/**
 * dsh-aux session→image ownership map: persistence, disposal cleanup and
 * cold-session reconciliation.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/ownership
 */
import {
  mkdir as mkdirDir,
  readFile as readFileText,
  readdir as readdirDir,
  rename as renameFile,
  stat as statFile,
  unlink as unlinkFile,
  writeFile as writeFileText,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { listSessionSnapshots, readSessionEvents, sessionEvents } from "../session-utils.js";
import { sessionImageRefs } from "./refs.js";
import { attachmentRefFor, loadAttachmentRefs, recordAttachmentRefs } from "./attachment-refs.js";
import { IMAGE_EXTENSIONS, TRASH_DIR_NAME, objectPathForId } from "./object-path.js";
import { loadRetained } from "./retention.js";
import { DEFAULT_REQUEST_IMAGES_MAX_BYTES, sweepRequestImages } from "./request-images.js";
/** Recovery window for trashed objects (swept by reconcile / gc-images). */
export const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Resolve the DSH home used by AUX attachment paths. */
function dshHome() {
  return process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
}

/** Attachments service (the official host-path seam), when mounted. */
function attachmentsService(service) {
  try {
    return service?._imageCtx?.get?.("attachments") ?? service?.ctx?.get?.("attachments");
  } catch {
    return void 0;
  }
}

/**
 * Resolve one object's host path.
 *
 * Prefers the official `attachments.imageHostPath(ref)` seam (needs a full
 * ref); falls back to the legacy id derivation only when the sidecar has no
 * ref for this id — a missing sidecar must never block a deletion.
 */
function imageObjectPath(service, objectsRoot, ref) {
  const attachments = attachmentsService(service);
  if (attachments !== void 0 && typeof attachments.imageHostPath === "function" && typeof ref?.mediaType === "string") {
    try {
      const hostPath = attachments.imageHostPath(ref);
      if (typeof hostPath === "string" && hostPath.length > 0) return hostPath;
    } catch {
      /* invalid ref: fall through to the legacy derivation */
    }
  }
  return objectPathForId(ref?.attachmentId, objectsRoot);
}

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
/**
 * Lazily-created lifecycle bookkeeping:
 * - `_liveBackfillPending`: live sessions whose ownership scan is in flight;
 * - `_liveBackfillFailed`: live sessions whose scan failed.
 *
 * Deletion is refused while either set is non-empty: an unbackfilled session's
 * ownership is unknowable, and an unknowable reference must never be deleted.
 * The state is observable through `/aux status` and clears itself once a
 * retry succeeds.
 */
function lifecycleState(service) {
  if (!(service._liveBackfillPending instanceof Set)) service._liveBackfillPending = new Set();
  if (!(service._liveBackfillFailed instanceof Set)) service._liveBackfillFailed = new Set();
  return { pending: service._liveBackfillPending, failed: service._liveBackfillFailed };
}

/** Whether every live session's ownership is known (fail-closed gate). */
export function deletionReady(service) {
  const { pending, failed } = lifecycleState(service);
  return pending.size === 0 && failed.size === 0;
}

/** Human-readable fail-closed state for /aux status (undefined when ready). */
export function deletionBlockReason(service) {
  const { pending, failed } = lifecycleState(service);
  if (pending.size === 0 && failed.size === 0) return void 0;
  const parts = [];
  if (pending.size > 0) parts.push(`${pending.size} 个 live 会话归属登记进行中`);
  if (failed.size > 0) parts.push(`${failed.size} 个 live 会话归属登记失败`);
  return `图片删除已冻结(fail-closed):${parts.join("、")}。`;
}

/**
 * Build the fail-closed deletion error (machine-readable `code` =
 * `DELETION_FROZEN`). `retryable` records that the condition clears itself:
 * the barrier reopens as soon as the live-session backfill retry succeeds.
 */
export function deletionFrozenError(service) {
  const reason = service !== null && typeof service === "object" ? deletionBlockReason(service) : void 0;
  const error = new Error((reason ?? "图片删除已冻结(fail-closed):无法确认 live 会话归属登记状态。") + "可稍后重试。");
  error.code = "DELETION_FROZEN";
  error.retryable = true;
  return error;
}

/**
 * The single fail-closed deletion gate shared by EVERY entry point that makes
 * an attachment object unrecoverable: session cleanup (which also enforces
 * deletionReady inline), single delete, orphan reclaim and manual gc-images —
 * `--force` paths included, because force overrides *known* references and
 * cannot invent *unknown* ones. A non-object service is refused too: without
 * it the barrier state cannot be evaluated, and an unevaluable barrier must
 * never delete.
 */
export function assertDeletionReady(service) {
  if (service === null || typeof service !== "object") throw deletionFrozenError(service);
  if (!deletionReady(service)) throw deletionFrozenError(service);
}

/** Mark ownership state dirty and flush it shortly (debounced, never throws). */
function markOwnershipDirty(service) {
  if (service._sessionImagesDirty) return;
  service._sessionImagesDirty = true;
  setTimeout(() => {
    service._sessionImagesDirty = false;
    saveSessionImages(service);
  }, 0);
}

/**
 * Record one ownership reference and report whether it landed.
 *
 * @returns {Promise<boolean>} true when the reference is in the in-memory map
 *   (and queued for persistence), false when the disk map could not be loaded.
 */
async function recordAttachmentOwnershipStrict(service, sessionId, attachmentId) {
  if (sessionId === void 0 || attachmentId === void 0) return false;
  try {
    await ensureSessionImagesLoaded(service);
  } catch {
    return false;
  }
  let ids = service._sessionImages.get(sessionId);
  if (ids === void 0) {
    ids = new Set();
    service._sessionImages.set(sessionId, ids);
  }
  ids.add(attachmentId);
  markOwnershipDirty(service);
  return true;
}

/**
 * Backfill a live session's image ownership from its in-memory log.
 *
 * A resumed session's constructor seed IS its full stored log, and constructor
 * seeds never fire `session/event` — so the incremental hook cannot see the
 * history and this synchronous scan is the recovery barrier. It needs no disk
 * I/O: the log is already in memory.
 *
 * @param {object} service The AUX service.
 * @param {object|null|undefined} session The live Session.
 * @returns {Promise<void>} Settlement of the ownership writes.
 */
export function noteLiveSession(service, session) {
  const raw = session?.id ?? session?.sessionId;
  if (raw === void 0) return;
  const sessionId = String(raw);
  const { pending, failed } = lifecycleState(service);
  pending.add(sessionId);
  const refs = sessionImageRefs(sessionEvents(session));
  const ids = new Set();
  for (const ref of refs) {
    const attachmentId = ref?.attachmentId;
    if (typeof attachmentId === "string" && attachmentId.length > 0) ids.add(attachmentId);
  }
  // Full refs feed the GC sidecar (host-path seam + media-type .ext removal).
  recordAttachmentRefs(service, refs).catch(() => {});
  // Returns the settlement promise so callers/tests can await the barrier;
  // the lifecycle hook itself fires and forgets it.
  return Promise.all([...ids].map((attachmentId) => recordAttachmentOwnershipStrict(service, sessionId, attachmentId)))
    .then((results) => {
      pending.delete(sessionId);
      if (results.every(Boolean)) failed.delete(sessionId);
      else failed.add(sessionId);
    })
    .catch(() => {
      pending.delete(sessionId);
      failed.add(sessionId);
    });
}

/**
 * Release a disposed session from the live lifecycle bookkeeping — but only
 * once it is really gone from the persistence layer.
 *
 * A session that still exists in storage (the user closed a tab without
 * deleting it) can come back with its log intact: its images must keep the
 * global fail-closed gate closed until the backfill succeeds, otherwise
 * another session's cleanup could reclaim them and break that log on resume
 * (the R5 scenario). Unreadable storage is treated as "still stored".
 *
 * @param {object} service The AUX service.
 * @param {string} sessionId The disposed session id.
 * @returns {Promise<boolean>} true when the session was released.
 */
export async function releaseLiveSession(service, sessionId) {
  const id = String(sessionId);
  const { pending, failed } = lifecycleState(service);
  if (!pending.has(id) && !failed.has(id)) return true;
  let persistence;
  try {
    persistence = service.ctx.get("sessionPersistence");
  } catch {
    persistence = void 0;
  }
  let snapshots;
  try {
    snapshots = await listSessionSnapshots(persistence, void 0, { strict: true });
  } catch {
    // Storage unreadable: indistinguishable from "still stored" — fail-closed.
    return false;
  }
  const stillStored = snapshots.some((entry) => String(entry?.header?.id ?? entry?.id) === id);
  if (stillStored) return false;
  pending.delete(id);
  failed.delete(id);
  return true;
}

/**
 * Retry one live session's backfill from its stored log (the read path works
 * while the live session holds write ownership). Used by the periodic
 * reconcile for sessions whose in-memory scan failed.
 *
 * @returns {Promise<boolean>} true when the stored log was read and recorded.
 */
async function backfillFromStoredLog(service, sessionId) {
  let persistence;
  try {
    persistence = service.ctx.get("sessionPersistence");
  } catch {
    persistence = void 0;
  }
  const events = await readSessionEvents(persistence, sessionId);
  if (!Array.isArray(events)) return false;
  const ids = new Set();
  for (const ref of sessionImageRefs(events)) {
    const attachmentId = ref?.attachmentId;
    if (typeof attachmentId === "string" && attachmentId.length > 0) ids.add(attachmentId);
  }
  const results = await Promise.all(
    [...ids].map((attachmentId) => recordAttachmentOwnershipStrict(service, sessionId, attachmentId)),
  );
  return results.every(Boolean);
}

/**
 * Trash entry name written by trashImageObject:
 * `<original-name>-<ingress-epoch-ms>-<uuid8>`.
 *
 * The ingress timestamp is encoded in the NAME on purpose. `rename(2)`
 * preserves the object's original mtime, and `utimes` can fail on read-only /
 * quota-limited filesystems, so a recovery window derived from filesystem
 * times alone would be zero for an object that is already older than the
 * window when it is trashed. The embedded stamp is authoritative; mtime is
 * only a fallback when the stamp cannot be trusted.
 */
export const TRASH_ENTRY_RE = /^(?<base>.+?)-(?<stamp>\d{10,17})-(?<uuid>[0-9a-f]{8})$/;

/**
 * Classify one trash entry name.
 *
 * @returns {{ managed: false } | { managed: true, ingressMs: number|undefined }}
 *   `managed: false` means the name was not written by this module and must
 *   never be swept. `ingressMs: undefined` means the entry is ours but its
 *   embedded stamp is unusable, so the caller falls back to mtime.
 */
function trashEntryIngress(name) {
  const match = TRASH_ENTRY_RE.exec(name);
  if (match === null) return { managed: false };
  const stamp = Number(match.groups.stamp);
  return { managed: true, ingressMs: Number.isSafeInteger(stamp) && stamp > 0 ? stamp : void 0 };
}

/**
 * Move one attachment object into the trash (recoverable) and drop its
 * companion `.ext` hard links — the inode stays alive through the trash entry,
 * so this reclaims the space without making an erroneous reclaim permanent.
 * The entry name carries the ingress timestamp, which is what sweepTrash ages
 * the recovery window by.
 *
 * @param {{ canTrash?: () => boolean }} [options] `canTrash` is a synchronous
 *   recheck run immediately before the rename (no await in between): a
 *   reference registered after the caller's decision keeps the object in place.
 * @returns {Promise<{ ok: boolean, gone: boolean, skipped?: boolean }>}
 *   `gone` marks an object that was already absent (nothing to reclaim, not a
 *   failure); `skipped` marks a recheck veto.
 */
async function trashImageObject(objectsRoot, objectPath, ref, { canTrash } = {}) {
  const trashRoot = objectsRoot + "/" + TRASH_DIR_NAME;
  try {
    await mkdirDir(trashRoot, { recursive: true });
  } catch {
    return { ok: false, gone: false };
  }
  const name = objectPath.slice(objectPath.lastIndexOf("/") + 1);
  const target = `${trashRoot}/${name}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  // TOCTOU recheck: the "no other reference" decision was made before this
  // function's await points, so a registration can land in between. This
  // synchronous recheck runs with no further await before rename.
  if (typeof canTrash === "function" && canTrash() === false) {
    return { ok: false, gone: false, skipped: true };
  }
  try {
    await renameFile(objectPath, target);
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, gone: true };
    return { ok: false, gone: false };
  }
  // Companion .ext hard links: every known extension is unlinked, not just the
  // one derived from ref.mediaType. They are hard links to the same inode, so
  // a single stale link (older bridges defaulted unknown types to `.png`)
  // would keep the data blocks alive even after the object itself moved.
  void ref;
  for (const ext of IMAGE_EXTENSIONS) {
    try {
      await unlinkFile(objectPath + ext);
    } catch {
      /* absent: nothing to reclaim */
    }
  }
  return { ok: true, gone: false };
}

/**
 * Sweep trash entries older than the recovery window.
 *
 * Two guards beyond the original mtime check:
 *  - NAMESPACE: only entries whose name matches TRASH_ENTRY_RE (i.e. written by
 *    trashImageObject) are ever unlinked. Foreign files parked in .trash are
 *    left untouched.
 *  - INGRESS CLOCK: the recovery window is measured from the timestamp encoded
 *    in the entry name, not from mtime. rename(2) preserves the object's old
 *    mtime, so an object older than the window would otherwise be swept the
 *    moment it is trashed (window = 0). mtime is used only when the embedded
 *    stamp is unusable.
 *
 * @param {object} service The AUX service (unused today, kept for symmetry).
 * @param {{ maxAgeMs?: number }} [options] Recovery window override.
 * @returns {Promise<{ removed: number, bytes: number, skippedForeign: number }>}
 */
export async function sweepTrash(service, { maxAgeMs = TRASH_TTL_MS } = {}) {
  const home = dshHome();
  if (home === void 0) return { removed: 0, bytes: 0, skippedForeign: 0 };
  const trashRoot = `${home}/attachments/v1/objects/${TRASH_DIR_NAME}`;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  let bytes = 0;
  let skippedForeign = 0;
  let entries;
  try {
    entries = await readdirDir(trashRoot, { withFileTypes: true });
  } catch {
    return { removed: 0, bytes: 0, skippedForeign: 0 };
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const ingress = trashEntryIngress(entry.name);
    if (!ingress.managed) {
      skippedForeign += 1;
      continue;
    }
    const path = `${trashRoot}/${entry.name}`;
    try {
      const info = await statFile(path);
      if (!info.isFile()) continue;
      const ingressMs = ingress.ingressMs ?? info.mtimeMs;
      if (ingressMs >= cutoff) continue;
      await unlinkFile(path);
      removed += 1;
      bytes += info.size;
    } catch {
      /* best-effort sweep */
    }
  }
  return { removed, bytes, skippedForeign };
}

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
  // Best-effort: a transient filesystem error must not become an unhandled
  // rejection from the fire-and-forget vision path. `_sessionImagesLoaded`
  // stays false on failure, so the next call retries the load.
  await recordAttachmentOwnershipStrict(service, sessionId, attachmentId).catch(() => false);
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
    for (const snapshot of await listSessionSnapshots(persistence)) {
      const id = snapshot?.header?.id ?? snapshot?.id;
      if (id !== void 0) ids.add(String(id));
    }
  } catch {
    /* persistence absent or unreadable */
  }
  return ids;
}

/**
 * Every attachment id referenced by any session, from the on-disk ownership
 * map plus the live in-memory map. The manual GC uses it to avoid deleting an
 * object a session still references.
 *
 * Throws when the on-disk map cannot be read: the caller must refuse the sweep
 * rather than assume "no references" (fail-closed).
 *
 * @param {object} service The AUX service.
 * @returns {Promise<Set<string>>}
 */
export async function loadReferencedAttachmentIds(service) {
  const ids = new Set();
  const disk = await loadSessionImages();
  for (const [, owned] of disk) {
    if (owned instanceof Set) for (const attachmentId of owned) ids.add(String(attachmentId));
  }
  const memory = service?._sessionImages;
  if (memory instanceof Map) {
    for (const [, owned] of memory) {
      if (owned instanceof Set) for (const attachmentId of owned) ids.add(String(attachmentId));
    }
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
  // Retry live sessions whose in-memory backfill failed, from their stored
  // log: the global fail-closed gate stays closed until these succeed.
  const { pending, failed } = lifecycleState(service);
  for (const sessionId of [...failed]) {
    if (pending.has(sessionId)) continue;
    try {
      if (await backfillFromStoredLog(service, sessionId)) failed.delete(sessionId);
    } catch {
      /* stays failed: fail-closed */
    }
  }
  await sweepTrash(service).catch(() => ({ removed: 0, bytes: 0 }));
  await sweepRequestImages(service, {
    maxBytes: Number.isFinite(service.requestImagesMaxBytes)
      ? service.requestImagesMaxBytes
      : DEFAULT_REQUEST_IMAGES_MAX_BYTES,
  }).catch(() => ({ removed: 0, bytes: 0, scanned: 0, totalBytes: 0 }));
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
  // Release the session from the live gate only when storage no longer has it;
  // a still-stored session keeps the gate closed so its images survive until
  // the reconcile retries the backfill from the stored log.
  releaseLiveSession(service, sid)
    .catch(() => false)
    .finally(() => {
      cleanupSessionImages(service, sid);
    });
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
    const refs = await loadAttachmentRefs(service);
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
    // Fail-closed: while any live session's ownership is unknown, no deletion
    // may proceed — an unknowable reference must never be deleted. Observable
    // via /aux status; clears itself once a retry succeeds.
    if (!deletionReady(service)) return;

    // Retained (user-pinned) objects are exempt from automatic cleanup. The
    // read is fail-closed: if the retention list cannot be read we do not know
    // what the user pinned, so nothing is deleted and the session stays in the
    // map as a retry anchor for the next reconcile.
    let retainedSet;
    try {
      retainedSet = await loadRetained();
    } catch {
      return;
    }

    // Which other sessions reference each id? Check disk + live memory: the
    // debounced save may lag behind memory, so a live shared reference must
    // still protect the file.
    const retry = new Set();
    let removed = 0;
    for (const attachmentId of mine) {
      const referencedElsewhere = hasOtherReference(map, memory, sessionId, attachmentId);
      if (referencedElsewhere) continue;
      // Retained exemption: the owner is still dropped below (the object
      // becomes a retained orphan), but the object itself is never trashed.
      if (retainedSet.has(String(attachmentId))) continue;
      // Reclaim through the official host-path seam when the sidecar has the
      // full ref; only an unknown id falls back to the legacy derivation.
      const ref = refs.get(String(attachmentId)) ?? { attachmentId: String(attachmentId) };
      const objectPath = imageObjectPath(service, objectsRoot, ref);
      if (objectPath === void 0) {
        retry.add(attachmentId);
        continue;
      }
      const outcome = await trashImageObject(objectsRoot, objectPath, ref, {
        // TOCTOU recheck: a reference registered after the check above (during
        // the awaits of this function) vetoes the rename synchronously.
        canTrash: () => !hasOtherReference(map, memory, sessionId, attachmentId),
      });
      if (outcome.ok) removed += 1;
      else retry.add(attachmentId);
    }
    // Drop the disposed session from the map even when every image was shared
    // (removed === 0): otherwise the stale owner stays forever and the last
    // remaining owner can never reclaim the shared image. Ids that could not
    // be reclaimed stay under this session id as a retry anchor.
    if (retry.size > 0) {
      service._sessionImages.set(sessionId, retry);
      merged.set(sessionId, retry);
    } else {
      service._sessionImages.delete(sessionId);
      merged.delete(sessionId);
    }
    try {
      await writeSessionImagesAtomically(mapToOwnershipObject(merged));
    } catch {
      /* best-effort */
    }
  });
}
