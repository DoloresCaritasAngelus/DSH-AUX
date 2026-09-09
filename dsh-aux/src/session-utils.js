/**
 * dsh-aux Session compatibility helpers.
 *
 * DSH 0.1.2-alpha.2/alpha.3 expose the live Session event log through the
 * `session.events` getter. DSH 0.1.2-alpha.4+ replace that getter with
 * `session.snapshotEvents()` / `session.eventAt()` while keeping persistence
 * inspection `.events`. These helpers let AUX read the live event log on both
 * API generations.
 *
 * @module @dolorescaritasangelus/dsh-aux/session-utils
 */

/**
 * Return a live Session's complete event log on both old and new DSH APIs.
 *
 * - New API (0.1.2-alpha.4+): `session.snapshotEvents()` returns a frozen
 *   array of the complete log.
 * - Old API (0.1.2-alpha.2/alpha.3): `session.events` returns a frozen array.
 *
 * @param {object|null|undefined} session The live Session, when present.
 * @returns {ReadonlyArray<object>} The complete event log, or an empty array.
 */
export function sessionEvents(session) {
  if (session === null || session === void 0) return [];
  if (typeof session.snapshotEvents === "function") {
    const events = session.snapshotEvents();
    return Array.isArray(events) ? events : [];
  }
  return Array.isArray(session.events) ? session.events : [];
}

/**
 * Return whether a live Session exposes the new snapshot API.
 * Useful for tests and for callers that need to distinguish old/new shapes.
 *
 * @param {object|null|undefined} session The live Session, when present.
 * @returns {boolean} True when `snapshotEvents()` is available.
 */
export function hasSnapshotEvents(session) {
  return session !== null && session !== void 0 && typeof session.snapshotEvents === "function";
}
/**
 * List stored sessions on both persistence generations.
 *
 * - New API (0.1.5+): `persistence.list({ signal })` returns snapshots whose
 *   metadata lives under `header`.
 * - Old API (<= 0.1.2): `persistence.listSnapshots()`.
 *
 * Enumeration is best-effort by default: a missing service, a missing method,
 * or a failing call degrades to an empty list instead of throwing. Callers
 * that must distinguish "no stored sessions" from "could not read storage"
 * (the fail-closed delete gate) pass `{ strict: true }` and get the error.
 *
 * @param {object|null|undefined} persistence The sessionPersistence service.
 * @param {AbortSignal|undefined} signal Optional cancellation.
 * @param {{ strict?: boolean }} [options] Throw instead of degrading to [].
 * @returns {Promise<ReadonlyArray<object>>} Stored-session snapshots.
 */
export async function listSessionSnapshots(persistence, signal, { strict = false } = {}) {
  if (persistence === null || persistence === void 0) {
    if (strict) throw new Error("sessionPersistence is unavailable");
    return [];
  }
  const options = signal === void 0 ? void 0 : { signal };
  try {
    if (typeof persistence.list === "function") {
      const snapshots = await persistence.list(options);
      return Array.isArray(snapshots) ? snapshots : [];
    }
    if (typeof persistence.listSnapshots === "function") {
      const snapshots = await persistence.listSnapshots();
      return Array.isArray(snapshots) ? snapshots : [];
    }
  } catch (error) {
    if (strict) throw error;
    return [];
  }
  if (strict) throw new Error("sessionPersistence exposes no list API");
  return [];
}

/**
 * Read one stored session's complete event log on both persistence
 * generations, always releasing the storage handle.
 *
 * - New API (0.1.5+): `open(id, 'read', { signal })` -> `handle.read(0)` ->
 *   `handle.close()` (the one teardown; `Symbol.asyncDispose` delegates to it).
 * - Old API (<= 0.1.2): `persistence.inspect(id).events`.
 *
 * @param {object|null|undefined} persistence The sessionPersistence service.
 * @param {string} sessionId Stored session id.
 * @param {AbortSignal|undefined} signal Optional cancellation.
 * @returns {Promise<ReadonlyArray<object>|undefined>} Events, or undefined when
 *   the log is unreadable — callers treat undefined as fail-closed.
 */
export async function readSessionEvents(persistence, sessionId, signal) {
  if (persistence === null || persistence === void 0) return void 0;
  const options = signal === void 0 ? void 0 : { signal };
  try {
    if (typeof persistence.open === "function") {
      const handle = await persistence.open(sessionId, "read", options);
      try {
        const result = await handle.read(0, void 0, options);
        return Array.isArray(result?.events) ? result.events : [];
      } finally {
        try {
          if (typeof handle.close === "function") await handle.close();
          else if (typeof handle[Symbol.asyncDispose] === "function") await handle[Symbol.asyncDispose]();
        } catch {
          /* teardown is best-effort; the read result stands */
        }
      }
    }
    if (typeof persistence.inspect === "function") {
      const inspection = await persistence.inspect(sessionId);
      return Array.isArray(inspection?.events) ? inspection.events : void 0;
    }
  } catch {
    return void 0;
  }
  return void 0;
}
