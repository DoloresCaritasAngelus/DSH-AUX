/**
 * dsh-aux compaction message preparation: degrade unusable image blocks to
 * text placeholders so text-only summarizers can still compact.
 *
 * @module @dolorescaritasangelus/dsh-aux/compaction-messages
 */
import { resolvePrimaryRoute } from "./route.js";

/** Build a text placeholder replacing an unusable compaction image block. */
export function compactionImagePlaceholder(ref) {
  const name = ref?.name ?? "";
  const media = ref?.mediaType ?? "image";
  const size = ref?.width !== void 0 && ref?.height !== void 0 ? `, ${ref.width}×${ref.height}` : "";
  const label = name.length > 0 ? name : "未命名";
  return { type: "text", text: `[图片: ${label} (${media}${size}) — 未纳入压缩摘要]` };
}

/**
 * Prepare messages for a compaction-style AUX call.
 *
 * Compaction replays derived session messages, which may carry image blocks
 * with only durable attachment references. The summarizer can use them only
 * when a compaction candidate route accepts images AND the attachment bytes
 * still exist (they may be missing after attachment GC, or after images were
 * handled by subagents rather than by this plugin). To keep `/compact` and
 * automatic compression resilient:
 *  - if no candidate route accepts images, replace every image block with a
 *    short text placeholder so a text-only auxiliary/main model can still
 *    produce the checkpoint summary;
 *  - otherwise keep image blocks that are still readable, and replace only
 *    missing/corrupt/unreadable ones with the same placeholder.
 */
export async function prepareCompactionMessages(service, messages, agent, signal) {
  const hasImage = messages.some(
    (message) => Array.isArray(message?.content) && message.content.some((block) => block?.type === "image"),
  );
  if (!hasImage) return messages;

  const definition = service._taskDefinition("compaction");
  const primary = resolvePrimaryRoute(definition, service.taskDefaults);
  const mainRoute = await service._mainRoute({ session: agent?.session, agent });
  const candidates = [];
  if (primary !== void 0) candidates.push(primary);
  if (service.fallbackToMain && mainRoute !== void 0) candidates.push(mainRoute);
  let imageCapable = candidates.length === 0;
  for (const candidate of candidates) {
    const capability = await service._resolveImageCapability(candidate, signal);
    if (capability !== false) {
      imageCapable = true;
      break;
    }
  }
  if (!imageCapable) {
    return messages.map((message) =>
      Array.isArray(message?.content) && message.content.some((block) => block?.type === "image")
        ? {
            ...message,
            content: message.content.map((block) =>
              block?.type === "image" ? compactionImagePlaceholder(block.attachment) : block,
            ),
          }
        : message,
    );
  }

  let attachments;
  try {
    attachments = service._imageCtx?.get("attachments") ?? service.ctx.get("attachments");
  } catch {
    attachments = void 0;
  }
  const out = [];
  for (const message of messages) {
    if (!Array.isArray(message?.content) || !message.content.some((block) => block?.type === "image")) {
      out.push(message);
      continue;
    }
    const content = [];
    let changed = false;
    for (const block of message.content) {
      if (block?.type !== "image") {
        content.push(block);
        continue;
      }
      const ref = block.attachment;
      if (attachments !== void 0 && ref !== void 0) {
        try {
          // Verify the object is present; the LLM stream path would otherwise
          // fail with "Attachment object is missing." for GC'd attachments.
          await attachments.readImage(ref, signal);
          content.push(block);
          continue;
        } catch {
          /* missing/corrupt/unreadable: replace with placeholder */
        }
      }
      changed = true;
      content.push(compactionImagePlaceholder(ref));
    }
    out.push(changed ? { ...message, content } : message);
  }
  return out;
}
