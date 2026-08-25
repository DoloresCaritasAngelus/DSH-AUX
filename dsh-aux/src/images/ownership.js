/**
 * dsh-aux session→image ownership map: persistence, disposal cleanup and
 * cold-session reconciliation.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/ownership
 */
import { readFile as readFileText, rename as renameFile, unlink as unlinkFile, writeFile as writeFileText } from "node:fs/promises";

/** Path to the session→attachment ownership map. */
export function sessionImagesPath() {
  const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
  return home === void 0 ? void 0 : home + "/attachments/v1/session-images.json";
}

/** Path to the previous-good copy of the ownership map (crash/corruption fallback). */
export function sessionImagesBackupPath() {
  const base = sessionImagesPath();
  return base === void 0 ? void 0 : base + ".bak";
}

/** Sentinel: a file existed but could not be parsed. */
const CORRUPT = Symbol("session-images.corrupt");

/**
 * Read one ownership-map file. Returns:
 *   - a Map on success,
 *   - CORRUPT when the file exists but is unparsable/malformed,
 *   - undefined when the file is absent,
 * and rethrows unexpected filesystem errors (so callers can retry).
 */
async function readOwnershipMapFile(path) {
  let raw;
  try {
    raw = await readFileText(path);
  } catch (error) {
    if (error?.code === "ENOENT") return void 0;
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return CORRUPT;
    const map = new Map();
    for (const [sid, ids] of Object.entries(parsed)) {
      if (Array.isArray(ids)) map.set(sid, new Set(ids));
    }
    return map;
  } catch {
    return CORRUPT;
  }
}

/** Move a corrupt file aside instead of silently overwriting it. */
async function quarantineFile(path) {
  try {
    await renameFile(path, path + ".corrupt-" + Date.now());
  } catch {
    /* best-effort: quarantine is a diagnostic nicety, never fatal */
  }
}

/**
 * Load the ownership map from disk, with crash/corruption fallback:
 * try the main file, then the `.bak` previous-good copy; corrupt files are
 * quarantined (renamed aside) rather than silently overwritten.
 */
export async function loadSessionImages() {
  const path = sessionImagesPath();
  if (path === void 0) return new Map();
  const main = await readOwnershipMapFile(path);
  if (main instanceof Map) return main;
  if (main === CORRUPT) await quarantineFile(path);
  const bakPath = sessionImagesBackupPath();
  if (bakPath !== void 0) {
    const backup = await readOwnershipMapFile(bakPath);
    if (backup instanceof Map) return backup;
    if (backup === CORRUPT) await quarantineFile(bakPath);
  }
  return new Map();
}

/** Atomically write both the main map and its previous-good `.bak` copy. */
async function writeSessionImagesAtomically(obj) {
  const path = sessionImagesPath();
  if (path === void 0) return;
  const tmp = path + ".tmp";
  const payload = JSON.stringify(obj);
  await writeFileText(tmp, payload);
  await renameFile(tmp, path);
  const bakPath = sessionImagesBackupPath();
  if (bakPath !== void 0) {
    const bakTmp = bakPath + ".tmp";
    await writeFileText(bakTmp, payload);
    await renameFile(bakTmp, bakPath);
  }
}

/** Convert the in-memory map to the plain-object shape used on disk. */
function toOwnershipObject(service) {
  return mapToOwnershipObject(service._sessionImages);
}

/** Convert a Map<sid, Set<id>> to the plain-object shape used on disk. */
function mapToOwnershipObject(map) {
  const obj = {};
  for (const [sid, ids] of map) {
    obj[sid] = [...ids];
  }
  return obj;
}

/**
 * Serialize a session-images.json write on the service's per-service promise
 * queue. Repeated writers (debounced saves, cleanup persistence, concurrent
 * multi-image turns) chain through one queue so the read-modify-write of the
 * shared file never interleaves.
 */
function enqueueSessionImagesWrite(service, write) {
  if (!service._sessionImagesWriteQueue) service._sessionImagesWriteQueue = Promise.resolve();
  service._sessionImagesWriteQueue = service._sessionImagesWriteQueue
    .then(() => write())
    .catch(() => { /* best-effort: ownership recording must never break vision calls */ });
  return service._sessionImagesWriteQueue;
}

/** Persist the ownership map atomically (tmp + rename), serialized. */
export async function saveSessionImages(service) {
  return enqueueSessionImagesWrite(service, async () => {
    if (sessionImagesPath() === void 0) return;
    try {
      await writeSessionImagesAtomically(toOwnershipObject(service));
    } catch { /* best-effort: ownership recording must never break vision calls */ }
  });
}

/**
 * Seed the in-memory ownership cache from disk exactly once. Without this,
 * a fresh process (restart) would persist ONLY the sessions seen since
 * startup, overwriting the disk map and losing every older session's
 * ownership — their images would then never be cleaned on deletion.
 * Only marks the cache loaded after a successful read, so a transient
 * filesystem error is retried on the next call instead of being swallowed.
 */
export async function ensureSessionImagesLoaded(service) {
  if (service._sessionImagesLoaded) return;
  const disk = await loadSessionImages();
  for (const [sid, ids] of disk) {
    if (!service._sessionImages.has(sid)) service._sessionImages.set(sid, ids);
  }
  service._sessionImagesLoaded = true;
}

/**
 * Record that one session referenced one image attachment. Called after a
 * vision call resolves its image, so disposal cleanup knows what to prune.
 */
export async function recordAttachmentOwnership(service, sessionId, attachmentId) {
  if (sessionId === void 0 || attachmentId === void 0) return;
  await ensureSessionImagesLoaded(service);
  let ids = service._sessionImages.get(sessionId);
  if (ids === void 0) {
    ids = new Set();
    service._sessionImages.set(sessionId, ids);
  }
  ids.add(attachmentId);
  if (!service._sessionImagesDirty) {
    service._sessionImagesDirty = true;
    // Debounced persistence: flush shortly after the current turn.
    setTimeout(() => {
      service._sessionImagesDirty = false;
      saveSessionImages(service);
    }, 0);
  }
}

/**
 * Collect the ids of every session that still exists: live (attached in
 * memory) plus persisted (on disk). Best-effort: a missing service or a
 * failed list call degrades to the live set only.
 * @returns a Set of session ids that must keep their images.
 */
export async function liveSessionIds(service) {
  const ids = new Set();
  try {
    const sessions = service.ctx.get("sessions");
    if (sessions !== void 0 && typeof sessions.list === "function") {
      for (const session of sessions.list()) ids.add(session.id);
    }
  } catch { /* service absent */ }
  try {
    const persistence = service.ctx.get("sessionPersistence");
    if (persistence !== void 0 && typeof persistence.listSnapshots === "function") {
      for (const snapshot of await persistence.listSnapshots()) {
        const id = snapshot?.header?.id ?? snapshot?.id;
        if (id !== void 0) ids.add(String(id));
      }
    }
  } catch { /* persistence absent or unreadable */ }
  return ids;
}

/**
 * Reconcile the persisted ownership map against the live session set:
 * any session that no longer exists (deleted while cold, so no
 * session/disposed fired) has its unreferenced images removed. Archive
 * does not delete a session, so archived sessions stay in persistence and
 * are never touched. Idempotent and cheap when the map is empty.
 */
export async function reconcileSessionImages(service) {
  const map = await loadSessionImages();
  if (map.size === 0) return;
  const live = await liveSessionIds(service);
  for (const sessionId of [...map.keys()]) {
    if (!live.has(sessionId)) {
      await cleanupSessionImages(service, sessionId);
    }
  }
}

/**
 * Arm an explicit shutdown hook on the service (idempotent). Once installed,
 * the next process exit signal flips `service._shuttingDown` so that
 * `onSessionDisposed` can tell a real process shutdown (which disposes every
 * session at once) apart from an ordinary user delete.
 */
export function installShutdownHook(service) {
  if (service._shutdownHookInstalled) return;
  service._shutdownHookInstalled = true;
  const markShuttingDown = () => {
    service._shuttingDown = true;
  };
  process.once("beforeExit", markShuttingDown);
  process.once("SIGTERM", markShuttingDown);
  process.once("SIGINT", markShuttingDown);
}

/**
 * Delete-triggered attachment GC. Runs when a session is disposed; removes
 * images that session owned and that no other session references. When the
 * process is shutting down every session disposes at once — not a user
 * delete — so that wholesale burst is skipped.
 */
export function onSessionDisposed(service, session) {
  const sid = session?.id ?? session?.sessionId;
  if (sid === void 0) return;
  // Process shutdown disposes every session at once — not a user delete.
  if (service._shuttingDown === true) return;
  installShutdownHook(service);
  cleanupSessionImages(service, sid);
}

/** Delete one disposed session's unreferenced images and update the map. */
export async function cleanupSessionImages(service, sessionId) {
  // Serialize the WHOLE read-modify-write+delete operation through the shared
  // queue, not just the final write. Otherwise two concurrent cleanups can
  // both read the same disk map, delete different files, and then write back
  // maps that resurrect each other's deletions.
  return enqueueSessionImagesWrite(service, async () => {
    const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
    if (home === void 0) return;
    const objectsRoot = home + "/attachments/v1/objects";
    const map = await loadSessionImages();
    const mine = map.get(sessionId);
    if (mine === void 0) return;
    // Empty entry (or a session whose images were already fully reclaimed):
    // still remove the key so `session-images.json` never accumulates empty
    // sessions. Keep the in-memory cache consistent too.
    if (mine.size === 0) {
      map.delete(sessionId);
      service._sessionImages.delete(sessionId);
      try {
        await writeSessionImagesAtomically(mapToOwnershipObject(map));
      } catch { /* best-effort */ }
      return;
    }
    // Which other sessions reference each id?
    let removed = 0;
    for (const attachmentId of mine) {
      const referencedElsewhere = [...map.entries()].some(([sid, ids]) =>
        sid !== sessionId && ids.has(attachmentId)
      );
      if (referencedElsewhere) continue;
      const match = /^sha256:([a-f0-9]{64})$/.exec(String(attachmentId));
      if (match === null) continue;
      const hash = match[1];
      const real = objectsRoot + "/" + hash.slice(0, 2) + "/" + hash;
      try {
        await unlinkFile(real);
      } catch { /* already gone */ }
      // Companion .ext hardlink from the image bridge, if present.
      const extensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
      for (const ext of extensions) {
        try {
          await unlinkFile(real + ext);
        } catch { /* absent */ }
      }
      removed += 1;
    }
    // Always drop the deleted session from the map, even when every image was
    // shared (removed === 0). Otherwise the stale owner stays forever and the
    // last remaining owner can never reclaim the shared image.
    map.delete(sessionId);
    // Keep the in-memory cache consistent: a later debounced save must not
    // resurrect the deleted session's entries from the stale cache.
    service._sessionImages.delete(sessionId);
    try {
      await writeSessionImagesAtomically(mapToOwnershipObject(map));
    } catch { /* best-effort */ }
  });
}
