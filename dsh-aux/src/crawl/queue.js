/**
 * Crawl queue helpers (BFS, dedup, budget, scope, robots, per-host intervals)
 * shared by web_extract and web_crawl.
 *
 * - `crawlPages`: exact same-origin behavior web_extract's `followLinks` uses.
 * - `crawlSite`: the web_crawl engine — scope (same-origin | hosts), robots.txt
 *   (default on), per-host minimum interval, page/total/time budgets.
 *
 * @module @dolorescaritasangelus/dsh-aux/crawl/queue
 */
import { extractPageLinks, extractPageLinksWhere, htmlToText } from "../prompt.js";
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
  maxSeconds: 0
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
    return RobotsPolicy.parse(raw.text);
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
 * Sequential same-origin BFS crawl (web_extract `followLinks`). Each page is
 * fetched through the seam-first + per-hop SSRF path and its text is capped to
 * the remaining shared character budget.
 * @returns `{ pages, totalChars }` — `totalChars` is the code-point length of
 * the capped page text actually sent to the model.
 */
export async function crawlPages(service, rootUrl, { maxChars, maxPages, maxDepth, signal, label = "web_extract" }) {
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

/**
 * General crawl engine for web_crawl: BFS with configurable scope, robots.txt
 * (default on), per-host minimum interval, and page/total/time budgets.
 * Every page and every hop goes through the seam-first + per-hop SSRF path.
 *
 * @param opts { scope?, hosts?, maxPages?, maxDepth?, maxCharsPerPage?,
 *   maxTotalChars?, minIntervalMs?, maxSeconds?, respectRobots?, signal?, label? }
 * @returns `{ pages, totalChars, fetched, skippedByRobots, skippedByScope, blocked }`.
 */
export async function crawlSite(service, rootUrl, opts = {}) {
  const {
    scope = "same-origin",
    hosts = [],
    maxPages = CRAWL_DEFAULTS.maxPages,
    maxDepth = CRAWL_DEFAULTS.maxDepth,
    maxCharsPerPage = 8000,
    maxTotalChars = 0,
    minIntervalMs = CRAWL_DEFAULTS.minIntervalMs,
    maxSeconds = 0,
    respectRobots = true,
    signal,
    label = "web_crawl"
  } = opts;

  const rootParsed = new URL(rootUrl);
  const rootOrigin = rootParsed.origin;
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
  const pages = [];
  const robotsCache = new Map();
  const lastFetchByHost = new Map();
  let totalChars = 0;
  let skippedByRobots = 0;
  let skippedByScope = 0;
  let blocked = 0;
  const deadline = maxSeconds > 0 ? Date.now() + maxSeconds * 1000 : Number.POSITIVE_INFINITY;

  const robotsFor = async (origin) => {
    if (respectRobots !== true) return new RobotsPolicy([]);
    if (!robotsCache.has(origin)) {
      robotsCache.set(origin, await fetchRobots(service, origin, { label, signal }));
    }
    return robotsCache.get(origin);
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
    const remaining = totalBudget - totalChars;
    if (remaining <= 0) break;
    const cap = Math.min(maxCharsPerPage, remaining);

    // Per-host politeness: keep at least minIntervalMs between requests.
    const host = parsed.host;
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
    pages.push({
      url: page.finalUrl,
      chars: page.chars,
      truncated: page.truncated,
      depth,
      isHtml: page.isHtml,
      rawHtml: page.rawHtml,
      text: page.text,
      title: extractTitle(page.rawHtml ?? "")
    });
    totalChars += page.chars;

    if (depth < maxDepth && page.isHtml && pages.length < maxPages) {
      // Collect all http(s) document links first (extension filter applied),
      // then count scope-ineligible ones and queue the rest.
      const rawLinks = extractPageLinksWhere(page.rawHtml ?? "", page.finalUrl, (u) => u.protocol === "http:" || u.protocol === "https:");
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
    blocked
  };
}
