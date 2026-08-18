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
 *     per-hop SSRF check.
 *
 * @module @dolorescaritasangelus/dsh-aux/crawl/fetch-page
 */
import { htmlToText, isBinaryContentType, isHtmlContentType } from "../prompt.js";
import { assertSafeFetchUrlForService, fetchWithSsrf } from "../fetch.js";
import { truncateByChars } from "./text.js";

/**
 * Read a fetch response body as text, aborting the read as soon as the raw
 * size exceeds `capChars` (cheap UTF-16 code-unit check used only to stop
 * the network); the final cap is applied on code-point boundaries.
 * Returns `{ text, rawChars, truncated }`.
 */
export async function readTextCapped(response, capChars) {
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
export function isProviderUnavailable(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "WEB_PROVIDER_UNAVAILABLE" || code === "WEB_PROVIDER_CONFIGURED_MISSING" || code === "WEB_PROVIDER_AMBIGUOUS") {
    return true;
  }
  const message = error?.message ?? String(error ?? "");
  return /no usable web provider/i.test(message);
}

/** Finish a local (fallback) fetch: clean, decode, cap, reject binary. */
export async function finishLocalFetch(response, finalUrl, { textCap, rawCap, label }) {
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
    chars: capped.kept,
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
export async function fetchPage(service, targetUrl, { textCap, rawCap = textCap, signal, label = "web_extract" }) {
  await assertSafeFetchUrlForService(service, targetUrl, label);
  const web = service.ctx?.web;
  const webFetch = web?.fetch;
  if (typeof webFetch === "function") {
    try {
      // Call as a method of the web service: real dsh-web's `fetch` reads
      // `this.fetchProviders`, so an unbound call would lose its receiver.
      const result = await webFetch.call(web, { url: targetUrl }, signal);
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
      // Best-effort release of any provider-buffered body on the error paths
      // (mirrors the local path cancelling streaming bodies), so rejected
      // responses are not retained until GC.
      const releaseBody = () => {
        try { if (typeof result?.body?.cancel === "function") result.body.cancel().catch(() => {}); } catch { /* best-effort */ }
      };
      if (statusCode >= 400) {
        releaseBody();
        throw new Error(`${label}: HTTP ${statusCode} fetching ${targetUrl}`);
      }
      if (typeof result.url !== "string" || result.url.length === 0) {
        releaseBody();
        throw new Error(`${label}: web provider returned no final URL for ${targetUrl}`);
      }
      await assertSafeFetchUrlForService(service, result.url, label);
      const body = result.body;
      if (body === null || typeof body !== "object" || (body.kind !== "html" && body.kind !== "text") || typeof body.content !== "string") {
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
      return {
        finalUrl: result.url,
        text: capped.text,
        chars: capped.kept,
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
