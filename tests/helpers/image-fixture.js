/**
 * Image-library test fixture: create an isolated DSH_HOME attachment tree.
 *
 * The fixture exposes helpers to write object files (with optional extension
 * hardlinks), session-images.json, image-memory.json and image-retention.json.
 * Tests should call `fixture.cleanup()` in `finally`.
 */
import { mkdtemp, mkdir, writeFile, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Hash for an attachmentId, i.e. strip `sha256:` prefix. */
export function hashOf(attachmentId) {
  return String(attachmentId).replace(/^sha256:/, '');
}

/** Object bucket path prefix for a hash. */
export function bucketOf(hash) {
  return hash.slice(0, 2);
}

/** Derive the object path under an objects root for an attachmentId. */
export function objectPath(objectsRoot, attachmentId) {
  const hash = hashOf(attachmentId);
  return join(objectsRoot, bucketOf(hash), hash);
}

/**
 * Create a temporary DSH_HOME with `attachments/v1/objects`.
 * @returns fixture object.
 */
export async function createImageFixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-aux-image-'));
  const v1 = join(home, 'attachments/v1');
  const objectsRoot = join(v1, 'objects');
  await mkdir(objectsRoot, { recursive: true });

  /** Write one object file (no extension), optionally with a `.ext` hardlink. */
  async function writeObject(attachmentId, { mediaType, bytes = 4 } = {}) {
    const hash = hashOf(attachmentId);
    const dir = join(objectsRoot, bucketOf(hash));
    await mkdir(dir, { recursive: true });
    const file = join(dir, hash);
    const data = Buffer.alloc(bytes, 1);
    await writeFile(file, data);
    let extPath;
    if (mediaType) {
      const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : mediaType === 'image/gif' ? 'gif' : null;
      if (ext) {
        extPath = join(dir, `${hash}.${ext}`);
        try { await link(file, extPath); } catch { /* hardlink may fail on some fs; optional */ }
      }
    }
    return { file, extPath, hash, dir };
  }

  async function writeSessionImages(obj) {
    await writeFile(join(v1, 'session-images.json'), JSON.stringify(obj));
  }

  async function writeMemory(entries) {
    await writeFile(join(v1, 'image-memory.json'), JSON.stringify({ entries }));
  }

  async function writeRetention(retained) {
    await writeFile(join(v1, 'image-retention.json'), JSON.stringify({ version: 1, retained: Array.isArray(retained) ? retained : [...retained] }));
  }

  async function cleanup() {
    await rm(home, { recursive: true, force: true });
  }

  return {
    home,
    v1,
    objectsRoot,
    sessionImagesPath: join(v1, 'session-images.json'),
    imageMemoryPath: join(v1, 'image-memory.json'),
    imageRetentionPath: join(v1, 'image-retention.json'),
    writeObject,
    writeSessionImages,
    writeMemory,
    writeRetention,
    cleanup
  };
}
