/**
 * SSRF guard for dsh-aux URL-fetching tools (`web_extract`, and the
 * `imageUrl` path of `vision_analyze`).
 *
 * The guard is deliberately conservative:
 *   - only http:/https: URLs are allowed (file:, gopher:, etc. are rejected);
 *   - by default, literal loopback/private/link-local/reserved addresses and
 *     private-use hostnames (`localhost`, `*.local`, `*.internal`, …) are
 *     rejected;
 *   - when a hostname is not a literal IP and `allowInternalUrls` is false,
 *     the hostname is resolved once and the resolved address is checked too,
 *     which catches `nip.io`-style DNS rebinding helpers without claiming to
 *     be a complete DNS-rebinding defense.
 *
 * @module @dolorescaritasangelus/dsh-aux/url-policy
 */
import { isIP } from "node:net";

/** Private / special-purpose IPv4 prefixes that must never be fetched by default. */
const IPV4_BLOCKED = [
  // this network
  (o) => o[0] === 0,
  // RFC1918 private
  (o) => o[0] === 10,
  (o) => o[0] === 172 && o[1] >= 16 && o[1] <= 31,
  (o) => o[0] === 192 && o[1] === 168,
  // CGNAT / carrier-grade NAT
  (o) => o[0] === 100 && o[1] >= 64 && o[1] <= 127,
  // loopback
  (o) => o[0] === 127,
  // link-local
  (o) => o[0] === 169 && o[1] === 254,
  // IETF protocol assignments / TEST-NET / benchmark
  (o) => o[0] === 192 && o[1] === 0 && o[2] === 0,
  (o) => o[0] === 192 && o[1] === 0 && o[2] === 2,
  (o) => o[0] === 198 && (o[1] === 18 || o[1] === 19),
  (o) => o[0] === 198 && o[1] === 51 && o[2] === 100,
  (o) => o[0] === 203 && o[1] === 0 && o[2] === 113,
  // multicast / reserved / broadcast
  (o) => o[0] >= 224,
  (o) => o[0] === 255
];

/** Parse an IPv4 dotted-quad string into octets, or null. */
function ipv4Octets(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN;
    return Number(part);
  });
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
  return octets;
}

/** Whether an IPv4 address is private / special-purpose for SSRF purposes. */
export function isPrivateIpv4(ip) {
  const octets = ipv4Octets(ip);
  if (octets === null) return false;
  return IPV4_BLOCKED.some((pred) => pred(octets));
}

/** Normalize an IPv6 string (with or without brackets) and return its lower-case form. */
function normalizeIpv6(ip) {
  return ip.replace(/^\[|\]$/g, "").toLowerCase();
}

/** Whether an IPv6 address is loopback / link-local / ULA / multicast / unspecified. */
export function isPrivateIpv6(ip) {
  const value = normalizeIpv6(ip);
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true; // fc00::/7 ULA
  if (value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true; // fe80::/10 link-local
  if (value.startsWith("fec") || value.startsWith("fed") || value.startsWith("fee") || value.startsWith("fef")) return true; // fec0::/10 site-local (deprecated)
  if (value.startsWith("ff")) return true; // multicast
  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:xxxx:xxxx) — check the embedded IPv4.
  const v4mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped !== null) return isPrivateIpv4(v4mapped[1]);
  const v4mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4mappedHex !== null) {
    const a = parseInt(v4mappedHex[1], 16) >> 8;
    const b = parseInt(v4mappedHex[1], 16) & 0xff;
    const c = parseInt(v4mappedHex[2], 16) >> 8;
    const d = parseInt(v4mappedHex[2], 16) & 0xff;
    return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
  }
  // Deprecated IPv4-compatible IPv6 (::a.b.c.d / ::xxxx:xxxx) can alias IPv4.
  const v4compatHex = value.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4compatHex !== null) {
    const a = parseInt(v4compatHex[1], 16) >> 8;
    const b = parseInt(v4compatHex[1], 16) & 0xff;
    const c = parseInt(v4compatHex[2], 16) >> 8;
    const d = parseInt(v4compatHex[2], 16) & 0xff;
    return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
  }
  // 6to4 / Teredo can embed private IPv4; block the well-known prefixes too.
  if (value.startsWith("2002:")) {
    // 2002:V4::
    const hex = value.slice(5, 9);
    if (/^[0-9a-f]{4}$/.test(hex)) {
      const a = parseInt(hex.slice(0, 2), 16);
      const b = parseInt(hex.slice(2, 4), 16);
      return isPrivateIpv4(`${a}.${b}.0.0`);
    }
  }
  return false;
}

/** Whether an IP string (v4 or v6) is private / special-purpose. */
export function isPrivateIp(ip) {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

/** Private-use hostname suffixes that should not be fetched by default. */
const PRIVATE_HOSTNAME_RE = /(^|\.)(localhost|local|internal|lan|home\.arpa|localdomain|intranet|corp|home)$/i;

/** Whether a hostname is obviously private-use (without DNS resolution). */
export function isPrivateHostname(hostname) {
  const host = hostname.replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return PRIVATE_HOSTNAME_RE.test(host);
}

/**
 * Synchronous URL-shape guard: rejects non-http(s) protocols and, unless
 * `allowInternalUrls` is true, literal private IPs and private-use hostnames.
 * @param rawUrl the URL string supplied by the model/user.
 * @param options { allowInternalUrls?: boolean }
 * @returns the parsed URL.
 */
export function assertSafeHttpUrl(rawUrl, options = {}) {
  const label = options.label ?? "web_extract";
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new Error(`${label}: url must be a non-empty string`);
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`${label}: invalid URL "${String(rawUrl).slice(0, 80)}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label}: only http/https URLs are allowed (got "${parsed.protocol}")`);
  }
  if (options.allowInternalUrls === true) return parsed;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  if (family === 4 || family === 6) {
    if (isPrivateIp(hostname)) {
      throw new Error(`${label}: internal/private URL "${parsed.host}" is blocked by default`);
    }
    return parsed;
  }
  if (isPrivateHostname(hostname)) {
    throw new Error(`${label}: internal/private hostname "${parsed.host}" is blocked by default`);
  }
  return parsed;
}

/**
 * Async SSRF guard used before every fetch. Runs the synchronous checks and,
 * when the hostname is not a literal IP, resolves it and rejects private
 * resolved addresses. `lookup` defaults to `dns.promises.lookup`; injectable
 * for tests.
 */
export async function assertSafeFetchUrl(rawUrl, options = {}) {
  const label = options.label ?? "web_extract";
  const parsed = assertSafeHttpUrl(rawUrl, options);
  if (options.allowInternalUrls === true) return parsed;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) !== 0) return parsed;
  if (typeof options.lookup !== "function") return parsed;
  let resolved;
  try {
    resolved = await options.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(
      `${label}: cannot resolve hostname "${hostname}" for SSRF check` +
      (error?.message ? ` (${error.message})` : "")
    );
  }
  const addresses = Array.isArray(resolved) ? resolved : [resolved];
  for (const entry of addresses) {
    const address = typeof entry === "string" ? entry : entry?.address;
    if (typeof address === "string" && isPrivateIp(address)) {
      throw new Error(`${label}: hostname "${hostname}" resolves to internal/private address "${address}" and is blocked by default`);
    }
  }
  return parsed;
}
