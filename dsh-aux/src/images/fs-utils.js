/**
 * Shared filesystem helpers for the dsh-aux image library.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/fs-utils
 */
import { lstat as lstatFile, readdir } from "node:fs/promises";

/**
 * Safely scan an objects root.
 *
 * Lists regular files inside real (non-symlinked) bucket directories,
 * including both extensionless object files and extension hardlinks. Symlinks
 * are never followed: each directory and file is verified with lstat.
 *
 * @param {string|undefined} root absolute `.../attachments/v1/objects` path.
 * @returns {Promise<Array<{ path: string, fileName: string, bytes: number, mtimeMs: number }>>}
 */
export async function scanObjectFiles(root) {
  const results = [];
  if (root === void 0 || root === null || root === "") return results;

  let buckets;
  try {
    buckets = await readdir(root, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const bucketEnt of buckets) {
    // Dirent check plus lstat: never descend through a symlinked directory.
    if (!bucketEnt.isDirectory() || bucketEnt.isSymbolicLink()) continue;
    const bucketPath = root + "/" + bucketEnt.name;
    try {
      const bucketSt = await lstatFile(bucketPath);
      if (!bucketSt.isDirectory() || bucketSt.isSymbolicLink()) continue;
    } catch {
      continue;
    }

    let files;
    try {
      files = await readdir(bucketPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fileEnt of files) {
      if (!fileEnt.isFile() || fileEnt.isSymbolicLink()) continue;
      const filePath = bucketPath + "/" + fileEnt.name;
      try {
        const fileSt = await lstatFile(filePath);
        if (!fileSt.isFile() || fileSt.isSymbolicLink()) continue;
        results.push({
          path: filePath,
          fileName: fileEnt.name,
          bytes: fileSt.size,
          mtimeMs: fileSt.mtimeMs
        });
      } catch {
        // Best-effort scan: unreadable entries are skipped.
      }
    }
  }

  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return results;
}
