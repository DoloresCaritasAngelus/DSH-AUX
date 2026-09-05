/**
 * dsh-aux `web_crawl` tool implementation (design: docs/design/WEB-CRAWL-DESIGN.md).
 *
 * Depth-crawls a documentation site (or a whitelisted host set) from a seed
 * URL through the shared crawl core, then summarizes the whole site with one
 * auxiliary call (mode A). Every page and every hop goes through the
 * seam-first + per-hop SSRF path; robots.txt and per-host rate limits are on
 * by default. Static HTML only — no JavaScript rendering.
 *
 * @module @dolorescaritasangelus/dsh-aux/tools/web-crawl
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  extractKeyPoints,
  webExtractSystemPrompt,
  webExtractUserMessage,
  webExtractUserMessageMulti,
} from "../prompt.js";
import { CRAWL_DEFAULTS, crawlSite } from "../crawl/queue.js";
import { codePointCount } from "../crawl/text.js";
import { assertSafeFetchUrlForService } from "../fetch.js";
import { DEFAULT_MAX_CHARS } from "../route.js";

function coercePositiveInt(value, name, fallback, label) {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v <= 0) {
    throw new Error(`${label}: ${name} must be a positive integer`);
  }
  return v;
}

function coerceNonNegInt(value, name, fallback, label) {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v < 0) {
    throw new Error(`${label}: ${name} must be a non-negative integer`);
  }
  return v;
}

/** Resolve the per-page char budget: call arg > per-task config > default. */
function resolvePerPageChars(service, args) {
  return coercePositiveInt(
    args?.maxCharsPerPage,
    "maxCharsPerPage",
    service?._merged?.web_crawl?.maxChars ?? DEFAULT_MAX_CHARS,
    "web_crawl",
  );
}

/** One aux summarization call across all crawled pages (mode A). */
async function callCrawlSummarizer(service, userText, inputChars, exec) {
  const messages = [
    createUserMessage({
      content: [{ type: "text", text: userText }],
      source: { kind: "plugin", plugin: "dsh-aux" },
    }),
  ];
  return service.call("web_crawl", {
    messages,
    system: webExtractSystemPrompt(),
    temperature: 0.2,
    session: exec.agent?.session,
    agent: exec.agent,
    signal: exec.signal,
    inputChars,
  });
}

/** Run `fn` over items with at most `limit` concurrent workers (order
 * preserved). Errors are captured per item so every worker settles (no
 * dangling aux calls when one page fails); the FIRST error is rethrown after
 * all workers finish. */
async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let firstError;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) break;
      try {
        results[index] = { ok: true, value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { ok: false };
        if (firstError === void 0) firstError = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  if (firstError !== void 0) throw firstError;
  return results.map((r) => r.value);
}

/** web_crawl execution. */
export async function runWebCrawl(service, args, exec) {
  if (typeof args?.url !== "string") {
    throw new Error("web_crawl: url must be a non-empty string");
  }
  const url = args.url.trim();
  if (url.length === 0) throw new Error("web_crawl: url must be a non-empty string");
  await assertSafeFetchUrlForService(service, url, "web_crawl");

  const scope = args.scope ?? "same-origin";
  if (scope !== "same-origin" && scope !== "hosts") {
    throw new Error('web_crawl: scope must be "same-origin" or "hosts" (domain not enabled in v1)');
  }
  const hosts = Array.isArray(args.hosts) ? args.hosts : [];
  for (const host of hosts) {
    if (typeof host !== "string" || host.length === 0) {
      throw new Error("web_crawl: hosts must be non-empty strings");
    }
  }
  const label = "web_crawl";
  const maxPages = coercePositiveInt(args.maxPages, "maxPages", CRAWL_DEFAULTS.maxPages, label);
  const maxDepth = coerceNonNegInt(args.maxDepth, "maxDepth", CRAWL_DEFAULTS.maxDepth, label);
  const maxCharsPerPage = resolvePerPageChars(service, args);
  const maxTotalChars = coerceNonNegInt(args.maxTotalChars, "maxTotalChars", 0, label);
  const maxSeconds = coerceNonNegInt(args.maxSeconds, "maxSeconds", 0, label);
  const minIntervalMs = coerceNonNegInt(args.minIntervalMs, "minIntervalMs", CRAWL_DEFAULTS.minIntervalMs, label);
  const maxPagesPerHost = coerceNonNegInt(args.maxPagesPerHost, "maxPagesPerHost", 0, label);
  const respectRobots = args.respectRobots !== false;
  const useSitemap = args.useSitemap === true;
  const perPageSummaries = args.perPageSummaries === true;
  const perPageConcurrency = coercePositiveInt(args.perPageConcurrency, "perPageConcurrency", 1, label);

  // Extra depth-0 seeds are SSRF-checked up front like the root seed; scope
  // filtering still applies to them inside crawlSite.
  const seedUrls = Array.isArray(args.seedUrls) ? args.seedUrls : [];
  for (const seed of seedUrls) {
    if (typeof seed !== "string" || seed.trim().length === 0) {
      throw new Error("web_crawl: seedUrls must be non-empty URL strings");
    }
    await assertSafeFetchUrlForService(service, seed.trim(), "web_crawl");
  }

  const crawl = await crawlSite(service, url, {
    scope,
    hosts,
    seedUrls: seedUrls.map((s) => s.trim()),
    maxPages,
    maxDepth,
    maxCharsPerPage,
    maxTotalChars,
    minIntervalMs,
    maxSeconds,
    respectRobots,
    useSitemap,
    maxPagesPerHost,
    signal: exec.signal,
    label,
  });
  if (crawl.pages.length === 0) {
    if (crawl.challengeBlocks > 0) {
      return {
        root: url,
        scope,
        browserRequired: true,
        challengeProvider: "generic",
        error: `目标站点页面均被 JS Challenge 拦截,需浏览器渲染`,
        summary: "未获取到内容:站点页面均为 JS-Challenge 拦截页。",
        keyPoints: [],
        pages: [],
        fetched: 0,
        skipped: crawl.skippedByRobots + crawl.skippedByScope + crawl.skippedByHostCap,
        blocked: crawl.challengeBlocks,
        totalChars: 0,
        truncated: false,
        perPage: [],
      };
    }
    throw new Error("web_crawl: no pages could be fetched (check scope/hosts, robots.txt, or budget)");
  }

  const warnings = [];
  if (crawl.skippedByRobots > 0) warnings.push(`${crawl.skippedByRobots} 个路径被 robots.txt Disallow 跳过`);
  if (crawl.skippedByScope > 0) warnings.push(`${crawl.skippedByScope} 个链接超出 scope 被跳过`);
  if (crawl.skippedByHostCap > 0) warnings.push(`${crawl.skippedByHostCap} 个页面超过 maxPagesPerHost 被跳过`);
  if (crawl.challengeBlocks > 0)
    warnings.push(`${crawl.challengeBlocks} 个页面为 JS Challenge 拦截页,需浏览器渲染,已跳过`);
  if (crawl.blocked > 0) warnings.push(`${crawl.blocked} 个请求失败或被 SSRF 拒绝`);

  let summary;
  let keyPoints;
  let perPage = [];
  let provider;
  let model;
  if (perPageSummaries) {
    // Mode B: one auxiliary call per page, then one lightweight aggregation
    // call over the per-page summaries for the overall summary/keyPoints.
    perPage = await runWithConcurrency(crawl.pages, perPageConcurrency, async (page) => {
      const single = await callCrawlSummarizer(
        service,
        webExtractUserMessage(page.text, page.url, args.question),
        page.chars,
        exec,
      );
      const extracted = extractKeyPoints(single.text);
      return { url: page.url, summary: extracted.summary || single.text, keyPoints: extracted.keyPoints };
    });
    const aggChars = perPage.reduce((sum, p) => sum + codePointCount(p.summary), 0);
    const aggregated = await callCrawlSummarizer(
      service,
      webExtractUserMessageMulti(
        perPage.map((p) => ({ url: p.url, text: p.summary })),
        args.question,
      ),
      aggChars,
      exec,
    );
    const extracted = extractKeyPoints(aggregated.text);
    summary = extracted.summary || aggregated.text;
    keyPoints = extracted.keyPoints;
    provider = aggregated.provider;
    model = aggregated.model;
  } else {
    // Mode A: one auxiliary call over all page texts.
    const result = await callCrawlSummarizer(
      service,
      webExtractUserMessageMulti(
        crawl.pages.map((p) => ({ url: p.url, text: p.text })),
        args.question,
      ),
      crawl.totalChars,
      exec,
    );
    const extracted = extractKeyPoints(result.text);
    summary = extracted.summary || result.text;
    keyPoints = extracted.keyPoints;
    provider = result.provider;
    model = result.model;
  }

  return {
    root: url,
    scope,
    pages: crawl.pages.map((p) => ({
      url: p.url,
      chars: p.chars,
      truncated: p.truncated,
      ...(p.title ? { title: p.title } : {}),
    })),
    fetched: crawl.fetched,
    skipped: crawl.skippedByRobots + crawl.skippedByScope + crawl.skippedByHostCap,
    blocked: crawl.blocked,
    totalChars: perPageSummaries ? perPage.reduce((sum, p) => sum + codePointCount(p.summary), 0) : crawl.totalChars,
    truncated: crawl.pages.some((p) => p.truncated),
    summary,
    keyPoints,
    perPage,
    provider,
    model,
    mode: perPageSummaries ? "per-page" : "aggregate",
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
