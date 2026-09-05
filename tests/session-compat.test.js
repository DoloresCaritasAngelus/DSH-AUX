/**
 * Session API compatibility tests: DSH 0.1.2-alpha.2/alpha.3 expose
 * `session.events`; DSH 0.1.2-alpha.4+ expose `session.snapshotEvents()` and
 * no longer expose `.events`. These tests lock the AUX read paths to both
 * Session shapes.
 *
 * Run: node --test tests/session-compat.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sessionEvents, hasSnapshotEvents } from "../dsh-aux/src/session-utils.js";
import { isAuxGuidePromoted } from "../dsh-aux/src/bootstrap.js";
import { handleDebugCommand, handleHistoryCommand, recentCalls } from "../dsh-aux/src/commands.js";
import { AUX_CALL_EVENT, AUX_DEBUG_EVENT } from "../dsh-aux/src/config.js";

function oldSession(events = []) {
  return { id: "old-session", events };
}

function newSession(events = []) {
  const log = [...events];
  return {
    id: "new-session",
    snapshotEvents() {
      return Object.freeze([...log]);
    },
  };
}

test("sessionEvents: old API uses session.events", () => {
  const events = [{ type: "turn/start" }];
  const session = oldSession(events);
  assert.equal(hasSnapshotEvents(session), false);
  assert.equal(sessionEvents(session), events);
});

test("sessionEvents: new API uses snapshotEvents and ignores missing .events", () => {
  const events = [{ type: "turn/start" }];
  const session = newSession(events);
  assert.equal(hasSnapshotEvents(session), true);
  assert.equal("events" in session, false);
  const result = sessionEvents(session);
  assert.deepEqual(result, events);
  assert.equal(Object.isFrozen(result), true);
});

test("sessionEvents: absent/empty Session returns empty array", () => {
  assert.deepEqual(sessionEvents(void 0), []);
  assert.deepEqual(sessionEvents(null), []);
  assert.deepEqual(sessionEvents({}), []);
});

test("isAuxGuidePromoted: old Session with tool/call", () => {
  assert.equal(isAuxGuidePromoted({ session: oldSession() }), false);
  assert.equal(isAuxGuidePromoted({ session: oldSession([{ type: "tool/call" }]) }), true);
});

test("isAuxGuidePromoted: new Session with only snapshotEvents", () => {
  assert.equal(isAuxGuidePromoted({ session: newSession() }), false);
  assert.equal(isAuxGuidePromoted({ session: newSession([{ type: "tool/call" }]) }), true);
  assert.equal(isAuxGuidePromoted({ session: newSession([{ type: "user/message" }]) }), false);
});

test("recentCalls: old and new Session both fold latest aux call per task", () => {
  const auxEvents = [
    { type: AUX_CALL_EVENT, data: { task: "vision", ok: true } },
    { type: AUX_CALL_EVENT, data: { task: "compress", ok: false } },
  ];
  const oldRecent = recentCalls({ session: oldSession(auxEvents) });
  assert.deepEqual(
    oldRecent,
    auxEvents.map((e) => e.data),
  );

  const newRecent = recentCalls({ session: newSession(auxEvents) });
  assert.deepEqual(
    newRecent,
    auxEvents.map((e) => e.data),
  );
});

test("handleHistoryCommand: new Session reads snapshot events", () => {
  const events = [
    { type: AUX_CALL_EVENT, data: { task: "vision", provider: "p", model: "m", ok: true, durationMs: 10 } },
  ];
  const agent = { session: newSession(events) };
  const result = handleHistoryCommand({}, agent, []);
  assert.equal(result.kind, "success");
  assert.match(result.text, /最近 1 次/);
  assert.match(result.text, /vision/);
});

test("handleDebugCommand: new Session reads snapshot debug events", async () => {
  const events = [{ type: AUX_DEBUG_EVENT, data: { kind: "call", task: "vision", ok: true } }];
  const agent = { session: newSession(events) };
  const service = {
    ctx: { get: () => void 0 },
    debugConfig: {},
  };
  const result = await handleDebugCommand(service, agent, []);
  assert.equal(result.kind, "success");
  assert.match(result.text, /AUX debug/);
  assert.match(result.text, /vision/);
});

test("resolveImageRef: new API snapshotEvents still finds attachmentId in session", async () => {
  const { resolveImageRef } = await import("../dsh-aux/src/images/resolve.js");
  const attachments = {
    readImage: async (attachment) => ({ ref: { attachmentId: attachment.attachmentId } }),
  };
  const service = {
    _imageCtx: void 0,
    ctx: { get: (key) => (key === "attachments" ? attachments : void 0) },
  };
  const session = newSession([
    {
      type: "user/message",
      data: {
        message: {
          content: [{ type: "image", attachment: { attachmentId: "sha256:abc" } }],
        },
      },
    },
  ]);
  const exec = { agent: { session }, signal: void 0 };
  const ref = await resolveImageRef(service, { attachmentId: "sha256:abc" }, exec);
  assert.deepEqual(ref, { attachmentId: "sha256:abc" });
});
