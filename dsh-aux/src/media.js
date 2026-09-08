/**
 * Small media-type helpers for image paths and HTTP content types.
 *
 * @module @dolorescaritasangelus/dsh-aux/media
 */

/** Lower-cased extension (including the dot) of a path, or "" when the file
 * name has none. A dotfile like `.png` counts as extension-less, matching
 * node:path.extname. */
export function extensionForPath(path) {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** Media type declared by a local path extension (dotfiles declare none). */
export function mediaTypeForPath(path) {
  const extension = extensionForPath(path);
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return void 0;
}

/** Leading bytes of the four image formats DSH stores. Mirrors the official
 * `read_image` sniffer so both tools accept the same extension-less files. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function matchesBytes(data, offset, expected) {
  if (data.byteLength < offset + expected.length) return false;
  return expected.every((byte, index) => data[offset + index] === byte);
}

function matchesAscii(data, offset, value) {
  if (data.byteLength < offset + value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (data[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Media type declared by a file's leading bytes: PNG, JPEG, GIF87a/89a, or
 * RIFF-WEBP. Used when the path carries no recognized extension; the
 * attachment service still re-decodes the bytes, so this is a routing hint,
 * never the authority on validity.
 * @param data the file's first bytes.
 * @returns the detected supported media type, or undefined.
 */
export function sniffImageMediaType(data) {
  if (!(data instanceof Uint8Array)) return void 0;
  if (matchesBytes(data, 0, PNG_SIGNATURE)) return "image/png";
  if (matchesBytes(data, 0, JPEG_SIGNATURE)) return "image/jpeg";
  if (matchesAscii(data, 0, "GIF87a") || matchesAscii(data, 0, "GIF89a")) return "image/gif";
  if (matchesAscii(data, 0, "RIFF") && matchesAscii(data, 8, "WEBP")) return "image/webp";
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
