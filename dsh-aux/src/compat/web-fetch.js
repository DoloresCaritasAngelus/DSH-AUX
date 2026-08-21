/**
 * dsh-aux compat adapter: native `web_fetch` surface, AUX fetch kernel.
 *
 * When `aux.enabled.web_extract` is set to `compat`, the AUX `web_extract`
 * tool is NOT exposed to the model. Instead the native `web_fetch` tool keeps
 * its original name/parameters/return shape, but its execute path is patched
 * to call `AuxLlmService.webFetchCompat()`, which uses AUX's seam-first,
 * SSRF-hardened fetch core (redirect hardening, charset sniffing, JS-challenge
 * detection, text cleaning/truncation).
 *
 * This is the first entry in the compat whitelist (A22 §10.1). Other tools and
 * bridges remain `unavailable` until they have a native equivalent and a
 * stable adapter.
 *
 * @module @dolorescaritasangelus/dsh-aux/compat/web-fetch
 */
import { readFile as readFileText } from "node:fs/promises";
import { fetchPage } from "../crawl/fetch-page.js";
import { assertSafeFetchUrlForService } from "../fetch.js";
import { DEFAULT_MAX_CHARS } from "../route.js";

/**
 * Run one native-shaped `web_fetch` call through the AUX fetch kernel.
 * @param {AuxLlmService} service
 * @param {{ url?: string }} input native web_fetch parsed arguments.
 * @param {{ signal?: AbortSignal, agent?: unknown }} exec tool execution context.
 * @returns native web_fetch result shape.
 */
export async function runWebFetchCompat(service, input, exec) {
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  if (url.length === 0) {
    throw new Error("web_fetch: url must be a non-empty string");
  }
  await assertSafeFetchUrlForService(service, url, "web_fetch");
  const maxChars = service?._merged?.web_extract?.maxChars ?? DEFAULT_MAX_CHARS;
  const page = await fetchPage(service, url, {
    textCap: maxChars,
    rawCap: maxChars,
    signal: exec?.signal,
    label: "web_fetch"
  });
  return {
    url: page.finalUrl,
    statusCode: 200,
    body: {
      kind: page.isHtml ? "html" : "text",
      content: page.text
    },
    truncated: page.truncated
  };
}

/**
 * Detect whether the `dsh-tool-web` compat patch is installed.
 * @returns "installed" | "missing" | "unknown" (not in a standard layout).
 */
export async function webFetchCompatStatus() {
  const rels = [
    "../../../@deepseek-ai/dsh-tool-web/lib/index.js",
    "../../../node_modules/@deepseek-ai/dsh-tool-web/lib/index.js"
  ];
  let src;
  for (const rel of rels) {
    try {
      src = await readFileText(new URL(rel, import.meta.url));
      break;
    } catch {
      /* try next candidate */
    }
  }
  if (src === void 0) return "unknown";
  if (src.includes("dsh-aux web_fetch compat (local patch)")) return "installed";
  return "missing";
}
