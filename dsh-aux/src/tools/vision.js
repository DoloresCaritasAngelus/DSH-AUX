/**
 * dsh-aux `vision_analyze` tool implementation.
 *
 * @module @dolorescaritasangelus/dsh-aux/tools/vision
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { visionSystemPrompt } from "../prompt.js";
import { resolveImageRef } from "../images/resolve.js";
import { recordAttachmentOwnership } from "../images/ownership.js";
import { recordImageMemory } from "../images/memory.js";

/** Run async work over an array with a bounded number of concurrent workers. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** vision_analyze execution. Supports ONE image via the classic single
 * source fields, or MANY via `images` (bounded by maxImagesPerMessage and a
 * small download/analysis concurrency limit). */
export async function runVision(service, args, exec) {
  const single = [
    args.attachmentId !== void 0 && args.attachmentId.length > 0,
    args.imagePath !== void 0 && args.imagePath.length > 0,
    args.imageUrl !== void 0 && args.imageUrl.length > 0
  ].filter(Boolean).length;
  const images = Array.isArray(args.images) ? args.images : [];
  const itemCount = images.length + (single > 0 ? 1 : 0);
  if (itemCount === 0) throw new Error("vision_analyze: provide one of attachmentId, imagePath, imageUrl, or an images array");
  if (images.length > 0 && single > 0) throw new Error("vision_analyze: provide either the images array or a single image source, not both");
  if (images.length > 0 && images.some((item) => !validImageItem(item))) {
    throw new Error("vision_analyze: each images entry must be an object with exactly one of attachmentId, imagePath, or imageUrl");
  }
  // Bound the batch size to the attachment service's per-message limit.
  let attachments;
  try {
    attachments = service._imageCtx?.get("attachments") ?? service.ctx.get("attachments");
  } catch {
    attachments = void 0;
  }
  const maxImages = attachments?.imageLimits?.maxImagesPerMessage ?? 5;
  if (images.length > maxImages) {
    throw new Error(`vision_analyze: images array exceeds maxImagesPerMessage (${maxImages})`);
  }
  const question = args.question ?? "";
  if (question.length === 0) {
    // Focus-hint contract: the vision model answers the caller's intent,
    // not a generic caption. Refuse instead of silently degrading.
    throw new Error("vision_analyze: question is required — state what you need to know about the image");
  }
  const items = images.length > 0
    ? images
    : [{ attachmentId: args.attachmentId, imagePath: args.imagePath, imageUrl: args.imageUrl }];
  const results = await mapWithConcurrency(items, Math.min(maxImages, 4), (item) => analyzeOne(service, item, question, exec));
  if (images.length === 0) return results[0]; // classic single-image shape
  return {
    analyses: results,
    provider: results[0].provider,
    model: results[0].model
  };
}

/** One `images` entry is valid when it names exactly one source. */
export function validImageItem(item) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
  const keys = ["attachmentId", "imagePath", "imageUrl"].filter((k) => typeof item[k] === "string" && item[k].length > 0);
  return keys.length === 1;
}

/** Analyze exactly one image through the auxiliary vision route. */
export async function analyzeOne(service, source, question, exec) {
  const ref = await resolveImageRef(service, source, exec);
  // Record ownership for disposal cleanup (session -> attachment id).
  if (exec.agent?.session?.id !== void 0) {
    recordAttachmentOwnership(service, exec.agent.session.id, ref.attachmentId);
  }
  const messages = [createUserMessage({
    content: [
      { type: "image", attachment: ref },
      { type: "text", text: question }
    ],
    source: { kind: "plugin", plugin: "dsh-aux" }
  })];
  const result = await service.call("vision", {
    messages,
    system: visionSystemPrompt(),
    session: exec.agent?.session,
    agent: exec.agent,
    signal: exec.signal,
    inputChars: question.length
  });
  // Image memory: persist a compact record so a restarted main session can
  // recall what was looked at without re-analyzing. Best-effort.
  if (exec.agent?.session?.id !== void 0) {
    recordImageMemory(service, exec.agent.session.id, ref.attachmentId, question, result.text);
  }
  return { analysis: result.text, provider: result.provider, model: result.model };
}
