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
  return session !== null && session !== void 0 &&
    typeof session.snapshotEvents === "function";
}
