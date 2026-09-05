/**
 * dsh-aux image library: read-only aggregation of attachment objects,
 * session ownership, analysis memories and retention marks.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/image-library
 */
import { readFile as readFileText } from "node:fs/promises";
import { liveSessionIds, loadArchivedSessionIds, loadSessionImages } from "./ownership.js";
import { imageMemoryPath } from "./memory.js";
import { scanObjectFiles } from "./fs-utils.js";
import { loadRetained } from "./retention.js";

const HASH_ID_RE = /^sha256:([a-f0-9]{64})$/;
const OBJECT_FILE_RE = /^([a-f0-9]{64})(?:\.(png|jpg|jpeg|webp|gif))?$/;
const EXTENSION_MEDIA_TYPES = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
});

/** Resolve the DSH home used by AUX attachment paths. */
function homePath() {
  return process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
}

/**
 * Derive the extensionless object file path for an attachment id.
 *
 * @param {string} attachmentId `sha256:<64 hex>` identifier.
 * @returns {string|undefined} absolute object path, or undefined when the id
 * is not a SHA-256 attachment or DSH_HOME cannot be located.
 */
export function deriveObjectPath(attachmentId) {
  const home = homePath();
  if (home === void 0) return void 0;
  const match = typeof attachmentId === "string" ? HASH_ID_RE.exec(attachmentId) : null;
  if (match === null) return void 0;
  const hash = match[1];
  return home + "/attachments/v1/objects/" + hash.slice(0, 2) + "/" + hash;
}

/** Read `image-memory.json` without mutating it; missing/corrupt => []. */
async function readImageMemoryEntries() {
  const path = imageMemoryPath();
  if (path === void 0) return [];
  try {
    const raw = await readFileText(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter((entry) => entry !== null && typeof entry === "object");
  } catch {
    return [];
  }
}

/** Build the attachment-id -> sorted owner session id list from ownership map. */
function buildOwnersByAttachment(ownershipMap) {
  const ownersByAttachment = new Map();
  for (const [sessionId, ids] of ownershipMap) {
    if (sessionId === void 0 || sessionId === null) continue;
    if (!(ids instanceof Set)) continue;
    for (const attachmentId of ids) {
      if (typeof attachmentId !== "string") continue;
      let owners = ownersByAttachment.get(attachmentId);
      if (owners === void 0) {
        owners = [];
        ownersByAttachment.set(attachmentId, owners);
      }
      owners.push(sessionId);
    }
  }
  for (const owners of ownersByAttachment.values()) owners.sort();
  return ownersByAttachment;
}

/** Build attachment-id -> recent memories sorted newest first. */
function buildMemoriesByAttachment(memoryEntries) {
  const byAttachment = new Map();
  for (const memory of memoryEntries) {
    const attachmentId = memory.attachmentId;
    if (typeof attachmentId !== "string") continue;
    let list = byAttachment.get(attachmentId);
    if (list === void 0) {
      list = [];
      byAttachment.set(attachmentId, list);
    }
    list.push({
      sessionId: memory.sessionId,
      question: memory.question,
      summary: memory.summary,
      at: memory.at,
    });
  }
  for (const list of byAttachment.values()) {
    list.sort((a, b) => {
      const atA = typeof a.at === "number" ? a.at : Number(a.at) || 0;
      const atB = typeof b.at === "number" ? b.at : Number(b.at) || 0;
      return atB - atA;
    });
    list.length = Math.min(list.length, 20);
  }
  return byAttachment;
}

/** Media type for an object file name, if it carries a known extension. */
function mediaTypeForFileName(fileName) {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return void 0;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return EXTENSION_MEDIA_TYPES[ext];
}

/** Does one entry match the free-text query? */
function entryMatchesQuery(entry, query) {
  const needle = String(query).toLowerCase();
  if (entry.attachmentId.toLowerCase().includes(needle)) return true;
  if (entry.hash.toLowerCase().includes(needle)) return true;
  if (entry.fileName !== void 0 && String(entry.fileName).toLowerCase().includes(needle)) return true;
  for (const owner of entry.ownerSessions) {
    if (String(owner).toLowerCase().includes(needle)) return true;
  }
  for (const memory of entry.memories) {
    if (
      String(memory.question ?? "")
        .toLowerCase()
        .includes(needle)
    )
      return true;
    if (
      String(memory.summary ?? "")
        .toLowerCase()
        .includes(needle)
    )
      return true;
  }
  return false;
}

/** Assemble every image library entry from disk/scan state. */
async function buildImageLibraryEntries(service) {
  const home = homePath();
  const [ownershipMap, liveIds, archivedIds, memoryEntries, retainedSet, scanned] = await Promise.all([
    loadSessionImages().catch(() => new Map()),
    liveSessionIds(service),
    loadArchivedSessionIds().catch(() => new Set()),
    readImageMemoryEntries(),
    loadRetained(),
    home === void 0 ? [] : scanObjectFiles(home + "/attachments/v1/objects"),
  ]);
  // Archived sessions are hidden from UI surfaces but their logs still appear
  // in persistence listings. For image-library readability/classification we
  // treat them as non-live; ownership cleanup still uses `liveSessionIds`
  // directly and therefore keeps archived sessions' images intact.
  const visibleIds = new Set([...liveIds].filter((id) => !archivedIds.has(id)));

  const ownersByAttachment = buildOwnersByAttachment(ownershipMap);
  const memoriesByAttachment = buildMemoriesByAttachment(memoryEntries);

  // One entry per hash; base object and extension hardlink share the identity.
  const byHash = new Map();
  for (const file of scanned) {
    const match = typeof file.fileName === "string" ? OBJECT_FILE_RE.exec(file.fileName) : null;
    if (match === null) continue;
    const hash = match[1];
    const extension = match[2];
    let draft = byHash.get(hash);
    if (draft === void 0) {
      draft = {
        hash,
        bytes: void 0,
        mtimeMs: void 0,
        fileName: void 0,
        mediaType: void 0,
      };
      byHash.set(hash, draft);
    }
    // Prefer the extension hardlink for display/file-name/media-type purposes.
    // Files are sorted by path, so the first name for a hash is `.../<hash>`
    // (extensionless); later `.ext` entries become the chosen fileName. This
    // makes a scanned `.png` hardlink the canonical display name.
    if (extension !== void 0) {
      draft.fileName = file.fileName;
      draft.mediaType = mediaTypeForFileName(file.fileName);
    } else if (draft.fileName === void 0) {
      draft.fileName = file.fileName;
    }
    if (draft.bytes === void 0) draft.bytes = file.bytes;
    if (draft.mtimeMs === void 0) draft.mtimeMs = file.mtimeMs;
  }

  const entries = [];
  for (const draft of byHash.values()) {
    const hash = draft.hash;
    const attachmentId = "sha256:" + hash;
    const ownerSessions = ownersByAttachment.get(attachmentId) ?? [];
    const ownerLiveSessions = ownerSessions.filter((sessionId) => visibleIds.has(sessionId));
    const ownerArchivedSessions = ownerSessions.filter((sessionId) => archivedIds.has(sessionId));
    const referenceCount = ownerSessions.length;
    const memories = memoriesByAttachment.get(attachmentId) ?? [];
    const archived = referenceCount > 0 && ownerLiveSessions.length === 0 && ownerArchivedSessions.length > 0;
    entries.push({
      kind: "image",
      attachmentId,
      hash,
      ...(draft.mediaType !== void 0 ? { mediaType: draft.mediaType } : {}),
      ...(draft.bytes !== void 0 ? { bytes: draft.bytes } : {}),
      ...(draft.mtimeMs !== void 0 ? { mtimeMs: draft.mtimeMs } : {}),
      ownerSessions,
      ownerLiveSessions,
      ownerArchivedSessions,
      referenceCount,
      shared: referenceCount > 1,
      orphan: referenceCount === 0,
      archived,
      retained: retainedSet.has(attachmentId),
      memories,
      ...(ownerLiveSessions.length > 0 ? { readableBySessionId: ownerLiveSessions[0] } : {}),
      ...(draft.fileName !== void 0 ? { fileName: draft.fileName } : {}),
    });
  }

  entries.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  return entries;
}

/**
 * Collect the full image library snapshot.
 *
 * @param {object} service AUX service with `ctx` sessions/sessionPersistence.
 * @returns {Promise<ImageLibrarySnapshot>}
 */
export async function collectImageLibrary(service) {
  const entries = await buildImageLibraryEntries(service);
  return {
    generatedAt: Date.now(),
    settings: {
      imageRetentionDays: 30,
      imageAutoCleanEnabled: false,
    },
    counts: {
      total: entries.length,
      orphan: entries.filter((entry) => entry.orphan).length,
      archived: entries.filter((entry) => entry.archived).length,
      shared: entries.filter((entry) => entry.shared).length,
      retained: entries.filter((entry) => entry.retained).length,
      withMemory: entries.filter((entry) => entry.memories.length > 0).length,
    },
    entries,
  };
}

/**
 * Collect image library entries with optional filtering/paging.
 *
 * @param {object} service AUX service.
 * @param {object} [opts]
 * @param {'all'|'orphan'|'archived'|'shared'|'retained'|'withMemory'} [opts.filter]
 * @param {string} [opts.query]
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 * @param {string} [opts.sessionId]
 * @param {ImageLibraryEntry[]} [prebuiltEntries] Optional already-built
 *   entries (e.g. from collectImageLibrary) to avoid a second full scan.
 * @returns {Promise<ImageLibraryEntry[]>}
 */
export async function collectImageLibraryEntries(service, opts = {}, prebuiltEntries) {
  const options = opts || {};
  let result = Array.isArray(prebuiltEntries) ? prebuiltEntries : await buildImageLibraryEntries(service);

  if (options.sessionId !== void 0 && options.sessionId !== null && options.sessionId !== "") {
    const sessionId = String(options.sessionId);
    result = result.filter((entry) => entry.ownerSessions.includes(sessionId));
  }

  switch (options.filter) {
    case "orphan":
      result = result.filter((entry) => entry.orphan);
      break;
    case "archived":
      result = result.filter((entry) => entry.archived);
      break;
    case "shared":
      result = result.filter((entry) => entry.shared);
      break;
    case "retained":
      result = result.filter((entry) => entry.retained);
      break;
    case "withMemory":
      result = result.filter((entry) => entry.memories.length > 0);
      break;
    case "all":
    case void 0:
    case null:
      break;
    default:
      // Unknown filters degrade to "all"; the public contract only lists known ones.
      break;
  }

  if (options.query !== void 0 && options.query !== null && String(options.query) !== "") {
    const query = String(options.query);
    result = result.filter((entry) => entryMatchesQuery(entry, query));
  }

  const offset = Number(options.offset) > 0 ? Math.floor(Number(options.offset)) : 0;
  if (options.limit !== void 0 && options.limit !== null) {
    const limit = Number(options.limit);
    if (!Number.isFinite(limit) || limit <= 0) return [];
    return result.slice(offset, offset + Math.floor(limit));
  }
  return result.slice(offset);
}
