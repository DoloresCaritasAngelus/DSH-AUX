/**
 * dsh-aux manual attachment GC (`/aux gc-images`).
 *
 * @module @dolorescaritasangelus/dsh-aux/images/gc
 */
import { lstat as lstatFile, readdir, stat as statFile, unlink as unlinkFile } from "node:fs/promises";
import { sweepTrash } from "./ownership.js";

/**
 * Garbage-collect pasted-image attachments older than `days` days.
 *
 * Pasted images persist under DSH_HOME/attachments/v1/objects (content-
 * addressed, extension-less objects plus the bridge's .ext hardlinks) and
 * DSH ships no retention for them — they accumulate forever. This command
 * deletes files whose mtime is older than the cutoff, and their companion
 * hardlinks. It is deliberately MANUAL (not a timer): deleting attachments
 * can break replay of historical sessions that reference them, so the user
 * decides when to reclaim space. Content addressing means the same image
 * pasted many times is one object, so growth is slower than it looks.
 *
 * @param {object} service The AUX service (for the trash sweep).
 * @param days cutoff age in days (default 30).
 * @returns a command result describing what was removed.
 */
export async function gcImages(service, days) {
  const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
  if (home === void 0) return { kind: "error", text: "aux: cannot locate DSH_HOME for attachment cleanup" };
  const objectsRoot = home + "/attachments/v1/objects";
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  let removedBytes = 0;
  let scanned = 0;
  let failed = 0;
  try {
    // Only REAL directories and REGULAR files are scanned: a symlinked
    // directory inside the object store could otherwise make readdir follow
    // it into an unrelated tree (e.g. a Windows drive mount under WSL) and
    // unlink files there. Dirent checks reject symlinks outright.
    const buckets = await readdir(objectsRoot, { withFileTypes: true }).catch(() => []);
    for (const bucketEnt of buckets) {
      if (!bucketEnt.isDirectory()) continue;
      const bucketPath = objectsRoot + "/" + bucketEnt.name;
      // Re-verify with lstat: the dirent can race with a symlink swap, so
      // refuse to descend into anything that is not a real directory.
      try {
        const bucketSt = await lstatFile(bucketPath);
        if (!bucketSt.isDirectory() || bucketSt.isSymbolicLink()) continue;
      } catch {
        continue;
      }
      const entries = await readdir(bucketPath, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = bucketPath + "/" + entry.name;
        scanned += 1;
        try {
          const st = await statFile(filePath);
          if (!st.isFile() || st.mtimeMs >= cutoff) continue;
          // Re-verify with lstat before unlink: the file could have been
          // swapped for a symlink since stat, and we must never follow it.
          const fileSt = await lstatFile(filePath);
          if (!fileSt.isFile() || fileSt.isSymbolicLink()) continue;
          await unlinkFile(filePath);
          removed += 1;
          removedBytes += st.size;
        } catch {
          failed += 1;
        }
      }
    }
  } catch (error) {
    return { kind: "error", text: `aux: attachment GC failed: ${error?.message ?? String(error)}` };
  }
  // Reclaimed objects parked in .trash/ become unrecoverable once the
  // recovery window closes; sweeping here keeps the store bounded even when
  // the periodic reconcile is not running (headless one-shot commands).
  const trash = await sweepTrash(service).catch(() => ({ removed: 0, bytes: 0 }));
  return {
    kind: "success",
    text:
      `附件清理完成: 扫描 ${scanned} 个文件, 删除 ${removed} 个超过 ${days} 天的附件 (${(removedBytes / 1024 / 1024).toFixed(1)} MB)` +
      `${failed > 0 ? `, ${failed} 个失败` : ""};` +
      `回收站清出 ${trash.removed} 个已过恢复窗口的对象 (${(trash.bytes / 1024 / 1024).toFixed(1)} MB)。`,
  };
}
