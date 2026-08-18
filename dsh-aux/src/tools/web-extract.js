/**
 * dsh-aux `web_extract` tool implementation.
 *
 * Fetching happens in the shared crawl core (`src/crawl/`): seam-first with
 * SSRF hardening (`fetchPage`) and the same-origin BFS crawl engine
 * (`crawlSite`, scope "same-origin" — same engine web_crawl uses). This file
 * owns the single-page/`followLinks` summarization flow and its prompts.
 *
 * Secondary-injection hardening: page text is wrapped in explicit
 * `<<<UNTRUSTED PAGE DATA ...>>>` … `<<<END UNTRUSTED PAGE DATA ...>>>`
 * blocks (random per-block nonce) so embedded page instructions are framed as
 * data, physically separated from the Question field.
 *
 * @module @dolorescaritasangelus/dsh-aux/tools/web-extract
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  extractKeyPoints,
  webExtractSystemPrompt,
  webExtractUserMessage,
  webExtractUserMessageMulti
} from "../prompt.js";
import { fetchPage } from "../crawl/fetch-page.js";
import { crawlSite } from "../crawl/queue.js";
import { assertSafeFetchUrlForService } from "../fetch.js";
import { DEFAULT_MAX_CHARS } from "../route.js";

// Re-exported so existing users/tests importing the text helpers from the tool
// module keep working; the canonical home is `src/crawl/text.js`.
export { codePointCount, truncateByChars } from "../crawl/text.js";

/** Resolve the effective maxChars: call arg > per-task config > default. */
export function resolveMaxChars(service, args) {
  const value = args?.maxChars ?? service?._merged?.web_extract?.maxChars ?? DEFAULT_MAX_CHARS;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("web_extract: maxChars must be a positive integer");
  }
  return value;
}

/** Run one aux summarization call and return the raw result. */
async function callSummarizer(service, userText, inputChars, exec) {
  const messages = [createUserMessage({
    content: [{ type: "text", text: userText }],
    source: { kind: "plugin", plugin: "dsh-aux" }
  })];
  return service.call("web_extract", {
    messages,
    system: webExtractSystemPrompt(),
    temperature: 0.2,
    session: exec.agent?.session,
    agent: exec.agent,
    signal: exec.signal,
    inputChars
  });
}

/** web_extract execution. */
export async function runWebExtract(service, args, exec) {
  if (typeof args?.url !== "string") {
    throw new Error("web_extract: url must be a non-empty string");
  }
  const url = args.url.trim();
  if (url.length === 0) throw new Error("web_extract: url must be a non-empty string");
  await assertSafeFetchUrlForService(service, url, "web_extract");

  const maxChars = resolveMaxChars(service, args);
  const followLinks = args.followLinks ?? "off";
  if (followLinks !== "off" && followLinks !== "same-origin") {
    throw new Error("web_extract: followLinks must be \"off\" or \"same-origin\"");
  }
  const effectiveMaxPages = args.maxPages ?? (followLinks === "same-origin" ? 3 : 1);
  if (!Number.isInteger(effectiveMaxPages) || effectiveMaxPages <= 0) {
    throw new Error("web_extract: maxPages must be a positive integer");
  }
  const maxDepth = args.maxDepth ?? 1;
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error("web_extract: maxDepth must be a non-negative integer");
  }

  if (followLinks === "off") {
    const page = await fetchPage(service, url, { textCap: maxChars, signal: exec.signal, label: "web_extract" });
    if (page.challenge?.browserRequired) {
      // JS-challenge shell: never burn tokens summarizing a bot-check page;
      // hand the main model a structured marker it can route to a browser.
      return {
        url: page.finalUrl,
        browserRequired: true,
        challengeProvider: page.challenge.provider,
        httpStatus: 200,
        error: `该站使用 JS Challenge(${page.challenge.provider}) 阻止脚本抓取;需要浏览器渲染(若 DSH 配置了浏览器/渲染 provider 可重试)`,
        summary: "该页为 JS-Challenge 拦截页,未获取到可用正文。",
        keyPoints: [],
        chars: page.chars,
        truncated: false
      };
    }
    const result = await callSummarizer(service, webExtractUserMessage(page.text, page.finalUrl, args.question), page.chars, exec);
    const extracted = extractKeyPoints(result.text);
    return {
      url: page.finalUrl,
      summary: extracted.summary || result.text,
      keyPoints: extracted.keyPoints,
      provider: result.provider,
      model: result.model,
      chars: page.chars,
      truncated: page.truncated,
      ...(page.redirects > 0 ? { redirects: page.redirects } : {})
    };
  }

  // followLinks delegates to the shared crawl engine (crawlSite, scope
  // same-origin) so robots.txt / per-host rate limits / budgets are identical
  // to web_crawl — no parallel crawl implementation (design §2.1).
  const crawl = await crawlSite(service, url, {
    scope: "same-origin",
    maxPages: effectiveMaxPages,
    maxDepth,
    maxCharsPerPage: maxChars,
    maxTotalChars: maxChars,
    signal: exec.signal,
    label: "web_extract"
  });
  if (crawl.pages.length === 0) {
    if (crawl.challengeBlocks > 0) {
      return {
        url,
        browserRequired: true,
        challengeProvider: "generic",
        error: `目标页面均被 JS Challenge 拦截,需浏览器渲染`,
        summary: "未获取到内容:站点页面均为 JS-Challenge 拦截页。",
        keyPoints: [],
        pages: [],
        totalChars: 0,
        truncated: false
      };
    }
    throw new Error("web_extract: no pages could be fetched");
  }
  const result = await callSummarizer(
    service,
    webExtractUserMessageMulti(crawl.pages.map((p) => ({ url: p.url, text: p.text })), args.question),
    crawl.totalChars,
    exec
  );
  const extracted = extractKeyPoints(result.text);
  return {
    url: crawl.pages[0].url,
    pages: crawl.pages.map((p) => ({ url: p.url, chars: p.chars, truncated: p.truncated })),
    totalChars: crawl.totalChars,
    truncated: crawl.pages.some((p) => p.truncated),
    summary: extracted.summary || result.text,
    keyPoints: extracted.keyPoints,
    provider: result.provider,
    model: result.model
  };
}
