/**
 * Unicode text helpers shared by web_extract and web_crawl.
 *
 * @module @dolorescaritasangelus/dsh-aux/crawl/text
 */

/** Marker appended when text is truncated to a character budget. */
export const TRUNCATED_MARKER = "\n[…truncated]";

/** Count Unicode code points in a string (UTF-16 surrogate pairs count once). */
export function codePointCount(text) {
  const str = typeof text === "string" ? text : "";
  let count = 0;
  for (let i = 0; i < str.length; ) {
    const code = str.codePointAt(i);
    i += code > 0xffff ? 2 : 1;
    count += 1;
  }
  return count;
}

/**
 * Truncate text to at most `maxChars` CODE POINTS (never splitting a
 * surrogate pair), appending a truncation marker when anything was cut.
 * @returns `{ text, chars, kept, truncated }` — `chars` is the ORIGINAL
 * code-point count, `kept` the retained content code points (marker
 * excluded), `truncated` whether a cut happened.
 */
export function truncateByChars(text, maxChars) {
  const str = typeof text === "string" ? text : String(text ?? "");
  const limit = Number.isInteger(maxChars) && maxChars >= 0 ? maxChars : 0;
  const total = codePointCount(str);
  if (total <= limit) return { text: str, chars: total, kept: total, truncated: false };
  let end = 0;
  let count = 0;
  for (let i = 0; i < str.length && count < limit; ) {
    const code = str.codePointAt(i);
    i += code > 0xffff ? 2 : 1;
    count += 1;
    end = i;
  }
  return { text: str.slice(0, end) + TRUNCATED_MARKER, chars: total, kept: count, truncated: true };
}
