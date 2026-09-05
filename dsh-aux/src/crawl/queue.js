/**
 * Crawl engine helpers (BFS, dedup, budget, scope, robots, per-host intervals)
 * shared by web_extract.followLinks and web_crawl via `crawlSite`. There is a
 * single crawl implementation — the web_extract and web_crawl tools both
 * delegate here (design: no parallel crawl logic).
 *
 * @module @dolorescaritasangelus/dsh-aux/crawl/queue
 */
import { extractPageLinksWhere, htmlToText } from "../prompt.js";
import { fetchPage } from "./fetch-page.js";
import { truncateByChars } from "./text.js";
import { fetchWithSsrf } from "../fetch.js";
import { isBinaryContentType } from "../prompt.js";
import { readTextCapped } from "./fetch-page.js";

/** Link scan reads more raw HTML than the model text budget so crawl link
 * discovery does not miss links that sit past the summary text cap. */
export const LINK_SCAN_FACTOR = 4;
export const LINK_SCAN_MIN = 32_000;
export const LINK_SCAN_MAX = 256_000;

/** web_crawl defaults (mirrors the design doc decisions). */
export const CRAWL_DEFAULTS = Object.freeze({
  maxPages: 10,
  maxDepth: 2,
  minIntervalMs: 250,
  maxSeconds: 0,
});

/** Normalized URL used for link dedup (hash stripped). */
export function normalizePageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return String(url);
  }
}

/**
 * robots.txt policy: best-effort `Allow`/`Disallow` path-prefix matching.
 * The longest matching rule wins; ties favour Allow. Empty/missing rules
 * allow everything. Advanced selectors (`$`, `*` wildcards, user-agent
 * targeting) are not interpreted — prefix matching only.
 */
export class RobotsPolicy {
  constructor(rules = []) {
    this.rules = rules;
  }

  /** Parse robots.txt text into a policy (all rule groups apply conservatively). */
  static parse(text) {
    const rules = [];
    for (const line of String(text ?? "").split(/\r?\n/)) {
      const m = /^\s*(Allow|Disallow)\s*:\s*(.+?)\s*$/i.exec(line);
      if (m === null) continue;
      const path = m[2];
      if (path.length === 0) continue; // empty rule = allow all, no-op here
      rules.push({ type: m[1].toLowerCase() === "allow" ? "allow" : "disallow", path });
    }
    return new RobotsPolicy(rules);
  }

  isAllowed(pathname) {
    if (this.rules.length === 0) return true;
    let best = null;
    let bestLen = -1;
    for (const rule of this.rules) {
      if (!pathname.startsWith(rule.path)) continue;
      if (rule.path.length > bestLen) {
        best = rule;
        bestLen = rule.path.length;
      } else if (rule.path.length === bestLen && best !== null && rule.type === "allow" && best.type === "disallow") {
        best = rule; // equal-length tie favours Allow
      }
    }
    if (best === null) return true;
    return best.type === "allow";
  }
}

/** Fetch one host's robots.txt (404/missing → allow all; failures are optimistic). */
async function fetchRobots(service, origin, { label, signal }) {
  const url = `${origin}/robots.txt`;
  try {
    const local = await fetchWithSsrf(service, url, label, signal);
    if (!local.response.ok) return new RobotsPolicy([]);
    const contentType = local.response.headers.get("content-type") ?? "";
    if (isBinaryContentType(contentType)) return new RobotsPolicy([]);
    const raw = await readTextCapped(local.response, 16_384);
    const text = raw.text;
    // A robots file is plain text. Some servers (notably MediaWiki) rewrite
    // /robots.txt to an HTML page; parsing that would produce a bogus blanket
    // block. If the response is HTML, treat the site as having no usable
    // robots policy — optimistically allow (robots failures never block).
    // The body sniff only matches a document prologue so a legal robots file
    // containing a literal "<head>/<html" in a rule is not misfiled.
    if (/text\/html/i.test(contentType) || /^\s*(<!doctype\s+html|<\s*html\b)/i.test(text)) {
      return new RobotsPolicy([]);
    }
    return RobotsPolicy.parse(text);
  } catch {
    // robots failure must never block the crawl — optimistically allow
    return new RobotsPolicy([]);
  }
}

/** Best-effort page title from raw HTML (title tag, then h1). */
export function extractTitle(rawHtml) {
  if (typeof rawHtml !== "string" || rawHtml.length === 0) return void 0;
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(rawHtml) || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(rawHtml);
  if (m === null) return void 0;
  const text = htmlToText(m[1]).split("\n")[0]?.trim() ?? "";
  return text.length > 0 ? truncateByChars(text, 120).text : void 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * General crawl engine for web_extract.followLinks and web_crawl: BFS with
 * configurable scope, robots.txt (default on), per-host minimum interval, and
 * page/total/time budgets. Every page and every hop goes through the
 * seam-first + per-hop SSRF path.
 *
 * @param opts { scope?, hosts?, maxPages?, maxDepth?, maxCharsPerPage?,
 *   maxTotalChars?, minIntervalMs?, maxSeconds?, respectRobots?, signal?, label? }
 * @returns `{ pages, totalChars, fetched, skippedByRobots, skippedByScope, blocked }`.
 */
export async function crawlSite(service, rootUrl, opts = {}) {
  const {
    scope = "same-origin",
    hosts = [],
    seedUrls = [],
    maxPages = CRAWL_DEFAULTS.maxPages,
    maxDepth = CRAWL_DEFAULTS.maxDepth,
    maxCharsPerPage = 8000,
    maxTotalChars = 0,
    minIntervalMs = CRAWL_DEFAULTS.minIntervalMs,
    maxSeconds = 0,
    respectRobots = true,
    useSitemap = false,
    maxPagesPerHost = 0,
    signal,
    label = "web_crawl",
  } = opts;

  const rootParsed = new URL(rootUrl);
  const rootOrigin = rootParsed.origin;
  // Defend at the engine level too (not only at the tool entry): an unknown
  // scope must not silently fall back to same-origin crawling.
  if (scope !== "same-origin" && scope !== "hosts") {
    throw new Error(`${label}: scope must be "same-origin" or "hosts" (domain not enabled in v1)`);
  }
  let allowedHosts = null;
  if (scope === "hosts") {
    if (!Array.isArray(hosts) || !hosts.includes(rootParsed.hostname)) {
      throw new Error(`${label}: scope "hosts" requires the seed host to be listed in hosts[]`);
    }
    allowedHosts = new Set(hosts);
  }
  const matchAllowed = (parsed) => {
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (allowedHosts !== null) return allowedHosts.has(parsed.hostname);
    return parsed.origin === rootOrigin;
  };

  const totalBudget = maxTotalChars > 0 ? maxTotalChars : maxPages * maxCharsPerPage;
  const rawCap = Math.min(LINK_SCAN_MAX, Math.max(LINK_SCAN_MIN, maxCharsPerPage * LINK_SCAN_FACTOR));
  const seen = new Set([normalizePageUrl(rootUrl)]);
  const queue = [{ url: rootUrl, depth: 0 }];
  // Extra depth-0 seeds (e.g. user-supplied seedUrls); they still pass the
  // scope + robots + per-host/global budget gates when popped.
  for (const extra of Array.isArray(seedUrls) ? seedUrls : []) {
    const key = normalizePageUrl(extra);
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push({ url: extra, depth: 0 });
  }
  const pages = [];
  const robotsCache = new Map();
  const lastFetchByHost = new Map();
  const pagesByHost = new Map();
  let totalChars = 0;
  let skippedByRobots = 0;
  let skippedByScope = 0;
  let skippedByHostCap = 0;
  let blocked = 0;
  let challengeBlocks = 0;
  const deadline = maxSeconds > 0 ? Date.now() + maxSeconds * 1000 : Number.POSITIVE_INFINITY;

  const robotsFor = async (origin) => {
    if (respectRobots !== true) return new RobotsPolicy([]);
    if (!robotsCache.has(origin)) {
      robotsCache.set(origin, await fetchRobots(service, origin, { label, signal }));
    }
    return robotsCache.get(origin);
  };

  // Sitemap seeding (opt-in): fetch `<origin>/sitemap.xml` once per origin and
  // queue its document URLs as depth-1 seeds. Nested sitemap indices (<loc>
  // pointing at .xml/.gz) are skipped (no recursion, per design). Entries still
  // pass scope + robots + budget when actually fetched.
  const sitemapDone = new Set();
  const seedSitemap = async (origin) => {
    if (useSitemap !== true || sitemapDone.has(origin)) return;
    sitemapDone.add(origin);
    const sitemapUrl = `${origin}/sitemap.xml`;
    let text;
    try {
      const local = await fetchWithSsrf(service, sitemapUrl, label, signal);
      if (!local.response.ok) return;
      const ct = local.response.headers.get("content-type") ?? "";
      if (isBinaryContentType(ct)) return;
      text = (await readTextCapped(local.response, 256_000)).text;
    } catch {
      return;
    }
    const locs = [...String(text).matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)]
      .map((m) => m[1].trim())
      .filter((s) => s.length > 0);
    for (const loc of locs) {
      if (/\.(xml|xml\.gz|gz)([?#]|$)/i.test(loc)) continue; // nested sitemap/index — skip
      let parsed;
      try {
        parsed = new URL(loc, origin + "/");
      } catch {
        continue;
      }
      if (!matchAllowed(parsed)) {
        skippedByScope += 1;
        continue;
      }
      const key = normalizePageUrl(parsed.href);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ url: parsed.href, depth: 1 });
    }
  };

  while (queue.length > 0 && pages.length < maxPages) {
    if (Date.now() > deadline) break;
    const { url: pageUrl, depth } = queue.shift();
    let parsed;
    try {
      parsed = new URL(pageUrl);
    } catch {
      continue;
    }
    if (!matchAllowed(parsed)) {
      skippedByScope += 1;
      continue;
    }
    const origin = parsed.origin;
    const robots = await robotsFor(origin);
    if (!robots.isAllowed(parsed.pathname)) {
      skippedByRobots += 1;
      continue;
    }
    await seedSitemap(origin);
    const remaining = totalBudget - totalChars;
    if (remaining <= 0) break;
    const cap = Math.min(maxCharsPerPage, remaining);

    // Per-host page budget: stop fetching further pages on a host that hit its cap.
    const host = parsed.host;
    if (maxPagesPerHost > 0 && (pagesByHost.get(host) ?? 0) >= maxPagesPerHost) {
      skippedByHostCap += 1;
      continue;
    }

    // Per-host politeness: keep at least minIntervalMs between requests.
    const lastAt = lastFetchByHost.get(host);
    if (lastAt !== void 0) {
      const wait = lastAt + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
    }
    lastFetchByHost.set(host, Date.now());

    let page;
    try {
      page = await fetchPage(service, pageUrl, { textCap: cap, rawCap, signal, label });
    } catch {
      blocked += 1;
      continue;
    }
    // A JS-challenge page yields a bot-check shell, not content — count it
    // separately and never send its text to the model.
    if (page.challenge?.browserRequired) {
      challengeBlocks += 1;
      continue;
    }
    pagesByHost.set(host, (pagesByHost.get(host) ?? 0) + 1);
    pages.push({
      url: page.finalUrl,
      chars: page.chars,
      truncated: page.truncated,
      depth,
      isHtml: page.isHtml,
      rawHtml: page.rawHtml,
      text: page.text,
      title: extractTitle(page.rawHtml ?? ""),
    });
    totalChars += page.chars;

    if (depth < maxDepth && page.isHtml && pages.length < maxPages) {
      // Collect all http(s) document links first (extension filter applied),
      // then count scope-ineligible ones and queue the rest.
      const rawLinks = extractPageLinksWhere(
        page.rawHtml ?? "",
        page.finalUrl,
        (u) => u.protocol === "http:" || u.protocol === "https:",
      );
      for (const link of rawLinks) {
        const key = normalizePageUrl(link);
        if (seen.has(key)) continue;
        seen.add(key);
        let parsedLink;
        try {
          parsedLink = new URL(link);
        } catch {
          continue;
        }
        if (!matchAllowed(parsedLink)) {
          skippedByScope += 1;
          continue;
        }
        queue.push({ url: link, depth: depth + 1 });
      }
    }
  }

  return {
    pages,
    totalChars,
    fetched: pages.length,
    skippedByRobots,
    skippedByScope,
    skippedByHostCap,
    blocked,
    challengeBlocks,
  };
}
