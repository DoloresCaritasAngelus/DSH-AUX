/**
 * image-library.js tests (node:test, zero dependencies beyond node builtins).
 *
 * Runs against isolated temporary DSH_HOME trees created by the image fixture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createImageFixture } from './helpers/image-fixture.js';
import {
  collectImageLibrary,
  collectImageLibraryEntries
} from '../dsh-aux/src/images/image-library.js';

/** Minimal service satisfying ownership.js `liveSessionIds`. */
function makeService({ sessions = [], snapshots = [] } = {}) {
  const store = new Map([
    ['sessions', { list: () => sessions }],
    ['sessionPersistence', { listSnapshots: async () => snapshots }]
  ]);
  return {
    ctx: {
      get(key) {
        return store.get(key);
      }
    }
  };
}

function idOf(prefix, fill) {
  const hex = prefix + String(fill).repeat(64 - prefix.length);
  return 'sha256:' + hex;
}

const imageA = idOf('ab', 'a');
const imageB = idOf('cd', 'b');
const imageC = idOf('ef', 'c');
const imageD = idOf('01', 'd');

/**
 * Run `fn` inside a fresh fixture with process.env.DSH_HOME pointed at it.
 * The original DSH_HOME value is restored afterwards.
 */
async function withFixture(fn) {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  try {
    return await fn(fixture);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
}

test('collectImageLibrary: empty fixture -> counts total 0', async () => {
  await withFixture(async (fixture) => {
    const service = makeService();
    const snapshot = await collectImageLibrary(service);
    assert.equal(snapshot.generatedAt > 0, true);
    assert.deepEqual(snapshot.settings, {
      imageRetentionDays: 30,
      imageAutoCleanEnabled: false
    });
    assert.deepEqual(snapshot.counts, {
      total: 0,
      orphan: 0,
      archived: 0,
      shared: 0,
      retained: 0,
      withMemory: 0
    });
    assert.deepEqual(snapshot.entries, []);
  });
});

test('collectImageLibrary: one image with one owner session -> entry fields correct', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA, { mediaType: 'image/png', bytes: 12 });
    await fixture.writeSessionImages({ 'sess-1': [imageA] });
    const service = makeService({ sessions: [{ id: 'sess-1' }] });

    const snapshot = await collectImageLibrary(service);
    assert.equal(snapshot.counts.total, 1);
    const entry = snapshot.entries[0];
    assert.equal(entry.kind, 'image');
    assert.equal(entry.attachmentId, imageA);
    assert.equal(entry.hash, imageA.slice('sha256:'.length));
    assert.equal(entry.mediaType, 'image/png');
    assert.equal(entry.fileName, entry.hash + '.png');
    assert.equal(entry.bytes, 12);
    assert.equal(typeof entry.mtimeMs, 'number');
    assert.deepEqual(entry.ownerSessions, ['sess-1']);
    assert.deepEqual(entry.ownerLiveSessions, ['sess-1']);
    assert.equal(entry.referenceCount, 1);
    assert.equal(entry.shared, false);
    assert.equal(entry.orphan, false);
    assert.equal(entry.retained, false);
    assert.deepEqual(entry.memories, []);
    assert.equal(entry.readableBySessionId, 'sess-1');
  });
});

test('collectImageLibrary: image referenced by two sessions -> shared true, referenceCount 2', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA, { mediaType: 'image/jpeg' });
    await fixture.writeSessionImages({
      'sess-1': [imageA],
      'sess-2': [imageA]
    });
    const service = makeService({
      sessions: [{ id: 'sess-1' }, { id: 'sess-2' }],
      snapshots: []
    });

    const snapshot = await collectImageLibrary(service);
    const entry = snapshot.entries[0];
    assert.deepEqual(entry.ownerSessions, ['sess-1', 'sess-2']);
    assert.deepEqual(entry.ownerLiveSessions, ['sess-1', 'sess-2']);
    assert.equal(entry.referenceCount, 2);
    assert.equal(entry.shared, true);
    assert.equal(entry.orphan, false);
    assert.equal(entry.readableBySessionId, 'sess-1');
  });
});

test('collectImageLibrary: object file with no ownership -> orphan true', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA, { mediaType: 'image/webp' });
    const snapshot = await collectImageLibrary(makeService());
    const entry = snapshot.entries[0];
    assert.equal(entry.orphan, true);
    assert.equal(entry.shared, false);
    assert.deepEqual(entry.ownerSessions, []);
    assert.deepEqual(entry.ownerLiveSessions, []);
    assert.equal(entry.referenceCount, 0);
    assert.equal(entry.readableBySessionId, undefined);
    assert.equal(snapshot.counts.orphan, 1);
  });
});

test('collectImageLibrary: retained set file -> retained true', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA);
    await fixture.writeRetention([imageA]);
    const snapshot = await collectImageLibrary(makeService());
    const entry = snapshot.entries[0];
    assert.equal(entry.retained, true);
    assert.equal(snapshot.counts.retained, 1);
  });
});

test('collectImageLibrary: image-memory entries aggregated, recent 20 sorted by at desc', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA);
    const memories = [];
    const base = Date.now();
    for (let i = 0; i < 25; i += 1) {
      memories.push({
        sessionId: 'sess-mem',
        attachmentId: imageA,
        question: 'q-' + i,
        summary: 's-' + i,
        at: base + i
      });
    }
    await fixture.writeMemory(memories);

    const snapshot = await collectImageLibrary(makeService());
    const entry = snapshot.entries[0];
    assert.equal(entry.memories.length, 20);
    assert.deepEqual(
      entry.memories.map((m) => m.at),
      [...entry.memories.map((m) => m.at)].sort((a, b) => b - a),
      'memories should be sorted newest first'
    );
    assert.equal(entry.memories[0].question, 'q-24');
    assert.equal(entry.memories[19].question, 'q-5');
    assert.equal(snapshot.counts.withMemory, 1);
  });
});

test('collectImageLibraryEntries: search by question/summary finds entry', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA);
    await fixture.writeObject(imageB);
    await fixture.writeMemory([
      {
        sessionId: 'sess-1',
        attachmentId: imageA,
        question: 'What color is the sky?',
        summary: 'The sky appears cyan in this screenshot.',
        at: 1000
      }
    ]);
    await fixture.writeSessionImages({ 'sess-1': [imageA, imageB] });

    const byQuestion = await collectImageLibraryEntries(makeService(), {
      query: 'sky'
    });
    assert.deepEqual(byQuestion.map((e) => e.attachmentId), [imageA]);

    const bySummary = await collectImageLibraryEntries(makeService(), {
      query: 'screenshot'
    });
    assert.deepEqual(bySummary.map((e) => e.attachmentId), [imageA]);

    const byHash = await collectImageLibraryEntries(makeService(), {
      query: imageA.slice('sha256:'.length)
    });
    assert.deepEqual(byHash.map((e) => e.attachmentId), [imageA]);
  });
});

test('collectImageLibrary: archived-only owner -> archived true, not orphan, no readable session', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA, { mediaType: 'image/png', bytes: 12 });
    await fixture.writeSessionImages({ 'sess-archived': [imageA] });
    // The session is still present in persistence snapshots, but workspace marks it archived.
    await fixture.writeWorkspace({ archivedSessionIds: ['sess-archived'] });
    const service = makeService({
      sessions: [],
      snapshots: [{ header: { id: 'sess-archived' } }]
    });

    const snapshot = await collectImageLibrary(service);
    const entry = snapshot.entries[0];
    assert.equal(entry.orphan, false);
    assert.equal(entry.archived, true);
    assert.deepEqual(entry.ownerSessions, ['sess-archived']);
    assert.deepEqual(entry.ownerLiveSessions, []);
    assert.deepEqual(entry.ownerArchivedSessions, ['sess-archived']);
    assert.equal(entry.readableBySessionId, undefined);
    assert.equal(snapshot.counts.archived, 1);
    assert.equal(snapshot.counts.orphan, 0);
  });
});

test('collectImageLibrary: live + archived owner -> readable via live, not archived-only', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA, { mediaType: 'image/jpeg' });
    await fixture.writeSessionImages({
      'sess-live': [imageA],
      'sess-archived': [imageA]
    });
    await fixture.writeWorkspace({ archivedSessionIds: ['sess-archived'] });
    const service = makeService({
      sessions: [{ id: 'sess-live' }],
      snapshots: [{ header: { id: 'sess-archived' } }]
    });

    const snapshot = await collectImageLibrary(service);
    const entry = snapshot.entries[0];
    assert.equal(entry.orphan, false);
    assert.equal(entry.archived, false);
    assert.deepEqual(entry.ownerLiveSessions, ['sess-live']);
    assert.deepEqual(entry.ownerArchivedSessions, ['sess-archived']);
    assert.equal(entry.readableBySessionId, 'sess-live');
    assert.equal(snapshot.counts.archived, 0);
  });
});

test('collectImageLibraryEntries: filter archived works', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA); // archived-only
    await fixture.writeObject(imageB); // live
    await fixture.writeSessionImages({
      'sess-archived': [imageA],
      'sess-live': [imageB]
    });
    await fixture.writeWorkspace({ archivedSessionIds: ['sess-archived'] });
    const service = makeService({
      sessions: [{ id: 'sess-live' }],
      snapshots: [{ header: { id: 'sess-archived' } }]
    });

    const archived = await collectImageLibraryEntries(service, { filter: 'archived' });
    assert.deepEqual(archived.map((e) => e.attachmentId), [imageA]);
  });
});

test('collectImageLibraryEntries: filter orphan/shared/retained/withMemory works', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA); // orphan + retained + memory
    await fixture.writeObject(imageB); // shared
    await fixture.writeObject(imageC); // orphan + retained
    await fixture.writeObject(imageD); // orphan
    await fixture.writeSessionImages({
      'sess-1': [imageB],
      'sess-2': [imageB]
    });
    await fixture.writeMemory([
      {
        sessionId: 'sess-mem',
        attachmentId: imageA,
        question: 'what is this',
        summary: 'a red circle',
        at: 10
      }
    ]);
    await fixture.writeRetention([imageA, imageC]);

    const all = await collectImageLibraryEntries(makeService());
    assert.equal(all.length, 4);

    const orphan = await collectImageLibraryEntries(makeService(), { filter: 'orphan' });
    assert.deepEqual(orphan.map((e) => e.attachmentId).sort(), [imageA, imageC, imageD].sort());

    const shared = await collectImageLibraryEntries(makeService(), { filter: 'shared' });
    assert.deepEqual(shared.map((e) => e.attachmentId), [imageB]);

    const retained = await collectImageLibraryEntries(makeService(), { filter: 'retained' });
    assert.deepEqual(retained.map((e) => e.attachmentId).sort(), [imageA, imageC].sort());

    const withMemory = await collectImageLibraryEntries(makeService(), { filter: 'withMemory' });
    assert.deepEqual(withMemory.map((e) => e.attachmentId), [imageA]);
  });
});

test('collectImageLibraryEntries: sessionId/limit/offset paging', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA);
    await fixture.writeObject(imageB);
    await fixture.writeObject(imageC);
    await fixture.writeSessionImages({
      'sess-1': [imageA, imageB],
      'sess-2': [imageC]
    });

    const forSession = await collectImageLibraryEntries(makeService(), {
      sessionId: 'sess-1'
    });
    assert.deepEqual(forSession.map((e) => e.attachmentId).sort(), [imageA, imageB].sort());

    const page = await collectImageLibraryEntries(makeService(), {
      limit: 2,
      offset: 1
    });
    assert.equal(page.length, 2);
    assert.equal(page[0].attachmentId === page[1].attachmentId, false);
  });
});

test('scanObjectFiles/collect: symbolic links inside objects are ignored', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA, { mediaType: 'image/png' });
    const hashB = imageB.slice('sha256:'.length);
    const bucketB = join(fixture.objectsRoot, hashB.slice(0, 2));
    const outsideDir = join(fixture.home, 'outside');
    const outsideFile = join(outsideDir, 'outside.png');
    await mkdir(outsideDir, { recursive: true });
    await writeFile(outsideFile, 'precious');

    // Symlinked bucket dir must not be scanned.
    await mkdir(join(fixture.objectsRoot, 'symlinked-bucket-dir'), { recursive: true });
    await symlink(outsideDir, join(fixture.objectsRoot, 'evil-bucket'), 'dir');
    // Symlinked file inside a real bucket must be ignored too.
    await mkdir(bucketB, { recursive: true });
    await symlink(outsideFile, join(bucketB, hashB + '.png'), 'file');

    const snapshot = await collectImageLibrary(makeService());
    assert.deepEqual(snapshot.entries.map((e) => e.attachmentId), [imageA]);
    assert.equal(snapshot.counts.total, 1);
  });
});

test('missing session-images.json / image-memory.json / retention file does not throw', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA);
    // Intentionally do NOT write session-images.json, image-memory.json or
    // image-retention.json.
    const snapshot = await collectImageLibrary(makeService());
    assert.equal(snapshot.counts.total, 1);
    const entry = snapshot.entries[0];
    assert.equal(entry.orphan, true);
    assert.equal(entry.retained, false);
    assert.deepEqual(entry.memories, []);
    assert.equal(snapshot.counts.orphan, 1);
    assert.equal(snapshot.counts.retained, 0);
    assert.equal(snapshot.counts.withMemory, 0);
  });
});

test('契约: collectImageLibrary 快照 JSON 结构完整(客户端依赖字段)', async () => {
  await withFixture(async (fixture) => {
    await fixture.writeObject(imageA, { mediaType: 'image/png', bytes: 32 });
    await fixture.writeObject(imageB, { mediaType: 'image/jpeg', bytes: 16 });
    await fixture.writeSessionImages({
      'sess-1': [imageA],
      'sess-2': [imageB]
    });
    await fixture.writeMemory([
      {
        sessionId: 'sess-1',
        attachmentId: imageA,
        question: 'q',
        summary: 's',
        at: 10
      }
    ]);
    await fixture.writeWorkspace({ archivedSessionIds: [] });

    const service = makeService({
      sessions: [{ id: 'sess-1' }, { id: 'sess-2' }],
      snapshots: []
    });
    const snapshot = await collectImageLibrary(service);

    // Snapshot envelope fields used by the client/commands.
    assert.equal(typeof snapshot.generatedAt, 'number');
    assert.deepEqual(Object.keys(snapshot.settings).sort(), ['imageAutoCleanEnabled', 'imageRetentionDays']);
    assert.deepEqual(Object.keys(snapshot.counts).sort(), [
      'archived',
      'orphan',
      'retained',
      'shared',
      'total',
      'withMemory'
    ]);
    assert.ok(Array.isArray(snapshot.entries));

    // Every entry carries the client-facing fields.
    for (const entry of snapshot.entries) {
      for (const key of [
        'kind',
        'attachmentId',
        'hash',
        'ownerSessions',
        'ownerLiveSessions',
        'referenceCount',
        'shared',
        'orphan',
        'archived',
        'retained',
        'memories'
      ]) {
        assert.ok(key in entry, `entry should contain ${key}`);
      }
      assert.equal(typeof entry.attachmentId, 'string');
      assert.equal(typeof entry.hash, 'string');
      assert.ok(Array.isArray(entry.ownerSessions));
      assert.ok(Array.isArray(entry.ownerLiveSessions));
      assert.ok(Array.isArray(entry.memories));
      assert.equal(typeof entry.referenceCount, 'number');
      assert.equal(typeof entry.orphan, 'boolean');
      assert.equal(typeof entry.archived, 'boolean');
      assert.equal(typeof entry.retained, 'boolean');
    }
  });
});
