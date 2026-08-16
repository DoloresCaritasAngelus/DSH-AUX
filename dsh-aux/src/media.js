/**
 * Small media-type helpers for image paths and HTTP content types.
 *
 * @module @dolorescaritasangelus/dsh-aux/media
 */

/** Media type from a local path extension. */
export function mediaTypeForPath(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return void 0;
}

/** Media type from a Content-Type header (prefix match). */
export function mediaTypeFromContentType(contentType) {
  if (typeof contentType !== "string") return void 0;
  const value = contentType.split(";")[0].trim().toLowerCase();
  if (value === "image/png") return "image/png";
  if (value === "image/jpeg" || value === "image/jpg") return "image/jpeg";
  if (value === "image/webp") return "image/webp";
  if (value === "image/gif") return "image/gif";
  return void 0;
}

/** Basename without path semantics (display only). */
export function basename(path) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
