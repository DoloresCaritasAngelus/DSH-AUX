/**
 * Canonical payload key sets for the AUX session events — single source of truth.
 *
 * Why this file exists
 * --------------------
 * AUX writes four hidden \`session.append()\` event types (\`aux/llm-call\`,
 * \`aux/debug\`, \`aux/platform-status\`, \`aux/image-library\`). DSH 0.1.5 introduced
 * a v0→v1 session-format migration whose frozen vocabulary
 * (\`RELEASED_V0_EVENT_DISPOSITIONS\` in \`@deepseek-ai/dsh-session-format-v0-to-v1\`)
 * enumerates every event type *and every payload member* it admits; a payload
 * member that is not listed makes the whole historical session unreadable
 * (\`data has unexpected member ...\`), with no recovery path.
 *
 * \`bridge/format-admissions.mjs\` (P12) generates the migration admission for the
 * four AUX types from this table, and \`tests/event-shapes.test.js\` asserts that
 * every key the writers emit is registered here. Adding a field to a writer
 * without registering it fails the test suite instead of silently breaking the
 * next DSH upgrade.
 *
 * The lists are unions of every shape AUX has written (released 0.4.x plus the
 * current line); every key is optional.
 *
 * @module @dolorescaritasangelus/dsh-aux/event-shapes
 */

/** Allowed payload members per AUX event type. */
export const AUX_EVENT_SHAPES = Object.freeze({
  "aux/llm-call": Object.freeze({
    required: Object.freeze([]),
    optional: Object.freeze([
      "task",
      "purpose",
      "provider",
      "model",
      "durationMs",
      "inputChars",
      "outputChars",
      "ok",
      "errorCode",
      "fallbackUsed",
      "result",
      "error",
      "mode",
      "candidates",
      "selectedIndex",
    ]),
  }),
  "aux/debug": Object.freeze({
    required: Object.freeze([]),
    optional: Object.freeze([
      "payload",
      "task",
      "kind",
      "ok",
      "provider",
      "model",
      "input",
      "output",
      "error",
      "attempts",
      "purpose",
      "reasoningEffort",
      "durationMs",
    ]),
  }),
  "aux/platform-status": Object.freeze({
    required: Object.freeze([]),
    optional: Object.freeze([
      "generatedAt",
      "restartRequired",
      "core",
      "eventsSupported",
      "patchLedger",
      "items",
      "warnings",
      "issues",
      "publishSeq",
      "visionRoute",
      "imageLifecycle",
    ]),
  }),
  "aux/image-library": Object.freeze({
    required: Object.freeze([]),
    optional: Object.freeze(["generatedAt", "settings", "counts", "entries", "publishSeq"]),
  }),
});

/**
 * Payload members that the v0 frozen vocabulary would reject for \`type\`.
 *
 * Returns an empty array for unregistered types (they are refused for another
 * reason) and for non-object payloads. The caller decides whether to warn.
 *
 * @param {string} type - session event type.
 * @param {unknown} data - payload about to be appended.
 * @returns {string[]} unexpected top-level payload members.
 */
export function unknownEventKeys(type, data) {
  const shape = AUX_EVENT_SHAPES[type];
  if (shape === void 0 || data === null || typeof data !== "object") return [];
  const allowed = new Set(shape.optional);
  return Object.keys(data).filter((key) => !allowed.has(key));
}
