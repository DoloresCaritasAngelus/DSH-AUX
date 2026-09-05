/**
 * dsh-aux image retention persistence: the set of image attachments that are
 * explicitly retained and therefore exempt from automatic cleanup.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/retention
 */
import { readFile as readFileText, rename as renameFile, writeFile as writeFileText } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/**
 * Path to the image retention file.
 *
 * @returns the retention file path under DSH_HOME, or undefined when neither
 * DSH_HOME nor a home directory is available.
 */
export function imageRetentionPath() {
  const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
  return home === void 0 ? void 0 : home + "/attachments/v1/image-retention.json";
}

/** Serialize all read-modify-write retention operations so concurrent sets do not lose entries. */
let retentionWriteQueue = Promise.resolve();

/**
 * Run one retention mutation after all earlier mutations have settled. The
 * returned promise follows the task; the internal queue swallows task errors
 * so one failed operation cannot block later ones.
 */
function enqueueRetentionWrite(task) {
  const result = retentionWriteQueue.then(task);
  retentionWriteQueue = result.then(
    () => void 0,
    () => void 0,
  );
  return result;
}

/**
 * Move a corrupt retention file aside so the evidence is preserved instead of
 * being silently overwritten. Best-effort: quarantine is a diagnostic nicety,
 * never fatal.
 */
async function quarantineRetentionFile(path) {
  try {
    await renameFile(path, path + ".corrupt-" + Date.now() + "-" + randomUUID());
  } catch {
    /* best-effort */
  }
}

/**
 * Load the retained attachment ids from disk.
 *
 * An absent file, or a file that cannot be parsed as a retention object, is
 * treated as an empty set. Unreadable JSON is quarantined as `.corrupt-*`
 * before the empty set is returned.
 *
 * @returns {Promise<Set<string>>} the retained attachment ids.
 */
export async function loadRetained() {
  const path = imageRetentionPath();
  if (path === void 0) return new Set();

  let raw;
  try {
    raw = await readFileText(path);
  } catch (error) {
    if (error?.code === "ENOENT") return new Set();
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await quarantineRetentionFile(path);
    return new Set();
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    await quarantineRetentionFile(path);
    return new Set();
  }

  const retained = parsed.retained;
  return new Set(Array.isArray(retained) ? retained : []);
}

/** Atomically write one retention file. Callers must already be on the queue. */
async function writeRetainedFile(path, retained) {
  try {
    const tmp = path + ".tmp";
    const payload = JSON.stringify({ version: 1, retained: [...retained] });
    await writeFileText(tmp, payload);
    await renameFile(tmp, path);
  } catch {
    /* best-effort: retention persistence must never throw */
  }
}

/**
 * Persist the retained attachment ids atomically (tmp + rename). Missing
 * DSH_HOME is a no-op; filesystem failures are best-effort so retention
 * bookkeeping never breaks a vision or image command.
 *
 * @param {Set<string>} retained the attachment ids to persist.
 * @returns {Promise<void>}
 */
export async function saveRetained(retained) {
  const path = imageRetentionPath();
  if (path === void 0) return;
  return enqueueRetentionWrite(() => writeRetainedFile(path, retained));
}

/**
 * Add or remove one attachment id from the retained set and persist the
 * result. All mutations run through one queue so concurrent `setRetained`
 * calls do not lose updates.
 *
 * When DSH_HOME is unavailable the call is a no-op and returns
 * `{ retained: false }` because nothing can be retained in memory or on disk.
 *
 * @param {string} attachmentId the attachment id to retain or unretain.
 * @param {boolean} retained true to retain, false to unretain.
 * @returns {Promise<{ retained: boolean }>} whether the id is retained after
 * the operation.
 */
export async function setRetained(attachmentId, retained) {
  const path = imageRetentionPath();
  if (path === void 0) return { retained: false };

  return enqueueRetentionWrite(async () => {
    const ids = await loadRetained();
    if (retained) ids.add(attachmentId);
    else ids.delete(attachmentId);
    await writeRetainedFile(path, ids);
    return { retained: ids.has(attachmentId) };
  });
}
