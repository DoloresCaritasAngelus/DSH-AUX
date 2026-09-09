/**
 * dsh-aux manual attachment GC (`/aux gc-images`).
 *
 * @module @dolorescaritasangelus/dsh-aux/images/gc
 */
import { lstat as lstatFile, readdir, stat as statFile, unlink as unlinkFile } from "node:fs/promises";
import { assertDeletionReady, loadReferencedAttachmentIds, sweepTrash } from "./ownership.js";
import { TRASH_DIR_NAME, dshHome, objectFileInfo } from "./object-path.js";
import { loadRetained } from "./retention.js";
import { DEFAULT_REQUEST_IMAGES_MAX_BYTES, sweepRequestImages } from "./request-images.js";

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
 * Deletion is additionally constrained:
 *  - the shared fail-closed deletion gate must be open (unknown ownership =
 *    no deletion);
 *  - `.trash` is never scanned (its entries age by their own ingress clock);
 *  - explicitly retained ("固化") attachments are skipped;
 *  - objects still referenced by any session's ownership entry are skipped.
 *
 * @param {object} service The AUX service (deletion gate, ownership map, trash sweep).
 * @param days cutoff age in days (default 30).
 * @returns a command result describing what was removed.
 */
export async function gcImages(service, days = 30) {
  const home = dshHome();
  if (home === void 0) return { kind: "error", text: "aux: cannot locate DSH_HOME for attachment cleanup" };
  // Fail-closed gate: while any live session's ownership is unknown the
  // ownership map below is incomplete, so this sweep could permanently unlink
  // objects such sessions still reference. Same single gate as deleteImage /
  // deleteOrphans; a non-object service is refused too.
  try {
    assertDeletionReady(service);
  } catch (error) {
    return { kind: "error", text: `DELETION_FROZEN: ${error.message}` };
  }
  // Retained list and ownership map must both be readable: an unreadable one
  // means "unknown which objects must survive", and unknown must never be
  // deleted (fail-closed — never degrade to an empty set).
  let retainedSet;
  try {
    retainedSet = await loadRetained();
  } catch (error) {
    return { kind: "error", text: `aux: 固化(retained)清单不可读,拒绝清扫: ${error?.message ?? String(error)}` };
  }
  let referenced;
  try {
    referenced = await loadReferencedAttachmentIds(service);
  } catch (error) {
    return { kind: "error", text: `aux: 会话归属表不可读,拒绝清扫: ${error?.message ?? String(error)}` };
  }
  const objectsRoot = home + "/attachments/v1/objects";
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  let removedBytes = 0;
  let scanned = 0;
  let failed = 0;
  let retainedSkipped = 0;
  let retainedBytes = 0;
  let referencedSkipped = 0;
  let referencedBytes = 0;
  try {
    // Only REAL directories and REGULAR files are scanned: a symlinked
    // directory inside the object store could otherwise make readdir follow
    // it into an unrelated tree (e.g. a Windows drive mount under WSL) and
    // unlink files there. Dirent checks reject symlinks outright.
    const buckets = await readdir(objectsRoot, { withFileTypes: true }).catch(() => []);
    for (const bucketEnt of buckets) {
      // .trash is not a hash bucket: its entries are aged by the ingress clock
      // in their name and swept only by sweepTrash. Scanning it here would
      // silently shorten the 7-day recovery window to `days`.
      if (bucketEnt.name === TRASH_DIR_NAME) continue;
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
          // Retained / live-reference exemptions apply to parseable object
          // names; base objects and their .ext hardlinks share one hash. Names
          // outside the object namespace keep the legacy mtime sweep.
          const info = objectFileInfo(entry.name);
          if (info !== void 0) {
            const attachmentId = "sha256:" + info.hash;
            if (retainedSet.has(attachmentId)) {
              retainedSkipped += 1;
              retainedBytes += st.size;
              continue;
            }
            if (referenced.has(attachmentId)) {
              referencedSkipped += 1;
              referencedBytes += st.size;
              continue;
            }
          }
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
  const derived = await sweepRequestImages(service, {
    maxBytes: Number.isFinite(service?.requestImagesMaxBytes)
      ? service.requestImagesMaxBytes
      : DEFAULT_REQUEST_IMAGES_MAX_BYTES,
  }).catch(() => ({ removed: 0, bytes: 0, scanned: 0, totalBytes: 0 }));
  return {
    kind: "success",
    text:
      `附件清理完成: 扫描 ${scanned} 个文件, 删除 ${removed} 个超过 ${days} 天的附件 (${(removedBytes / 1024 / 1024).toFixed(1)} MB)` +
      `${failed > 0 ? `, ${failed} 个失败` : ""}` +
      `${retainedSkipped > 0 ? `, 跳过 ${retainedSkipped} 个固化附件 (${(retainedBytes / 1024 / 1024).toFixed(1)} MB)` : ""}` +
      `${referencedSkipped > 0 ? `, 跳过 ${referencedSkipped} 个仍被会话引用的附件 (${(referencedBytes / 1024 / 1024).toFixed(1)} MB)` : ""};` +
      `回收站清出 ${trash.removed} 个已过恢复窗口的对象 (${(trash.bytes / 1024 / 1024).toFixed(1)} MB);` +
      `请求派生缓存 ${derived.scanned} 个 / ${(derived.totalBytes / 1024 / 1024).toFixed(1)} MB,LRU 回收 ${derived.removed} 个 (${(derived.bytes / 1024 / 1024).toFixed(1)} MB)。`,
  };
}
