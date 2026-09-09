/**
 * images-review 测试 (node:test,零依赖)。
 *
 * 覆盖本次修复的三项:
 *  - B2: session-images.json 写入经 per-service promise 队列串行化
 *        (并发 save/cleanup 不丢失、不交错)
 *  - B3: gcImages 对符号链接的 TOCTOU 加固(lstat 复查 bucket / file)
 *  - B4: onSessionDisposed 显式 _shuttingDown 标志(替代突发启发式)
 *
 * 运行: cd <仓库路径>/tests && node --test images-review.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import {
  cleanupSessionImages,
  ensureSessionImagesLoaded,
  installShutdownHook,
  onSessionDisposed,
  saveSessionImages,
} from "../dsh-aux/src/images/ownership.js";
import { gcImages } from "../dsh-aux/src/images/gc.js";

/** 构造一个最小的 service 对象(仅含 ownership 用到的字段)。 */
function makeService() {
  return {
    _sessionImages: new Map(),
    _sessionImagesDirty: false,
    _sessionImagesLoaded: false,
    _sessionImagesWriteQueue: undefined,
  };
}

test("B2: session-images 写入经 per-service 队列串行化,并发 save/cleanup 不交错", async () => {
  const tmp = "/tmp/aux-b2-queue-" + process.pid;
  const objects = tmp + "/attachments/v1/objects/ab";
  await fsPromises.mkdir(objects, { recursive: true });
  const hashA = "ab" + "a".repeat(62);
  const hashB = "ab" + "b".repeat(62);
  await fsPromises.writeFile(objects + "/" + hashA, "A");
  await fsPromises.writeFile(objects + "/" + hashB, "B");
  await fsPromises.writeFile(
    tmp + "/attachments/v1/session-images.json",
    JSON.stringify({
      "sess-1": ["sha256:" + hashA],
      "sess-2": ["sha256:" + hashB],
    }),
  );
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  const service = makeService();
  try {
    await ensureSessionImagesLoaded(service);
    // 并发:saveSessionImages(写当前内存)与 cleanupSessionImages(读盘+回写)
    // 同时进行;两者都必须经同一个队列串行落盘,不得产生撕裂/损坏文件。
    const p1 = saveSessionImages(service);
    const p2 = cleanupSessionImages(service, "sess-1");
    await Promise.all([p1, p2]);
    assert.ok(service._sessionImagesWriteQueue instanceof Promise, "应初始化写队列");
    const finalMap = JSON.parse(await fsPromises.readFile(tmp + "/attachments/v1/session-images.json", "utf8"));
    // 两次写盘均完整执行:sess-1 被清理,sess-2 保留
    assert.equal(finalMap["sess-1"], void 0, "sess-1 应被清理: " + JSON.stringify(finalMap));
    assert.ok(Array.isArray(finalMap["sess-2"]) && finalMap["sess-2"][0] === "sha256:" + hashB);
    const remaining = await fsPromises.readdir(objects);
    assert.ok(!remaining.includes(hashA), "无引用文件 A 应删除");
    assert.ok(remaining.includes(hashB), "共享文件 B 应保留");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("B2: 并发多次 saveSessionImages 串行执行,最终映射完整", async () => {
  const tmp = "/tmp/aux-b2-multi-" + process.pid;
  await fsPromises.mkdir(tmp + "/attachments/v1", { recursive: true });
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  const service = makeService();
  try {
    const p1 = saveSessionImages(service);
    service._sessionImages.set("s1", new Set(["a"]));
    const p2 = saveSessionImages(service);
    service._sessionImages.set("s2", new Set(["b"]));
    const p3 = saveSessionImages(service);
    await Promise.all([p1, p2, p3]);
    const map = JSON.parse(await fsPromises.readFile(tmp + "/attachments/v1/session-images.json", "utf8"));
    assert.ok(Array.isArray(map["s1"]) && map["s1"].includes("a"));
    assert.ok(Array.isArray(map["s2"]) && map["s2"].includes("b"));
    assert.ok(service._sessionImagesWriteQueue instanceof Promise);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("B3: gcImages lstat 加固 - 跳过符号链接 bucket,受害文件保留", async () => {
  const tmp = "/tmp/aux-b3-bucket-" + process.pid;
  const objects = tmp + "/attachments/v1/objects";
  await fsPromises.mkdir(objects, { recursive: true });
  const victimDir = tmp + "/victim";
  await fsPromises.mkdir(victimDir, { recursive: true });
  const victim = victimDir + "/precious.bin";
  await fsPromises.writeFile(victim, "precious");
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  await fsPromises.utimes(victim, new Date(old), new Date(old));
  await fsPromises.symlink(victimDir, objects + "/evil-bucket", "dir");
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const out = await gcImages(makeService(), 30);
    assert.equal(out.kind, "success", out.text);
    assert.equal(await fsPromises.readFile(victim, "utf8"), "precious", "外部受害文件不得被删");
    await fsPromises.lstat(objects + "/evil-bucket"); // 符号链接本身保留
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("B3: gcImages lstat 加固 - 常规旧文件删除,符号链接文件不删不跟随", async () => {
  const tmp = "/tmp/aux-b3-file-" + process.pid;
  const objects = tmp + "/attachments/v1/objects/ab";
  await fsPromises.mkdir(objects, { recursive: true });
  const victimDir = tmp + "/victim";
  await fsPromises.mkdir(victimDir, { recursive: true });
  const victim = victimDir + "/precious.bin";
  await fsPromises.writeFile(victim, "precious");
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  await fsPromises.utimes(victim, new Date(old), new Date(old));
  // 常规旧文件:应被删除(lstat 确认是常规文件)
  await fsPromises.writeFile(objects + "/oldfile", "x");
  await fsPromises.utimes(objects + "/oldfile", new Date(old), new Date(old));
  // 符号链接文件:不应删除,也不应跟随到外部 victim
  await fsPromises.symlink(victim, objects + "/evil.jpg", "file");
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const out = await gcImages(makeService(), 30);
    assert.equal(out.kind, "success", out.text);
    const remaining = await fsPromises.readdir(objects);
    assert.ok(!remaining.includes("oldfile"), "常规旧文件应删除,实际: " + remaining.join(","));
    assert.ok(remaining.includes("evil.jpg"), "符号链接文件应保留");
    assert.equal(await fsPromises.readFile(victim, "utf8"), "precious", "链接指向的外部文件不得被删");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("B4: onSessionDisposed 在 _shuttingDown=true 时跳过(进程关闭突发)", async () => {
  const tmp = "/tmp/aux-b4-skip-" + process.pid;
  const objects = tmp + "/attachments/v1/objects/ab";
  await fsPromises.mkdir(objects, { recursive: true });
  const hashA = "ab" + "a".repeat(62);
  await fsPromises.writeFile(objects + "/" + hashA, "A");
  await fsPromises.writeFile(
    tmp + "/attachments/v1/session-images.json",
    JSON.stringify({
      "sess-1": ["sha256:" + hashA],
    }),
  );
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  const service = makeService();
  try {
    await ensureSessionImagesLoaded(service);
    service._shuttingDown = true; // 模拟进程关闭
    onSessionDisposed(service, { id: "sess-1" });
    await new Promise((r) => setTimeout(r, 30));
    const remaining = await fsPromises.readdir(objects);
    assert.ok(remaining.includes(hashA), "关闭时应跳过清理,文件保留");
    const map = JSON.parse(await fsPromises.readFile(tmp + "/attachments/v1/session-images.json", "utf8"));
    assert.ok(Array.isArray(map["sess-1"]), "映射不得被修改");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("B4: onSessionDisposed 在 _shuttingDown=false 时正常批量清理", async () => {
  const tmp = "/tmp/aux-b4-clean-" + process.pid;
  const objects = tmp + "/attachments/v1/objects/ab";
  await fsPromises.mkdir(objects, { recursive: true });
  const hashA = "ab" + "a".repeat(62);
  const hashB = "ab" + "b".repeat(62);
  await fsPromises.writeFile(objects + "/" + hashA, "A");
  await fsPromises.writeFile(objects + "/" + hashB, "B");
  await fsPromises.writeFile(
    tmp + "/attachments/v1/session-images.json",
    JSON.stringify({
      "sess-1": ["sha256:" + hashA],
      "sess-2": ["sha256:" + hashB],
    }),
  );
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  const service = makeService();
  try {
    await ensureSessionImagesLoaded(service);
    service._shuttingDown = false;
    // 普通批量删除:每个 disposed 会话都应触发清理(删除其无引用文件)
    onSessionDisposed(service, { id: "sess-1" });
    onSessionDisposed(service, { id: "sess-2" });
    // 等待异步清理完成(轮询,避免 Node 20/慢机器上的固定延时抖动)。
    let remaining = await fsPromises.readdir(objects);
    for (let i = 0; i < 40 && (remaining.includes(hashA) || remaining.includes(hashB)); i++) {
      await new Promise((r) => setTimeout(r, 50));
      remaining = await fsPromises.readdir(objects);
    }
    assert.ok(!remaining.includes(hashA), "sess-1 的文件应删除");
    assert.ok(!remaining.includes(hashB), "sess-2 的文件应删除");
    // 写回的文件仍是合法 JSON
    const map = JSON.parse(await fsPromises.readFile(tmp + "/attachments/v1/session-images.json", "utf8"));
    assert.equal(typeof map, "object");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("B4: installShutdownHook 可导出且幂等", () => {
  const service = {};
  installShutdownHook(service);
  installShutdownHook(service); // 重复调用不应报错
  assert.equal(service._shutdownHookInstalled, true);
});

test("gcImages: 冻结期拒绝清扫(DELETION_FROZEN),不删任何文件", async () => {
  const tmp = "/tmp/aux-w1-frozen-" + process.pid;
  const objects = tmp + "/attachments/v1/objects/ab";
  await fsPromises.mkdir(objects, { recursive: true });
  const file = objects + "/" + "ab" + "f".repeat(62);
  await fsPromises.writeFile(file, "OLD");
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  await fsPromises.utimes(file, new Date(old), new Date(old));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  const service = makeService();
  service._liveBackfillPending = new Set(["s-live"]);
  try {
    const out = await gcImages(service, 1);
    assert.equal(out.kind, "error", "冻结期必须拒绝: " + out.text);
    assert.ok(out.text.includes("DELETION_FROZEN"), "错误应带机器可读码: " + out.text);
    assert.ok(out.text.includes("冻结"), "错误应带冻结原因: " + out.text);
    await fsPromises.lstat(file);
    assert.equal(
      (await fsPromises.readdir(tmp + "/attachments/v1/objects/.trash").catch(() => [])).length,
      0,
      "冻结期不得产生回收动作",
    );
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("gcImages: 非对象 service 拒绝清扫(屏障不可评估即不得删除)", async () => {
  const tmp = "/tmp/aux-w1-noservice-" + process.pid;
  const objects = tmp + "/attachments/v1/objects/ab";
  await fsPromises.mkdir(objects, { recursive: true });
  const file = objects + "/" + "ab" + "c".repeat(62);
  await fsPromises.writeFile(file, "OLD");
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  await fsPromises.utimes(file, new Date(old), new Date(old));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const out = await gcImages(30);
    assert.equal(out.kind, "error", "缺少 service 时必须拒绝: " + out.text);
    assert.ok(out.text.includes("DELETION_FROZEN"), out.text);
    await fsPromises.lstat(file);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("gcImages: 不把 objects/.trash 当 bucket 清扫(回收窗口不被 days 缩短)", async () => {
  const tmp = "/tmp/aux-w1-trashskip-" + process.pid;
  const v1 = tmp + "/attachments/v1";
  const bucket = v1 + "/objects/ab";
  const trash = v1 + "/objects/.trash";
  await fsPromises.mkdir(bucket, { recursive: true });
  await fsPromises.mkdir(trash, { recursive: true });
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  // A just-trashed old object: fresh ingress stamp in the name, old mtime.
  const trashed = trash + "/" + "ab" + "e".repeat(62) + "-" + Date.now() + "-abcdef01";
  await fsPromises.writeFile(trashed, "TRASHED");
  await fsPromises.utimes(trashed, new Date(old), new Date(old));
  // A normal stale object: gc-images must still sweep it.
  const stale = bucket + "/" + "ab" + "d".repeat(62);
  await fsPromises.writeFile(stale, "STALE");
  await fsPromises.utimes(stale, new Date(old), new Date(old));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const out = await gcImages(makeService(), 1);
    assert.equal(out.kind, "success", out.text);
    await fsPromises.lstat(trashed);
    await assert.rejects(fsPromises.lstat(stale), (error) => error?.code === "ENOENT");
    assert.ok(out.text.includes("回收站清出 0 个"), "trash 条目不得计入附件删除: " + out.text);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("gcImages: 跳过固化(retained)附件并计数,其余旧附件照常清除", async () => {
  const tmp = "/tmp/aux-w1-retained-" + process.pid;
  const v1 = tmp + "/attachments/v1";
  const objects = v1 + "/objects/ab";
  await fsPromises.mkdir(objects, { recursive: true });
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  const retainedHash = "ab" + "e".repeat(62);
  const freeHash = "ab" + "d".repeat(62);
  const retainedFile = objects + "/" + retainedHash;
  const freeFile = objects + "/" + freeHash;
  await fsPromises.writeFile(retainedFile, "R");
  await fsPromises.writeFile(freeFile, "F");
  await fsPromises.utimes(retainedFile, new Date(old), new Date(old));
  await fsPromises.utimes(freeFile, new Date(old), new Date(old));
  await fsPromises.writeFile(
    v1 + "/image-retention.json",
    JSON.stringify({ version: 1, retained: ["sha256:" + retainedHash] }),
  );
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const out = await gcImages(makeService(), 1);
    assert.equal(out.kind, "success", out.text);
    assert.ok(out.text.includes("跳过 1 个固化附件"), "结果应报告固化跳过计数: " + out.text);
    await fsPromises.lstat(retainedFile);
    await assert.rejects(fsPromises.lstat(freeFile), (error) => error?.code === "ENOENT");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("gcImages: 跳过仍被会话引用的对象并计数", async () => {
  const tmp = "/tmp/aux-w1-referenced-" + process.pid;
  const v1 = tmp + "/attachments/v1";
  const objects = v1 + "/objects/ab";
  await fsPromises.mkdir(objects, { recursive: true });
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  const refHash = "ab" + "e".repeat(62);
  const freeHash = "ab" + "d".repeat(62);
  const refFile = objects + "/" + refHash;
  const freeFile = objects + "/" + freeHash;
  await fsPromises.writeFile(refFile, "R");
  await fsPromises.writeFile(freeFile, "F");
  await fsPromises.utimes(refFile, new Date(old), new Date(old));
  await fsPromises.utimes(freeFile, new Date(old), new Date(old));
  await fsPromises.writeFile(v1 + "/session-images.json", JSON.stringify({ "s-1": ["sha256:" + refHash] }));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const out = await gcImages(makeService(), 1);
    assert.equal(out.kind, "success", out.text);
    assert.ok(out.text.includes("跳过 1 个仍被会话引用的附件"), "结果应报告引用跳过计数: " + out.text);
    await fsPromises.lstat(refFile);
    await assert.rejects(fsPromises.lstat(freeFile), (error) => error?.code === "ENOENT");
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("gcImages: retained 清单不可读时拒绝清扫(fail-closed)", async () => {
  const tmp = "/tmp/aux-w1-badretained-" + process.pid;
  const v1 = tmp + "/attachments/v1";
  const objects = v1 + "/objects/ab";
  await fsPromises.mkdir(objects, { recursive: true });
  const file = objects + "/" + "ab" + "b".repeat(62);
  await fsPromises.writeFile(file, "OLD");
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  await fsPromises.utimes(file, new Date(old), new Date(old));
  // A directory where the retention file should be -> readFile throws EISDIR.
  await fsPromises.mkdir(v1 + "/image-retention.json", { recursive: true });
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const out = await gcImages(makeService(), 1);
    assert.equal(out.kind, "error", "不可读必须拒绝而不是当成空固化集: " + out.text);
    assert.ok(out.text.includes("固化"), out.text);
    await fsPromises.lstat(file);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test("gcImages: 会话归属表不可读时拒绝清扫(fail-closed)", async () => {
  const tmp = "/tmp/aux-w1-badowner-" + process.pid;
  const v1 = tmp + "/attachments/v1";
  const objects = v1 + "/objects/ab";
  await fsPromises.mkdir(objects, { recursive: true });
  const file = objects + "/" + "ab" + "a".repeat(62);
  await fsPromises.writeFile(file, "OLD");
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  await fsPromises.utimes(file, new Date(old), new Date(old));
  await fsPromises.mkdir(v1 + "/session-images.json", { recursive: true });
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const out = await gcImages(makeService(), 1);
    assert.equal(out.kind, "error", "归属表不可读必须拒绝: " + out.text);
    assert.ok(out.text.includes("会话归属表不可读"), out.text);
    await fsPromises.lstat(file);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});
