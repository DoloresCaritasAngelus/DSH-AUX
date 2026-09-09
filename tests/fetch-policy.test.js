/**
 * W3 policy locks: fail-closed strict resolution (#31), NO_PROXY bracketed IPv6
 * entries (#32), and the documented Response.url contract (#33). Offline:
 * loopback servers only, no real network.
 *
 * Run: node --test tests/fetch-policy.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  fetchWithSsrf,
  matchesNoProxy,
  proxyForUrl,
  requestDirect,
  resolveSafeFetchTargetForService,
} from "../dsh-aux/src/fetch.js";
import { resolveSafeFetchTarget } from "../dsh-aux/src/url-policy.js";

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function closeServer(server) {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  // A half-open connection can keep the close callback from firing; the
  // listening handle is already released, so a short grace period suffices.
  await new Promise((resolve) => {
    const grace = setTimeout(resolve, 250);
    server.close(() => {
      clearTimeout(grace);
      resolve();
    });
  });
}

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

async function withProxyEnv(env, fn) {
  const saved = {};
  for (const key of PROXY_ENV_KEYS) saved[key] = process.env[key];
  try {
    for (const key of PROXY_ENV_KEYS) delete process.env[key];
    Object.assign(process.env, env);
    return await fn();
  } finally {
    for (const key of PROXY_ENV_KEYS) {
      if (saved[key] === void 0) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// ── #31 严格模式空地址集 fail-closed ───────────────────────────────────────

test("resolveSafeFetchTarget: 严格解析结果全空时抛错,不再静默回落无钉扎传输", async () => {
  await assert.rejects(
    () => resolveSafeFetchTarget("http://empty.example.test/", { lookup: async () => [] }),
    /no usable address/,
    "lookup 返回空数组必须 fail closed",
  );
  await assert.rejects(
    () =>
      resolveSafeFetchTarget("http://junk.example.test/", {
        lookup: async () => [{ address: "not-an-ip", family: 4 }],
      }),
    /no usable address/,
    "无法解析成 IP 的条目必须 fail closed",
  );
  await assert.rejects(
    () => resolveSafeFetchTarget("http://blank.example.test/", { lookup: async () => ({}) }),
    /no usable address/,
  );
});

test("resolveSafeFetchTarget: 文档化豁免仍返回空地址集(allowInternalUrls / 无 lookup)", async () => {
  const allowed = await resolveSafeFetchTarget("http://internal.example.test/", {
    allowInternalUrls: true,
    lookup: async () => [],
  });
  assert.deepEqual(allowed.addresses, [], "allowInternalUrls 是显式放行,不算 fail-open");
  const noLookup = await resolveSafeFetchTarget("http://nolookup.example.test/");
  assert.deepEqual(noLookup.addresses, [], "没有 lookup 时不做严格解析(既有契约)");
});

test("fetchWithSsrf: 空地址集在发出请求前 fail-closed(传输不得被调用)", async () => {
  let transportCalls = 0;
  const service = {
    allowInternalUrls: false,
    _dnsLookup: async () => [{ address: "not-an-ip", family: 4 }],
    _httpRequest: async () => {
      transportCalls += 1;
      return { status: 200, headers: { get: () => "text/plain" }, text: async () => "unpinned" };
    },
  };
  await assert.rejects(
    () => fetchWithSsrf(service, "https://empty.example.test/x", "web_extract"),
    /no usable address/,
  );
  assert.equal(transportCalls, 0, "守卫失败必须发生在任何请求之前");
});

test("resolveSafeFetchTargetForService: 空地址集同样 fail-closed", async () => {
  await assert.rejects(
    () =>
      resolveSafeFetchTargetForService(
        { allowInternalUrls: false, _dnsLookup: async () => [{ address: "0.0.0.0.nope", family: 4 }] },
        "https://empty.example.test/x",
      ),
    /no usable address/,
  );
});

// ── #32 NO_PROXY 括号 IPv6 ────────────────────────────────────────────────

test("matchesNoProxy: 括号 IPv6 条目归一化后匹配", () => {
  assert.equal(matchesNoProxy("::1", "[::1]"), true, "NO_PROXY 常见写法 [::1] 必须命中");
  assert.equal(matchesNoProxy("::1", "[::1],localhost"), true);
  assert.equal(matchesNoProxy("2001:db8::1", "[2001:DB8::1]"), true, "大小写不敏感");
  assert.equal(matchesNoProxy("fe80::1", "[fe80::1]"), true);
  assert.equal(matchesNoProxy("::1", "[::2]"), false, "不同地址不得误匹配");
  assert.equal(matchesNoProxy("::1", "[]"), false, "空括号不得匹配任何地址");
  assert.equal(matchesNoProxy("[::1]", "[::1]"), true, "主机名侧的括号也应归一化");
});

test("matchesNoProxy: 既有语义(通配/后缀/IP/CIDR)不被归一化改动", () => {
  assert.equal(matchesNoProxy("example.com", ""), false);
  assert.equal(matchesNoProxy("example.com", "*"), true);
  assert.equal(matchesNoProxy("api.example.com", "example.com"), true);
  assert.equal(matchesNoProxy("other.org", "example.com"), false);
  assert.equal(matchesNoProxy("192.168.1.5", "192.168.0.0/16"), true);
  assert.equal(matchesNoProxy("8.8.8.8", "192.168.0.0/16"), false);
});

test("proxyForUrl: NO_PROXY=[::1] 时 IPv6 回环不走代理", async () => {
  await withProxyEnv({ HTTP_PROXY: "http://127.0.0.1:1", NO_PROXY: "[::1]" }, async () => {
    assert.equal(proxyForUrl(new URL("http://[::1]:8080/x")), null, "[::1] 命中后不得返回代理");
    assert.ok(proxyForUrl(new URL("http://[::2]:8080/x")) !== null, "未命中的 IPv6 仍应走代理");
  });
  await withProxyEnv({ HTTP_PROXY: "http://127.0.0.1:1", NO_PROXY: "::1" }, async () => {
    assert.equal(proxyForUrl(new URL("http://[::1]:8080/x")), null, "去括号写法继续命中(回归)");
  });
});

// ── #33 Response.url 契约(行为不变,锁定文档化契约)────────────────────────

test("契约: requestDirect 的 Response.url 恒为空串,调用方必须用 finalUrl", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  try {
    const response = await requestDirect(`http://url-contract.example.test:${port}/x`, {
      addresses: [{ address: "127.0.0.1", family: 4 }],
    });
    // WHATWG 的 Response 构造函数没有 url 入参,手工构造的 Response.url 只能为空;
    // 这是文档化契约(见 fetch.js requestDirect 注释),不是待修 bug。
    assert.equal(response.url, "", "response.url 必须为空串:调用方只能读 finalUrl");
    assert.equal(await response.text(), "ok");
  } finally {
    await closeServer(server);
  }
});
