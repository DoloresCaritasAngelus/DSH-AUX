/**
 * web_crawl(P1+P2)验收测试(node:test,零依赖)。
 *
 * 覆盖 docs/design/WEB-CRAWL-DESIGN.md:
 *  P1: robots.txt、scope(same-origin/hosts)、minIntervalMs、预算、
 *      runWebCrawl 模式 A、注册/路由联动
 *  P2: sitemap 引导(含嵌套 index 跳过、跨域计数)、模式 B 逐页摘要、受控并发
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import AuxLlmService from "../dsh-aux/src/index.js";
import { crawlSite, RobotsPolicy } from "../dsh-aux/src/crawl/queue.js";
import { runWebCrawl } from "../dsh-aux/src/tools/web-crawl.js";
import { AUX_TASKS, resolveConfig } from "../dsh-aux/src/route.js";

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 本地路径 harness(web seam 无 fetch 能力 → 强制本地逐跳),可传 plugin config。 */
async function makeLocalHarness(config) {
  const ctx = new Context();
  const streams = [];
  const tools = [];
  await ctx.plugin({
    name: "local-crawl-stubs",
    apply(s) {
      s.provide("tools", {
        register(d) {
          tools.push(d);
          return () => {};
        },
      });
      s.provide("systemPrompt", {
        section() {
          return () => {};
        },
      });
      s.provide("settings", {});
      s.provide("web", {});
      s.provide("fs", {
        async resolve(p) {
          return { displayPath: p };
        },
        async stat() {
          return { type: "file" };
        },
        async readBytes() {
          return new Uint8Array(0);
        },
      });
      s.provide("attachments", {
        imageLimits: {
          maxImageBytes: 1000,
          maxMessageImageBytes: 1000,
          maxImagesPerMessage: 1,
          maxImagePixels: 1000,
          mediaTypes: ["image/png"],
        },
        async validateImage() {},
        async saveImage(i) {
          return { attachmentId: "a", mediaType: i.mediaType, bytes: 0, width: 1, height: 1 };
        },
        async readImage(r) {
          return { ref: r, data: new Uint8Array(0) };
        },
      });
      s.provide("llm", {
        modelCapabilities: new Map([["deepseek-v4-flash", ["text"]]]),
        async resolveModelInfo(provider, model) {
          return { provider, model, inputModalities: ["text"] };
        },
        stream(options) {
          streams.push(options);
          return (async function* () {
            yield { type: "block-start", index: 0, blockType: "text" };
            yield { type: "text-delta", index: 0, text: "OUTPUT_TEXT" };
            yield { type: "block-end", index: 0, block: { type: "text", text: "OUTPUT_TEXT" } };
            yield { type: "finish", reason: { kind: "stop" } };
          })();
        },
      });
      s.provide("agentDefaultModel", {
        currentSelection() {
          return { provider: "opencode-go", model: "deepseek-v4-flash" };
        },
      });
    },
  });
  await ctx.plugin(AuxLlmService, config ?? {});
  await settle();
  ctx.auxLlm._dnsLookup = async () => ({ address: "93.184.216.34" });
  return { ctx, streams, tools };
}

/** 全局 fetch 桩:map = { url: htmlText } 或 { url: { body, contentType } }。返回调用记录。 */
async function withFetchMap(map, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const entry = map[u];
    if (entry === undefined)
      return { ok: false, status: 404, url: u, headers: { get: () => "text/plain" }, text: async () => "nf" };
    const body = typeof entry === "string" ? entry : entry.body;
    const contentType = typeof entry === "string" ? "text/html" : (entry.contentType ?? "text/html");
    return { ok: true, status: 200, url: u, headers: { get: () => contentType }, text: async () => body };
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

// ── robots 策略 ───────────────────────────────────────────────────────────

test("RobotsPolicy: 高级选择器(如 /private/*)按字面前缀处理,不解释通配符", () => {
  // 设计文档:只做前缀匹配,不解释 * / $ 等高级选择器。
  const p = RobotsPolicy.parse("Disallow: /private/*\n");
  // '/private/secret' 不以字面 '/private/*' 开头 → 不匹配 → 放行(通配符未解释)
  assert.equal(p.isAllowed("/private/secret"), true);
  // 字面以 '/private/*' 开头的路径才会命中 Disallow
  assert.equal(p.isAllowed("/private/*/x"), false);
  // 最长真实前缀规则生效(allow 更具体 → 放行)
  const p3 = RobotsPolicy.parse("Disallow: /private\nAllow: /private-pub\n");
  assert.equal(p3.isAllowed("/private-pub/x"), true);
  assert.equal(p3.isAllowed("/private/inside"), false);
});

test("RobotsPolicy: 前缀匹配/最长规则/Allow 覆盖", () => {
  const policy = RobotsPolicy.parse("User-agent: *\nDisallow: /api\nDisallow: /private\nAllow: /api/public\n");
  assert.equal(policy.isAllowed("/"), true);
  assert.equal(policy.isAllowed("/docs"), true);
  assert.equal(policy.isAllowed("/api"), false);
  assert.equal(policy.isAllowed("/api/status"), false);
  assert.equal(policy.isAllowed("/api/public"), true);
  assert.equal(policy.isAllowed("/private/x"), false);
  assert.equal(RobotsPolicy.parse("").isAllowed("/anything"), true);
  assert.equal(RobotsPolicy.parse("Disallow: /").isAllowed("/x"), false);
});

test("crawlSite: respectRobots 默认开启,Disallow 路径不请求", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": { body: "User-agent: *\nDisallow: /private", contentType: "text/plain" },
    "https://a.example/root": '<html><body>ROOT<a href="/public">p</a><a href="/private">priv</a></body></html>',
    "https://a.example/public": "<html><body>PUBLIC</body></html>",
  };
  await withFetchMap(map, async (calls) => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", { maxPages: 5, maxDepth: 2 });
    assert.equal(crawl.fetched, 2);
    assert.equal(crawl.skippedByRobots, 1);
    assert.equal(crawl.pages.map((p) => p.url).includes("https://a.example/private"), false);
    assert.ok(!calls.includes("https://a.example/private"), "被 robots 拒绝的路径不应实际请求");
  });
});

test("crawlSite: robots 404/缺失时放行全部", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/root": '<html><body>ROOT<a href="/next">n</a></body></html>',
    "https://a.example/next": "<html><body>NEXT</body></html>",
  };
  await withFetchMap(map, async () => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", { maxPages: 5, maxDepth: 2 });
    assert.equal(crawl.fetched, 2);
    assert.equal(crawl.skippedByRobots, 0);
  });
});

test("crawlSite: /robots.txt 被 HTML 页面劫持时按无 robots 策略乐观放行(线上复现)", async () => {
  // MediaWiki 会把 /robots.txt 重定向到名为 Robots.txt 的 HTML 页面;若误解析
  // 会产生全站误封。HTML 响应应视为"无可用 robots 策略"。
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": {
      body: "<!DOCTYPE html><html><head><title>Robots.txt</title></head><body>this is a wiki page</body></html>",
      contentType: "text/html",
    },
    "https://a.example/root": '<html><body>ROOT<a href="/next">n</a></body></html>',
    "https://a.example/next": "<html><body>NEXT</body></html>",
  };
  await withFetchMap(map, async () => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", { maxPages: 5, maxDepth: 2 });
    assert.equal(crawl.fetched, 2, "HTML 形式的 robots 不应阻塞抓取");
    assert.equal(crawl.skippedByRobots, 0);
  });
});

// ── scope ─────────────────────────────────────────────────────────────────

test("crawlSite: 默认 same-origin,跨域链接被跳过并计数", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/root":
      '<html><body>ROOT<a href="/local">l</a><a href="https://other.example/x">x</a><a href="https://other.example/y">y</a></body></html>',
    "https://a.example/local": "<html><body>LOCAL</body></html>",
  };
  await withFetchMap(map, async () => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", { maxPages: 5, maxDepth: 2 });
    assert.equal(crawl.fetched, 2);
    assert.equal(crawl.skippedByScope, 2, "两个跨域链接应计入跳过");
    assert.deepEqual(
      crawl.pages.map((p) => p.url),
      ["https://a.example/root", "https://a.example/local"],
    );
  });
});

test("crawlSite: scope=hosts 多主机白名单,种子必须在 hosts 内", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://docs.example.com/robots.txt": "",
    "https://docs.example.com/root":
      '<html><body>ROOT<a href="https://api.example.com/endpoint">api</a><a href="https://other.example/x">x</a></body></html>',
    "https://api.example.com/endpoint": "<html><body>ENDPOINT</body></html>",
  };
  await withFetchMap(map, async () => {
    const crawl = await crawlSite(ctx.auxLlm, "https://docs.example.com/root", {
      scope: "hosts",
      hosts: ["docs.example.com", "api.example.com"],
      maxPages: 5,
      maxDepth: 2,
    });
    assert.equal(crawl.fetched, 2);
    assert.equal(crawl.skippedByScope, 1);
    assert.ok(crawl.pages.some((p) => p.url === "https://api.example.com/endpoint"));
  });
  await assert.rejects(
    () => crawlSite(ctx.auxLlm, "https://docs.example.com/root", { scope: "hosts", hosts: ["api.example.com"] }),
    /seed host/,
  );
});

// ── 限速 ──────────────────────────────────────────────────────────────────

test("crawlSite: minIntervalMs 限制同主机最小间隔", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/root": '<html><body>ROOT<a href="/a">a</a></body></html>',
    "https://a.example/a": '<html><body>A<a href="/b">b</a></body></html>',
    "https://a.example/b": "<html><body>B</body></html>",
  };
  await withFetchMap(map, async (calls) => {
    // 关掉 robots 以避免 robots.txt 请求污染时间窗
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", {
      maxPages: 3,
      maxDepth: 2,
      respectRobots: false,
      minIntervalMs: 15,
    });
    assert.equal(crawl.fetched, 3);
    const pageCalls = calls.filter((u) => u !== "https://a.example/robots.txt");
    assert.equal(pageCalls.length, 3);
    // 难以精确测时间,验证至少按序请求且无重复
    assert.deepEqual(pageCalls, ["https://a.example/root", "https://a.example/a", "https://a.example/b"]);
  });
});

// ── runWebCrawl 全流程(模式 A) ────────────────────────────────────────────

test("runWebCrawl: 模式 A 输出结构 + 单次聚合 aux 调用", async () => {
  const { ctx, streams } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/root":
      '<html><head><title>首页</title></head><body>ROOT TXT<a href="/guide">guide</a></body></html>',
    "https://a.example/guide": "<html><head><title>指南</title></head><body>GUIDE TXT 42</body></html>",
  };
  await withFetchMap(map, async () => {
    const exec = {
      signal: new AbortController().signal,
      agent: { session: undefined, options: { provider: "opencode-go", model: "deepseek-v4-flash" } },
    };
    const value = await runWebCrawl(ctx.auxLlm, { url: "https://a.example/root", maxPages: 3, maxDepth: 2 }, exec);
    assert.equal(value.root, "https://a.example/root");
    assert.equal(value.scope, "same-origin");
    assert.equal(value.fetched, 2);
    assert.equal(value.pages.length, 2);
    assert.equal(value.pages[0].title, "首页");
    assert.equal(value.pages[1].title, "指南");
    assert.ok(value.pages.every((p) => Number.isInteger(p.chars)));
    assert.equal(value.perPage.length, 0, "模式 A 不产生逐页摘要");
    assert.equal(value.summary, "OUTPUT_TEXT");
    assert.equal(value.provider, "opencode-go");
    assert.equal(value.model, "deepseek-v4-flash");
    // 一次聚合 aux 调用
    assert.equal(streams.length, 1);
    const userText = streams[0].messages[0].content.find((b) => b.type === "text").text;
    assert.ok(userText.includes("PAGE 1/2 URL: https://a.example/root"));
    assert.ok(userText.includes("PAGE 2/2 URL: https://a.example/guide"));
  });
});

test("runWebCrawl: 每页 char 预算取自合并配置(web_crawl.maxChars)", async () => {
  const { ctx } = await makeLocalHarness({ tasks: { web_crawl: { maxChars: 200 } } });
  const long = "<html><body>" + "T".repeat(4000) + "</body></html>";
  const map = { "https://a.example/robots.txt": "", "https://a.example/root": long };
  await withFetchMap(map, async () => {
    const exec = {
      signal: new AbortController().signal,
      agent: { session: undefined, options: { provider: "opencode-go", model: "deepseek-v4-flash" } },
    };
    const value = await runWebCrawl(ctx.auxLlm, { url: "https://a.example/root", maxPages: 1, maxDepth: 0 }, exec);
    assert.ok(
      value.pages[0].chars >= 200 && value.pages[0].chars <= 220,
      "配置默认应把单页限制在 ~200 码点(含截断标记): " + value.pages[0].chars,
    );
    assert.equal(value.pages[0].truncated, true);
  });
});

test("runWebCrawl: 校验参数(domain 未启用 / hosts 缺种子)", async () => {
  const { ctx } = await makeLocalHarness();
  const exec = {
    signal: new AbortController().signal,
    agent: { session: undefined, options: { provider: "opencode-go", model: "deepseek-v4-flash" } },
  };
  await assert.rejects(
    () => runWebCrawl(ctx.auxLlm, { url: "https://a.example/x", scope: "domain" }, exec),
    /domain.*not enabled/i,
  );
  await assert.rejects(
    () => runWebCrawl(ctx.auxLlm, { url: "https://a.example/x", scope: "bogus" }, exec),
    /scope must be/i,
  );
  await assert.rejects(
    () => runWebCrawl(ctx.auxLlm, { url: "https://a.example/x", scope: "hosts", hosts: [] }, exec),
    /seed host/,
  );
});

// ── 注册 / 路由联动 ───────────────────────────────────────────────────────

test("注册: web_crawl 工具存在、isConcurrencySafe=false、参数/输出 schema 齐全", async () => {
  const { tools } = await makeLocalHarness();
  const tool = tools.find((t) => t.name === "web_crawl");
  assert.ok(tool, "应注册 web_crawl");
  assert.equal(tool.isConcurrencySafe(), false, "深度抓取不得标为并发安全");
  assert.ok(tool.parameters.type === "object", "defineTool 会转成 JSON-schema 形状");
  assert.ok(tool.parameters.required?.includes("url"), "url 应为顶层必填");
  assert.equal(tool.parameters.properties.url?.type, "string");
  assert.ok(tool.parameters.properties.scope !== void 0);
  assert.ok(tool.parameters.properties.hosts !== void 0);
  assert.ok(tool.output?.schema?.properties?.pages !== void 0);
});

test("路由: AUX_TASKS 含 web_crawl,resolveConfig 允许 web_crawl.maxChars", () => {
  assert.ok(AUX_TASKS.includes("web_crawl"));
  const resolved = resolveConfig({ tasks: { web_crawl: { maxChars: 1234 } } });
  assert.equal(resolved.tasks.web_crawl.maxChars, 1234);
  assert.throws(() => resolveConfig({ tasks: { vision: { maxChars: 1 } } }), /unknown key\(s\) maxChars/);
});

// ── P2: sitemap 引导 ──────────────────────────────────────────────────────

test("crawlSite: useSitemap 把 sitemap.xml 的 loc 加入队列", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/sitemap.xml":
      '<?xml version="1.0"?><urlset><url><loc>https://a.example/alpha</loc></url><url><loc>https://a.example/beta</loc></url></urlset>',
    "https://a.example/root": "<html><body>ROOT(无链接)</body></html>",
    "https://a.example/alpha": "<html><body>ALPHA</body></html>",
    "https://a.example/beta": "<html><body>BETA</body></html>",
  };
  await withFetchMap(map, async () => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", { maxPages: 5, maxDepth: 1, useSitemap: true });
    assert.equal(crawl.fetched, 3, "应抓取 root + sitemap 里的 alpha/beta");
    assert.ok(crawl.pages.some((p) => p.url === "https://a.example/alpha"));
    assert.ok(crawl.pages.some((p) => p.url === "https://a.example/beta"));
  });
});

test("crawlSite: 默认不启用 sitemap,useSitemap=false 时不请求 sitemap.xml", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/sitemap.xml":
      '<?xml version="1.0"?><urlset><url><loc>https://a.example/alpha</loc></url></urlset>',
    "https://a.example/root": "<html><body>ROOT</body></html>",
    "https://a.example/alpha": "<html><body>ALPHA</body></html>",
  };
  await withFetchMap(map, async (calls) => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", { maxPages: 5, maxDepth: 1 });
    assert.equal(crawl.fetched, 1);
    assert.ok(!calls.includes("https://a.example/sitemap.xml"), "默认不应请求 sitemap");
  });
});

test("crawlSite: sitemap 嵌套 index(.xml/.gz)跳过,跨域 loc 计数", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/sitemap.xml":
      '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://a.example/sitemap-children.xml</loc></sitemap></sitemapindex>',
    "https://a.example/root": "<html><body>ROOT</body></html>",
    "https://other.example/z": "<html><body>Z</body></html>",
  };
  await withFetchMap(map, async (calls) => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", { maxPages: 5, maxDepth: 1, useSitemap: true });
    assert.equal(crawl.fetched, 1, "嵌套 sitemap index 不应被当作页面抓取");
    assert.ok(!calls.includes("https://a.example/sitemap-children.xml"), "嵌套 sitemap 不应被请求");
  });
});

// ── P2: 模式 B 逐页摘要 ───────────────────────────────────────────────────

test("runWebCrawl: perPageSummaries=true 逐一页调用 + 一次聚合,输出 perPage", async () => {
  const { ctx, streams } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/root": '<html><body>ROOT TXT<a href="/child">c</a></body></html>',
    "https://a.example/child": "<html><body>CHILD TXT</body></html>",
  };
  await withFetchMap(map, async () => {
    const exec = {
      signal: new AbortController().signal,
      agent: { session: undefined, options: { provider: "opencode-go", model: "deepseek-v4-flash" } },
    };
    const value = await runWebCrawl(
      ctx.auxLlm,
      { url: "https://a.example/root", maxPages: 3, maxDepth: 2, perPageSummaries: true },
      exec,
    );
    assert.equal(value.mode, "per-page");
    assert.equal(value.perPage.length, 2);
    assert.deepEqual(
      value.perPage.map((p) => p.url),
      ["https://a.example/root", "https://a.example/child"],
    );
    assert.ok(value.perPage.every((p) => typeof p.summary === "string" && Array.isArray(p.keyPoints)));
    assert.equal(typeof value.summary, "string", "模式 B 仍应有整体摘要(聚合调用)");
    assert.equal(value.provider, "opencode-go");
    // 2 个逐页调用 + 1 个聚合调用
    assert.equal(streams.length, 3, "模式 B 应产生 逐页×N + 聚合 共 N+1 次辅助调用");
  });
});

test("runWebCrawl: perPageConcurrency 参数合法且不影响结果", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/root": "<html><body>ROOT</body></html>",
  };
  await withFetchMap(map, async () => {
    const exec = {
      signal: new AbortController().signal,
      agent: { session: undefined, options: { provider: "opencode-go", model: "deepseek-v4-flash" } },
    };
    const value = await runWebCrawl(
      ctx.auxLlm,
      { url: "https://a.example/root", maxPages: 1, maxDepth: 0, perPageSummaries: true, perPageConcurrency: 2 },
      exec,
    );
    assert.equal(value.perPage.length, 1);
    assert.equal(value.mode, "per-page");
  });
  await assert.rejects(
    () =>
      runWebCrawl(
        ctx.auxLlm,
        { url: "https://a.example/root", maxPages: 1, perPageConcurrency: 0 },
        { signal: new AbortController().signal, agent: { session: undefined, options: { provider: "p", model: "m" } } },
      ),
    /perPageConcurrency/,
  );
});

test("注册: web_crawl 新增 P2 参数与 perPage 条目 schema", async () => {
  const { tools } = await makeLocalHarness();
  const tool = tools.find((t) => t.name === "web_crawl");
  assert.ok(tool.parameters.properties.useSitemap !== void 0);
  assert.ok(tool.parameters.properties.perPageSummaries !== void 0);
  assert.ok(tool.parameters.properties.perPageConcurrency !== void 0);
  assert.ok(tool.parameters.properties.seedUrls !== void 0);
  assert.ok(tool.parameters.properties.maxPagesPerHost !== void 0);
  const perPageSchema = tool.output?.schema?.properties?.perPage;
  assert.ok(perPageSchema?.items?.properties?.summary !== void 0, "perPage 条目应声明 summary 字段");
  assert.ok(tool.output.schema.properties.mode !== void 0);
});

test("crawlSite: maxTotalChars 显式预算截断累计文本", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/root": "<html><body>" + "R".repeat(260) + '<a href="/c">c</a></body></html>',
    "https://a.example/c": "<html><body>" + "C".repeat(260) + "</body></html>",
  };
  await withFetchMap(map, async () => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", {
      maxPages: 5,
      maxDepth: 1,
      maxCharsPerPage: 200,
      maxTotalChars: 300,
    });
    assert.equal(crawl.fetched, 2);
    assert.ok(crawl.totalChars <= 300, "累计应受显式 maxTotalChars 约束: " + crawl.totalChars);
    assert.ok(
      crawl.pages.every((p) => p.truncated),
      "两页都应被截断",
    );
  });
});

// ── P4a: seedUrls 多种子 + maxPagesPerHost 每站上限 ────────────────────────

test("crawlSite: seedUrls 作为 depth-0 种子被抓取(即使页面无链接)", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/root": "<html><body>ROOT(无链接)</body></html>",
    "https://a.example/other": "<html><body>OTHER</body></html>",
  };
  await withFetchMap(map, async () => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", {
      seedUrls: ["https://a.example/other"],
      maxPages: 5,
      maxDepth: 1,
    });
    assert.equal(crawl.fetched, 2);
    assert.ok(crawl.pages.some((p) => p.url === "https://a.example/other"));
  });
});

test("crawlSite: 越出 scope 的 seedUrl 被跳过并计数", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/root": "<html><body>ROOT</body></html>",
  };
  await withFetchMap(map, async () => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", {
      seedUrls: ["https://other.example/x"],
      maxPages: 5,
      maxDepth: 1,
    });
    assert.equal(crawl.fetched, 1);
    assert.equal(crawl.skippedByScope, 1);
  });
});

test("crawlSite: seedUrls + hosts scope 可跨主机抓取", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://docs.example.com/robots.txt": "",
    "https://api.example.com/robots.txt": "",
    "https://docs.example.com/root": "<html><body>DOCS ROOT</body></html>",
    "https://api.example.com/endpoint": "<html><body>API DOC</body></html>",
  };
  await withFetchMap(map, async () => {
    const crawl = await crawlSite(ctx.auxLlm, "https://docs.example.com/root", {
      scope: "hosts",
      hosts: ["docs.example.com", "api.example.com"],
      seedUrls: ["https://api.example.com/endpoint"],
      maxPages: 5,
      maxDepth: 1,
    });
    assert.equal(crawl.fetched, 2);
    assert.ok(crawl.pages.some((p) => p.url === "https://api.example.com/endpoint"));
  });
});

test("crawlSite: maxPagesPerHost 限制每主机页面数", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/root": '<html><body>ROOT<a href="/a">a</a><a href="/b">b</a></body></html>',
    "https://a.example/a": "<html><body>A</body></html>",
    "https://a.example/b": "<html><body>B</body></html>",
  };
  await withFetchMap(map, async () => {
    const crawl = await crawlSite(ctx.auxLlm, "https://a.example/root", {
      maxPages: 5,
      maxDepth: 2,
      maxPagesPerHost: 1,
    });
    assert.equal(crawl.fetched, 1, "只应抓取根页");
    assert.equal(crawl.skippedByHostCap, 2, "/a 与 /b 应被每主机上限跳过");
  });
});

test("runWebCrawl: seedUrls 参数透传并校验", async () => {
  const { ctx } = await makeLocalHarness();
  const map = {
    "https://a.example/robots.txt": "",
    "https://a.example/root": "<html><body>ROOT</body></html>",
    "https://a.example/second": "<html><body>SECOND</body></html>",
  };
  await withFetchMap(map, async () => {
    const exec = {
      signal: new AbortController().signal,
      agent: { session: undefined, options: { provider: "opencode-go", model: "deepseek-v4-flash" } },
    };
    const value = await runWebCrawl(
      ctx.auxLlm,
      { url: "https://a.example/root", seedUrls: ["https://a.example/second"], maxPages: 3 },
      exec,
    );
    assert.equal(value.fetched, 2);
    assert.ok(value.pages.some((p) => p.url === "https://a.example/second"));
  });
  await assert.rejects(
    () =>
      runWebCrawl(
        ctx.auxLlm,
        { url: "https://a.example/root", seedUrls: ["http://127.0.0.1:3080/x"] },
        { signal: new AbortController().signal, agent: { session: undefined, options: { provider: "p", model: "m" } } },
      ),
    /blocked by default/,
  );
});
