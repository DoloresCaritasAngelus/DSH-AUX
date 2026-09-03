/**
 * dsh-aux image locate: find the most recent user message and vision_analyze
 * call that reference one attachment across owner sessions.
 *
 * This is a read-only diagnostic helper for the image gallery jump-to-source
 * feature. It intentionally does not mutate the ownership map or publish any
 * projection.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/locate
 */
import { loadSessionImages } from "./ownership.js";

/** Attachment ids are content-addressed: `sha256:<64 hex>`. */
const HASH_ID_RE = /^sha256:([a-f0-9]{64})$/;
/** Match the hash in an object-store path, with or without an extension. */
const PATH_HASH_RE = /([a-f0-9]{64})(?:\.(?:png|jpe?g|webp|gif))?$/i;

/** Extract the 64-hex hash from an attachment id, or null. */
function hashOfAttachmentId(attachmentId) {
  const match = typeof attachmentId === "string" ? HASH_ID_RE.exec(attachmentId) : null;
  return match === null ? null : match[1];
}

/** Extract the 64-hex hash from an object-store image path, or null. */
function hashOfImagePath(imagePath) {
  if (typeof imagePath !== "string") return null;
  const match = PATH_HASH_RE.exec(imagePath);
  return match === null ? null : match[1].toLowerCase();
}

/** Parse a tool/call `arguments` field, which is normally a JSON string. */
function parseArguments(raw) {
  if (raw === null || raw === void 0) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Does one image source object reference the target attachment? */
function imageSourceMatches(attachmentId, hash, source) {
  if (source === null || typeof source !== "object" || Array.isArray(source)) return false;
  if (source.attachmentId !== void 0 && String(source.attachmentId) === String(attachmentId)) return true;
  if (source.imagePath !== void 0) {
    const pathHash = hashOfImagePath(source.imagePath);
    if (hash !== null && pathHash !== null && pathHash === hash) return true;
  }
  return false;
}

/** Does a parsed vision_analyze argument object reference the image? */
function visionCallMatches(rawArguments, attachmentId, hash) {
  const parsed = parseArguments(rawArguments);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  if (imageSourceMatches(attachmentId, hash, parsed)) return true;
  if (Array.isArray(parsed.images)) {
    return parsed.images.some((item) => imageSourceMatches(attachmentId, hash, item));
  }
  return false;
}

/** Read the user-message content blocks, tolerating the known event shapes. */
function contentOfUserEvent(event) {
  const data = event?.data ?? {};
  for (const candidate of [data.content, data.message?.content, event?.message?.content]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

/**
 * Read a session's events from the supplied live session first, then fall
 * back to `sessionPersistence.inspect`. Returns null when the session is not
 * readable (live session absent and persistence inspect missing/failing).
 */
async function readSessionEvents(service, sessionId, opts = {}) {
  const liveSession = opts?.liveSession;
  if (liveSession !== void 0 && liveSession !== null && liveSession.id === sessionId) {
    if (Array.isArray(liveSession.events)) return liveSession.events;
  }
  let persistence;
  try {
    persistence = service.ctx.get("sessionPersistence");
  } catch {
    persistence = void 0;
  }
  if (persistence === void 0 || persistence === null || typeof persistence.inspect !== "function") {
    return null;
  }
  try {
    const inspection = await persistence.inspect(sessionId);
    if (inspection !== null && inspection !== void 0 && Array.isArray(inspection.events)) {
      return inspection.events;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Scan one session's events and keep the highest seq for each anchor kind.
 */
function scanSessionEvents(events, attachmentId, hash) {
  let messageSeq = null;
  let callId = null;
  let callSeq = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] ?? {};
    const numericSeq = Number(event.seq);
    const seq = Number.isFinite(numericSeq) ? numericSeq : index + 1;
    if (event.type === "user/message") {
      for (const block of contentOfUserEvent(event)) {
        if (block?.type === "image" && String(block.attachment?.attachmentId) === String(attachmentId)) {
          if (messageSeq === null || seq > messageSeq) messageSeq = seq;
          break;
        }
      }
    } else if (event.type === "tool/call" && event.data?.name === "vision_analyze") {
      if (visionCallMatches(event.data.arguments, attachmentId, hash)) {
        if (callSeq === null || seq > callSeq) {
          callId = event.data?.callId === void 0 ? null : String(event.data.callId);
          callSeq = seq;
        }
      }
    }
  }
  return { messageSeq, callId, callSeq };
}

/**
 * Locate where an image attachment appeared and where it was analyzed.
 *
 * Owner sessions come from the persisted session-images map. For every owner
 * session that can be read, the function scans user/message image blocks and
 * vision_analyze tool/call arguments. Only sessions with at least one match
 * are included in `anchors`.
 *
 * @param {object} service AUX service (ctx access for sessionPersistence).
 * @param {string} attachmentId `sha256:<64 hex>` attachment identifier.
 * @param {object} [opts]
 * @param {string} [opts.sessionId] Restrict lookup to one owner session.
 * @param {object} [opts.liveSession] Current live session, whose `.events`
 *   are used before persistence when its id matches.
 * @returns {Promise<{attachmentId: string, found: boolean, anchors: Array<object>}>}
 */
export async function locateImageAnchors(service, attachmentId, opts = {}) {
  const targetAttachmentId = String(attachmentId ?? "");
  const hash = hashOfAttachmentId(targetAttachmentId);
  const empty = { attachmentId: targetAttachmentId, found: false, anchors: [] };
  if (hash === null) return empty;

  let ownership;
  try {
    ownership = await loadSessionImages();
  } catch {
    ownership = new Map();
  }

  let sessionIds = [];
  for (const [sessionId, ids] of ownership) {
    if (ids instanceof Set && ids.has(targetAttachmentId)) sessionIds.push(sessionId);
  }
  const requested = opts?.sessionId;
  if (requested !== void 0 && requested !== null && requested !== "") {
    const wanted = String(requested);
    sessionIds = sessionIds.filter((sessionId) => sessionId === wanted);
  }
  if (sessionIds.length === 0) return empty;

  const anchors = [];
  for (const sessionId of sessionIds) {
    const events = await readSessionEvents(service, sessionId, opts);
    if (!Array.isArray(events)) continue;
    const found = scanSessionEvents(events, targetAttachmentId, hash);
    if (found.messageSeq === null && found.callId === null) continue;
    anchors.push({
      sessionId,
      messageSeq: found.messageSeq,
      callId: found.callId,
      callSeq: found.callSeq
    });
  }

  anchors.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  return {
    attachmentId: targetAttachmentId,
    found: anchors.length > 0,
    anchors
  };
}
