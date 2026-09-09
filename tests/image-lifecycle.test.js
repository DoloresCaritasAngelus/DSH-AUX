/**
 * Image lifecycle tests (P3): reference extraction, the persistence shim,
 * the live-session recovery barrier, the fail-closed deletion gate and the
 * trash-based reclaim path.
 *
 * Run: cd <仓库路径> && node --test tests/image-lifecycle.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import { join } from "node:path";
import { createImageFixture, hashOf } from "./helpers/image-fixture.js";
import { recordAttachmentRefs } from "../dsh-aux/src/images/attachment-refs.js";
import { collectImageRefs, eventImageRefs } from "../dsh-aux/src/images/refs.js";
import { listSessionSnapshots, readSessionEvents } from "../dsh-aux/src/session-utils.js";
import {
  cleanupSessionImages,
  deletionBlockReason,
  deletionReady,
  noteLiveSession,
  releaseLiveSession,
  sweepTrash,
} from "../dsh-aux/src/images/ownership.js";
import { resolveImageRef } from "../dsh-aux/src/images/resolve.js";

const hash = (ch) => ch.repeat(64);
const id = (ch) => "sha256:" + hash(ch);
const refOf = (ch, mediaType = "image/png") => ({ attachmentId: id(ch), mediaType, name: ch + ".png" });

/**
 * Minimal service matching ownership.js's surface.
 * @param {{ stored?: string[] }} [options] ids the persistence layer reports.
 */
function makeService({ stored = [] } = {}) {
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
        if (name === "sessionPersistence") {
          return {
            async list() {
              return stored.map((sessionId) => ({ header: { id: sessionId } }));
            },
          };
        }
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

test("collectImageRefs: 递归 tool-result.content 并按遇到顺序返回", () => {
  const content = [
    { type: "text", text: "hi" },
    { type: "image", attachment: refOf("a") },
    {
      type: "tool-result",
      toolCallId: "c1",
      content: [
        { type: "text", text: "ok" },
        { type: "image", attachment: refOf("b", "image/jpeg") },
        { type: "tool-result", toolCallId: "c2", content: [{ type: "image", attachment: refOf("c", "image/webp") }] },
      ],
    },
    { type: "image" },
    { type: "image", attachment: { mediaType: "image/png" } },
  ];
  assert.deepEqual(
    collectImageRefs(content).map((ref) => ref.attachmentId),
    [id("a"), id("b"), id("c")],
  );
});

test("eventImageRefs: user/message 的 data 就是消息本体,只认消息事件", () => {
  const persisted = {
    type: "tool/result",
    data: { message: { content: [{ type: "tool-result", content: [{ type: "image", attachment: refOf("d") }] }] } },
  };
  // 真实会话日志形状:user/message 的 data 是扁平 UserMessage(content/role/id/source)。
  const pasted = {
    type: "user/message",
    seq: 9,
    time: 1000,
    data: {
      content: [
        { type: "image", attachment: refOf("e") },
        { type: "text", text: "测试." },
      ],
      source: { kind: "user" },
      role: "user",
      id: "msg-9",
    },
    surfaceOp: "append",
  };
  // 容错回退:派生 live 形状(event.message)在其它 API 世代仍可解析。
  const derived = { type: "user/message", message: { content: [{ type: "image", attachment: refOf("f") }] } };
  assert.deepEqual(
    eventImageRefs(persisted).map((r) => r.attachmentId),
    [id("d")],
  );
  assert.deepEqual(
    eventImageRefs(pasted).map((r) => r.attachmentId),
    [id("e")],
  );
  assert.deepEqual(
    eventImageRefs(derived).map((r) => r.attachmentId),
    [id("f")],
  );
  assert.deepEqual(
    eventImageRefs({ type: "assistant/message", message: { content: [{ type: "image", attachment: refOf("g") }] } }),
    [],
  );
  // agent/inbox/spliced 的 inserted 随后会成为 user/message,计入会重复。
  assert.deepEqual(
    eventImageRefs({
      type: "agent/inbox/spliced",
      data: { inserted: [{ content: [{ type: "image", attachment: refOf("h") }] }] },
    }),
    [],
  );
  assert.deepEqual(eventImageRefs(void 0), []);
});

test("listSessionSnapshots: 0.1.5 list() 与旧 listSnapshots() 均支持,失败降级为空", async () => {
  const seen = [];
  const signal = new AbortController().signal;
  const modern = {
    async list(options) {
      seen.push(options?.signal);
      return [{ header: { id: "s1" } }];
    },
  };
  const legacy = {
    async listSnapshots() {
      return [{ id: "s2" }];
    },
  };
  assert.deepEqual(await listSessionSnapshots(modern, signal), [{ header: { id: "s1" } }]);
  assert.equal(seen[0], signal);
  assert.deepEqual(await listSessionSnapshots(legacy), [{ id: "s2" }]);
  assert.deepEqual(await listSessionSnapshots(void 0), []);
  assert.deepEqual(
    await listSessionSnapshots({
      async list() {
        throw new Error("boom");
      },
    }),
    [],
  );
});

test("readSessionEvents: 0.1.5 open/read 并释放 handle;旧 inspect 兼容;不可读返回 undefined", async () => {
  let closed = 0;
  let opened = null;
  const modern = {
    async open(sessionId, access, options) {
      opened = { sessionId, access, signal: options?.signal };
      return {
        async read(offset, length) {
          assert.equal(offset, 0);
          assert.equal(length, void 0);
          return { events: [{ type: "user/message" }] };
        },
        async close() {
          closed += 1;
        },
      };
    },
  };
  const signal = new AbortController().signal;
  assert.deepEqual(await readSessionEvents(modern, "s1", signal), [{ type: "user/message" }]);
  assert.deepEqual(opened, { sessionId: "s1", access: "read", signal });
  assert.equal(closed, 1, "读完必须释放 handle");

  const legacy = {
    async inspect() {
      return { events: [{ type: "tool/result" }] };
    },
  };
  assert.deepEqual(await readSessionEvents(legacy, "s1"), [{ type: "tool/result" }]);
  assert.equal(
    await readSessionEvents(
      {
        async open() {
          throw new Error("not found");
        },
      },
      "x",
    ),
    void 0,
  );
  const flakyClose = {
    async open() {
      return {
        async read() {
          return { events: [] };
        },
        async close() {
          throw new Error("already closed");
        },
      };
    },
  };
  assert.deepEqual(await readSessionEvents(flakyClose, "s"), [], "close 失败不得吞掉读取结果");
});

test("noteLiveSession: 扫描内存日志登记归属,期间保持 fail-closed", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const session = {
      id: "s-live",
      snapshotEvents: () => [
        {
          type: "user/message",
          data: { content: [{ type: "image", attachment: refOf("1") }], role: "user", id: "m1" },
        },
        {
          type: "tool/result",
          data: {
            message: {
              content: [{ type: "tool-result", content: [{ type: "image", attachment: refOf("2", "image/jpeg") }] }],
            },
          },
        },
      ],
    };
    assert.equal(deletionReady(service), true);
    const barrier = noteLiveSession(service, session);
    assert.equal(deletionReady(service), false, "扫描进行中必须拒绝删除");
    await barrier;
    assert.equal(deletionReady(service), true);
    assert.equal(deletionBlockReason(service), void 0);
    assert.deepEqual([...service._sessionImages.get("s-live")].sort(), [id("1"), id("2")].sort());
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test("noteLiveSession: 归属写入失败时进入 failed 集合并上报(fail-closed)", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    // Force the ownership load to fail: the loader sees a directory where the
    // map file should be, so `ensureSessionImagesLoaded` rejects.
    await fsPromises.mkdir(join(fixture.v1, "session-images.json"), { recursive: true });
    await noteLiveSession(service, {
      id: "s-bad",
      snapshotEvents: () => [
        {
          type: "user/message",
          data: { content: [{ type: "image", attachment: refOf("9") }], role: "user", id: "m9" },
        },
      ],
    });
    assert.equal(deletionReady(service), false);
    assert.ok(deletionBlockReason(service).includes("冻结"), "应给出可读的冻结原因");
    assert.ok(service._liveBackfillFailed.has("s-bad"));
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test("cleanupSessionImages: fail-closed 期间全局拒绝删除", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const target = await fixture.writeObject(id("3"), { mediaType: "image/png" });
    await fixture.writeSessionImages({ "s-1": [id("3")] });
    service._liveBackfillPending.add("s-other");
    await cleanupSessionImages(service, "s-1");
    assert.equal(await exists(target.file), true, "冻结期间不得删除对象");
    assert.equal(await exists(target.extPath), true, "冻结期间不得删除 .ext 硬链接");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test("cleanupSessionImages: 无其他引用时移入 .trash 并删除 .ext 硬链接", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const target = await fixture.writeObject(id("4"), { mediaType: "image/png" });
    await fixture.writeSessionImages({ "s-1": [id("4")] });
    await cleanupSessionImages(service, "s-1");
    assert.equal(await exists(target.file), false, "对象应离开对象目录");
    assert.equal(await exists(target.extPath), false, ".ext 硬链接应一并移除");
    const trash = await fsPromises.readdir(join(fixture.objectsRoot, ".trash"));
    assert.equal(trash.length, 1, "对象应进入回收站(可恢复)");
    assert.ok(trash[0].startsWith(hash("4")), "回收站条目应可辨识原对象");
    assert.equal(service._sessionImages.has("s-1"), false, "会话应从归属表移除");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test("cleanupSessionImages: 其他会话仍引用时保留对象", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const target = await fixture.writeObject(id("5"), { mediaType: "image/png" });
    await fixture.writeSessionImages({ "s-1": [id("5")], "s-2": [id("5")] });
    await cleanupSessionImages(service, "s-1");
    assert.equal(await exists(target.file), true, "共享图必须保留");
    assert.equal(await exists(target.extPath), true);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test("sweepTrash: 只清理超过恢复窗口的、本模块写入的条目", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  const DAY = 24 * 60 * 60 * 1000;
  try {
    const trashRoot = join(fixture.objectsRoot, ".trash");
    await fsPromises.mkdir(trashRoot, { recursive: true });
    // Managed entries carry their ingress timestamp in the name.
    const stale = join(trashRoot, `${hash("a")}-${Date.now() - 30 * DAY}-abcdef01`);
    const fresh = join(trashRoot, `${hash("b")}-${Date.now()}-abcdef02`);
    // Foreign file: not written by this module, must never be swept.
    const foreign = join(trashRoot, "manual-recovery-note.txt");
    await fsPromises.writeFile(stale, "old");
    await fsPromises.writeFile(fresh, "fresh");
    await fsPromises.writeFile(foreign, "keep");
    const past = new Date(Date.now() - 30 * DAY);
    await fsPromises.utimes(foreign, past, past);
    const result = await sweepTrash(service, { maxAgeMs: 7 * DAY });
    assert.equal(result.removed, 1);
    assert.equal(await exists(stale), false);
    assert.equal(await exists(fresh), true);
    assert.equal(await exists(foreign), true, "外来文件不得被清扫");
    assert.equal(result.skippedForeign, 1);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test("resolveImageRef: 递归找到工具产物图,回收后给出明确文案", async () => {
  const ref = refOf("6", "image/png");
  const session = {
    snapshotEvents: () => [
      {
        type: "tool/result",
        data: { message: { content: [{ type: "tool-result", content: [{ type: "image", attachment: ref }] }] } },
      },
    ],
  };
  const exec = { agent: { session }, signal: void 0 };
  const ok = {
    async readImage(r) {
      return { ref: r };
    },
  };
  const service = { ctx: { get: (name) => (name === "attachments" ? ok : void 0) } };
  assert.deepEqual(await resolveImageRef(service, { attachmentId: ref.attachmentId }, exec), ref);

  const reclaimed = {
    async readImage() {
      throw new Error("ATTACHMENT_NOT_FOUND");
    },
  };
  const failing = { ctx: { get: (name) => (name === "attachments" ? reclaimed : void 0) } };
  await assert.rejects(
    () => resolveImageRef(failing, { attachmentId: ref.attachmentId }, exec),
    /may have been reclaimed by attachment GC/,
  );
  await assert.rejects(
    () => resolveImageRef(service, { attachmentId: id("7") }, exec),
    /not found in this session's messages/,
  );
});
test("R5:恢复窗口内另一会话删除 —— 未回填会话引用的图不得被删", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const target = await fixture.writeObject(id("8"), { mediaType: "image/png" });
    // B owns the image on disk; A is a resumed live session whose constructor
    // seed (full stored log) also references it, but whose barrier has not
    // settled yet — the exact window R5 describes.
    await fixture.writeSessionImages({ "s-b": [id("8")] });
    const a = {
      id: "s-a",
      snapshotEvents: () => [
        {
          type: "user/message",
          data: { content: [{ type: "image", attachment: refOf("8") }], role: "user", id: "m8" },
        },
      ],
    };
    const barrier = noteLiveSession(service, a);
    await cleanupSessionImages(service, "s-b");
    assert.equal(await exists(target.file), true, "恢复窗口内不得删除 A 引用的图");
    assert.equal(await exists(target.extPath), true);
    await barrier;
    // Once A's ownership is known, the shared image is still protected.
    await cleanupSessionImages(service, "s-b");
    assert.equal(await exists(target.file), true, "A 仍引用时共享图必须保留");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});
test("releaseLiveSession: 会话仍在存储时保留在 failed,GC 继续冻结", async () => {
  const service = makeService({ stored: ["s-live"] });
  service._liveBackfillFailed.add("s-live");
  assert.equal(await releaseLiveSession(service, "s-live"), false, "仍存在于存储的会话不得释放");
  assert.equal(deletionReady(service), false, "必须继续 fail-closed");
});

test("releaseLiveSession: 会话已从存储删除时释放并解冻", async () => {
  const service = makeService({ stored: [] });
  service._liveBackfillFailed.add("s-gone");
  assert.equal(await releaseLiveSession(service, "s-gone"), true);
  assert.equal(deletionReady(service), true);
  assert.equal(service._liveBackfillFailed.size, 0);
});

test("releaseLiveSession: 持久层不可读时保留(fail-closed)", async () => {
  const service = makeService();
  service.ctx = {
    get() {
      throw new Error("persistence unavailable");
    },
  };
  service._liveBackfillFailed.add("s-x");
  assert.equal(await releaseLiveSession(service, "s-x"), false);
  assert.equal(deletionReady(service), false);
});

test("trash 窗口: 30 天龄对象入 trash 后按入站时刻计龄,7 天内不得被清", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  const DAY = 24 * 60 * 60 * 1000;
  try {
    const target = await fixture.writeObject(id("d"), { mediaType: "image/png" });
    // The object is already 30 days old when it is reclaimed.
    const past = new Date(Date.now() - 30 * DAY);
    await fsPromises.utimes(target.file, past, past);
    await fixture.writeSessionImages({ "s-1": [id("d")] });

    await cleanupSessionImages(service, "s-1");

    const trashRoot = join(fixture.objectsRoot, ".trash");
    const entries = await fsPromises.readdir(trashRoot);
    assert.equal(entries.length, 1, "对象应进入回收站");
    const entry = join(trashRoot, entries[0]);
    const st = await fsPromises.stat(entry);
    assert.ok(
      Date.now() - st.mtimeMs > 25 * DAY,
      "rename 保留原始 mtime —— 这正是旧实现把窗口缩成 0 的成因,实际龄 " + (Date.now() - st.mtimeMs) / DAY + " 天",
    );

    const first = await sweepTrash(service);
    assert.equal(first.removed, 0, "刚入站的 30 天龄对象必须保留完整恢复窗口,实际 removed=" + first.removed);
    assert.equal(await exists(entry), true);

    // Simulate 8 days passing by rewriting the ingress stamp in the name.
    const base = entries[0].replace(/-\d{10,17}-[0-9a-f]{8}$/, "");
    const aged = join(trashRoot, `${base}-${Date.now() - 8 * DAY}-abcdef01`);
    await fsPromises.rename(entry, aged);
    const second = await sweepTrash(service);
    assert.equal(second.removed, 1, "窗口过期后应被清扫");
    assert.equal(await exists(aged), false);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test("sweepTrash: 名字时间戳不可用时回退 mtime", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  const DAY = 24 * 60 * 60 * 1000;
  try {
    const trashRoot = join(fixture.objectsRoot, ".trash");
    await fsPromises.mkdir(trashRoot, { recursive: true });
    // 17-digit stamps exceed Number.MAX_SAFE_INTEGER -> unusable -> mtime.
    const stale = join(trashRoot, `${hash("e")}-99999999999999999-abcdef01`);
    const fresh = join(trashRoot, `${hash("f")}-99999999999999998-abcdef02`);
    await fsPromises.writeFile(stale, "old");
    await fsPromises.writeFile(fresh, "fresh");
    const past = new Date(Date.now() - 30 * DAY);
    await fsPromises.utimes(stale, past, past);
    const result = await sweepTrash(service, { maxAgeMs: 7 * DAY });
    assert.equal(result.removed, 1);
    assert.equal(await exists(stale), false);
    assert.equal(await exists(fresh), true);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test("cleanupSessionImages: 固化(retained)对象跳过 trash,owner 移除(留存为 retained-orphan)", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const target = await fixture.writeObject(id("1"), { mediaType: "image/png" });
    await fixture.writeSessionImages({ "s-1": [id("1")] });
    await fixture.writeRetention([id("1")]);

    await cleanupSessionImages(service, "s-1");

    assert.equal(await exists(target.file), true, "固化对象不得入回收站");
    assert.equal(await exists(target.extPath), true, "固化对象 .ext 硬链接不得删除");
    assert.equal(
      (await fsPromises.readdir(join(fixture.objectsRoot, ".trash")).catch(() => [])).length,
      0,
      "固化对象不得产生任何 trash 条目",
    );
    assert.equal(service._sessionImages.has("s-1"), false, "会话仍应从归属表移除(成为 retained-orphan)");
    const map = JSON.parse(await fsPromises.readFile(fixture.sessionImagesPath, "utf8"));
    assert.equal(map["s-1"], void 0, "磁盘映射同样移除已删会话");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test("cleanupSessionImages: retained 清单不可读时拒绝删除(fail-closed),owner 保留", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const target = await fixture.writeObject(id("2"), { mediaType: "image/png" });
    await fixture.writeSessionImages({ "s-1": [id("2")] });
    // A directory where the retention file should be -> readFile throws EISDIR.
    await fsPromises.mkdir(join(fixture.v1, "image-retention.json"), { recursive: true });

    await cleanupSessionImages(service, "s-1");

    assert.equal(await exists(target.file), true, "无法判定固化时必须拒绝删除");
    assert.equal(await exists(target.extPath), true);
    assert.equal(
      (await fsPromises.readdir(join(fixture.objectsRoot, ".trash")).catch(() => [])).length,
      0,
      "拒绝时不得产生 trash 条目",
    );
    const kept = JSON.parse(await fsPromises.readFile(fixture.sessionImagesPath, "utf8"));
    assert.deepEqual(kept["s-1"], [id("2")], "无法判定固化时必须保留 owner 作为重试锚点");

    // Once the retention file is readable again the same cleanup succeeds.
    await fsPromises.rm(join(fixture.v1, "image-retention.json"), { recursive: true, force: true });
    await cleanupSessionImages(service, "s-1");
    assert.equal(await exists(target.file), false);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});

test("cleanupSessionImages: 判定后 rename 前的新登记阻止对象入 trash(TOCTOU 复检)", async () => {
  const fixture = await createImageFixture();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = fixture.home;
  const service = makeService();
  try {
    const target = await fixture.writeObject(id("3"), { mediaType: "image/png" });
    await fixture.writeSessionImages({ "s-1": [id("3")] });
    const ref = refOf("3", "image/png");
    // The official host-path seam is the await boundary between the reference
    // check and the rename; register a new owner from inside it.
    const attachments = {
      imageHostPath(value) {
        service._sessionImages.set("s-2", new Set([value.attachmentId]));
        return join(fixture.objectsRoot, hashOf(value.attachmentId).slice(0, 2), hashOf(value.attachmentId));
      },
    };
    service.ctx.get = (name) => {
      if (name === "attachments") return attachments;
      if (name === "sessions") return { list: () => [] };
      if (name === "sessionPersistence") return { list: async () => [] };
      return void 0;
    };
    await recordAttachmentRefs(service, ref);

    await cleanupSessionImages(service, "s-1");

    assert.equal(await exists(target.file), true, "新登记必须阻止对象被移出对象目录");
    assert.equal(await exists(target.extPath), true);
    assert.equal(
      (await fsPromises.readdir(join(fixture.objectsRoot, ".trash")).catch(() => [])).length,
      0,
      "不得产生 trash 条目",
    );
    assert.equal(service._sessionImages.get("s-1")?.has(id("3")), true, "被否决的对象应留作重试锚点");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fixture.cleanup();
  }
});
