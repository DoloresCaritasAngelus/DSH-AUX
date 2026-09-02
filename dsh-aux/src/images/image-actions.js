/**
 * dsh-aux image lifecycle actions: single delete, orphan collection and
 * ownership cleanup for attachment objects.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/image-actions
 */
import {
  lstat as lstatFile,
  readFile as readFileText,
  readdir,
  rename as renameFile,
  unlink as unlinkFile,
  writeFile as writeFileText
} from "node:fs/promises";
import { dirname } from "node:path";
import { ensureSessionImagesLoaded, loadSessionImages, saveSessionImages } from "./ownership.js";

/** attachment id format used by the image store. */
const HASH_ID_RE = /^sha256:([a-f0-9]{64})$/;
/** File names in an object bucket: `<64 hex>` or `<64 hex>.<image ext>`. */
const OBJECT_FILE_RE = /^([a-f0-9]{64})(?:\.(png|jpg|jpeg|webp|gif))?$/;

/** Locate the DSH home using the same rule as the other image modules. */
function homePath() {
  return process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
}

/** Path to the AUX-owned retention marks file. */
function imageRetentionPath() {
  const home = homePath();
  return home === void 0 ? void 0 : home + "/attachments/v1/image-retention.json";
}

/** Derive the extensionless object file path for a valid attachment id. */
function deriveObjectPath(attachmentId) {
  const home = homePath();
  if (home === void 0) return void 0;
  const match = typeof attachmentId === "string" ? HASH_ID_RE.exec(attachmentId) : null;
  if (match === null) return void 0;
  const hash = match[1];
  return home + "/attachments/v1/objects/" + hash.slice(0, 2) + "/" + hash;
}

/** Build a NOT_FOUND error carrying the machine-readable `.code`. */
function notFoundError(attachmentId) {
  const error = new Error(`image attachment not found: ${attachmentId}`);
  error.code = "NOT_FOUND";
  return error;
}

/** Build a REFERENCED error carrying the machine-readable `.code`. */
function referencedError(attachmentId, refs) {
  const error = new Error(
    `image attachment is referenced by session(s): ${refs.join(", ")}`
  );
  error.code = "REFERENCED";
  return error;
}

/** Read the retained set directly from `image-retention.json`. */
async function readRetainedSet(path) {
  if (path === void 0) return new Set();
  try {
    const raw = await readFileText(path, "utf8");
    const parsed = JSON.parse(raw);
    const retained = parsed !== null && typeof parsed === "object" ? parsed.retained : void 0;
    if (!Array.isArray(retained)) return new Set();
    return new Set(retained.filter((id) => typeof id === "string"));
  } catch {
    // Missing or unreadable retention files simply mean nothing is retained.
    return new Set();
  }
}

/** Local helper: read whether one attachment is currently retained. */
async function isRetainedLocal(attachmentId) {
  const retained = await readRetainedSet(imageRetentionPath());
  return retained.has(attachmentId);
}

/** Local helper: atomically add/remove one retention entry, preserving others. */
async function setRetainedLocal(attachmentId, retained) {
  const path = imageRetentionPath();
  if (path === void 0) return;
  const set = await readRetainedSet(path);
  if (retained) {
    set.add(attachmentId);
  } else {
    set.delete(attachmentId);
  }
  const tmp = path + ".tmp";
  const payload = JSON.stringify({ version: 1, retained: [...set].sort() });
  await writeFileText(tmp, payload);
  await renameFile(tmp, path);
}

/**
 * Verify that the extensionless object is a real regular file before delete
 * actions perform reference checks. Symlinks are deliberately rejected.
 */
async function assertRegularObjectExists(attachmentId) {
  const objectPath = deriveObjectPath(attachmentId);
  if (objectPath === void 0) throw notFoundError(attachmentId);
  let stat;
  try {
    stat = await lstatFile(objectPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw notFoundError(attachmentId);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw notFoundError(attachmentId);
  return objectPath;
}

/**
 * Return every session id that references an attachment. Checks both the
 * in-memory live map (`service._sessionImages`) and the on-disk map so a
 * debounced ownership save can never accidentally expose an image as orphan.
 */
async function referencesFor(service, attachmentId) {
  if (service._sessionImages instanceof Map !== true) service._sessionImages = new Map();
  await ensureSessionImagesLoaded(service);
  const refs = new Set();
  for (const [sid, ids] of service._sessionImages) {
    if (ids instanceof Set && ids.has(attachmentId)) refs.add(String(sid));
  }
  const disk = await loadSessionImages();
  for (const [sid, ids] of disk) {
    if (ids instanceof Set && ids.has(attachmentId)) refs.add(String(sid));
  }
  return [...refs].sort();
}

/**
 * Delete the object file plus every sibling extension hardlink beginning with
 * `<hash>.`. Only real regular files are unlinked; symlinks are never followed
 * or removed. `requireBase` makes a missing base object a NOT_FOUND error.
 *
 * @returns the number of bytes actually reclaimed for this one object (the
 * backing inode size, counted once even when extension hardlinks exist).
 */
async function deleteObjectFiles(attachmentId, { requireBase = true } = {}) {
  const objectPath = deriveObjectPath(attachmentId);
  if (objectPath === void 0) {
    if (requireBase) throw notFoundError(attachmentId);
    return { freedBytes: 0 };
  }

  const hash = objectPath.slice(objectPath.lastIndexOf("/") + 1);
  const bucketDir = dirname(objectPath);
  let baseStat;
  let baseRemoved = false;

  try {
    baseStat = await lstatFile(objectPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (requireBase) throw notFoundError(attachmentId);
    } else {
      throw error;
    }
  }

  if (baseStat !== void 0) {
    if (baseStat.isFile() && !baseStat.isSymbolicLink()) {
      await unlinkFile(objectPath);
      baseRemoved = true;
    } else if (requireBase) {
      throw notFoundError(attachmentId);
    }
  }

  // Remove companion hardlinks (e.g. .png/.jpg/.webp/.gif) in the same real
  // bucket directory. lstat re-check keeps a symlink swap safe.
  let freedBytes = baseStat?.isFile() && baseRemoved ? baseStat.size : 0;
  const prefix = hash + ".";
  try {
    const bucketStat = await lstatFile(bucketDir);
    if (!bucketStat.isDirectory() || bucketStat.isSymbolicLink()) {
      return { freedBytes };
    }
    const entries = await readdir(bucketDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      if (!entry.name.startsWith(prefix)) continue;
      const path = bucketDir + "/" + entry.name;
      let stat;
      try {
        stat = await lstatFile(path);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      await unlinkFile(path);
      if (!baseRemoved && freedBytes === 0) freedBytes = stat.size;
    }
  } catch {
    // Missing/unreadable bucket is already covered by NOT_FOUND/base checks;
    // companion cleanup is best-effort.
  }

  return { freedBytes };
}

/**
 * Safely scan the object store for regular object files. Symlinked buckets and
 * symlinked files are never followed.
 *
 * @returns Array<{ fileName, path }> for real regular files.
 */
async function scanObjectFiles(root) {
  const results = [];
  let buckets;
  try {
    buckets = await readdir(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const bucketEnt of buckets) {
    if (!bucketEnt.isDirectory() || bucketEnt.isSymbolicLink()) continue;
    const bucketPath = root + "/" + bucketEnt.name;
    try {
      const bucketStat = await lstatFile(bucketPath);
      if (!bucketStat.isDirectory() || bucketStat.isSymbolicLink()) continue;
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
        const fileStat = await lstatFile(filePath);
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
        results.push({ fileName: fileEnt.name, path: filePath, bytes: fileStat.size });
      } catch {
        // Best-effort scan: skip unreadable entries.
      }
    }
  }
  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return results;
}

/**
 * Remove one attachment id from every session ownership set and persist the
 * updated map through ownership's serialized save queue.
 */
export async function removeFromOwnership(service, attachmentId) {
  if (service === void 0 || service === null) return;
  if (service._sessionImages instanceof Map !== true) service._sessionImages = new Map();
  await ensureSessionImagesLoaded(service);

  let changed = false;
  for (const ids of service._sessionImages.values()) {
    if (ids instanceof Set && ids.delete(attachmentId)) changed = true;
  }
  if (changed) {
    service._sessionImagesDirty = true;
    await saveSessionImages(service);
    service._sessionImagesDirty = false;
  }
}

/**
 * Delete one image object. Referenced images are rejected unless `force` is
 * set. Explicit single deletion of a retained image is allowed; when the file
 * is deleted its retention mark is cleared too.
 *
 * @returns {Promise<{ ok: true, deleted: string, freedBytes: number }>}
 */
export async function deleteImage(service, attachmentId, opts = {}) {
  const force = opts?.force === true;
  await assertRegularObjectExists(attachmentId);

  const refs = await referencesFor(service, attachmentId);
  if (refs.length > 0 && !force) throw referencedError(attachmentId, refs);

  const retained = await isRetainedLocal(attachmentId);
  const { freedBytes } = await deleteObjectFiles(attachmentId, { requireBase: true });
  await removeFromOwnership(service, attachmentId);
  if (retained) await setRetainedLocal(attachmentId, false);

  return { ok: true, deleted: attachmentId, freedBytes };
}

/**
 * Delete orphaned image objects. Orphans are attachments with no ownership
 * reference in memory or on disk. Retained orphans are skipped by default;
 * pass `{ includeRetained: true }` to delete them too.
 *
 * @returns {Promise<{ ok: true, deleted: string[], skipped: string[], freedBytes: number }>}
 */
export async function deleteOrphans(service, opts = {}) {
  const includeRetained = opts?.includeRetained === true;
  const home = homePath();
  const objectsRoot = home === void 0 ? void 0 : home + "/attachments/v1/objects";
  const scanned = objectsRoot === void 0 ? [] : await scanObjectFiles(objectsRoot);

  // One entry per hash; extension hardlinks and base object share identity.
  const hashes = new Map();
  for (const file of scanned) {
    const match = typeof file.fileName === "string" ? OBJECT_FILE_RE.exec(file.fileName) : null;
    if (match === null) continue;
    const hash = match[1];
    if (!hashes.has(hash)) hashes.set(hash, { attachmentId: "sha256:" + hash });
  }

  const retainedSet = await readRetainedSet(imageRetentionPath());
  const deleted = [];
  const skipped = [];
  let freedBytes = 0;

  const ordered = [...hashes.values()].sort((a, b) =>
    a.attachmentId < b.attachmentId ? -1 : a.attachmentId > b.attachmentId ? 1 : 0
  );
  for (const { attachmentId } of ordered) {
    const refs = await referencesFor(service, attachmentId);
    if (refs.length > 0) continue;

    const retained = retainedSet.has(attachmentId);
    if (retained && !includeRetained) {
      skipped.push(attachmentId);
      continue;
    }

    const result = await deleteObjectFiles(attachmentId, { requireBase: false });
    if (retained) await setRetainedLocal(attachmentId, false);
    deleted.push(attachmentId);
    freedBytes += result.freedBytes;
  }

  return { ok: true, deleted, skipped, freedBytes };
}
