/**
 * Command-level tests for `/aux images` and `/aux image ...`.
 *
 * Uses the same isolated-DSH_HOME fixture pattern as the server modules.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createImageFixture } from "./helpers/image-fixture.js";
import { handleImagesCommand, handleImageCommand } from "../dsh-aux/src/commands.js";

function makeHash(seed) {
  const raw = seed
    .replace(/[^a-f0-9]/gi, "0")
    .slice(0, 64)
    .padEnd(64, "0");
  return raw.toLowerCase();
}

function attachmentIdFor(seed) {
  return "sha256:" + makeHash(seed);
}

/** Minimal service matching ownership/commands expectations. */
function makeService() {
  return {
    _sessionImages: new Map(),
    _sessionImagesLoaded: false,
    _sessionImagesDirty: false,
    _sessionImagesWriteQueue: Promise.resolve(),
    ctx: {
      get(name) {
        if (name === "sessions") return { list: () => [] };
        if (name === "sessionPersistence") return { listSnapshots: async () => [] };
        return void 0;
      },
    },
  };
}

test("/aux images --json: returns snapshot JSON", async () => {
  const fixture = await createImageFixture();
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  try {
    const id = attachmentIdFor("cmd-list");
    await fixture.writeObject(id, { mediaType: "image/png", bytes: 8 });
    await fixture.writeSessionImages({ "sess-1": [id] });
    await fixture.writeMemory([{ sessionId: "sess-1", attachmentId: id, question: "颜色?", summary: "红色", at: 1 }]);

    const service = makeService();
    const result = await handleImagesCommand(service, ["--json"]);
    assert.equal(result.kind, "success");
    const data = JSON.parse(result.text);
    assert.equal(data.counts.total, 1);
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0].attachmentId, id);
    assert.equal(data.entries[0].ownerSessions[0], "sess-1");
    assert.equal(data.entries[0].memories.length, 1);
  } finally {
    process.env.DSH_HOME = prev;
    await fixture.cleanup();
  }
});

test("/aux images --query finds memory content", async () => {
  const fixture = await createImageFixture();
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  try {
    const id = attachmentIdFor("cmd-mem");
    await fixture.writeObject(id, { mediaType: "image/jpeg", bytes: 4 });
    await fixture.writeMemory([
      { sessionId: "sess-1", attachmentId: id, question: "柱状图数值?", summary: "最高 42", at: 1 },
    ]);

    const service = makeService();
    const hit = await handleImagesCommand(service, ["--json", "--query", "42"]);
    const miss = await handleImagesCommand(service, ["--json", "--query", "zzz"]);
    const hitData = JSON.parse(hit.text);
    const missData = JSON.parse(miss.text);
    assert.equal(hitData.entries.length, 1);
    assert.equal(missData.entries.length, 0);
  } finally {
    process.env.DSH_HOME = prev;
    await fixture.cleanup();
  }
});

test("/aux image retain/unretain updates retention JSON", async () => {
  const fixture = await createImageFixture();
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  try {
    const id = attachmentIdFor("cmd-retain");
    const service = makeService();

    const retain = await handleImageCommand(service, ["retain", id]);
    assert.equal(retain.kind, "success");
    const snap = await handleImagesCommand(service, ["--json", "--filter", "retained"]);
    const snapData = JSON.parse(snap.text);
    assert.equal(snapData.counts.retained, 0); // no object file exists, so entry absent; retention file still updated

    const unretain = await handleImageCommand(service, ["unretain", id]);
    assert.equal(unretain.kind, "success");
  } finally {
    process.env.DSH_HOME = prev;
    await fixture.cleanup();
  }
});

test("/aux image delete orphan removes file and returns success", async () => {
  const fixture = await createImageFixture();
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  try {
    const id = attachmentIdFor("cmd-del");
    const { file } = await fixture.writeObject(id, { mediaType: "image/png", bytes: 16 });
    const service = makeService();

    const result = await handleImageCommand(service, ["delete", id, "--json"]);
    assert.equal(result.kind, "success");
    const data = JSON.parse(result.text);
    assert.equal(data.ok, true);
    assert.equal(data.deleted, id);
    await assert.rejects(import("node:fs/promises").then((fs) => fs.lstat(file)));
  } finally {
    process.env.DSH_HOME = prev;
    await fixture.cleanup();
  }
});

test("/aux image gc-orphans removes orphan and skips referenced", async () => {
  const fixture = await createImageFixture();
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  try {
    const orphan = attachmentIdFor("cmd-orphan");
    const referenced = attachmentIdFor("cmd-ref");
    await fixture.writeObject(orphan, { mediaType: "image/png", bytes: 8 });
    await fixture.writeObject(referenced, { mediaType: "image/png", bytes: 8 });
    await fixture.writeSessionImages({ "sess-1": [referenced] });

    const service = makeService();
    const result = await handleImageCommand(service, ["gc-orphans", "--json"]);
    assert.equal(result.kind, "success");
    const data = JSON.parse(result.text);
    assert.deepEqual(data.deleted, [orphan]);
    assert.deepEqual(data.skipped, []);
  } finally {
    process.env.DSH_HOME = prev;
    await fixture.cleanup();
  }
});
