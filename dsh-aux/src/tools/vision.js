/**
 * dsh-aux `vision_analyze` tool implementation.
 *
 * @module @dolorescaritasangelus/dsh-aux/tools/vision
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { visionSystemPrompt } from "../prompt.js";
import { resolveImageRef } from "../images/resolve.js";
import { recordAttachmentOwnership } from "../images/ownership.js";
import { recordAttachmentRefs } from "../images/attachment-refs.js";
import { recordAuxEvent } from "../events.js";
import { recordImageMemory } from "../images/memory.js";
import { messageOrdinalFor } from "../images/refs.js";
import { sessionEvents } from "../session-utils.js";
import { classifyFailure, isRetryableFailure } from "../route.js";

/** Run async work over an array with a bounded number of concurrent workers.
 * Returns per-item allSettled-style results in input order so a single
 * failure does not drop the other items. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (error) {
        results[i] = { status: "rejected", reason: error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Delay before the single automatic retry (ms): a rate-limited or timed-out
 * route usually needs a moment, and an immediate repeat mostly fails again. */
const RETRY_DELAY_MS = 250;

/** Abortable delay: resolves early when the caller cancels. */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener?.("abort", finish, { once: true });
  });
}

/**
 * Resolve the delivery decision once per tool call. The decision is a property
 * of the batch — every image in one call shares the same main route, the same
 * configuration and the same main-model modalities — while
 * `service.visionDelivery` probes the main route and (through index.js)
 * `llm.resolveModelInfo` on every invocation, none of which is cached. A
 * per-image decision therefore repeated that work once per image *and* once
 * per automatic retry.
 *
 * @param service the aux service (may not implement visionDelivery at all).
 * @param exec tool execution context.
 * @returns {Promise<{mode: "aux"|"native", reason: string}>}
 */
async function resolveDelivery(service, exec) {
  if (typeof service.visionDelivery !== "function") return { mode: "aux", reason: "no-router" };
  return await service.visionDelivery(exec);
}

/**
 * Analyze one image, retrying once when the failure class is transient
 * (rate limit / timeout / connection). The retry re-enters the whole route
 * chain, so a primary route that just entered cooldown can land on a backup.
 * Non-transient failures and aborted calls are rethrown untouched.
 */
async function analyzeWithRetry(service, item, question, exec, delivery) {
  try {
    return await analyzeOne(service, item, question, exec, delivery);
  } catch (error) {
    const kind = classifyFailure(error, exec.signal);
    if (exec.signal?.aborted === true || !isRetryableFailure(kind)) throw error;
    await sleep(RETRY_DELAY_MS, exec.signal);
    if (exec.signal?.aborted === true) throw error;
    return await analyzeOne(service, item, question, exec, delivery);
  }
}

/** Model-facing reason word per classified failure kind. */
const FAILURE_REASON_TEXT = Object.freeze({
  "rate-limit": "限流",
  timeout: "超时",
  connection: "连接失败",
  auth: "鉴权失败",
  payment: "额度不足",
  "model-not-found": "模型不可用",
  content: "内容不受支持",
  aborted: "已取消",
  other: "未知错误",
});

/**
 * Imperative, actionable text for one failed batch entry: the model must know
 * what happened, whether a retry can help, and what to do next — never drop
 * the image silently. Rendered as `【图N】` + this text by the tool render.
 */
export function failureInstruction(kind) {
  const reason = FAILURE_REASON_TEXT[kind] ?? FAILURE_REASON_TEXT.other;
  if (isRetryableFailure(kind)) {
    return `分析失败(${reason},可重试)。如需本图结论,请稍后重试本图或单图重发。`;
  }
  return `分析失败(${reason},不可重试)。请勿重复调用同一来源;如仍需本图结论,请改用其它来源(重新上传或换图),或告知用户该图无法分析。`;
}

/**
 * Attach the display ordinal to one successful analysis value. An image that
 * came from a user message is numbered inside that message (the bridge's
 * "本条消息第N张/共M张" numbering, same source and order); anything else
 * (imagePath / imageUrl) is numbered inside this call only.
 * @param value successful analysis value.
 * @param position zero-based position of this item inside the call.
 * @param total number of items this call requested.
 * @param events the session's event log (for message-scoped numbering).
 */
function withImageOrdinal(value, position, total, events) {
  const message = messageOrdinalFor(events, value?.attachment?.attachmentId);
  return {
    ...value,
    imageOrdinal:
      message === void 0
        ? { scope: "call", index: position + 1, total }
        : { scope: "message", index: message.index, total: message.total },
  };
}

/** vision_analyze execution. Supports ONE image via the classic single
 * source fields, or MANY via `images` (bounded by maxImagesPerMessage and a
 * small download/analysis concurrency limit). */
export async function runVision(service, args, exec) {
  const single = [
    args.attachmentId !== void 0 && args.attachmentId.length > 0,
    args.imagePath !== void 0 && args.imagePath.length > 0,
    args.imageUrl !== void 0 && args.imageUrl.length > 0,
  ].filter(Boolean).length;
  const images = Array.isArray(args.images) ? args.images : [];
  const itemCount = images.length + (single > 0 ? 1 : 0);
  if (itemCount === 0)
    throw new Error("vision_analyze: provide one of attachmentId, imagePath, imageUrl, or an images array");
  if (images.length > 0 && single > 0)
    throw new Error("vision_analyze: provide either the images array or a single image source, not both");
  // The `images` entries are exactly-one; the classic top-level fields must be
  // too. resolveImageRef silently prefers attachmentId over imagePath over
  // imageUrl, so accepting two sources would analyze a different image than
  // the caller asked for instead of failing loudly.
  if (single > 1) throw new Error("vision_analyze: provide exactly one of attachmentId, imagePath, or imageUrl");
  if (images.length > 0 && images.some((item) => !validImageItem(item))) {
    throw new Error(
      "vision_analyze: each images entry must be an object with exactly one of attachmentId, imagePath, or imageUrl",
    );
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
  const items =
    images.length > 0
      ? images
      : [{ attachmentId: args.attachmentId, imagePath: args.imagePath, imageUrl: args.imageUrl }];
  // One delivery decision for the whole batch (was: one per image, plus one
  // per automatic retry — see resolveDelivery).
  const delivery = await resolveDelivery(service, exec);
  const settled = await mapWithConcurrency(items, Math.min(maxImages, 4), (item) =>
    analyzeWithRetry(service, item, question, exec, delivery),
  );
  const events = sessionEvents(exec.agent?.session);
  if (images.length === 0) {
    // Classic single-image shape: preserve the old throw-on-failure contract.
    if (settled[0].status === "rejected") throw settled[0].reason;
    return withImageOrdinal(settled[0].value, 0, 1, events);
  }
  const results = settled.map((entry, index) => {
    if (entry.status === "fulfilled") return withImageOrdinal(entry.value, index, settled.length, events);
    // Failed entries carry a machine-readable classification beside the
    // imperative text, so the caller can decide to retry without parsing the
    // message. `code` is the AUX kind from route.js (DSH alignment table in
    // DSH_FAILURE_CODES); `retryable` mirrors the in-tool retry decision.
    const kind = classifyFailure(entry.reason, exec.signal);
    return {
      analysis: failureInstruction(kind),
      provider: "",
      model: "",
      mode: "aux",
      error: {
        code: kind,
        message: entry.reason?.message ?? String(entry.reason),
        retryable: isRetryableFailure(kind),
      },
    };
  });
  const firstOk = results.find((r) => r.provider !== "");
  return {
    analyses: results,
    provider: firstOk?.provider ?? "",
    model: firstOk?.model ?? "",
    // Top-level delivery route of the batch. The output schema requires it
    // (register.js) and every entry in this batch shares the single decision
    // made above; failed entries carry the "aux" fallback label, so the batch
    // decision — not entries[0] — is authoritative.
    mode: delivery?.mode ?? results[0]?.mode ?? "aux",
  };
}

/** One `images` entry is valid when it names exactly one source. */
export function validImageItem(item) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
  const keys = ["attachmentId", "imagePath", "imageUrl"].filter(
    (k) => typeof item[k] === "string" && item[k].length > 0,
  );
  return keys.length === 1;
}

/** Model-facing note for native delivery (the image block carries the image). */
function nativeDeliveryNote(question) {
  return `[原生视觉交付] 图片已作为附件随本次工具结果返回,请直接查看该图片后回答。问题: ${question}`;
}

/** Analyze exactly one image through the auxiliary vision route.
 * @param service the aux service.
 * @param source one image source (attachmentId / imagePath / imageUrl).
 * @param question the caller's intent.
 * @param exec tool execution context.
 * @param delivery optional batch-level delivery decision (see runVision); when
 * omitted it is resolved here, so direct callers keep the old contract. */
export async function analyzeOne(service, source, question, exec, delivery) {
  const startedAt = Date.now();
  const ref = await resolveImageRef(service, source, exec);
  const decision = delivery ?? (await resolveDelivery(service, exec));
  if (decision.mode === "native") {
    if (typeof ref?.attachmentId !== "string" || ref.attachmentId.length === 0) {
      // Never silently fall back: a chosen-but-failed native delivery is
      // visible to the caller, with the escape hatch named explicitly.
      throw new Error(
        "vision_analyze: native delivery requires a durable attachment ref — set aux.visionRoute: 'aux' to route images through the auxiliary vision model instead",
      );
    }
    if (exec.agent?.session?.id !== void 0) {
      recordAttachmentOwnership(service, exec.agent.session.id, ref.attachmentId);
      recordAttachmentRefs(service, ref).catch(() => {});
    }
    // No auxiliary call and no image memory: native delivery carries no
    // analysis conclusion, only the image itself. The delivery is still
    // observable through the existing aux/llm-call event with mode="native"
    // (no new event type, so no patch/whitelist change).
    const provider = decision.mainRoute?.provider ?? "";
    const model = decision.mainRoute?.model ?? "";
    await recordAuxEvent(service, exec.agent?.session, {
      task: "vision",
      provider,
      model,
      ok: true,
      durationMs: Date.now() - startedAt,
      fallbackUsed: false,
      purpose: "native-delivery",
      mode: "native",
    });
    return {
      analysis: nativeDeliveryNote(question),
      provider,
      model,
      attachment: ref,
      mode: "native",
    };
  }
  // Record ownership for disposal cleanup (session -> attachment id) and the
  // full ref for the GC sidecar (host-path seam + media-type .ext removal).
  // Both are session-scoped: without a session there is nothing to reclaim
  // against, and tests must not touch a real DSH_HOME.
  if (exec.agent?.session?.id !== void 0) {
    recordAttachmentOwnership(service, exec.agent.session.id, ref.attachmentId);
    recordAttachmentRefs(service, ref).catch(() => {});
  }
  const messages = [
    createUserMessage({
      content: [
        { type: "image", attachment: ref },
        { type: "text", text: question },
      ],
      source: { kind: "plugin", plugin: "dsh-aux" },
    }),
  ];
  const result = await service.call("vision", {
    messages,
    system: visionSystemPrompt(),
    session: exec.agent?.session,
    agent: exec.agent,
    signal: exec.signal,
    inputChars: question.length,
    mode: "aux",
  });
  // Image memory: persist a compact record so a restarted main session can
  // recall what was looked at without re-analyzing. Best-effort.
  if (exec.agent?.session?.id !== void 0) {
    recordImageMemory(service, exec.agent.session.id, ref.attachmentId, question, result.text);
  }
  // Echo the durable ref so the official render pipeline can emit an image
  // block: the trajectory view then shows what the auxiliary model actually
  // looked at (text-only main models are protected by the official
  // tool-result image projection). Pass-through only — never reshape.
  return { analysis: result.text, provider: result.provider, model: result.model, attachment: ref, mode: "aux" };
}
