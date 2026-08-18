/**
 * dsh-aux tool registration.
 *
 * @module @dolorescaritasangelus/dsh-aux/tools/register
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { runVision } from "./vision.js";
import { runWebExtract } from "./web-extract.js";
import { runWebCrawl } from "./web-crawl.js";
import { runCompress } from "./compress.js";

/** Register the auxiliary tools. */
export function registerAuxTools(service) {
  const ctx = service.ctx;
  // The vision tool needs the durable attachment service; register it in
  // the attachments-injected scope (mirrors dsh-tool-fs read_image), so
  // `ctx.get("attachments")` resolves inside execution even under a
  // subagent-scoped context. The other two tools need no image store.
  ctx.inject(["attachments"], (imageCtx) => {
    service._imageCtx = imageCtx;
    imageCtx.tools.register(defineTool({
      name: "vision_analyze",
      description: "Look at one image (or several via the images array) with the auxiliary vision model and answer a SPECIFIC question about it/them. Always state exactly what you need to know in the question parameter (extract text, count objects, read a chart, check a color, compare elements) — never ask for a generic description, because the vision model answers your intent, not a caption. If the returned description misses a detail you need, call again with a more specific question about that detail. If the same image (same attachmentId) was already analyzed with the same question in this session, reuse that earlier result instead of re-analyzing. Provide one of attachmentId (a session image attachment), imagePath (a local image file), imageUrl (a remote image URL), or an images array (each entry exactly one of those three keys; analyzed in parallel — useful for comparing multiple images with one question).",
      parameters: {
        attachmentId: { type: "string", description: "Session attachment id of an image already attached to this conversation." },
        imagePath: { type: "string", description: "Path to a local PNG/JPEG/WebP/GIF image file." },
        imageUrl: { type: "string", description: "URL of a remote image to fetch and analyze." },
        images: { type: "array", description: "Multiple images (or GIFs) to analyze in parallel with the SAME question. Each entry must be an object with exactly one of: attachmentId, imagePath, imageUrl." },
        question: { type: "string", required: true, description: "The SPECIFIC thing you need to know about the image(s) (your intent). One focused question per call; ask a follow-up call for another detail." }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            analysis: { type: "string", description: "Present for single-image calls." },
            analyses: { type: "array", description: "Present for multi-image calls; one entry per image." },
            provider: { type: "string", required: true },
            model: { type: "string", required: true }
          }
        },
        render: (_args, value) => [{ type: "text", text: Array.isArray(value.analyses) ? value.analyses.map((a, i) => "【图" + (i + 1) + "】" + a.analysis).join("\n\n") : value.analysis }]
      },
      timeoutMs: 120_000,
      isConcurrencySafe: () => true,
      execute: (args, exec) => runVision(service, args, exec)
    }));
  });
  ctx.tools.register(defineTool({
    name: "web_extract",
    description: "Fetch a web page (or a same-origin set of pages via followLinks) and summarize it with the auxiliary model: returns a factual summary plus key points. Fetches static HTML only — no JavaScript rendering. Use when you need the essence of a page (or doc set) without carrying its full text.",
    parameters: {
      url: { type: "string", required: true, description: "The HTTP(S) URL to fetch and summarize." },
      question: { type: "string", description: "Optional question to answer from the page." },
      maxChars: { type: "integer", description: "Max page code points sent to the model (per call; for a crawl, the shared total budget). Default from config, else 8000." },
      followLinks: { type: "string", description: "'off' (default): single page. 'same-origin': follow same-origin links, crawling up to maxPages pages within maxDepth and the shared maxChars budget." },
      maxPages: { type: "integer", description: "Max pages to fetch when followLinks is same-origin (default 3)." },
      maxDepth: { type: "integer", description: "Max link depth to follow when followLinks is same-origin; 0 = root only (default 1)." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", required: true },
          summary: { type: "string", required: true },
          keyPoints: { type: "array", items: { type: "string" }, required: true },
          provider: { type: "string", required: true },
          model: { type: "string", required: true },
          chars: { type: "integer", description: "Code points of the page's retained content sent to the model (truncation marker excluded; single-page calls)." },
          truncated: { type: "boolean", description: "True when page text was cut to fit maxChars." },
          pages: { type: "array", description: "Per-page crawl metadata (present when followLinks is same-origin).", items: { type: "object", additionalProperties: false, properties: { url: { type: "string", required: true }, chars: { type: "integer", required: true }, truncated: { type: "boolean", required: true } } } },
          totalChars: { type: "integer", description: "Total content code points sent to the model across a crawl (truncation markers/wrappers excluded)." }
        }
      },
      render: (args, value) => [
        { type: "text", text: value.summary + (value.keyPoints.length > 0 ? "\n\n要点:\n- " + value.keyPoints.join("\n- ") : "") + (Array.isArray(value.pages) ? "\n\n已抓取 " + value.pages.length + " 页: " + value.pages.map((p) => p.url).join(" · ") : "") }
      ]
    },
    timeoutMs: 90_000,
    isConcurrencySafe: () => true,
    execute: (args, exec) => runWebExtract(service, args, exec)
  }));
  ctx.tools.register(defineTool({
    name: "web_crawl",
    description: "Crawl a documentation site (or a whitelisted host set) starting from a seed URL and summarize the whole site with the auxiliary model: returns an overall summary plus per-page metadata. Respects robots.txt and per-host rate limits by default; every page and hop is SSRF-checked. Fetches static HTML only — no JavaScript rendering.",
    parameters: {
      url: { type: "string", required: true, description: "Seed URL; the crawl starts here." },
      question: { type: "string", description: "Optional question to focus the summary." },
      scope: { type: "string", description: "'same-origin' (default): only the seed's origin. 'hosts': only the hostnames listed in hosts[] (domain scope is not enabled in v1)." },
      hosts: { type: "array", items: { type: "string" }, description: "Allowed hostnames when scope is 'hosts' (the seed host must be included)." },
      maxPages: { type: "integer", description: "Max pages to fetch (default 10)." },
      maxDepth: { type: "integer", description: "Max link depth from the seed (default 2); 0 = seed only." },
      maxCharsPerPage: { type: "integer", description: "Per-page code-point budget (default from config, else 8000)." },
      maxTotalChars: { type: "integer", description: "Total code-point budget across pages; 0 (default) derives it as maxPages × maxCharsPerPage." },
      maxSeconds: { type: "integer", description: "Total time budget in seconds; 0 (default) = unlimited." },
      minIntervalMs: { type: "integer", description: "Minimum gap between requests to the same host (default 250)." },
      respectRobots: { type: "boolean", description: "Respect robots.txt (default true); set false to ignore robots checks." },
      useSitemap: { type: "boolean", description: "Seed URL discovery from <origin>/sitemap.xml (default false); nested sitemap indices are skipped." },
      seedUrls: { type: "array", items: { type: "string" }, description: "Extra depth-0 seed URLs beyond the root seed; still SSRF-checked and scope-filtered." },
      maxPagesPerHost: { type: "integer", description: "Max pages to fetch per host before skipping further links from it (0 = unlimited, default)." },
      perPageSummaries: { type: "boolean", description: "Produce a per-page summary (mode B, default false) instead of one aggregate summary; costs one auxiliary call per page plus one aggregation call." },
      perPageConcurrency: { type: "integer", description: "Max concurrent per-page summary calls when perPageSummaries is true (default 1)." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          root: { type: "string", required: true },
          scope: { type: "string", required: true },
          pages: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: { url: { type: "string", required: true }, chars: { type: "integer", required: true, description: "Retained content code points (marker excluded)." }, truncated: { type: "boolean", required: true }, title: { type: "string" } } } },
          fetched: { type: "integer", required: true },
          skipped: { type: "integer", required: true },
          blocked: { type: "integer", required: true },
          totalChars: { type: "integer", required: true, description: "Mode A: total content code points of crawled page texts; Mode B: total code points of per-page summaries." },
          truncated: { type: "boolean", required: true },
          summary: { type: "string", required: true },
          keyPoints: { type: "array", items: { type: "string" }, required: true },
          perPage: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: { url: { type: "string", required: true }, summary: { type: "string", required: true }, keyPoints: { type: "array", items: { type: "string" }, required: true } } } },
          provider: { type: "string", required: true },
          model: { type: "string", required: true },
          mode: { type: "string", description: "'aggregate' (mode A default) or 'per-page' (mode B)." },
          warnings: { type: "array", items: { type: "string" } }
        }
      },
      render: (args, value) => [
        { type: "text", text: (value.mode === "per-page" ? `已抓取 ${value.fetched} 页(逐页摘要 ` + value.perPage.length + " 篇)\n\n" : `已抓取 ${value.fetched} 页(跳过 ${value.skipped},失败 ${value.blocked})\n\n`) + value.summary + (value.keyPoints.length > 0 ? "\n\n要点:\n- " + value.keyPoints.join("\n- ") : "") + "\n\n页面:\n" + value.pages.map((p) => "- " + p.url + (p.title ? ` (${p.title})` : "")).join("\n") + (value.perPage.length > 0 ? "\n\n逐页摘要:\n" + value.perPage.map((p) => "### " + p.url + "\n" + p.summary).join("\n\n") : "") }
      ]
    },
    timeoutMs: 180_000,
    isConcurrencySafe: () => false,
    execute: (args, exec) => runWebCrawl(service, args, exec)
  }));
  ctx.tools.register(defineTool({
    name: "compress_text",
    description: "Compress long text with the auxiliary model, preserving factual details (numbers, paths, identifiers). Use to shrink oversized tool output, research notes, or logs before they enter context.",
    parameters: {
      text: { type: "string", required: true, description: "The text to compress." },
      instruction: { type: "string", description: "Optional additional compression requirements (e.g. 'keep every file path')." },
      targetRatio: { type: "number", description: "Target compressed/original ratio (0.05-0.5). If maxOutputChars is set, it takes precedence." },
      maxOutputChars: { type: "integer", description: "Optional output budget in characters. Preferred over targetRatio when provided." },
      mode: { type: "string", description: "Optional soft compression profile hint: auto, code, log, doc, or general. Auto is recommended." },
      preserve: { type: "array", items: { type: "string" }, description: "Optional structured preservation hints: paths, numbers, headers, ids, urls, signatures, levels, stacktraces." },
      hierarchical: { type: "boolean", description: "Optional deep compression for very large inputs (skeleton then refine). Usually auto-enabled above 200K chars." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          compressed: { type: "string", required: true },
          originalChars: { type: "integer", required: true },
          compressedChars: { type: "integer", required: true },
          ratio: { type: "number", required: true },
          provider: { type: "string", required: true },
          model: { type: "string", required: true },
          strategy: { type: "string", description: "Detected or requested compression profile." },
          confidence: { type: "number", description: "Confidence of the profile detection (0-1)." },
          rounds: { type: "integer", description: "Number of compression rounds used." },
          segments: { type: "integer", description: "Number of input segments processed." },
          degraded: { type: "boolean", description: "True when at least one segment/round failed and original text was kept." },
          warnings: { type: "array", items: { type: "string" }, description: "Non-fatal warnings (e.g. unknown preserve hints, failed segment recovery)." }
        }
      },
      render: (args, value) => [{ type: "text", text: value.compressed }]
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    execute: (args, exec) => runCompress(service, args, exec)
  }));
}
