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
import { resolveSafeFetchTarget } from "./url-policy.js";
import { ipv4Octets } from "./url-policy.js";

/**
 * Default connect / first-byte deadline (ms) for one direct request. It bounds
 * a silent TCP drop, a stalled TLS handshake, or a server that accepts the
 * connection but never sends response headers. Implemented as a socket
 * inactivity timer, so it is reset by any progress.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

/**
 * Default idle (no-bytes) deadline (ms) for the response body of one direct
 * request. Reset by every chunk, so a slow-but-progressing large response is
 * never killed; only a full stall trips it.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 45_000;

/**
 * Normalize one timeout option: `undefined`/`null`/non-finite fall back to the
 * default, any value `<= 0` disables that deadline (explicit opt-out).
 */
function resolveTimeoutMs(value, fallback) {
  if (value === void 0 || value === null) return fallback;
  const ms = Number(value);
  if (!Number.isFinite(ms)) return fallback;
  return ms > 0 ? Math.trunc(ms) : 0;
}

/**
 * Arm the two unconditional deadlines on one node:http(s) request:
 *   - connect / first byte: from request start until response headers arrive;
 *   - idle: from the response headers on, reset by every body chunk.
 * Both are socket inactivity timers; `socket.destroy(error)` is required because
 * a socket `timeout` event does not abort the request by itself. A `0`
 * deadline disables that phase. Callers may pass their own values (tests, slow
 * hosts); `fetchWithSsrf` forwards per-service overrides.
 */
function armFetchDeadlines(req, connectTimeoutMs, idleTimeoutMs) {
  const connectMs = resolveTimeoutMs(connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
  const idleMs = resolveTimeoutMs(idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
  let socket = null;
  let response = null;
  let phase = { ms: connectMs, name: "connect/first-byte" };
  const onTimeout = () => {
    const error = new Error(`fetch timed out: no ${phase.name} within ${phase.ms}ms`);
    error.code = "ETIMEDOUT";
    if (response !== null && response.destroyed !== true) {
      // Headers already arrived: destroy the response with the timeout so the
      // body consumer (Readable.toWeb) rejects with ETIMEDOUT instead of the
      // generic "aborted"/ECONNRESET, then drop the socket.
      response.destroy(error);
      if (socket !== null && socket.destroyed !== true) socket.destroy();
      return;
    }
    (socket ?? req).destroy(error);
  };
  const arm = (target, next) => {
    if (target === null || target === void 0) return;
    if (socket !== target) {
      socket = target;
      target.on("timeout", onTimeout);
    }
    phase = next;
    target.setTimeout(next.ms > 0 ? next.ms : 0);
  };
  req.once("socket", (assigned) => arm(assigned, { ms: connectMs, name: "connect/first-byte" }));
  req.once("response", (message) => {
    response = message;
    arm(message?.socket ?? socket, { ms: idleMs, name: "idle body" });
    // The idle deadline bounds progress, not an already-finished response:
    // clear it once the body ends so a server that ignores "Connection: close"
    // is not torn down by our timer after a successful read.
    const clearIdle = () => {
      if (socket !== null && socket.destroyed !== true) socket.setTimeout(0);
    };
    message.once("end", clearIdle);
    message.once("close", clearIdle);
  });
}

/** SSRF-guard options derived from the owning service (injectable DNS for tests). */
function guardOptions(service, label) {
  return {
    allowInternalUrls: service.allowInternalUrls === true,
    lookup: service._dnsLookup ?? dnsLookup,
    label,
  };
}

/**
 * Apply the SSRF guard before fetching a URL (web_extract or vision imageUrl).
 *
 * Preflight only: this resolution validates and is then DISCARDED. The address
 * set that actually pins a connection comes from the per-hop
 * {@link resolveSafeFetchTargetForService} inside {@link fetchWithSsrf}. On the
 * single-page local path the same URL is therefore resolved three times (tool
 * preflight -> `fetchPage` preflight -> pinned hop). The first two are
 * defence-in-depth inherited from base and are redundant for that path; only
 * the third is authoritative, and dropping the earlier ones would require
 * editing `tools/web-extract.js` / `crawl/fetch-page.js` (outside this
 * change's file ownership). The seam post-check in `fetchPage` must stay.
 */
export async function assertSafeFetchUrlForService(service, rawUrl, label = "web_extract") {
  await resolveSafeFetchTarget(rawUrl, guardOptions(service, label));
}

/**
 * Resolve one URL to `{ url, addresses }` for the actual request: the guard
 * runs once and the validated addresses travel with the URL, so the transport
 * connects to exactly what was checked (no second DNS answer can flip). The
 * invariant holds per connection: the transport must open a fresh connection
 * for this address set (see `agent: false` in {@link requestDirect}).
 */
export async function resolveSafeFetchTargetForService(service, rawUrl, label = "web_extract") {
  return await resolveSafeFetchTarget(rawUrl, guardOptions(service, label));
}

/**
 * Build a Node connection lookup that serves the already validated address set
 * and never resolves again. The URL hostname still supplies HTTP Host and TLS
 * SNI, so certificate verification is unchanged.
 * @param addresses validated public addresses from the guard.
 */
export function pinnedLookup(addresses) {
  return (hostname, options, callback) => {
    const family = typeof options?.family === "number" ? options.family : 0;
    const eligible = family === 0 ? addresses : addresses.filter((entry) => entry.family === family);
    if (eligible.length === 0) {
      const error = new Error(`no validated address for ${hostname} in family ${family}`);
      error.code = "ENOTFOUND";
      callback(error, options?.all === true ? [] : "", family);
      return;
    }
    if (options?.all === true) {
      callback(
        null,
        eligible.map((entry) => ({ ...entry })),
      );
      return;
    }
    callback(null, eligible[0].address, eligible[0].family);
  };
}

/**
 * Direct-path transport: one request through node:http/https with the
 * validated addresses pinned as the connection lookup. Redirects are never
 * followed here (the caller handles them hop by hop).
 *
 * Pinning invariant (per connection): the socket is opened through
 * `pinnedLookup(addresses)`, so it reaches exactly the address set the guard
 * validated — but only because this transport never reuses a connection (see
 * `agent: false` below). It does not hold across pooled sockets.
 *
 * @param url absolute URL.
 * @param options { headers, signal, addresses, connectTimeoutMs?, idleTimeoutMs? }
 *   — `addresses` empty means no pinning was possible (internal URLs allowed,
 *   or no lookup available). `connectTimeoutMs` bounds connect/TLS/first byte,
 *   `idleTimeoutMs` bounds body inactivity; both default to the exported
 *   constants and `0` disables one.
 * @returns a WHATWG Response whose `url` is ALWAYS `""` (see note below).
 */
export async function requestDirect(
  url,
  {
    headers = {},
    signal,
    addresses = [],
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  } = {},
) {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const isHttps = parsed.protocol === "https:";
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const rawOut = await new Promise((resolve, reject) => {
    const out = (isHttps ? httpsRequest : httpRequest)({
      method: "GET",
      hostname,
      port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
      path: (parsed.pathname || "/") + parsed.search,
      headers: { ...BROWSER_HEADERS, ...headers },
      // Never share http.globalAgent's keep-alive pool. A pooled socket was
      // opened for an earlier request, possibly with a different (or, under
      // allowInternalUrls, an unpinned) address set; the pool key is only
      // host:port, not the pinned address, so reusing it would silently bypass
      // THIS request's pinned lookup. `agent: false` gives every direct
      // request its own connection, which is what makes the pinning invariant
      // hold "per connection" instead of "per pool entry". It also opts this
      // path out of Node's built-in env-proxy routing (NODE_USE_ENV_PROXY,
      // Node >= 22.21) which would otherwise resolve the target inside the
      // proxy and never consult the pin.
      // Side effect: the wire header changes from `Connection: keep-alive` to
      // `Connection: close` — one TCP/TLS handshake per request (no pooling).
      agent: false,
      ...(isHttps ? { servername: hostname } : {}),
      ...(addresses.length > 0 ? { lookup: pinnedLookup(addresses) } : {}),
      signal,
    });
    // Unconditional deadlines: the guard above is useless if a silent packet
    // drop hangs the request forever. These apply with or without a proxy and
    // never cut a response that keeps making progress.
    armFetchDeadlines(out, connectTimeoutMs, idleTimeoutMs);
    out.once("response", resolve);
    out.once("error", reject);
    out.end();
  });
  // CONTRACT: a manually constructed WHATWG `Response` has no URL — the spec
  // provides no init field for it — so `response.url` is ALWAYS `""` on this
  // transport (the previous undici-based path had a real value). Callers must
  // use the `finalUrl` returned by `fetchWithSsrf` and must never read
  // `response.url` here.
  return new Response(Readable.toWeb(rawOut), {
    status: rawOut.statusCode ?? 200,
    statusText: rawOut.statusMessage ?? "",
    headers: rawOut.headers,
  });
}

/** Direct transport used when no per-service override is installed. */
let directTransport = requestDirect;

/** Test-only seam: replace the process-wide direct transport (null restores it). */
export function setFetchTransportForTests(transport) {
  directTransport = typeof transport === "function" ? transport : requestDirect;
}

/** Browser-like request headers sent on the local fetch path (proxy hygiene). */
const BROWSER_HEADERS = Object.freeze({
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en,zh-CN;q=0.9",
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
  // Normalize the hostname too: callers may hand over a bracketed IPv6
  // literal (e.g. "[::1]") while NO_PROXY entries are compared unbracketed.
  const lower = String(hostname ?? "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  for (const entry of list) {
    if (entry === "*") return true;
    let e = entry.toLowerCase().replace(/^\./, "");
    // NO_PROXY commonly spells IPv6 literals with brackets ("[::1]") while the
    // URL hostname arrives de-bracketed (see proxyForUrl); normalize the entry
    // so the two forms compare equal. Only a bracketed *IPv6 literal* is
    // unwrapped, so "[]" or a bracketed hostname never matches by accident.
    if (e.startsWith("[") && e.endsWith("]") && isIP(e.slice(1, -1)) === 6) {
      e = e.slice(1, -1);
    }
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
  const raw =
    process.env[isHttps ? "HTTPS_PROXY" : "HTTP_PROXY"] ??
    process.env[isHttps ? "https_proxy" : "http_proxy"] ??
    process.env.ALL_PROXY ??
    process.env.all_proxy;
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80),
      httpsProxy: parsed.protocol === "https:",
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a URL honoring HTTP(S)_PROXY via a CONNECT tunnel when configured;
 * the direct path uses the pinned transport otherwise. Returns a WHATWG
 * Response.
 * @param options { via?, addresses?, request?, connectTimeoutMs?, idleTimeoutMs? }
 *   — "auto" (proxy if env set & not NO_PROXY), "direct" (never proxy), or
 *   "proxy" (force the tunnel when a proxy is configured). `addresses` are the
 *   guard's validated addresses to pin on the direct path; `request` overrides
 *   the transport for this call; the two timeout options are forwarded to the
 *   direct transport and bound the proxy path as well.
 */
export async function fetchViaProxy(
  url,
  {
    headers = {},
    signal,
    via = "auto",
    addresses = [],
    request,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  } = {},
) {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const mergedHeaders = { ...BROWSER_HEADERS, ...headers };
  const useProxy = via !== "direct" && proxyForUrl(parsed) !== null;
  if (!useProxy) {
    const send = typeof request === "function" ? request : directTransport;
    return await send(parsed, { headers: mergedHeaders, signal, addresses, connectTimeoutMs, idleTimeoutMs });
  }
  const proxy = proxyForUrl(parsed);
  const isHttps = parsed.protocol === "https:";
  const targetPort = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;
  const CONNECT_path = `${parsed.hostname}:${targetPort}`;
  // KNOWN TRADE-OFF (recorded, not changed): the proxy branch does NOT pin. The
  // CONNECT target is the hostname and the proxy performs its own DNS
  // resolution, so the guard's validated address set does not apply here. This
  // is the pre-existing design: pinning would break proxies that ACL by
  // domain. The trusted-proxy assumption is documented in the report.
  const tunnel = await connectProxy(proxy, CONNECT_path, signal, connectTimeoutMs);
  const path = (parsed.pathname || "/") + parsed.search;
  const rawOut = await new Promise((resolve, reject) => {
    const out = (isHttps ? httpsRequest : httpRequest)({
      method: "GET",
      path,
      ...(isHttps
        ? { hostname: parsed.hostname, port: 443, servername: parsed.hostname }
        : { hostname: parsed.hostname, port: 80 }),
      headers: mergedHeaders,
      createConnection: () => tunnel.socket,
      signal,
    });
    // The tunnel socket is already connected, so this arms the first-byte
    // deadline and then the body idle deadline on the tunneled request.
    armFetchDeadlines(out, connectTimeoutMs, idleTimeoutMs);
    out.once("response", (msg) => resolve(msg));
    out.once("error", reject);
    out.end();
  });
  tunnel.release();
  return new Response(Readable.toWeb(rawOut), {
    status: rawOut.statusCode ?? 200,
    statusText: rawOut.statusMessage ?? "",
    headers: rawOut.headers,
  });
}

/** Open a CONNECT tunnel through the proxy to `CONNECT_path` (host:port). */
function connectProxy(proxy, CONNECT_path, signal, connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: CONNECT_path,
      headers: { Host: CONNECT_path },
      signal,
    });
    // Bound the proxy handshake itself: a proxy that accepts the TCP
    // connection and never answers must not hang the request. A plain
    // (ref-counted) timer is used instead of ClientRequest#setTimeout: the
    // latter is unref'd, so a test/process whose only pending work is this
    // handshake can drain the event loop before the deadline fires.
    const connectMs = resolveTimeoutMs(connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
    const deadline =
      connectMs > 0
        ? setTimeout(() => {
            const error = new Error(`proxy CONNECT timed out after ${connectMs}ms`);
            error.code = "ETIMEDOUT";
            req.destroy(error);
          }, connectMs)
        : null;
    const clearDeadline = () => {
      if (deadline !== null) clearTimeout(deadline);
    };
    req.on("connect", (res, socket, head) => {
      clearDeadline();
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT failed: HTTP ${res.statusCode}`));
        return;
      }
      // The CONNECT deadline must not follow the socket into the tunnel; the
      // tunneled request arms its own deadlines when it takes the socket over.
      socket.setTimeout(0);
      if (head && head.length > 0) socket.unshift(head);
      resolve({
        socket,
        release() {
          socket.removeAllListeners("error");
          socket.on("error", () => {});
        },
      });
    });
    req.on("error", (error) => {
      clearDeadline();
      reject(error);
    });
    req.end();
  });
}

/** Transport-level error regex (used to decide direct→proxy fallback). */
const FETCH_TRANSPORT_RE =
  /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|getaddrinfo|socket hang up|UND_ERR|network|timeout/i;

function isTransportLike(error) {
  const message = error?.message ?? String(error ?? "");
  const code = error?.cause?.code ?? error?.code ?? "";
  return FETCH_TRANSPORT_RE.test(message) || FETCH_TRANSPORT_RE.test(code);
}

/**
 * Fetch a URL through the pinned direct transport (or the env proxy tunnel) with SSRF
 * checks on every redirect hop. Redirects are followed manually so an
 * internal/private redirect target is rejected BEFORE the request is sent.
 */
export async function fetchWithSsrf(service, rawUrl, label, signal) {
  // At most MAX_REDIRECTS redirects are followed; one more redirect means
  // "too many redirects". Earlier the loop bound was `< MAX_REDIRECTS`, which
  // silently allowed only MAX_REDIRECTS - 1 hops (off-by-one).
  const MAX_REDIRECTS = 5;

  const transport = typeof service?._httpRequest === "function" ? service._httpRequest : void 0;

  // Deadlines are UNCONDITIONAL: this transport replaced undici's global fetch
  // (and with it undici's 300s default headers/body bound), so every direct
  // attempt gets a connect/first-byte and an idle body deadline even when no
  // proxy is configured. `_connectTimeoutMs` / `_idleTimeoutMs` on the service
  // are test/ops overrides (`0` disables one); they never cut a response that
  // keeps streaming.
  const timeouts = {
    connectTimeoutMs: resolveTimeoutMs(service?._connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS),
    idleTimeoutMs: resolveTimeoutMs(service?._idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS),
  };

  async function fetchResponse(target) {
    // Direct first; if the transport fails and a proxy is configured, retry
    // through the proxy tunnel (e.g. hosts only reachable behind a proxy).
    try {
      return await fetchViaProxy(target.url, {
        signal,
        via: "direct",
        addresses: target.addresses,
        request: transport,
        ...timeouts,
      });
    } catch (error) {
      // KNOWN TRADE-OFF (recorded, not changed): the fallback below is NOT
      // pinned — it is a CONNECT tunnel and the proxy resolves the target. A
      // caller abort is never converted into a proxy retry (AbortError is not
      // transport-like), so cancelling still cancels.
      if (isTransportLike(error) && proxyForUrl(new URL(target.url)) !== null) {
        return await fetchViaProxy(target.url, { signal, via: "proxy", ...timeouts });
      }
      throw error;
    }
  }

  let currentUrl = rawUrl;
  let hops = 0;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // One resolution per hop: the guard's validated addresses are pinned onto
    // the connection, so the transport cannot resolve the hostname again into
    // a different (internal) address.
    const target = await resolveSafeFetchTargetForService(service, currentUrl, label);
    const response = await fetchResponse(target);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null || location.length === 0) {
        throw new Error(`${label}: redirect response missing Location header`);
      }
      // Release the redirect body before following the next hop.
      try {
        await response.body?.cancel();
      } catch {
        /* best-effort */
      }
      // KNOWN TRADE-OFF (recorded, not changed): an https -> http redirect
      // downgrade is followed (pre-existing behaviour). No credentials travel
      // across hops (BROWSER_HEADERS are fixed), so only page integrity is
      // affected; tightening it would be a behaviour change outside this fix.
      currentUrl = new URL(location, currentUrl).href;
      hops += 1;
      continue;
    }
    return { response, finalUrl: currentUrl, hops };
  }
  throw new Error(`${label}: too many redirects`);
}
