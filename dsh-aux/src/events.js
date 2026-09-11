/**
 * dsh-aux session-event layer: auxiliary-call errors and the
 * `aux/llm-call` session-event writer (with ignorable-patch detection).
 *
 * @module @dolorescaritasangelus/dsh-aux/events
 */
import { AUX_CALL_EVENT, AUX_DEBUG_EVENT, AUX_PLATFORM_EVENT, AUX_IMAGE_LIBRARY_EVENT } from "./config.js";
import { readPackageFile } from "./bridge-locate.js";
import { unknownEventKeys } from "./event-shapes.js";

/** One auxiliary call outcome. */
export class AuxCallError extends Error {
  constructor(task, attempts) {
    const lines = attempts.map(
      (a) => `  - ${a.provider}/${a.model}: ${a.error?.message ?? String(a.error)} (${a.kind})`,
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
    case "stop":
      return void 0;
    case "max-tokens":
      return new Error("aux: output reached maxTokens");
    case "tool-calls":
      return new Error("aux: model unexpectedly requested a tool");
    case "error":
    case "aborted": {
      const error = new Error(finish.failure.message);
      error.code = finish.failure.code;
      error.status = finish.failure.status;
      error.failure = finish.failure;
      return error;
    }
    default:
      return new Error("aux: unsupported finish reason " + String(finish.kind));
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
    new URL("../../../../node_modules/@deepseek-ai/dsh-session/lib/index.js", baseUrl),
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

/** Warn once per (type, key) when a payload carries members the v0 frozen vocabulary would reject. */
const SHAPE_WARNED_KEYS = new Set();

function warnUnknownEventKeys(service, type, data) {
  const unknown = unknownEventKeys(type, data);
  if (unknown.length === 0) return;
  const cacheKey = `${type}:${unknown.join(",")}`;
  if (SHAPE_WARNED_KEYS.has(cacheKey)) return;
  SHAPE_WARNED_KEYS.add(cacheKey);
  service?.ctx?.logger?.warn?.(
    `dsh-aux: ${type} payload has unregistered member(s) ${unknown.join(", ")} — ` +
      "0.1.5 migration would refuse historical sessions carrying them; register them in " +
      "dsh-aux/src/event-shapes.js and bridge/format-admissions.mjs",
  );
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
  if (!(await sessionEventsSupported(service))) {
    if (!service._sessionEventsWarned) {
      service._sessionEventsWarned = true;
      service.ctx.logger.warn(
        "dsh-aux: dsh-session ignorable patch not found — aux/llm-call events are NOT written to keep session logs compatible. Run bridge/patch-session-ignorable.mjs (or the repo install.sh) to enable event tracing.",
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
    warnUnknownEventKeys(service, AUX_CALL_EVENT, clean);
    session.append(AUX_CALL_EVENT, clean, void 0, { ignorable: true });
  } catch {
    /* event logging must never fail the call */
  }
}

/** Key names treated as sensitive when recording debug payloads. */
const SECRET_KEY_RE =
  /\b(?:pass(?:word|phrase)?|secret|token|api[_-]?key|auth(?:orization)?|cookie|session[_-]?id|private[_-]?key|access[_-]?key|credential|pwd|bearer)\b/i;

/** Common inline secret shapes found inside strings (JSON, headers, logs). */
const SECRET_VALUE_PATTERNS = [
  /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /("?(?:pass(?:word|phrase)?|secret|token|api[_-]?key|authorization|cookie|credential)"?\s*[=:]\s*")[^"]*/gi,
  /(password|passwd|secret|token|api[_-]?key|authorization)(\s*[=:]\s*)[^\s,;]+/gi,
];

const REDACTED = "[REDACTED]";

function redactDebugValue(value, key) {
  if (typeof value === "string") {
    if (SECRET_KEY_RE.test(key)) return REDACTED;
    let out = value;
    for (const pattern of SECRET_VALUE_PATTERNS) {
      out = out.replace(pattern, (_match, prefix, separator) => {
        if (prefix === void 0) return REDACTED;
        // For single-capture patterns the third callback argument is the match
        // offset (a number); for two-capture patterns it is the second capture.
        return typeof separator === "string" ? `${prefix}${separator}${REDACTED}` : `${prefix}${REDACTED}`;
      });
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDebugValue(entry, key));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      out[entryKey] = redactDebugValue(entryValue, entryKey);
    }
    return out;
  }
  return value;
}

/**
 * Basic recursive redaction for debug payloads. Replaces values under
 * secret-looking keys and common inline secret patterns (Bearer tokens,
 * `sk-...` keys, PEM private keys, `key=value` credentials).
 *
 * This is intentionally basic, not a full PII/secret scanner. It protects the
 * most common accidental leaks in fullToolTrace records without trying to be
 * a complete redaction engine.
 */
export function redactDebugData(data, enabled = true) {
  if (!enabled) return data;
  return redactDebugValue(data, "");
}

/**
 * Log one debug/content-truth event. Used when `aux.debug.fullToolTrace` is
 * enabled or for explicit diagnostic records. The event is `ignorable` and
 * non-surface by convention: it stays in the session log for `/aux debug`
 * but never enters the model context.
 */
export async function recordDebugEvent(service, session, data) {
  if (session === void 0) return;
  if (!(await sessionEventsSupported(service))) return;
  try {
    const redacted = service?.debugConfig?.redactSecrets !== false ? redactDebugData(data) : data;
    const clean = {};
    for (const [key, value] of Object.entries(redacted)) {
      if (value !== void 0) clean[key] = value;
    }
    const safe = withoutUndefined(clean);
    warnUnknownEventKeys(service, AUX_DEBUG_EVENT, safe);
    session.append(AUX_DEBUG_EVENT, safe, void 0, { ignorable: true });
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
/**
 * Deep-copy `value` with every `undefined` dropped from objects and arrays.
 * Session-event payloads must be JSON-serializable: DSH rejects an append whose
 * data carries `undefined` (`session event "…" carries non-JSON-serializable
 * data`), and the previous top-level-only filter missed nested ones — a status
 * snapshot with `imageLifecycle.blockedReason: undefined` (the healthy case,
 * where nothing blocks deletion) silently failed to publish, so the settings
 * page could never read platform status.
 * @param value - any JSON-ish value.
 * @returns an equivalent value with no `undefined` anywhere.
 */
export function withoutUndefined(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== void 0).map((entry) => withoutUndefined(entry));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === void 0) continue;
      out[key] = withoutUndefined(entry);
    }
    return out;
  }
  return value;
}

export async function recordPlatformEvent(service, session, data) {
  if (session === void 0) return;
  // Both early exits below are silent by design (status publishing must never
  // break the session), which is why "the settings page cannot read platform
  // status" used to have no diagnosable cause. DSH_AUX_DEBUG_PUBLISH=1 prints it.
  if (!(await sessionEventsSupported(service))) {
    if (process.env.DSH_AUX_DEBUG_PUBLISH === "1") {
      process.stderr.write(
        "[dsh-aux] platform event skipped — session events unsupported (ignorable patch missing?)\n",
      );
    }
    return;
  }
  try {
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== void 0) clean[key] = value;
    }
    const safe = withoutUndefined(clean);
    warnUnknownEventKeys(service, AUX_PLATFORM_EVENT, safe);
    session.append(AUX_PLATFORM_EVENT, safe, void 0, { ignorable: true });
  } catch (error) {
    if (process.env.DSH_AUX_DEBUG_PUBLISH === "1") {
      process.stderr.write(`[dsh-aux] platform event append failed — ${error?.message ?? String(error)}\n`);
    }
  }
}

/**
 * Log one image-library snapshot as an ignorable, non-surface session event.
 * The Web UI reads it through the `aux-image-library` projection so it never
 * needs to execute a slash command just to refresh the image panel.
 */
export async function recordImageLibraryEvent(service, session, data) {
  if (session === void 0) return;
  if (!(await sessionEventsSupported(service))) return;
  try {
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== void 0) clean[key] = value;
    }
    const safe = withoutUndefined(clean);
    warnUnknownEventKeys(service, AUX_IMAGE_LIBRARY_EVENT, safe);
    session.append(AUX_IMAGE_LIBRARY_EVENT, safe, void 0, { ignorable: true });
  } catch {
    /* image-library logging must never fail */
  }
}
