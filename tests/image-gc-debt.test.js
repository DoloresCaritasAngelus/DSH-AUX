/**
 * Image GC debt tests (P4): the attachment-refs sidecar, host-path based
 * reclamation, single-module object naming and the request-image LRU cap.
 *
 * Run: cd <仓库路径> && node --test tests/image-gc-debt.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import { join } from "node:path";
import { createImageFixture, hashOf } from "./helpers/image-fixture.js";
import {
  attachmentRefFor,
  attachmentRefsPath,
  loadAttachmentRefs,
  recordAttachmentRefs,
} from "../dsh-aux/src/images/attachment-refs.js";
import { cleanupSessionImages } from "../dsh-aux/src/images/ownership.js";
import { extensionForMediaType, objectFileInfo, objectPathForId } from "../dsh-aux/src/images/object-path.js";
import { sweepRequestImages } from "../dsh-aux/src/images/request-images.js";

const hash = (ch) => ch.repeat(64);
const id = (ch) => "sha256:" + hash(ch);
const refOf = (ch, mediaType = "image/png") => ({ attachmentId: id(ch), mediaType, name: ch + ".png" });

/** Minimal service; `attachments` is the optional host-path seam under test. */
function makeService({ attachments } = {}) {
  return {
    _sessionImages: new Map(),
    _sessionImagesLoaded: false,
    _sessionImagesDirty: false,
    _sessionImagesWriteQueue: Promise.resolve(),
    _liveBackfillPending: new Set(),
    _liveBackfillFailed: new Set(),
    ctx: {
      get(name) {
        if (name === "sessions") return { list: () => [] };
        if (name === "sessionPersistence")
          return {
            async list() {
              return [];
            },
          };
        if (name === "attachments") return attachments;
        return void 0;
      },
    },
  };
}

const exists = async (path) => {
  try {
    await fsPromises.lstat(path);
    return true;
  } catch {
    return false;
  }
};

const withHome = async (fixture, run) => {
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  try {
    return await run();
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
};

test("attachment-refs: 写入/读取完整 ref;损坏文件降级为空", async () => {
  const fixture = await createImageFixture();
  await withHome(fixture, async () => {
    const service = makeService();
    const ref = refOf("a", "image/png");
    await recordAttachmentRefs(service, ref);
    const path = attachmentRefsPath();
    assert.ok(path.startsWith(fixture.home), "sidecar 应位于 DSH_HOME 下");
    const parsed = JSON.parse(await fsPromises.readFile(path, "utf8"));
    assert.equal(parsed.version, 2);
    assert.deepEqual(parsed.refs[ref.attachmentId], ref);
    assert.deepEqual(await attachmentRefFor(service, ref.attachmentId), ref);

    // A fresh service reads the file; a corrupt file degrades to an empty map.
    assert.deepEqual(await attachmentRefFor(makeService(), ref.attachmentId), ref);
    await fsPromises.writeFile(path, "{not json");
    assert.equal((await loadAttachmentRefs(makeService())).size, 0);
    assert.equal(await attachmentRefFor(makeService(), ref.attachmentId), void 0);
  });
});

test("cleanupSessionImages: 有完整 ref 时走 imageHostPath 并按 mediaType 删 .ext", async () => {
  const fixture = await createImageFixture();
  await withHome(fixture, async () => {
    const target = await fixture.writeObject(id("b"), { mediaType: "image/jpeg" });
    await fixture.writeSessionImages({ "s-1": [id("b")] });
    const ref = refOf("b", "image/jpeg");
    const calls = [];
    const attachments = {
      imageHostPath(value) {
        calls.push(value);
        return join(fixture.objectsRoot, hashOf(value.attachmentId).slice(0, 2), hashOf(value.attachmentId));
      },
    };
    const service = makeService({ attachments });
    await recordAttachmentRefs(service, ref);
    await cleanupSessionImages(service, "s-1");

    assert.equal(calls.length, 1, "删除路径必须调用官方 imageHostPath");
    assert.deepEqual(calls[0], ref);
    assert.equal(await exists(target.file), false, "对象应被回收");
    assert.equal(await exists(target.extPath), false, ".ext 硬链接应按 mediaType 删除");
    assert.equal((await fsPromises.readdir(join(fixture.objectsRoot, ".trash"))).length, 1);
  });
});

test("cleanupSessionImages: 旁挂表缺失时回退旧派生,不得拒绝删除", async () => {
  const fixture = await createImageFixture();
  await withHome(fixture, async () => {
    const target = await fixture.writeObject(id("c"), { mediaType: "image/png" });
    await fixture.writeSessionImages({ "s-1": [id("c")] });
    const service = makeService(); // no sidecar entry, no attachments service
    await cleanupSessionImages(service, "s-1");
    assert.equal(await exists(target.file), false);
    assert.equal(await exists(target.extPath), false);
  });
});

test("sweepRequestImages: 超过总量上限时按 mtime LRU 回收", async () => {
  const fixture = await createImageFixture();
  await withHome(fixture, async () => {
    const base = join(fixture.v1, "request-images", "ab");
    await fsPromises.mkdir(base, { recursive: true });
    const entries = [];
    for (const [name, bytes, ageDays] of [
      ["oldest", 40, 30],
      ["middle", 40, 10],
      ["newest", 40, 1],
    ]) {
      const path = join(base, name);
      await fsPromises.writeFile(path, Buffer.alloc(bytes, 7));
      const when = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
      await fsPromises.utimes(path, when, when);
      entries.push(path);
    }
    const service = makeService();
    const under = await sweepRequestImages(service, { maxBytes: 200 });
    assert.equal(under.removed, 0, "未超上限不得回收");
    assert.equal(under.totalBytes, 120);

    const over = await sweepRequestImages(service, { maxBytes: 100 });
    assert.equal(over.removed, 1, "只回收最旧的一个");
    assert.equal(await exists(entries[0]), false);
    assert.equal(await exists(entries[1]), true);
    assert.equal(await exists(entries[2]), true);
  });
});

test("object-path: 单模块持有对象命名规则", () => {
  assert.deepEqual(objectFileInfo(hash("d")), { hash: hash("d"), mediaType: void 0 });
  assert.deepEqual(objectFileInfo(hash("d") + ".webp"), { hash: hash("d"), mediaType: "image/webp" });
  assert.equal(objectFileInfo("not-a-hash"), void 0);
  assert.equal(objectPathForId(id("d"), "/objects"), "/objects/" + hash("d").slice(0, 2) + "/" + hash("d"));
  assert.equal(objectPathForId("sha256:short", "/objects"), void 0);
  assert.equal(extensionForMediaType("image/jpeg"), ".jpg");
  assert.equal(extensionForMediaType("image/bmp"), void 0);
});
