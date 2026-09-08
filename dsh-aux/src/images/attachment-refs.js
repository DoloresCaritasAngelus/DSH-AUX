/**
 * Sidecar map of full `ImageAttachmentRef`s keyed by attachment id.
 *
 * The session->image ownership map (`session-images.json`) stores bare ids and
 * must keep its existing semantics (silent non-array drop, quarantine on
 * corruption). Reclaiming an object needs more than the id — the official
 * `attachments.imageHostPath(ref)` seam takes a ref, and the companion
 * `.ext` hard link needs `ref.mediaType` — so the refs live in this
 * separate, GC-only sidecar. A missing or unreadable sidecar degrades to the
 * legacy id/extension derivation, never to a refused deletion.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/attachment-refs
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { attachmentsRootPath } from "./object-path.js";

/** Path to the sidecar, or undefined without DSH_HOME. */
export function attachmentRefsPath() {
  const root = attachmentsRootPath();
  return root === void 0 ? void 0 : root + "/attachment-refs.json";
}

/** JSON-safe subset of an ImageAttachmentRef (drops functions/undefined). */
export function sanitizeAttachmentRef(ref) {
  if (ref === null || typeof ref !== "object") return void 0;
  const attachmentId = ref.attachmentId;
  if (typeof attachmentId !== "string" || attachmentId.length === 0) return void 0;
  const out = { attachmentId };
  if (typeof ref.mediaType === "string" && ref.mediaType.length > 0) out.mediaType = ref.mediaType;
  if (typeof ref.name === "string" && ref.name.length > 0) out.name = ref.name;
  for (const key of ["bytes", "width", "height"]) {
    if (Number.isFinite(ref[key])) out[key] = ref[key];
  }
  return out;
}

/**
 * Load the sidecar into the per-service cache (once).
 *
 * @returns {Promise<Map<string, object>>} id -> ref; empty when absent/corrupt.
 */
export async function loadAttachmentRefs(service) {
  if (service?._attachmentRefs instanceof Map) return service._attachmentRefs;
  const map = new Map();
  const path = attachmentRefsPath();
  if (path !== void 0) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      const refs = parsed?.refs;
      if (refs !== null && typeof refs === "object" && !Array.isArray(refs)) {
        for (const value of Object.values(refs)) {
          const clean = sanitizeAttachmentRef(value);
          if (clean !== void 0) map.set(clean.attachmentId, clean);
        }
      }
    } catch {
      /* absent/corrupt: legacy fallback */
    }
  }
  if (service !== void 0) service._attachmentRefs = map;
  return map;
}

/** Serialize sidecar writes per service (last write wins, never throws). */
function enqueueWrite(service, task) {
  if (!(service._attachmentRefsQueue instanceof Promise)) service._attachmentRefsQueue = Promise.resolve();
  service._attachmentRefsQueue = service._attachmentRefsQueue.then(task).catch(() => {});
  return service._attachmentRefsQueue;
}

/** Atomically persist the sidecar map. */
async function writeAttachmentRefs(map) {
  const path = attachmentRefsPath();
  if (path === void 0) return;
  const payload = JSON.stringify({ version: 2, refs: Object.fromEntries(map) });
  const tmp = path + ".tmp";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, payload);
  await rename(tmp, path);
}

/**
 * Record full refs into the sidecar (best-effort; GC-only data).
 *
 * @param {object} service The AUX service (owns the cache + write queue).
 * @param {object|Array<object>} refs One ref or an array of refs.
 * @returns {Promise<void>} Settlement of the queued write.
 */
export async function recordAttachmentRefs(service, refs) {
  const list = Array.isArray(refs) ? refs : [refs];
  const clean = list.map(sanitizeAttachmentRef).filter((ref) => ref !== void 0);
  if (clean.length === 0) return;
  const map = await loadAttachmentRefs(service);
  let changed = false;
  for (const ref of clean) {
    const previous = map.get(ref.attachmentId);
    if (previous === void 0 || JSON.stringify(previous) !== JSON.stringify(ref)) {
      map.set(ref.attachmentId, ref);
      changed = true;
    }
  }
  if (!changed) return;
  return enqueueWrite(service, () => writeAttachmentRefs(map));
}

/**
 * Full ref for one attachment id, from the sidecar cache.
 *
 * @returns {Promise<object|undefined>} The ref, or undefined (legacy fallback).
 */
export async function attachmentRefFor(service, attachmentId) {
  const map = await loadAttachmentRefs(service);
  return map.get(attachmentId);
}
