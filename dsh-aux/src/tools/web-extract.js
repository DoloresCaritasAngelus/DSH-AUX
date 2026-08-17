/**
 * dsh-aux `web_extract` tool implementation.
 *
 * Fetch strategy (seam-first with SSRF hardening):
 *   - When `service.ctx.web.fetch` is callable (the DSH web capability seam),
 *     it is used first — it owns decode/cleanup/truncation and can reach the
 *     web in environments where the Node global fetch cannot. The seam only
 *     exposes a FINAL url (not each hop), so we harden the boundary:
 *       1. refuse a missing final url,
 *       2. re-validate the final url through the SSRF guard,
 *       3. treat any 3xx the provider returns as "redirect unresolved" and
 *          re-follow it through `fetchWithSsrf`, which checks every hop
 *          BEFORE the request is sent,
 *       4. fall back to the local per-hop fetch only when the seam has no
 *          usable provider (or is absent entirely).
 *   - The local fallback (`fetchWithSsrf`) follows redirects manually with a
 *     per-hop SSRF check.
 *
 * Secondary-injection hardening: page text is wrapped in explicit
 * `<<<UNTRUSTED PAGE DATA ...>>>` … `<<<END UNTRUSTED PAGE DATA ...>>>`
 * blocks (random per-block nonce) so embedded page instructions are framed as
 * data, physically separated from the Question field.
 *
 * Link discovery (`followLinks: "same-origin"`) runs a sequential BFS over
 * same-origin document links with a shared character budget; every page goes
 * through the same seam-first + per-hop SSRF path.
 *
 * @module @dolorescaritasangelus/dsh-aux/tools/web-extract
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  extractKeyPoints,
  extractPageLinks,
  htmlToText,
  isBinaryContentType,
  isHtmlContentType,
  webExtractSystemPrompt,
  webExtractUserMessage,
  webExtractUserMessageMulti
} from "../prompt.js";
import { assertSafeFetchUrlForService, fetchWithSsrf } from "../fetch.js";
import { DEFAULT_MAX_CHARS } from "../route.js";

const TRUNCATED_MARKER = "\n[…truncated]";
/** Link scan reads more raw HTML than the model text budget so crawl link
 * discovery does not miss links that sit past the summary text cap. */
const LINK_SCAN_FACTOR = 4;
const LINK_SCAN_MIN = 32_000;
const LINK_SCAN_MAX = 256_000;

/** Count Unicode code points in a string (UTF-16 surrogate pairs count once). */
export function codePointCount(text) {
  const str = typeof text === "string" ? text : "";
  let count = 0;
  for (let i = 0; i < str.length; ) {
    const code = str.codePointAt(i);
    i += code > 0xffff ? 2 : 1;
    count += 1;
  }
  return count;
}

/**
 * Truncate text to at most `maxChars` CODE POINTS (never splitting a
 * surrogate pair), appending a truncation marker when anything was cut.
 * @returns `{ text, chars, truncated }` — `chars` is the ORIGINAL code-point
 * count, `truncated` whether a cut happened.
 */
export function truncateByChars(text, maxChars) {
  const str = typeof text === "string" ? text : String(text ?? "");
  const limit = Number.isInteger(maxChars) && maxChars >= 0 ? maxChars : 0;
  const total = codePointCount(str);
  if (total <= limit) return { text: str, chars: total, truncated: false };
  let end = 0;
  let count = 0;
  for (let i = 0; i < str.length && count < limit; ) {
    const code = str.codePointAt(i);
    i += code > 0xffff ? 2 : 1;
    count += 1;
    end = i;
  }
  return { text: str.slice(0, end) + TRUNCATED_MARKER, chars: total, truncated: true };
}

/**
 * Read a fetch response body as text, aborting the read as soon as the raw
 * size exceeds `capChars` (cheap UTF-16 code-unit check used only to stop
 * the network); the final cap is applied on code-point boundaries.
 * Returns `{ text, rawChars, truncated }`.
 */
async function readTextCapped(response, capChars) {
  const reader = response.body?.getReader?.();
  if (reader === void 0) {
    const raw = await response.text();
    const capped = truncateByChars(raw, capChars);
    return { text: capped.text, rawChars: capped.chars, truncated: capped.truncated };
  }
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > capChars) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  text += decoder.decode();
  const capped = truncateByChars(text, capChars);
  return { text: capped.text, rawChars: capped.chars, truncated: capped.truncated };
}

/** Whether a web-seam failure means "no usable provider" (fall back locally).
 * Code-based first; the message match is deliberately NARROW (the exact
 * dsh-web text) so our OWN "web provider returned …" validation errors are
 * never swallowed and misread as provider-availability fallbacks. */
function isProviderUnavailable(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "WEB_PROVIDER_UNAVAILABLE" || code === "WEB_PROVIDER_CONFIGURED_MISSING" || code === "WEB_PROVIDER_AMBIGUOUS") {
    return true;
  }
  const message = error?.message ?? String(error ?? "");
  return /no usable web provider/i.test(message);
}

/** Finish a local (fallback) fetch: clean, decode, cap, reject binary. */
async function finishLocalFetch(response, finalUrl, { textCap, rawCap, label }) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`${label}: HTTP ${response.status} fetching ${finalUrl}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (isBinaryContentType(contentType)) {
    await response.body?.cancel().catch(() => {});
    const kind = (contentType.split(";")[0] || "unknown").trim();
    throw new Error(`${label}: ${finalUrl} is not an HTML/text page (${kind})`);
  }
  const isHtml = isHtmlContentType(contentType);
  const raw = await readTextCapped(response, rawCap);
  const rawHtml = isHtml ? raw.text : null;
  const cleaned = isHtml ? htmlToText(raw.text) : raw.text;
  const capped = truncateByChars(cleaned, textCap);
  return {
    finalUrl,
    text: capped.text,
    chars: codePointCount(capped.text),
    truncated: capped.truncated || raw.truncated,
    isHtml,
    rawHtml
  };
}

/**
 * Fetch one page through the seam-first + hardened path and return the plain
 * text (capped), plus raw HTML when it is an HTML page (used for link
 * discovery). Every entry point asserts the SSRF guard up front.
 * @returns `{ finalUrl, text, chars, truncated, isHtml, rawHtml }`.
 */
async function fetchPage(service, targetUrl, { textCap, rawCap = textCap, signal, label = "web_extract" }) {
  await assertSafeFetchUrlForService(service, targetUrl, label);
  const webFetch = service.ctx?.web?.fetch;
  if (typeof webFetch === "function") {
    try {
      const result = await webFetch({ url: targetUrl }, signal);
      if (result === null || typeof result !== "object") {
        throw new Error(`${label}: web provider returned an invalid result for ${targetUrl}`);
      }
      const statusCode = result.statusCode ?? result.status;
      if (statusCode >= 300 && statusCode < 400) {
        // The provider left the redirect unresolved; re-follow it locally with
        // per-hop SSRF checks so no internal hop is ever fetched.
        const from = typeof result.url === "string" && result.url.length > 0 ? result.url : targetUrl;
        const local = await fetchWithSsrf(service, from, label, signal);
        return finishLocalFetch(local.response, local.finalUrl, { textCap, rawCap, label });
      }
      if (statusCode >= 400) {
        throw new Error(`${label}: HTTP ${statusCode} fetching ${targetUrl}`);
      }
      if (typeof result.url !== "string" || result.url.length === 0) {
        throw new Error(`${label}: web provider returned no final URL for ${targetUrl}`);
      }
      await assertSafeFetchUrlForService(service, result.url, label);
      const body = result.body;
      if (body === null || typeof body !== "object" || (body.kind !== "html" && body.kind !== "text") || typeof body.content !== "string") {
        throw new Error(`${label}: web provider returned an unsupported body for ${targetUrl}`);
      }
      const isHtml = body.kind === "html";
      // The seam has already buffered the body, so clean the FULL content (the
      // provider owns its size cap); rawHtml is only capped at rawCap for link
      // scanning. The pre-cleaning raw cap is a memory bound for the LOCAL
      // streaming path, which we control — not for the seam's buffer.
      const rawHtml = isHtml ? truncateByChars(body.content, rawCap).text : null;
      const cleaned = isHtml ? htmlToText(body.content) : body.content;
      const capped = truncateByChars(cleaned, textCap);
      return {
        finalUrl: result.url,
        text: capped.text,
        chars: codePointCount(capped.text),
        truncated: capped.truncated,
        isHtml,
        rawHtml
      };
    } catch (error) {
      // Only provider-availability failures fall through to the local fetch;
      // real fetch/validation errors surface to the caller.
      if (!isProviderUnavailable(error)) throw error;
    }
  }
  const local = await fetchWithSsrf(service, targetUrl, label, signal);
  return finishLocalFetch(local.response, local.finalUrl, { textCap, rawCap, label });
}

/** Normalized URL used for link dedup (hash stripped). */
function normalizePageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return String(url);
  }
}

/**
 * Sequential same-origin BFS crawl. Each page is fetched through the
 * seam-first + per-hop SSRF path and its text is capped to the remaining
 * shared character budget.
 * @returns `{ pages, totalChars }` — `totalChars` is the code-point length of
 * the capped page text actually sent to the model.
 */
async function crawlPages(service, rootUrl, { maxChars, maxPages, maxDepth, signal, label = "web_extract" }) {
  const rootParsed = new URL(rootUrl);
  const origin = rootParsed.origin;
  const rawCap = Math.min(LINK_SCAN_MAX, Math.max(LINK_SCAN_MIN, maxChars * LINK_SCAN_FACTOR));
  const seen = new Set([normalizePageUrl(rootUrl)]);
  const queue = [{ url: rootUrl, depth: 0 }];
  const pages = [];
  let totalChars = 0;
  while (queue.length > 0 && pages.length < maxPages) {
    const { url: pageUrl, depth } = queue.shift();
    const remaining = maxChars - totalChars;
    if (remaining <= 0) break;
    const page = await fetchPage(service, pageUrl, { textCap: remaining, rawCap, signal, label });
    pages.push({ url: page.finalUrl, chars: page.chars, truncated: page.truncated, depth, isHtml: page.isHtml, rawHtml: page.rawHtml, text: page.text });
    totalChars += page.chars;
    if (depth < maxDepth && page.isHtml && pages.length < maxPages) {
      for (const link of extractPageLinks(page.rawHtml ?? "", page.finalUrl, origin)) {
        const key = normalizePageUrl(link);
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ url: link, depth: depth + 1 });
      }
    }
  }
  return { pages, totalChars };
}

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
    const result = await callSummarizer(service, webExtractUserMessage(page.text, page.finalUrl, args.question), page.chars, exec);
    const extracted = extractKeyPoints(result.text);
    return {
      url: page.finalUrl,
      summary: extracted.summary || result.text,
      keyPoints: extracted.keyPoints,
      provider: result.provider,
      model: result.model,
      chars: page.chars,
      truncated: page.truncated
    };
  }

  const crawl = await crawlPages(service, url, { maxChars, maxPages: effectiveMaxPages, maxDepth, signal: exec.signal, label: "web_extract" });
  if (crawl.pages.length === 0) {
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
