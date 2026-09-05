/**
 * Seam-first, SSRF-hardened page fetching shared by web_extract and web_crawl.
 *
 * Fetch strategy:
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
 *     per-hop SSRF check and reports the hop count.
 *
 * Anti-crawl hardening (zero-dependency):
 *   - 429/502/503/504 are retried once with a short backoff, then surfaced as
 *     a categorized `HttpStatusError`.
 *   - 403/503 bodies are sniffed for JS-challenge markers; when detected the
 *     page is tagged `browserRequired` (main model can route to a browser /
 *     rendering provider instead of burning tokens on a challenge page).
 *   - non-UTF-8 pages are decoded from their charset (Content-Type header or a
 *     `<meta charset>` sniff) so GBK/GB18030 pages are not mojibake.
 *
 * @module @dolorescaritasangelus/dsh-aux/crawl/fetch-page
 */
import { htmlToText, isBinaryContentType, isHtmlContentType } from "../prompt.js";
import { assertSafeFetchUrlForService, fetchWithSsrf } from "../fetch.js";
import { truncateByChars } from "./text.js";

/** Remote HTTP status the fetch could not turn into content. Distinguished so
 * tools can surface a diagnostic instead of raw bytes-as-text. */
export class HttpStatusError extends Error {
  constructor(message, status, options = {}) {
    super(message);
    this.name = "HttpStatusError";
    this.httpStatus = status;
    this.rateLimited = options.rateLimited === true;
    this.blocker = options.blocker; // e.g. "js-challenge" | "forbidden"
    this.browserRequired = options.browserRequired === true;
    this.challengeProvider = options.challengeProvider;
  }
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const RETRY_BACKOFF_MS = 300;

function isRetryableStatus(status) {
  return typeof status === "number" && RETRYABLE_STATUS.has(status);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Human hint appended to HTTP error messages so the main model can act. */
function httpHint(label, status) {
  let base = `HTTP ${status}`;
  if (status === 429) base += " (rate limited)";
  if (status === 403) base += " (forbidden)";
  if (isRetryableStatus(status)) base += " — 已重试仍失败,建议稍后重试或降低频率";
  if (status === 403) base += " — 该站可能拒绝本抓取来源,或需浏览器渲染/登录";
  return `${label}: ${base}`;
}

/** JS-challenge / bot-detection markers (zero-dependency sniff). Cloudflare's
 * tokens live in <script> (stripped by htmlToText), so callers scan the raw
 * HTML too; the generic phrases are deliberately narrow to avoid flagging
 * ordinary "please enable JavaScript" fallbacks. */
const CHALLENGE_SIGNALS = [
  { re: /cf-chl|challenge-platform|__cf_chl|cf_clearance|__cf_bm|__cfruid/i, provider: "cloudflare" },
  { re: /Just a moment|Checking your browser|Pardon our interruption|Verify you are human/i, provider: "generic" },
];

/** Detect whether a page body is actually a JS-challenge / bot-check shell. */
export function detectBrowserChallenge(text) {
  const str = typeof text === "string" ? text : "";
  for (const sig of CHALLENGE_SIGNALS) {
    if (sig.re.test(str)) {
      return { browserRequired: true, provider: sig.provider, reason: "js-challenge" };
    }
  }
  return { browserRequired: false };
}

/** Parse `label` (or null) out of a Content-Type header `charset=` parameter. */
export function charsetFromContentType(contentType) {
  const m = /;\s*charset\s*=\s*"?([a-zA-Z0-9._:+-]+)"?/i.exec(contentType || "");
  return m === null ? null : m[1].toLowerCase();
}

/** Whether a label is usable by TextDecoder (Node WHATWG set, incl. gbk/gb18030). */
export function isSupportedCharsetLabel(label) {
  if (typeof label !== "string" || label.length === 0) return false;
  try {
    // eslint-disable-next-line no-new
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

/** Sniff `<meta charset>` / `<meta http-equiv=content-type>` from latin-1-decoded head. */
export function sniffMetaCharset(latin1Head) {
  const m =
    /(?:<meta\b[^>]*\bcharset\s*=\s*["']?\s*([a-z0-9._:-]+)|http-equiv\s*=\s*["']?content-type["']?[^>]*\bcharset\s*=\s*["']?\s*([a-z0-9._:-]+))/i.exec(
      latin1Head || "",
    );
  if (m === null) return null;
  return (m[1] ?? m[2] ?? "").toLowerCase() || null;
}

/** Decode raw bytes to a capped string, sniffing meta charset unless fixed. */
function decodeBytesCapped(bytes, capChars, fixedLabel) {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 4096)));
  const sniffed = fixedLabel ?? sniffMetaCharset(head);
  const label = sniffed && isSupportedCharsetLabel(sniffed) ? sniffed : "utf-8";
  let decoded;
  try {
    decoded = new TextDecoder(label).decode(bytes);
  } catch {
    decoded = new TextDecoder("utf-8").decode(bytes);
  }
  const capped = truncateByChars(decoded, capChars);
  return { text: capped.text, rawChars: capped.chars, truncated: capped.truncated, charset: label };
}

/**
 * Read a fetch response body as text, aborting the read as soon as the raw
 * size exceeds `capChars`; the final cap is applied on code-point boundaries.
 * @param options { charset? } — decode with an explicit TextDecoder label.
 * Returns `{ text, rawChars, truncated }`.
 */
export async function readTextCapped(response, capChars, options = {}) {
  const reader = response.body?.getReader?.();
  if (reader === void 0) {
    const { charset } = options;
    if (charset && isSupportedCharsetLabel(charset) && typeof response.arrayBuffer === "function") {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const r = decodeBytesCapped(bytes, capChars, charset);
      return { text: r.text, rawChars: r.rawChars, truncated: r.truncated };
    }
    const raw = await response.text();
    const capped = truncateByChars(raw, capChars);
    return { text: capped.text, rawChars: capped.chars, truncated: capped.truncated };
  }
  const { charset } = options;
  const decoder = new TextDecoder(charset && isSupportedCharsetLabel(charset) ? charset : "utf-8");
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

/**
 * Read a body without a trustworthy header charset: buffer at most `capChars`
 * bytes, sniff a `<meta charset>` from a latin-1 head, then decode.
 * Returns `{ text, rawChars, truncated, charset }`.
 */
async function readSniffedCapped(response, capChars) {
  const reader = response.body?.getReader?.();
  if (reader === void 0) {
    if (typeof response.arrayBuffer === "function") {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return decodeBytesCapped(bytes, capChars);
    }
    const raw = await response.text();
    const capped = truncateByChars(raw, capChars);
    return { text: capped.text, rawChars: capped.chars, truncated: capped.truncated, charset: "utf-8" };
  }
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.length;
    if (bytes >= capChars) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const buf = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }
  return decodeBytesCapped(buf, capChars);
}

/** Read a bounded error-page body (403/503) for JS-challenge sniffing. */
async function readChallengeBody(response) {
  const reader = response.body?.getReader?.();
  if (reader === void 0) {
    try {
      return typeof response.text === "function" ? await response.text() : "";
    } catch {
      return "";
    }
  }
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (let i = 0; i < 16; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length >= 16_384) break;
    }
    await reader.cancel().catch(() => {});
  } catch {
    /* best-effort */
  }
  return text;
}

/** Whether a web-seam failure means "no usable provider" (fall back locally).
 * Code-based first; the message match is deliberately NARROW (the exact
 * dsh-web text) so our OWN "web provider returned …" validation errors are
 * never swallowed and misread as provider-availability fallbacks. */
export function isProviderUnavailable(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (
    code === "WEB_PROVIDER_UNAVAILABLE" ||
    code === "WEB_PROVIDER_CONFIGURED_MISSING" ||
    code === "WEB_PROVIDER_AMBIGUOUS"
  ) {
    return true;
  }
  const message = error?.message ?? String(error ?? "");
  return /no usable web provider/i.test(message);
}

const TRANSPORT_RE =
  /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|getaddrinfo|socket hang up|tls|network|timeout|UND_ERR/i;

/** Whether a seam/provider failure is a transport problem — the local (env-
 * proxy-aware) path may still reach the host, so it is worth retrying there. */
function isLikelyTransportError(error) {
  const message = error?.message ?? String(error ?? "");
  const code = error?.cause?.code ?? error?.code ?? "";
  return TRANSPORT_RE.test(message) || TRANSPORT_RE.test(code);
}

/** Finish a local (fallback) fetch: status checks, challenge sniff, decode. */
export async function finishLocalFetch(response, finalUrl, { textCap, rawCap, label, redirects = 0 }) {
  if (!response.ok) {
    if (response.status === 403 || response.status === 503) {
      const challenge = detectBrowserChallenge(await readChallengeBody(response));
      if (challenge.browserRequired) {
        throw new HttpStatusError(
          `${label}: HTTP ${response.status} — 检测到 JS Challenge(${challenge.provider}),需浏览器渲染`,
          response.status,
          { blocker: "js-challenge", browserRequired: true, challengeProvider: challenge.provider },
        );
      }
    }
    await response.body?.cancel().catch(() => {});
    throw new HttpStatusError(httpHint(label, response.status), response.status, {
      rateLimited: isRetryableStatus(response.status),
    });
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (isBinaryContentType(contentType)) {
    await response.body?.cancel().catch(() => {});
    const kind = (contentType.split(";")[0] || "unknown").trim();
    throw new Error(`${label}: ${finalUrl} is not an HTML/text page (${kind})`);
  }
  const isHtml = isHtmlContentType(contentType);
  const headerCharset = charsetFromContentType(contentType);
  // Stream with a header charset when known; otherwise sniff <meta charset>
  // from a bounded buffer (covers GBK/GB18030 without a header).
  const raw =
    headerCharset && isSupportedCharsetLabel(headerCharset)
      ? await readTextCapped(response, rawCap, { charset: headerCharset })
      : await readSniffedCapped(response, rawCap);
  const rawHtml = isHtml ? raw.text : null;
  const cleaned = isHtml ? htmlToText(raw.text) : raw.text;
  const capped = truncateByChars(cleaned, textCap);
  const challenge = detectBrowserChallenge(rawHtml ? rawHtml + "\n" + cleaned : cleaned);
  return {
    finalUrl,
    text: capped.text,
    chars: capped.kept,
    truncated: capped.truncated || raw.truncated,
    isHtml,
    rawHtml,
    challenge,
    redirects,
    charset: raw.charset,
  };
}

/**
 * Fetch one page through the seam-first + hardened path and return the plain
 * text (capped), plus raw HTML when it is an HTML page (used for link
 * discovery). Every entry point asserts the SSRF guard up front.
 * @returns `{ finalUrl, text, chars, truncated, isHtml, rawHtml, challenge, redirects, charset }`.
 */
export async function fetchPage(service, targetUrl, { textCap, rawCap = textCap, signal, label = "web_extract" }) {
  await assertSafeFetchUrlForService(service, targetUrl, label);
  const web = service.ctx?.web;
  const webFetch = web?.fetch;
  if (typeof webFetch === "function") {
    try {
      // Call as a method of the web service: real dsh-web's `fetch` reads
      // `this.fetchProviders`, so an unbound call would lose its receiver.
      let result = await webFetch.call(web, { url: targetUrl }, signal);
      let statusCode = result?.statusCode ?? result?.status;
      // 429/502/503/504: retry the seam once with a short backoff.
      if (isRetryableStatus(statusCode) && signal?.aborted !== true) {
        await sleep(RETRY_BACKOFF_MS);
        result = await webFetch.call(web, { url: targetUrl }, signal);
        statusCode = result?.statusCode ?? result?.status;
      }
      if (result === null || typeof result !== "object") {
        throw new Error(`${label}: web provider returned an invalid result for ${targetUrl}`);
      }
      if (statusCode >= 300 && statusCode < 400) {
        // The provider left the redirect unresolved; re-follow it locally with
        // per-hop SSRF checks so no internal hop is ever fetched.
        const from = typeof result.url === "string" && result.url.length > 0 ? result.url : targetUrl;
        const local = await fetchWithSsrf(service, from, label, signal);
        return finishLocalFetch(local.response, local.finalUrl, {
          textCap,
          rawCap,
          label,
          redirects: (local.hops ?? 0) + 1,
        });
      }
      // Best-effort release of any provider-buffered body on the error paths.
      const releaseBody = () => {
        try {
          if (typeof result?.body?.cancel === "function") result.body.cancel().catch(() => {});
        } catch {
          /* best-effort */
        }
      };
      if (statusCode >= 400) {
        const challenge = detectBrowserChallenge(typeof result?.body?.content === "string" ? result.body.content : "");
        if (challenge.browserRequired) {
          releaseBody();
          throw new HttpStatusError(
            `${label}: HTTP ${statusCode} — 检测到 JS Challenge(${challenge.provider}),需浏览器渲染`,
            statusCode,
            { blocker: "js-challenge", browserRequired: true, challengeProvider: challenge.provider },
          );
        }
        const rateLimited = isRetryableStatus(statusCode);
        releaseBody();
        throw new HttpStatusError(`${httpHint(label, statusCode)} fetching ${targetUrl}`, statusCode, { rateLimited });
      }
      if (typeof result.url !== "string" || result.url.length === 0) {
        releaseBody();
        throw new Error(`${label}: web provider returned no final URL for ${targetUrl}`);
      }
      await assertSafeFetchUrlForService(service, result.url, label);
      const body = result.body;
      if (
        body === null ||
        typeof body !== "object" ||
        (body.kind !== "html" && body.kind !== "text") ||
        typeof body.content !== "string"
      ) {
        releaseBody();
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
      const challenge = detectBrowserChallenge(rawHtml ? rawHtml + "\n" + cleaned : cleaned);
      return {
        finalUrl: result.url,
        text: capped.text,
        chars: capped.kept,
        truncated: capped.truncated,
        isHtml,
        rawHtml,
        challenge,
        redirects: 0,
        charset: void 0,
      };
    } catch (error) {
      // Provider-availability AND transport failures fall through to the
      // local (env-proxy-aware) fetch — the provider may not reach a host
      // that our local path can; real validation errors surface to the caller.
      if (!isProviderUnavailable(error) && !isLikelyTransportError(error)) throw error;
    }
  }
  let local = await fetchWithSsrf(service, targetUrl, label, signal);
  // 429/502/503/504: retry the local fetch once with a short backoff.
  if (isRetryableStatus(local.response.status) && signal?.aborted !== true) {
    await local.response.body?.cancel().catch(() => {});
    await sleep(RETRY_BACKOFF_MS);
    local = await fetchWithSsrf(service, targetUrl, label, signal);
  }
  return finishLocalFetch(local.response, local.finalUrl, { textCap, rawCap, label, redirects: local.hops ?? 0 });
}
