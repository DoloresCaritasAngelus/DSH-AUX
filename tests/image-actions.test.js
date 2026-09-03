/**
 * image-actions tests: deleteImage / deleteOrphans / removeFromOwnership.
 *
 * Run: cd <仓库路径> && node --test tests/image-actions.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { createImageFixture, hashOf } from './helpers/image-fixture.js';
import {
  deleteImage,
  deleteOrphans,
  removeFromOwnership
} from '../dsh-aux/src/images/image-actions.js';

/** A valid-looking 64-char hex hash (real files use this exact shape). */
function makeHash(seed) {
  const raw = seed.replace(/[^a-f0-9]/gi, '0').slice(0, 64).padEnd(64, '0');
  return raw.toLowerCase();
}

function attachmentIdFor(seed) {
  return 'sha256:' + makeHash(seed);
}

/**
 * Minimal service matching ownership's service surface. `sessions.list` and
 * `sessionPersistence.listSnapshots` are intentionally empty; ownership
 * decisions for these tests are driven by the session-images map/disk data.
 */
function makeService() {
  return {
    _sessionImages: new Map(),
    _sessionImagesLoaded: false,
    _sessionImagesDirty: false,
    _sessionImagesWriteQueue: Promise.resolve(),
    ctx: {
      get(name) {
        if (name === 'sessions') return { list: () => [] };
        if (name === 'sessionPersistence') return { listSnapshots: async () => [] };
        return void 0;
      }
    }
  };
}

/** Assert a file is absent; also assert no symlink/other entry remains. */
async function assertMissing(path) {
  await assert.rejects(fsPromises.lstat(path), (error) => {
    assert.equal(error?.code, 'ENOENT');
    return true;
  });
}

test('deleteImage: orphan object removes base file and extension hardlink, returns deleted/freedBytes', async (t) => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const id = attachmentIdFor('orphan');
    const { file, extPath } = await fixture.writeObject(id, { mediaType: 'image/png', bytes: 16 });
    assert.notEqual(extPath, void 0);

    const result = await deleteImage(service, id);

    assert.deepEqual(result, { ok: true, deleted: id, freedBytes: 16 });
    await assertMissing(file);
    await assertMissing(extPath);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test('deleteImage: referenced image without force throws REFERENCED', async (t) => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const id = attachmentIdFor('referenced');
    const { file, extPath } = await fixture.writeObject(id, { mediaType: 'image/jpeg', bytes: 8 });
    await fixture.writeSessionImages({ 'session-a': [id] });

    await assert.rejects(
      deleteImage(service, id),
      (error) => {
        assert.equal(error?.code, 'REFERENCED');
        return true;
      }
    );

    // Nothing was removed and ownership is intact.
    await fsPromises.lstat(file);
    await fsPromises.lstat(extPath);
    const map = JSON.parse(await fsPromises.readFile(fixture.sessionImagesPath, 'utf8'));
    assert.deepEqual(map['session-a'], [id]);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test('deleteImage: referenced image with force removes file and ownership reference', async (t) => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const id = attachmentIdFor('forced');
    const { file, extPath } = await fixture.writeObject(id, { mediaType: 'image/png', bytes: 12 });
    await fixture.writeSessionImages({ 'session-a': [id] });

    const result = await deleteImage(service, id, { force: true });

    assert.deepEqual(result, { ok: true, deleted: id, freedBytes: 12 });
    await assertMissing(file);
    await assertMissing(extPath);
    const map = JSON.parse(await fsPromises.readFile(fixture.sessionImagesPath, 'utf8'));
    assert.deepEqual(map['session-a'], []);
    assert.equal(service._sessionImages.get('session-a').has(id), false);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test('deleteOrphans: removes only orphan files; skips retained by default', async (t) => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const orphanId = attachmentIdFor('orphan-gc');
    const retainedId = attachmentIdFor('retained-gc');
    const ownedId = attachmentIdFor('owned-gc');
    const { file: orphanFile } = await fixture.writeObject(orphanId, { mediaType: 'image/gif', bytes: 20 });
    const { file: retainedFile, extPath: retainedExt } = await fixture.writeObject(retainedId, { mediaType: 'image/png', bytes: 24 });
    const { file: ownedFile } = await fixture.writeObject(ownedId, { mediaType: 'image/jpeg', bytes: 28 });
    await fixture.writeSessionImages({ 'session-a': [ownedId] });
    await fixture.writeRetention([retainedId]);

    const result = await deleteOrphans(service);

    assert.equal(result.ok, true);
    assert.deepEqual(result.deleted, [orphanId]);
    assert.deepEqual(result.skipped, [retainedId]);
    assert.equal(result.freedBytes, 20);
    await assertMissing(orphanFile);
    await fsPromises.lstat(retainedFile);
    await fsPromises.lstat(retainedExt);
    await fsPromises.lstat(ownedFile);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test('deleteOrphans: includeRetained removes retained orphan too and clears retention', async (t) => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const orphanId = attachmentIdFor('retained-include');
    const { file, extPath } = await fixture.writeObject(orphanId, { mediaType: 'image/webp', bytes: 32 });
    await fixture.writeRetention([orphanId]);

    const result = await deleteOrphans(service, { includeRetained: true });

    assert.deepEqual(result, { ok: true, deleted: [orphanId], skipped: [], freedBytes: 32 });
    await assertMissing(file);
    await assertMissing(extPath);
    const retained = JSON.parse(await fsPromises.readFile(fixture.imageRetentionPath, 'utf8'));
    assert.deepEqual(retained.retained, []);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test('deleteImage: symbolic link named like an object is not deleted', async (t) => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const hash = makeHash('symlink');
    const id = 'sha256:' + hash;
    const dir = join(fixture.objectsRoot, hash.slice(0, 2));
    await fsPromises.mkdir(dir, { recursive: true });
    const victim = join(fixture.home, 'victim.txt');
    await fsPromises.writeFile(victim, 'precious');
    const linkPath = join(dir, hash);
    await fsPromises.symlink(victim, linkPath);

    await assert.rejects(
      deleteImage(service, id),
      (error) => {
        assert.equal(error?.code, 'NOT_FOUND');
        return true;
      }
    );

    await fsPromises.lstat(linkPath);
    assert.equal(await fsPromises.readFile(victim, 'utf8'), 'precious');

    const orphanResult = await deleteOrphans(service);
    assert.deepEqual(orphanResult.deleted, []);
    assert.deepEqual(orphanResult.skipped, []);
    assert.equal(orphanResult.freedBytes, 0);
    await fsPromises.lstat(linkPath);
    assert.equal(await fsPromises.readFile(victim, 'utf8'), 'precious');
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test('deleteImage: missing file throws NOT_FOUND', async (t) => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const id = attachmentIdFor('missing');
    await assert.rejects(
      deleteImage(service, id),
      (error) => {
        assert.equal(error?.code, 'NOT_FOUND');
        return true;
      }
    );
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test('removeFromOwnership: cleans service._sessionImages map and persists', async (t) => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const a = attachmentIdFor('owner-a');
    const b = attachmentIdFor('owner-b');
    const c = attachmentIdFor('owner-c');
    service._sessionImages.set('s1', new Set([a, b]));
    service._sessionImages.set('s2', new Set([a]));
    await fixture.writeSessionImages({
      's1': [a, b],
      's2': [a],
      's3': [c]
    });

    await removeFromOwnership(service, a);

    assert.equal(service._sessionImages.get('s1').has(a), false);
    assert.equal(service._sessionImages.get('s1').has(b), true);
    assert.equal(service._sessionImages.get('s2').has(a), false);
    // On-disk map is written through ownership's save queue from the in-memory
    // map, so session s3 (loaded from disk) is preserved as well.
    const persisted = JSON.parse(await fsPromises.readFile(fixture.sessionImagesPath, 'utf8'));
    assert.deepEqual(persisted['s1'], [b]);
    assert.deepEqual(persisted['s2'], []);
    assert.deepEqual(persisted['s3'], [c]);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});
