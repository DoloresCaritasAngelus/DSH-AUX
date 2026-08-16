/**
 * dsh-aux `web_extract` tool implementation.
 *
 * @module @dolorescaritasangelus/dsh-aux/tools/web-extract
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { htmlToText, webExtractSystemPrompt, webExtractUserMessage } from "../prompt.js";
import { assertSafeFetchUrlForService, fetchWithSsrf } from "../fetch.js";

/** Split the model summary into summary + key points. */
function extractKeyPoints(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const points = [];
  const summaryLines = [];
  for (const line of lines) {
    const stripped = line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");
    if (/^[-*•]|^\d+[.)]/.test(line)) {
      points.push(stripped);
    } else {
      summaryLines.push(line);
    }
  }
  return { summary: summaryLines.join("\n"), keyPoints: points };
}

/** web_extract execution. */
export async function runWebExtract(service, args, exec) {
  const url = args.url.trim();
  if (url.length === 0) throw new Error("web_extract: url must be a non-empty string");
  await assertSafeFetchUrlForService(service, url, "web_extract");
  const maxChars = args.maxChars ?? 8000;
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new Error("web_extract: maxChars must be a positive integer");
  }
  // Prefer the ctx.web seam (provider-registered fetch: status codes,
  // decoded bodies, truncation); fall back to a plain fetch when no web
  // provider is registered (e.g. no DEEPSEEK_API_KEY), so web_extract
  // works in every environment.
  let pageText;
  let finalUrl = url;
  try {
    const fetchResult = await service.ctx.web.fetch({ url }, exec.signal);
    if (fetchResult.statusCode >= 400) {
      throw new Error(`web_extract: HTTP ${fetchResult.statusCode} fetching ${url}`);
    }
    finalUrl = fetchResult.url ?? url;
    // The provider may have followed redirects; reject a final URL that
    // points back at an internal/private target (best-effort post-check).
    await assertSafeFetchUrlForService(service, finalUrl, "web_extract");
    // HTML bodies are cleaned to plain text before reaching the auxiliary
    // model; text bodies pass through unchanged.
    pageText = fetchResult.body.kind === "html"
      ? htmlToText(fetchResult.body.content)
      : fetchResult.body.content;
  } catch (error) {
    const message = error?.message ?? String(error);
    if (!/no usable web provider|web provider/i.test(message)) throw error;
    const { response, finalUrl: redirectedUrl } = await fetchWithSsrf(service, url, "web_extract", exec.signal);
    if (!response.ok) {
      throw new Error(`web_extract: HTTP ${response.status} fetching ${url}`);
    }
    finalUrl = redirectedUrl;
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    pageText = /html/i.test(contentType) ? htmlToText(raw) : raw;
  }
  if (pageText.length > maxChars) {
    pageText = pageText.slice(0, maxChars) + "\n[…truncated]";
  }
  const messages = [createUserMessage({
    content: [{ type: "text", text: webExtractUserMessage(pageText, url, args.question ?? "") }],
    source: { kind: "plugin", plugin: "dsh-aux" }
  })];
  const result = await service.call("web_extract", {
    messages,
    system: webExtractSystemPrompt(),
    temperature: 0.2,
    session: exec.agent?.session,
    agent: exec.agent,
    signal: exec.signal,
    inputChars: pageText.length
  });
  const extracted = extractKeyPoints(result.text);
  return {
    url: finalUrl,
    summary: extracted.summary || result.text,
    keyPoints: extracted.keyPoints,
    provider: result.provider,
    model: result.model
  };
}
