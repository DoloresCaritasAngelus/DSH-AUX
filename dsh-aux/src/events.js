/**
 * dsh-aux session-event layer: auxiliary-call errors and the
 * `aux/llm-call` session-event writer (with ignorable-patch detection).
 *
 * @module @dolorescaritasangelus/dsh-aux/events
 */
import { AUX_CALL_EVENT, AUX_DEBUG_EVENT, AUX_PLATFORM_EVENT } from "./config.js";
import { readPackageFile } from "./bridge-locate.js";

/** One auxiliary call outcome. */
export class AuxCallError extends Error {
  constructor(task, attempts) {
    const lines = attempts.map(
      (a) => `  - ${a.provider}/${a.model}: ${a.error?.message ?? String(a.error)} (${a.kind})`
    );
    super(`aux task "${task}" failed after ${attempts.length} attempt(s):\n${lines.join("\n")}`);
    this.name = "AuxCallError";
    this.task = task;
    this.attempts = attempts;
  }
}

/**
 * Translate terminal finish reasons into an auxiliary-call failure.
 * @returns undefined on a clean stop, else an Error carrying the failure facts.
 */
export function finishError(finish) {
  switch (finish.kind) {
    case "stop": return void 0;
    case "max-tokens": return new Error("aux: output reached maxTokens");
    case "tool-calls": return new Error("aux: model unexpectedly requested a tool");
    case "error":
    case "aborted": {
      const error = new Error(finish.failure.message);
      error.code = finish.failure.code;
      error.status = finish.failure.status;
      error.failure = finish.failure;
      return error;
    }
    default: return new Error("aux: unsupported finish reason " + String(finish.kind));
  }
}

/**
 * Candidate URLs for the patched dsh-session bundle, given this module's URL.
 * Exported for tests; the service tries each candidate and accepts the first
 * one that exists and carries the "dsh-aux ignorable (local patch)" marker.
 */
export function sessionPatchCandidates(baseUrl) {
  return [
    // symlink deploy: node_modules/@dolorescaritasangelus/dsh-aux/src
    // -> ../../../@deepseek-ai/dsh-session
    new URL("../../../@deepseek-ai/dsh-session/lib/index.js", baseUrl),
    // realpath'd source tree: <root>/dsh work/aux/dsh-aux/src -> <root>/node_modules
    new URL("../../../node_modules/@deepseek-ai/dsh-session/lib/index.js", baseUrl),
    // DSH home layout fallback
    new URL("../../../../node_modules/@deepseek-ai/dsh-session/lib/index.js", baseUrl)
  ];
}

/**
 * Whether the deployed dsh-session supports marking custom events
 * ignorable (the bridge/patch-session-ignorable.mjs patch). Without it,
 * appending "aux/llm-call" would write events the persistence read path
 * rejects (unknown type, not ignorable) and the WHOLE session log becomes
 * unreadable. Detection is cached; missing/undetectable ⇒ treated as
 * unsupported so we degrade to not writing events at all.
 */
export async function sessionEventsSupported(service) {
  if (service._sessionEventsSupportedCache !== void 0) return service._sessionEventsSupportedCache;
  const src = await readPackageFile("dsh-session");
  service._sessionEventsSupportedCache = src?.includes("dsh-aux ignorable (local patch)") === true;
  return service._sessionEventsSupportedCache;
}

/**
 * Log one auxiliary call as a session event, when a session is present.
 * The event is marked ignorable (requires the dsh-session ignorable patch,
 * see bridge/patch-session-ignorable.mjs): the persistence read path
 * accepts out-of-repo event types when ignorable, while the event itself
 * stays in the log so the aux-status projection replays normally.
 * WITHOUT the patch we intentionally do NOT write the event: an
 * unmarked custom event would make the whole session log unreadable.
 */
export async function recordAuxEvent(service, session, data) {
  if (session === void 0) return;
  if (!await sessionEventsSupported(service)) {
    if (!service._sessionEventsWarned) {
      service._sessionEventsWarned = true;
      service.ctx.logger.warn(
        "dsh-aux: dsh-session ignorable patch not found — aux/llm-call events are NOT written to keep session logs compatible. Run bridge/patch-session-ignorable.mjs (or the repo install.sh) to enable event tracing."
      );
    }
    return;
  }
  try {
    // Drop undefined fields before the event is snapshotted: dsh-session's
    // JSON snapshot (walkJsonValue) rejects ANY undefined property value as
    // "non-lossless JSON", which would make append() throw and silently
    // drop the event. Optional request fields (purpose, errorCode, …) are
    // absent from most calls, so strip them here defensively.
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== void 0) clean[key] = value;
    }
    session.append(AUX_CALL_EVENT, clean, void 0, { ignorable: true });
  } catch {
    /* event logging must never fail the call */
  }
}

/**
 * Log one debug/content-truth event. Used when `aux.debug.fullToolTrace` is
 * enabled or for explicit diagnostic records. The event is `ignorable` and
 * non-surface by convention: it stays in the session log for `/aux debug`
 * but never enters the model context.
 */
export async function recordDebugEvent(service, session, data) {
  if (session === void 0) return;
  if (!await sessionEventsSupported(service)) return;
  try {
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== void 0) clean[key] = value;
    }
    session.append(AUX_DEBUG_EVENT, clean, void 0, { ignorable: true });
  } catch {
    /* debug logging must never fail the call */
  }
}

/**
 * Log one full platform-status snapshot as an ignorable, non-surface session
 * event. The settings page reads this through the `aux-platform` projection,
 * so it never needs to execute a slash command (which would pollute the
 * conversation with command cards).
 */
export async function recordPlatformEvent(service, session, data) {
  if (session === void 0) return;
  if (!await sessionEventsSupported(service)) return;
  try {
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== void 0) clean[key] = value;
    }
    session.append(AUX_PLATFORM_EVENT, clean, void 0, { ignorable: true });
  } catch {
    /* platform status logging must never fail */
  }
}
