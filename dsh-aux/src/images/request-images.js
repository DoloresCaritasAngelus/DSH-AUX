/**
 * Derived request-image cache reclamation (`<DSH_HOME>/attachments/v1/request-images/`).
 *
 * DSH never expires these route-derived variants (they are deterministic
 * caches: the service regenerates one by reading the durable object first), so
 * a long-lived install grows without bound. Age alone is the wrong policy —
 * DSH never utimes an entry, so a hot variant can look old — so the sweep
 * enforces a total-byte cap and evicts by mtime LRU instead.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/request-images
 */
import { lstat, readdir, stat, unlink } from "node:fs/promises";
import { attachmentsRootPath } from "./object-path.js";

/** Default total-size cap for the derived request-image cache (256 MiB). */
export const DEFAULT_REQUEST_IMAGES_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Enforce the request-image cache cap by evicting the least-recently-modified
 * entries first. Symlinks are never followed or removed.
 *
 * @param {object} service The AUX service (unused today; kept for symmetry).
 * @param {{ maxBytes?: number }} [options] Cap override; <= 0 disables the sweep.
 * @returns {Promise<{ removed: number, bytes: number, scanned: number, totalBytes: number }>}
 */
export async function sweepRequestImages(service, { maxBytes = DEFAULT_REQUEST_IMAGES_MAX_BYTES } = {}) {
  const empty = { removed: 0, bytes: 0, scanned: 0, totalBytes: 0 };
  const root = attachmentsRootPath();
  if (root === void 0 || !(maxBytes > 0)) return empty;
  const base = root + "/request-images";

  const files = [];
  let buckets;
  try {
    buckets = await readdir(base, { withFileTypes: true });
  } catch {
    return empty;
  }
  for (const bucket of buckets) {
    if (!bucket.isDirectory() || bucket.isSymbolicLink()) continue;
    const bucketPath = base + "/" + bucket.name;
    try {
      const info = await lstat(bucketPath);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    let entries;
    try {
      entries = await readdir(bucketPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const path = bucketPath + "/" + entry.name;
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        files.push({ path, size: info.size, mtimeMs: info.mtimeMs });
      } catch {
        /* unreadable entry: skip */
      }
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes <= maxBytes) return { removed: 0, bytes: 0, scanned: files.length, totalBytes };

  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let removed = 0;
  let bytes = 0;
  let running = totalBytes;
  for (const file of files) {
    if (running <= maxBytes) break;
    try {
      const info = await lstat(file.path);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      await unlink(file.path);
      removed += 1;
      bytes += file.size;
      running -= file.size;
    } catch {
      /* already gone / unreadable */
    }
  }
  return { removed, bytes, scanned: files.length, totalBytes };
}
