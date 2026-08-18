/**
 * Live extraction-layer probe for web_extract/web_crawl core.
 *
 * Runs `fetchPage` (the shared seam-first + per-hop-SSRF core) against the
 * REAL network, with no web seam — exercising the exact fetch/clean/charset/
 * challenge/redirect logic the live tools use, against real sites. No aux LLM
 * call (the summarizer is outsourced to the live tool path).
 *
 * This is what subagents can run via bash even though they do not have the
 * `web_extract` tool — it lets them verify the EXTRACTION layer (encoding,
 * noise removal, structure, challenge/redirect handling) on real URLs.
 *
 * Usage: node tests/fetch-page-probe.mjs <url> [maxChars]
 * Prints: url / finalUrl / redirects / truncated / chars / charset /
 *         challenge{...} / head (first N chars of cleaned text) / error?
 *
 * @module tests/fetch-page-probe
 */
import { fetchPage } from '../dsh-aux/src/crawl/fetch-page.js';

function head(text, n = 900) {
  if (typeof text !== 'string') return '(no text)';
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  let out = [];
  let len = 0;
  for (const line of lines) {
    if (len > n) break;
    out.push(line);
    len += line.length;
  }
  return out.join('\n');
}

const url = process.argv[2];
const maxChars = Number.isInteger(Number(process.argv[3])) ? Number(process.argv[3]) : 32000;
if (!url) {
  console.error('usage: node tests/fetch-page-probe.mjs <url> [maxChars]');
  process.exit(2);
}

// Fake service: no web seam → local per-hop fetch with the REAL global fetch;
// real DNS for the SSRF guard.
const service = {
  allowInternalUrls: false,
  ctx: {}
};

const out = { url, maxChars };
try {
  const page = await fetchPage(service, url.trim(), { textCap: maxChars, rawCap: maxChars, label: 'web_extract' });
  out.finalUrl = page.finalUrl;
  out.redirects = page.redirects;
  out.truncated = page.truncated;
  out.chars = page.chars;
  out.charset = page.charset;
  out.challenge = page.challenge;
  out.head = head(page.text);
} catch (error) {
  out.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  if (error?.httpStatus !== void 0) {
    out.httpStatus = error.httpStatus;
    out.rateLimited = error.rateLimited === true;
    out.browserRequired = error.browserRequired === true;
    out.challengeProvider = error.challengeProvider;
  }
}

console.log(JSON.stringify(out, null, 2));
