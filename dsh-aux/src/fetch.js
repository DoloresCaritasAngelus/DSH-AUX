/**
 * SSRF-safe fetching helpers for dsh-aux tools.
 *
 * @module @dolorescaritasangelus/dsh-aux/fetch
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { assertSafeFetchUrl } from "./url-policy.js";

/** Apply the SSRF guard before fetching a URL (web_extract or vision imageUrl). */
export async function assertSafeFetchUrlForService(service, rawUrl, label = "web_extract") {
  await assertSafeFetchUrl(rawUrl, {
    allowInternalUrls: service.allowInternalUrls === true,
    lookup: service._dnsLookup ?? dnsLookup,
    label
  });
}

/**
 * Fetch a URL through the global fetch with SSRF checks on every redirect
 * hop. Redirects are followed manually so an internal/private redirect
 * target is rejected BEFORE the request is sent.
 */
export async function fetchWithSsrf(service, rawUrl, label, signal) {
  const MAX_REDIRECTS = 5;
  let currentUrl = rawUrl;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    await assertSafeFetchUrlForService(service, currentUrl, label);
    const response = await fetch(currentUrl, { signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null || location.length === 0) {
        throw new Error(`${label}: redirect response missing Location header`);
      }
      // Release the redirect body before following the next hop.
      try { await response.body?.cancel(); } catch { /* best-effort */ }
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    return { response, finalUrl: currentUrl };
  }
  throw new Error(`${label}: too many redirects`);
}
