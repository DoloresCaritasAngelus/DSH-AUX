/**
 * Single source of truth for attachment object naming and host paths.
 *
 * The `sha256:<hex>` id shape, the object file-name shape and the
 * media-type <-> extension mapping used to be duplicated in four modules
 * (ownership, image-library, image-actions, locate). They live here so the
 * official `attachments.imageHostPath(ref)` seam can replace the legacy
 * derivation in exactly one place.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/object-path
 */

/** Legacy attachment id: `sha256:` + 64 lowercase hex. */
export const HASH_ID_RE = /^sha256:([a-f0-9]{64})$/;
/** Legacy object file name: 64 hex, optionally with a media-type extension. */
export const OBJECT_FILE_RE = /^([a-f0-9]{64})(?:\.(png|jpg|jpeg|webp|gif))?$/;
/** Companion hard-link extension -> media type. */
export const EXTENSION_MEDIA_TYPES = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
});
/** Media type -> companion hard-link extension. */
export const MEDIA_TYPE_EXTENSIONS = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
});
/** Every companion extension (fallback sweep when the media type is unknown). */
export const IMAGE_EXTENSIONS = Object.freeze([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
/**
 * Reclaimed-object park directory inside the objects root. It is NOT a normal
 * hash bucket: its lifecycle belongs exclusively to sweepTrash, so bucket
 * scans (gc-images / orphan reclaim / library listing) must skip it.
 */
export const TRASH_DIR_NAME = ".trash";

/** Resolve the DSH home that hosts `attachments/v1`. */
export function dshHome() {
  return process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
}

/** `<DSH_HOME>/attachments/v1`, or undefined without DSH_HOME. */
export function attachmentsRootPath() {
  const home = dshHome();
  return home === void 0 ? void 0 : home + "/attachments/v1";
}

/** `<DSH_HOME>/attachments/v1/objects`, or undefined without DSH_HOME. */
export function objectsRootPath() {
  const root = attachmentsRootPath();
  return root === void 0 ? void 0 : root + "/objects";
}

/** Hash part of a legacy attachment id, or undefined when the id is not one. */
export function hashOfAttachmentId(attachmentId) {
  const match = typeof attachmentId === "string" ? HASH_ID_RE.exec(attachmentId) : null;
  return match === null ? void 0 : match[1];
}

/**
 * Legacy object-path derivation: `<objectsRoot>/<ab>/<hash>`.
 *
 * This is the v1 fallback for entries with no full `ImageAttachmentRef` in
 * the sidecar; the official seam is `attachments.imageHostPath(ref)`.
 *
 * @returns {string|undefined} absolute object path.
 */
export function objectPathForId(attachmentId, objectsRoot = objectsRootPath()) {
  const hash = hashOfAttachmentId(attachmentId);
  if (hash === void 0 || objectsRoot === void 0) return void 0;
  return objectsRoot + "/" + hash.slice(0, 2) + "/" + hash;
}

/** Parse one object file name into `{ hash, mediaType }` (legacy scan). */
export function objectFileInfo(fileName) {
  const match = typeof fileName === "string" ? OBJECT_FILE_RE.exec(fileName) : null;
  if (match === null) return void 0;
  return { hash: match[1], mediaType: match[2] === void 0 ? void 0 : EXTENSION_MEDIA_TYPES[match[2]] };
}

/** Companion extension for a media type, or undefined. */
export function extensionForMediaType(mediaType) {
  return typeof mediaType === "string" ? MEDIA_TYPE_EXTENSIONS[mediaType] : void 0;
}
