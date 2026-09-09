/**
 * P5.2: the direct fetch path connects to the address the SSRF guard validated,
 * so a DNS answer that flips between validation and connection cannot redirect
 * the request to an internal address. Covers the pinned transport end to end
 * (real socket), the per-hop pinning, and the resolver/pin units.
 *
 * Run: node --test tests/fetch-pinning.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchWithSsrf, pinnedLookup, requestDirect, resolveSafeFetchTargetForService } from "../dsh-aux/src/fetch.js";

/** One local HTTP server for the real-socket cases. */
function listen(handler) {
  return listenOn("127.0.0.1", 0, handler);
}

/** Listen on a specific loopback address/port (127.0.0.2 shares 127.0.0.0/8). */
function listenOn(host, port, handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, port: address.port, url: "http://" + host + ":" + address.port });
    });
  });
}

/** Close a server and drop any socket still held open by a test. */
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

function serviceWith(lookup, transport) {
  return {
    allowInternalUrls: false,
    _dnsLookup: lookup,
    ...(transport === undefined ? {} : { _httpRequest: transport }),
  };
}

test("真跑: 钉扎连接把请求送到校验通过的 IP,Host 头仍是被请求的主机名", async () => {
  const seen = [];
  const { server, port, url } = await listen((req, res) => {
    seen.push(req.headers.host);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("PINNED_OK");
  });
  try {
    // 主机名不可解析(example.test),唯一地址来自钉扎集合 —— 请求必须仍然成功。
    const response = await requestDirect("http://pinned.example.test:" + port + "/probe", {
      addresses: [{ address: "127.0.0.1", family: 4 }],
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "PINNED_OK");
    assert.deepEqual(seen, ["pinned.example.test:" + port], "Host 头必须保留被请求的主机名");
    assert.equal(url.startsWith("http://127.0.0.1:"), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("TOCTOU: DNS 第二次解析翻到内网时,连接仍用校验通过的 IP(只解析一次)", async () => {
  let lookups = 0;
  const lookup = async () => {
    lookups += 1;
    // 第一次:公网;之后:云元数据地址(模拟翻转)。
    return lookups === 1 ? { address: "93.184.216.34" } : { address: "169.254.169.254" };
  };
  const pinned = [];
  const transport = async (url, options) => {
    // 走生产钉扎函数:它只能给出校验过的地址,不会再解析。
    const address = await new Promise((resolve, reject) => {
      pinnedLookup(options.addresses)("flip.example.test", { family: 4 }, (error, resolved) =>
        error === null ? resolve(resolved) : reject(error),
      );
    });
    pinned.push(address);
    return { ok: true, status: 200, headers: { get: () => "text/plain" }, text: async () => "ok" };
  };
  const service = serviceWith(lookup, transport);
  const { response, finalUrl } = await fetchWithSsrf(service, "https://flip.example.test/x", "web_extract");
  assert.equal(response.status, 200);
  assert.equal(finalUrl, "https://flip.example.test/x");
  assert.equal(lookups, 1, "校验只解析一次;第二次解析(会翻到内网)永不发生");
  assert.deepEqual(pinned, ["93.184.216.34"], "实际连接目标是校验通过的公网 IP");
});

test("逐跳钉扎: 重定向目标用自己的校验地址", async () => {
  const lookupCalls = [];
  const lookup = async (hostname) => {
    lookupCalls.push(hostname);
    if (hostname === "first.example.test") return { address: "93.184.216.34" };
    if (hostname === "second.example.test") return { address: "8.8.8.8" };
    return { address: "1.1.1.1" };
  };
  const hops = [];
  const transport = async (url, options) => {
    hops.push({ url: String(url), addresses: options.addresses.map((entry) => entry.address) });
    if (String(url) === "https://first.example.test/start") {
      return {
        ok: false,
        status: 302,
        headers: { get: () => "https://second.example.test/end" },
        text: async () => "",
      };
    }
    return { ok: true, status: 200, headers: { get: () => "text/plain" }, text: async () => "done" };
  };
  const { finalUrl } = await fetchWithSsrf(
    serviceWith(lookup, transport),
    "https://first.example.test/start",
    "web_extract",
  );
  assert.equal(finalUrl, "https://second.example.test/end");
  assert.deepEqual(lookupCalls, ["first.example.test", "second.example.test"]);
  assert.deepEqual(hops, [
    { url: "https://first.example.test/start", addresses: ["93.184.216.34"] },
    { url: "https://second.example.test/end", addresses: ["8.8.8.8"] },
  ]);
});

test("钉扎查找: 只服务校验过的地址,不触发 DNS", () => {
  const lookup = pinnedLookup([
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ]);
  const sync = (hostname, options) => {
    let result;
    lookup(hostname, options, (error, address, family) => {
      result = { error, address, family };
    });
    return result;
  };
  assert.deepEqual(sync("a.test", {}), { error: null, address: "93.184.216.34", family: 4 });
  assert.deepEqual(sync("a.test", { family: 6 }), {
    error: null,
    address: "2606:2800:220:1:248:1893:25c8:1946",
    family: 6,
  });
  const missing = sync("a.test", { family: 6 });
  assert.equal(missing.error, null);
  const onlyV4 = pinnedLookup([{ address: "93.184.216.34", family: 4 }]);
  let failure;
  onlyV4("a.test", { family: 6 }, (error) => {
    failure = error;
  });
  assert.equal(failure.code, "ENOTFOUND");
  let all;
  lookup("a.test", { all: true }, (error, addresses) => {
    all = { error, addresses };
  });
  assert.equal(all.error, null);
  assert.equal(all.addresses.length, 2);
});

test("resolveSafeFetchTargetForService: 字面量 IP 直接钉扎,内网解析被拒", async () => {
  const literal = await resolveSafeFetchTargetForService(
    serviceWith(async () => ({ address: "93.184.216.34" })),
    "http://93.184.216.34/x",
  );
  assert.deepEqual(literal.addresses, [{ address: "93.184.216.34", family: 4 }]);

  await assert.rejects(
    () =>
      resolveSafeFetchTargetForService(
        serviceWith(async () => ({ address: "10.0.0.5" })),
        "https://evil.test/x",
      ),
    /resolves to internal\/private address/,
  );

  const allowed = await resolveSafeFetchTargetForService(
    { allowInternalUrls: true, _dnsLookup: async () => ({ address: "10.0.0.5" }) },
    "http://internal.test/x",
  );
  assert.deepEqual(allowed.addresses, [], "allowInternalUrls 时不解析也不钉扎");
});

test("池复用: 同一 host:port 上两次不同钉扎集必须各打本次钉扎地址", async () => {
  const internalHits = [];
  const publicHits = [];
  // 127.0.0.2 模拟内网、127.0.0.1 模拟公网,两个 server 共享同一个端口,
  // 使 http.globalAgent 的池键(host:port)完全相同 —— 修复前第二次请求会
  // 复用第一次的 socket,被 127.0.0.2 的服务应答,本次钉扎集被完全绕过。
  const internal = await listenOn("127.0.0.2", 0, (req, res) => {
    internalHits.push(req.url);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("INTERNAL-SIM");
  });
  const publicSrv = await listenOn("127.0.0.1", internal.port, (req, res) => {
    publicHits.push(req.url);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("PUBLIC-SIM");
  });
  try {
    const first = await requestDirect("http://victim.example.test:" + internal.port + "/one", {
      addresses: [{ address: "127.0.0.2", family: 4 }],
    });
    assert.equal(await first.text(), "INTERNAL-SIM");
    const second = await requestDirect("http://victim.example.test:" + internal.port + "/two", {
      addresses: [{ address: "127.0.0.1", family: 4 }],
    });
    assert.equal(await second.text(), "PUBLIC-SIM", "第二次请求必须打到本次钉扎的 127.0.0.1");
    assert.deepEqual(internalHits, ["/one"], "第一次钉扎的地址只应收到第一次请求");
    assert.deepEqual(publicHits, ["/two"], "第二次钉扎的地址必须收到第二次请求");
  } finally {
    await closeServer(internal.server);
    await closeServer(publicSrv.server);
  }
});

test("连接隔离: 同一 host:port 顺序请求各建新连接(keep-alive 池不复用)", async () => {
  let connections = 0;
  const connectionHeaders = [];
  const { server, port } = await listen((req, res) => {
    connectionHeaders.push(req.headers.connection);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  server.on("connection", () => {
    connections += 1;
  });
  try {
    const addresses = [{ address: "127.0.0.1", family: 4 }];
    const first = await requestDirect("http://pooled.example.test:" + port + "/first", { addresses });
    assert.equal(await first.text(), "ok");
    const second = await requestDirect("http://pooled.example.test:" + port + "/second", { addresses });
    assert.equal(await second.text(), "ok");
    // 池复用会破坏「连接 = 本次校验地址」:agent:false 后每次直连必须新建 TCP。
    assert.equal(connections, 2, "每次直连都应新建连接(修复前池复用为 1)");
    // 记录 agent:false 的线上副作用:连接语义从 keep-alive 变为 close。
    assert.deepEqual(connectionHeaders, ["close", "close"], "不复用连接的直接后果:每请求一个连接");
  } finally {
    await closeServer(server);
  }
});

test("契约: requestDirect 的 Response.url 恒为空串,调用方必须用 finalUrl", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  try {
    const response = await requestDirect("http://url-contract.example.test:" + port + "/x", {
      addresses: [{ address: "127.0.0.1", family: 4 }],
    });
    // WHATWG Response 的构造函数没有 url 入参,手工构造的 Response.url 只能为空。
    // 这是文档化契约(见 fetch.js requestDirect 注释),不是待修 bug。
    assert.equal(response.url, "", "response.url 必须为空串:调用方只能读 fetchWithSsrf 的 finalUrl");
    assert.equal(await response.text(), "ok");
  } finally {
    await closeServer(server);
  }
});
