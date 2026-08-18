/**
 * SSRF-safe fetching helpers for dsh-aux tools.
 *
 * @module @dolorescaritasangelus/dsh-aux/fetch
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { isIP } from "node:net";
import { assertSafeFetchUrl } from "./url-policy.js";
import { ipv4Octets } from "./url-policy.js";

/** Apply the SSRF guard before fetching a URL (web_extract or vision imageUrl). */
export async function assertSafeFetchUrlForService(service, rawUrl, label = "web_extract") {
  await assertSafeFetchUrl(rawUrl, {
    allowInternalUrls: service.allowInternalUrls === true,
    lookup: service._dnsLookup ?? dnsLookup,
    label
  });
}

/** Browser-like request headers sent on the local fetch path (proxy hygiene). */
const BROWSER_HEADERS = Object.freeze({
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en,zh-CN;q=0.9"
});

/** IPv4 CIDR match (dotted-quad + /prefix). */
function ipv4InCidr(ip, cidr) {
  const findex = cidr.indexOf("/");
  if (findex === -1) return ip === cidr;
  const prefix = Number(cidr.slice(findex + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const a = ipv4Octets(ip);
  const b = ipv4Octets(cidr.slice(0, findex));
  if (a === null || b === null) return false;
  const shift = 32 - prefix;
  const mask = shift >= 32 ? 0 : (0xffffffff >>> shift) << shift;
  const ipInt = ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0;
  const netInt = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

/** Whether a hostname/IP is excluded from the proxy by NO_PROXY. */
export function matchesNoProxy(hostname, rawNoProxy) {
  const list = String(rawNoProxy ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return false;
  for (const entry of list) {
    if (entry === "*") return true;
    const lower = hostname.toLowerCase();
    const e = entry.toLowerCase().replace(/^\./, "");
    if (!e.includes("/")) {
      if (e === lower) return true;
      if (isIP(lower) === 0 && lower.endsWith("." + e)) return true;
      continue;
    }
    if (isIP(lower) === 4 && ipv4InCidr(lower, e)) return true;
  }
  return false;
}

/** Resolve (https|http) proxy for a URL honoring HTTP(S)_PROXY / ALL_PROXY / NO_PROXY. */
export function proxyForUrl(url) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (matchesNoProxy(hostname, process.env.NO_PROXY ?? process.env.no_proxy)) return null;
  const isHttps = url.protocol === "https:";
  const raw = process.env[isHttps ? "HTTPS_PROXY" : "HTTP_PROXY"]
    ?? process.env[isHttps ? "https_proxy" : "http_proxy"]
    ?? process.env.ALL_PROXY
    ?? process.env.all_proxy;
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return { host: parsed.hostname, port: Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80), httpsProxy: parsed.protocol === "https:" };
  } catch {
    return null;
  }
}

/**
 * Fetch a URL honoring HTTP(S)_PROXY via a CONNECT tunnel when configured;
 * falls back to the global fetch otherwise. Returns a WHATWG Response.
 * @param options { via? } — "auto" (proxy if env set & not NO_PROXY), "direct"
 *   (never proxy), or "proxy" (force the tunnel when a proxy is configured).
 */
export async function fetchViaProxy(url, { headers = {}, signal, via = "auto" } = {}) {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const mergedHeaders = { ...BROWSER_HEADERS, ...headers };
  const useProxy = via !== "direct" && proxyForUrl(parsed) !== null;
  if (!useProxy) {
    return fetch(parsed, { signal, redirect: "manual", headers: mergedHeaders });
  }
  const proxy = proxyForUrl(parsed);
  const isHttps = parsed.protocol === "https:";
  const targetPort = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);
  const CONNECT_path = `${parsed.hostname}:${targetPort}`;
  const tunnel = await connectProxy(proxy, CONNECT_path, signal);
  const path = (parsed.pathname || "/") + parsed.search;
  const rawOut = await new Promise((resolve, reject) => {
    const out = (isHttps ? httpsRequest : httpRequest)({
      method: "GET",
      path,
      ...(isHttps ? { hostname: parsed.hostname, port: 443, servername: parsed.hostname } : { hostname: parsed.hostname, port: 80 }),
      headers: mergedHeaders,
      createConnection: () => tunnel.socket,
      signal
    });
    out.once("response", (msg) => resolve(msg));
    out.once("error", reject);
    out.end();
  });
  tunnel.release();
  return new Response(Readable.toWeb(rawOut), {
    status: rawOut.statusCode ?? 200,
    statusText: rawOut.statusMessage ?? "",
    headers: rawOut.headers
  });
}

/** Open a CONNECT tunnel through the proxy to `CONNECT_path` (host:port). */
function connectProxy(proxy, CONNECT_path, signal) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: CONNECT_path,
      headers: { Host: CONNECT_path },
      signal
    });
    req.on("connect", (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT failed: HTTP ${res.statusCode}`));
        return;
      }
      if (head && head.length > 0) socket.unshift(head);
      resolve({
        socket,
        release() {
          socket.removeAllListeners("error");
          socket.on("error", () => {});
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** Transport-level error regex (used to decide direct→proxy fallback). */
const FETCH_TRANSPORT_RE = /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|getaddrinfo|socket hang up|UND_ERR|network|timeout/i;

function isTransportLike(error) {
  const message = error?.message ?? String(error ?? "");
  const code = error?.cause?.code ?? error?.code ?? "";
  return FETCH_TRANSPORT_RE.test(message) || FETCH_TRANSPORT_RE.test(code);
}

/**
 * Fetch a URL through the global fetch (or the env proxy tunnel) with SSRF
 * checks on every redirect hop. Redirects are followed manually so an
 * internal/private redirect target is rejected BEFORE the request is sent.
 */
export async function fetchWithSsrf(service, rawUrl, label, signal) {
  // At most MAX_REDIRECTS redirects are followed; one more redirect means
  // "too many redirects". Earlier the loop bound was `< MAX_REDIRECTS`, which
  // silently allowed only MAX_REDIRECTS - 1 hops (off-by-one).
  const MAX_REDIRECTS = 5;

  async function fetchResponse(currentUrl) {
    // Direct first; if the transport fails and a proxy is configured, retry
    // through the proxy tunnel (e.g. hosts only reachable behind a proxy).
    try {
      return await fetchViaProxy(currentUrl, { signal, via: "direct" });
    } catch (error) {
      if (isTransportLike(error) && proxyForUrl(new URL(currentUrl)) !== null) {
        return await fetchViaProxy(currentUrl, { signal, via: "proxy" });
      }
      throw error;
    }
  }

  let currentUrl = rawUrl;
  let hops = 0;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeFetchUrlForService(service, currentUrl, label);
    const response = await fetchResponse(currentUrl);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null || location.length === 0) {
        throw new Error(`${label}: redirect response missing Location header`);
      }
      // Release the redirect body before following the next hop.
      try { await response.body?.cancel(); } catch { /* best-effort */ }
      currentUrl = new URL(location, currentUrl).href;
      hops += 1;
      continue;
    }
    return { response, finalUrl: currentUrl, hops };
  }
  throw new Error(`${label}: too many redirects`);
}
