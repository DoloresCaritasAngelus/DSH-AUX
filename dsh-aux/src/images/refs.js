/**
 * dsh-aux image-reference extraction: pull durable image attachment refs out
 * of session-event content, including images nested inside tool results.
 *
 * The extractor is a pure function of the content array — no service, no
 * session, no I/O — so the lifecycle hook, the persistence shim and the
 * resolver all agree on one definition of "this session referenced this
 * image".
 *
 * @module @dolorescaritasangelus/dsh-aux/images/refs
 */

/** Durable image ref of one image block, or undefined when it carries none. */
function imageRefOf(block) {
  const attachment = block?.attachment;
  const id = attachment?.attachmentId;
  return typeof id === "string" && id.length > 0 ? attachment : void 0;
}

/**
 * Recursively collect image attachment refs from a content-block array.
 *
 * Recurses through `tool-result` blocks: their own `content` array carries
 * what a tool produced (e.g. `read_image` and the `vision_analyze` echo), and
 * that is exactly where the image library used to lose track of images.
 *
 * @param {unknown} content A content-block array, or one nested block.
 * @param {Array<object>} [out] Accumulator (encounter order preserved).
 * @returns {Array<object>} Durable attachment refs.
 */
export function collectImageRefs(content, out = []) {
  if (!Array.isArray(content)) return out;
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    if (block.type === "image") {
      const attachment = imageRefOf(block);
      if (attachment !== void 0) out.push(attachment);
      continue;
    }
    if (block.type === "tool-result") collectImageRefs(block.content, out);
  }
  return out;
}

/**
 * The message one event carries, normalized per event type.
 *
 * A `user/message` stores the UserMessage itself as `event.data`
 * (`packages/core/session/src/types.ts:297`; the official reader normalizes it
 * exactly this way in `packages/core/session/src/index.ts:335`), while
 * `tool/result` nests it under `data.message` (`types.ts:353-356`). The
 * derived live shape (`event.message`) stays as a fallback for other API
 * generations.
 *
 * `agent/inbox/spliced` also carries `inserted: UserMessage[]`, but those
 * messages are spliced into the log as `user/message` events afterwards;
 * counting them here would double-count every image, so that type is
 * deliberately not handled.
 *
 * @param {object} event A session event.
 * @returns {object|undefined} The carried message, when the shape provides one.
 */
function messageOf(event) {
  const data = event.data !== null && typeof event.data === "object" ? event.data : void 0;
  if (event.type === "user/message") return event.message ?? data;
  return data?.message ?? event.message;
}

/**
 * Extract image refs from one session event. Only message-producing event
 * types are considered — `user/message` (pasted images, whose `data` is the
 * message) and `tool/result` (tool-produced images, nested under
 * `data.message`).
 *
 * @param {object|null|undefined} event A session event.
 * @returns {Array<object>} Durable attachment refs.
 */
export function eventImageRefs(event) {
  if (event === null || event === void 0 || typeof event !== "object") return [];
  if (event.type !== "user/message" && event.type !== "tool/result") return [];
  return collectImageRefs(messageOf(event)?.content);
}

/**
 * Extract every image ref referenced by a session's event log.
 *
 * @param {ReadonlyArray<object>|undefined} events Session events.
 * @returns {Array<object>} Durable attachment refs, in log order.
 */
export function sessionImageRefs(events) {
  const out = [];
  if (!Array.isArray(events)) return out;
  for (const event of events) {
    for (const ref of eventImageRefs(event)) out.push(ref);
  }
  return out;
}

/**
 * Locate one attachmentId inside a `user/message` and report its 1-based
 * position and that message's image count — the same numbering the bridge
 * writes into the request (`[本条消息第N张/共M张, attachmentId=…]`).
 *
 * The newest matching message wins: a re-uploaded image references the
 * message the model is answering now, not an older turn that carried the same
 * content-addressed id.
 *
 * @param {ReadonlyArray<object>|undefined} events Session events.
 * @param {string|undefined} attachmentId Durable id to locate.
 * @returns {{ index: number, total: number }|undefined}
 */
export function messageOrdinalFor(events, attachmentId) {
  if (!Array.isArray(events) || typeof attachmentId !== "string" || attachmentId.length === 0) return void 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type !== "user/message") continue;
    const refs = eventImageRefs(event);
    const index = refs.findIndex((ref) => String(ref.attachmentId) === attachmentId);
    if (index >= 0) return { index: index + 1, total: refs.length };
  }
  return void 0;
}
