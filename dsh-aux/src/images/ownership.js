/**
 * dsh-aux session→image ownership map: persistence, disposal cleanup and
 * cold-session reconciliation.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/ownership
 */
import {
  readFile as readFileText,
  rename as renameFile,
  unlink as unlinkFile,
  writeFile as writeFileText,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";

/** Path to the workspace registry state (archive set). */
export function workspaceRegistryPath() {
  const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
  return home === void 0 ? void 0 : home + "/storages/workspace.json";
}

/**
 * Read the archived session id set from the DSH workspace registry.
 * Missing/corrupt file degrades to an empty set; archiving is an optional
 * display/readability classification and must never break image collection.
 */
export async function loadArchivedSessionIds() {
  const path = workspaceRegistryPath();
  if (path === void 0) return new Set();
  try {
    const raw = await readFileText(path, "utf8");
    const parsed = JSON.parse(raw);
    const archived = parsed?.global?.archivedSessionIds;
    if (!Array.isArray(archived)) return new Set();
    return new Set(archived.filter((id) => typeof id === "string"));
  } catch {
    return new Set();
  }
}

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
    await renameFile(path, path + ".corrupt-" + Date.now() + "-" + randomUUID());
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
 * Whether any session other than `sessionId` references `attachmentId`.
 * Checks BOTH the on-disk map and the in-memory live map: the debounced
 * ownership save can lag behind memory, and a cleanup must not delete an
 * image the live (in-memory) map still considers shared.
 */
function hasOtherReference(map, memory, sessionId, attachmentId) {
  for (const [sid, ids] of map) {
    if (sid !== sessionId && ids.has(attachmentId)) return true;
  }
  if (memory instanceof Map) {
    for (const [sid, ids] of memory) {
      if (sid !== sessionId && ids.has(attachmentId)) return true;
    }
  }
  return false;
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
    .catch(() => {
      /* best-effort: ownership recording must never break vision calls */
    });
  return service._sessionImagesWriteQueue;
}

/** Persist the ownership map atomically (tmp + rename), serialized. */
export async function saveSessionImages(service) {
  return enqueueSessionImagesWrite(service, async () => {
    if (sessionImagesPath() === void 0) return;
    try {
      await writeSessionImagesAtomically(toOwnershipObject(service));
    } catch {
      /* best-effort: ownership recording must never break vision calls */
    }
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
  // Best-effort: a transient filesystem error must not become an unhandled
  // rejection from the fire-and-forget vision path. `_sessionImagesLoaded`
  // stays false on failure, so the next call retries the load.
  try {
    await ensureSessionImagesLoaded(service);
  } catch {
    return;
  }
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
  } catch {
    /* service absent */
  }
  try {
    const persistence = service.ctx.get("sessionPersistence");
    if (persistence !== void 0 && typeof persistence.listSnapshots === "function") {
      for (const snapshot of await persistence.listSnapshots()) {
        const id = snapshot?.header?.id ?? snapshot?.id;
        if (id !== void 0) ids.add(String(id));
      }
    }
  } catch {
    /* persistence absent or unreadable */
  }
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
  // On a graceful signal, flush any debounced ownership writes first, then
  // re-raise the signal. The plugin must not call process.exit() itself:
  // DSH/Cordis and other plugins may still need to run their own shutdown
  // cleanup. Because the listener is `once`, the re-raised signal falls
  // through to the host/default handler.
  const flushAndReraise = (signal) => {
    markShuttingDown();
    saveSessionImages(service)
      .catch(() => {})
      .finally(() => {
        process.kill(process.pid, signal);
      });
  };
  process.once("SIGTERM", () => flushAndReraise("SIGTERM"));
  process.once("SIGINT", () => flushAndReraise("SIGINT"));
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
    const memory = service._sessionImages;
    const diskMine = map.get(sessionId);
    const memMine = memory.get(sessionId);
    const mine = new Set();
    if (diskMine !== void 0) for (const id of diskMine) mine.add(id);
    if (memMine !== void 0) for (const id of memMine) mine.add(id);

    // Persist a merged view: on-disk map + in-memory pending owners (excluding
    // the deleted session). Otherwise a cleanup write could temporarily drop
    // owners that are still inside the debounce window.
    const merged = new Map(map);
    for (const [sid, ids] of memory) {
      if (sid === sessionId) continue;
      const set = merged.get(sid) ?? new Set();
      for (const id of ids) set.add(id);
      merged.set(sid, set);
    }
    merged.delete(sessionId);

    // A session may exist only in memory (debounce window before first save).
    // Remove the in-memory entry even when disk has no key, otherwise the
    // pending debounced save would resurrect the deleted session.
    if (mine.size === 0) {
      service._sessionImages.delete(sessionId);
      if (diskMine !== void 0 || merged.size !== map.size) {
        try {
          await writeSessionImagesAtomically(mapToOwnershipObject(merged));
        } catch {
          /* best-effort */
        }
      }
      return;
    }
    // Which other sessions reference each id? Check disk + live memory: the
    // debounced save may lag behind memory, so a live shared reference must
    // still protect the file.
    let removed = 0;
    for (const attachmentId of mine) {
      const referencedElsewhere = hasOtherReference(map, memory, sessionId, attachmentId);
      if (referencedElsewhere) continue;
      const match = /^sha256:([a-f0-9]{64})$/.exec(String(attachmentId));
      if (match === null) continue;
      const hash = match[1];
      const real = objectsRoot + "/" + hash.slice(0, 2) + "/" + hash;
      try {
        await unlinkFile(real);
      } catch {
        /* already gone */
      }
      // Companion .ext hardlink from the image bridge, if present.
      const extensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
      for (const ext of extensions) {
        try {
          await unlinkFile(real + ext);
        } catch {
          /* absent */
        }
      }
      removed += 1;
    }
    // Always drop the deleted session from the map, even when every image was
    // shared (removed === 0). Otherwise the stale owner stays forever and the
    // last remaining owner can never reclaim the shared image.
    service._sessionImages.delete(sessionId);
    try {
      await writeSessionImagesAtomically(mapToOwnershipObject(merged));
    } catch {
      /* best-effort */
    }
  });
}
