/**
 * dsh-aux `web_crawl` tool implementation (design: WEB-CRAWL-DESIGN.md).
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
import { extractKeyPoints, webExtractSystemPrompt, webExtractUserMessageMulti } from "../prompt.js";
import { CRAWL_DEFAULTS, crawlSite } from "../crawl/queue.js";
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
  return coercePositiveInt(args?.maxCharsPerPage, "maxCharsPerPage", service?._merged?.web_crawl?.maxChars ?? DEFAULT_MAX_CHARS, "web_crawl");
}

/** One aux summarization call across all crawled pages (mode A). */
async function callCrawlSummarizer(service, userText, inputChars, exec) {
  const messages = [createUserMessage({
    content: [{ type: "text", text: userText }],
    source: { kind: "plugin", plugin: "dsh-aux" }
  })];
  return service.call("web_crawl", {
    messages,
    system: webExtractSystemPrompt(),
    temperature: 0.2,
    session: exec.agent?.session,
    agent: exec.agent,
    signal: exec.signal,
    inputChars
  });
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
    throw new Error("web_crawl: scope must be \"same-origin\" or \"hosts\" (domain not enabled in v1)");
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
  const respectRobots = args.respectRobots !== false;

  const crawl = await crawlSite(service, url, {
    scope,
    hosts,
    maxPages,
    maxDepth,
    maxCharsPerPage,
    maxTotalChars,
    minIntervalMs,
    maxSeconds,
    respectRobots,
    signal: exec.signal,
    label
  });
  if (crawl.pages.length === 0) {
    throw new Error("web_crawl: no pages could be fetched (check scope/hosts, robots.txt, or budget)");
  }

  const result = await callCrawlSummarizer(
    service,
    webExtractUserMessageMulti(crawl.pages.map((p) => ({ url: p.url, text: p.text })), args.question),
    crawl.totalChars,
    exec
  );
  const extracted = extractKeyPoints(result.text);
  const warnings = [];
  if (crawl.skippedByRobots > 0) warnings.push(`${crawl.skippedByRobots} 个路径被 robots.txt Disallow 跳过`);
  if (crawl.skippedByScope > 0) warnings.push(`${crawl.skippedByScope} 个链接超出 scope 被跳过`);
  if (crawl.blocked > 0) warnings.push(`${crawl.blocked} 个请求失败或被 SSRF 拒绝`);

  return {
    root: url,
    scope,
    pages: crawl.pages.map((p) => ({
      url: p.url,
      chars: p.chars,
      truncated: p.truncated,
      ...(p.title ? { title: p.title } : {})
    })),
    fetched: crawl.fetched,
    skipped: crawl.skippedByRobots + crawl.skippedByScope,
    blocked: crawl.blocked,
    totalChars: crawl.totalChars,
    truncated: crawl.pages.some((p) => p.truncated),
    summary: extracted.summary || result.text,
    keyPoints: extracted.keyPoints,
    perPage: [],
    provider: result.provider,
    model: result.model,
    ...(warnings.length > 0 ? { warnings } : {})
  };
}
