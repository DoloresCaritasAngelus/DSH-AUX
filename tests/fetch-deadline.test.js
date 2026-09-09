/**
 * W3: unconditional connect/first-byte + idle deadlines on the direct transport
 * (the PR replaced undici's global fetch and with it its 300s default bound),
 * plus the interaction with the existing proxy fallback. Offline: loopback
 * servers only, every proxy env var is explicitly cleared/set per test.
 *
 * Run: node --test tests/fetch-deadline.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import { fetchViaProxy, fetchWithSsrf, requestDirect } from "../dsh-aux/src/fetch.js";
// Namespace import so the deadline constants are read at run time: against a
// build without them the file still loads and the behavioural tests fail by
// hanging (test timeout) instead of dying on an import SyntaxError.
import * as fetchModule from "../dsh-aux/src/fetch.js";

const { DEFAULT_CONNECT_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS } = fetchModule;

/** Local HTTP server; a handler that never responds simulates a silent drop. */
function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function closeServer(server) {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  // A half-open connection (e.g. a CONNECT aborted mid-handshake) can keep the
  // close callback from firing; the listening handle is already released, so a
  // short grace period is enough to finish the test.
  await new Promise((resolve) => {
    const grace = setTimeout(resolve, 250);
    server.close(() => {
      clearTimeout(grace);
      resolve();
    });
  });
}

/** Every proxy env key the transport consults. */
const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];

function saveProxyEnv() {
  const saved = {};
  for (const key of PROXY_ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreProxyEnv(saved) {
  for (const key of PROXY_ENV_KEYS) {
    if (saved[key] === void 0) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

/** Run fn as a no-proxy deployment (every proxy env var unset). */
async function withoutProxyEnv(fn) {
  const saved = saveProxyEnv();
  try {
    for (const key of PROXY_ENV_KEYS) delete process.env[key];
    return await fn();
  } finally {
    restoreProxyEnv(saved);
  }
}

/** Run fn with exactly the given proxy env (all other keys unset). */
async function withProxyEnv(env, fn) {
  const saved = saveProxyEnv();
  try {
    for (const key of PROXY_ENV_KEYS) delete process.env[key];
    Object.assign(process.env, env);
    return await fn();
  } finally {
    restoreProxyEnv(saved);
  }
}

/** Minimal local CONNECT proxy forwarding every tunnel to 127.0.0.1:targetPort. */
function startConnectProxy(targetPort) {
  const server = createServer();
  server.on("connect", (req, clientSocket, head) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    upstream.on("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length > 0) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/** accept-all service: no DNS, no pinning, real loopback connection. */
function localService(overrides = {}) {
  return { allowInternalUrls: true, ...overrides };
}

function isTimeout(error) {
  return error?.code === "ETIMEDOUT" || /timed out/i.test(String(error?.message ?? error));
}

test("默认 deadline 常量落在建议区间(connect 10-15s, idle 30-60s)", () => {
  assert.ok(DEFAULT_CONNECT_TIMEOUT_MS >= 10_000, "connect deadline 不应低于 10s: " + DEFAULT_CONNECT_TIMEOUT_MS);
  assert.ok(DEFAULT_CONNECT_TIMEOUT_MS <= 15_000, "connect deadline 不应高于 15s: " + DEFAULT_CONNECT_TIMEOUT_MS);
  assert.ok(DEFAULT_IDLE_TIMEOUT_MS >= 30_000, "idle deadline 不应低于 30s: " + DEFAULT_IDLE_TIMEOUT_MS);
  assert.ok(DEFAULT_IDLE_TIMEOUT_MS <= 60_000, "idle deadline 不应高于 60s: " + DEFAULT_IDLE_TIMEOUT_MS);
});

test("requestDirect: 服务端接受连接但永不响应时按首字节 deadline 失败", { timeout: 5000 }, async () => {
  const { server, port } = await listen(() => {});
  try {
    const started = Date.now();
    await assert.rejects(
      () => requestDirect(`http://127.0.0.1:${port}/hang`, { connectTimeoutMs: 200, idleTimeoutMs: 5000 }),
      isTimeout,
      "无 deadline 的实现会永远挂起(本测试 5s 超时即红)",
    );
    assert.ok(Date.now() - started < 3000, "应在 connect deadline 附近失败,实际 " + (Date.now() - started) + "ms");
  } finally {
    await closeServer(server);
  }
});

test("requestDirect: 响应头已到但正文停滞时按 idle deadline 失败", { timeout: 5000 }, async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
    // never end(): the body stalls after the first chunk.
  });
  try {
    const response = await requestDirect(`http://127.0.0.1:${port}/stall`, {
      connectTimeoutMs: 5000,
      idleTimeoutMs: 200,
    });
    assert.equal(response.status, 200, "首字节按期到达:不应被 connect deadline 误杀");
    await assert.rejects(() => response.text(), isTimeout, "正文停滞必须按 idle deadline 失败");
  } finally {
    await closeServer(server);
  }
});

test("fetchWithSsrf: 无代理部署下静默丢包按 deadline 失败(修复前无界挂起)", { timeout: 5000 }, async () => {
  const { server, port } = await listen(() => {});
  try {
    await withoutProxyEnv(async () => {
      const started = Date.now();
      await assert.rejects(
        () =>
          fetchWithSsrf(
            localService({ _connectTimeoutMs: 200, _idleTimeoutMs: 5000 }),
            `http://127.0.0.1:${port}/hang`,
            "web_extract",
          ),
        isTimeout,
        "无代理部署也必须无条件有界(不依赖 env proxy)",
      );
      assert.ok(Date.now() - started < 3000, "应在 deadline 附近失败,实际 " + (Date.now() - started) + "ms");
    });
  } finally {
    await closeServer(server);
  }
});

test("fetchWithSsrf: 慢速但持续响应的正文不被 idle deadline 误杀", { timeout: 10_000 }, async () => {
  const chunkCount = 8;
  const chunkSize = 64;
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    let sent = 0;
    const tick = () => {
      if (sent >= chunkCount) {
        res.end();
        return;
      }
      sent += 1;
      res.write("x".repeat(chunkSize));
      setTimeout(tick, 60);
    };
    tick();
  });
  try {
    await withoutProxyEnv(async () => {
      const { response } = await fetchWithSsrf(
        localService({ _connectTimeoutMs: 5000, _idleTimeoutMs: 250 }),
        `http://127.0.0.1:${port}/slow`,
        "web_extract",
      );
      const body = await response.text();
      assert.equal(body.length, chunkCount * chunkSize, "总时长超过 idle 值但每块间隔小于它:不得误杀");
    });
  } finally {
    await closeServer(server);
  }
});

test("fetchWithSsrf: 调用方 abort 立即失败且不转代理兜底", { timeout: 5000 }, async () => {
  const { server, port } = await listen(() => {});
  const proxy = await startConnectProxy(port);
  let proxyConnects = 0;
  proxy.server.on("connect", () => {
    proxyConnects += 1;
  });
  try {
    await withProxyEnv({ HTTP_PROXY: `http://127.0.0.1:${proxy.port}` }, async () => {
      const controller = new AbortController();
      const pending = fetchWithSsrf(
        localService({ _connectTimeoutMs: 30_000, _idleTimeoutMs: 30_000 }),
        `http://127.0.0.1:${port}/x`,
        "web_extract",
        controller.signal,
      );
      setTimeout(() => controller.abort(), 50);
      await assert.rejects(pending, (error) => error?.name === "AbortError" || /abort/i.test(String(error?.message)));
      assert.equal(proxyConnects, 0, "调用方取消不得被当成传输失败去走代理");
    });
  } finally {
    await closeServer(proxy.server);
    await closeServer(server);
  }
});

test("fetchWithSsrf: 直连 deadline 触发后仍按既有语义转代理兜底", { timeout: 10_000 }, async () => {
  const healthy = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("VIA_PROXY");
  });
  const hanging = await listen(() => {});
  const proxy = await startConnectProxy(healthy.port);
  let proxyConnects = 0;
  proxy.server.on("connect", () => {
    proxyConnects += 1;
  });
  try {
    await withProxyEnv({ HTTP_PROXY: `http://127.0.0.1:${proxy.port}` }, async () => {
      const { response, finalUrl } = await fetchWithSsrf(
        localService({ _connectTimeoutMs: 200, _idleTimeoutMs: 5000 }),
        `http://127.0.0.1:${hanging.port}/via-proxy`,
        "web_extract",
      );
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "VIA_PROXY");
      assert.equal(proxyConnects, 1, "直连 deadline 属于传输失败:应兜底到代理隧道");
      assert.equal(finalUrl, `http://127.0.0.1:${hanging.port}/via-proxy`);
    });
  } finally {
    await closeServer(proxy.server);
    await closeServer(healthy.server);
    await closeServer(hanging.server);
  }
});

test("代理隧道: 隧道内正文停滞也按 idle deadline 失败(代理路径同样有界)", { timeout: 5000 }, async () => {
  const stalling = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
    // never end(): the tunneled body stalls after the first chunk.
  });
  const proxy = await startConnectProxy(stalling.port);
  try {
    await withProxyEnv({ HTTP_PROXY: `http://127.0.0.1:${proxy.port}` }, async () => {
      const response = await fetchViaProxy(`http://stall-tunnel.example.test:${stalling.port}/x`, {
        via: "proxy",
        connectTimeoutMs: 5000,
        idleTimeoutMs: 200,
      });
      assert.equal(response.status, 200);
      await assert.rejects(() => response.text(), isTimeout, "隧道内正文停滞必须按 idle deadline 失败");
    });
  } finally {
    await closeServer(proxy.server);
    await closeServer(stalling.server);
  }
});

test("代理 CONNECT: 代理接受 TCP 但不应答时按 connect deadline 失败", { timeout: 5000 }, async () => {
  // 只接受连接、永不回应的“哑代理”。
  const silentProxy = net.createServer(() => {});
  await new Promise((resolve) => silentProxy.listen(0, "127.0.0.1", resolve));
  const proxyPort = silentProxy.address().port;
  try {
    await withProxyEnv({ HTTP_PROXY: `http://127.0.0.1:${proxyPort}` }, async () => {
      const started = Date.now();
      await assert.rejects(
        () => fetchViaProxy("http://target.invalid:8080/x", { via: "proxy", connectTimeoutMs: 200 }),
        isTimeout,
        "代理握手无应答时不得无限挂起",
      );
      assert.ok(Date.now() - started < 3000, "应在 connect deadline 附近失败,实际 " + (Date.now() - started) + "ms");
    });
  } finally {
    await closeServer(silentProxy);
  }
});
