/**
 * P5.5 (G9): `vision_analyze` imagePath resolves the format from the file's
 * leading bytes when the extension declares no supported type, and refuses a
 * declared extension that disagrees with those bytes. The sniffer mirrors
 * read_image so both tools accept the same extension-less files.
 *
 * Run: node --test tests/image-path-media.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extensionForPath, sniffImageMediaType } from "../dsh-aux/src/media.js";
import { resolveImageRef } from "../dsh-aux/src/images/resolve.js";

function ascii(value) {
  return Array.from(value, (c) => c.charCodeAt(0));
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const GIF87A = ascii("GIF87a").concat([0x01]);
const GIF89A = ascii("GIF89a").concat([0x01]);
const WEBP = ascii("RIFF").concat([0x24, 0x00, 0x00, 0x00], ascii("WEBP"), [0x00]);

/** Service stub: fs hands back the given bytes; attachments records the call. */
function makeService(bytes, options = {}) {
  const calls = { save: [], read: [] };
  const fs = {
    async resolve(path) {
      return { targetKey: path, displayPath: path };
    },
    async stat() {
      return options.stat ?? { type: "file" };
    },
    async readBytes(target, signal, byteCap) {
      calls.read.push({ target, byteCap });
      return new Uint8Array(bytes);
    },
  };
  const attachments = {
    imageLimits: { maxImageBytes: 1000, maxMessageImageBytes: 400 },
    async saveImage(input) {
      calls.save.push(input);
      if (options.saveError !== void 0) throw options.saveError;
      return {
        attachmentId: "att",
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 1,
        height: 1,
        name: input.name,
      };
    },
  };
  return {
    calls,
    service: {
      ctx: { get: (key) => (key === "fs" ? fs : key === "attachments" ? attachments : void 0) },
    },
  };
}

const exec = { signal: void 0, agent: { session: { header: { cwd: "/workspace" } } } };

test("sniffImageMediaType: 四个受支持签名 + 未知/截断字节", () => {
  assert.equal(sniffImageMediaType(new Uint8Array(PNG)), "image/png");
  assert.equal(sniffImageMediaType(new Uint8Array(JPEG)), "image/jpeg");
  assert.equal(sniffImageMediaType(new Uint8Array(GIF87A)), "image/gif");
  assert.equal(sniffImageMediaType(new Uint8Array(GIF89A)), "image/gif");
  assert.equal(sniffImageMediaType(new Uint8Array(WEBP)), "image/webp");
  assert.equal(sniffImageMediaType(new Uint8Array([1, 2, 3])), void 0);
  assert.equal(sniffImageMediaType(new Uint8Array([0x89, 0x50])), void 0, "截断签名不判定");
  assert.equal(sniffImageMediaType(void 0), void 0);
});

for (const entry of [
  ["PNG", PNG, "image/png"],
  ["JPEG", JPEG, "image/jpeg"],
  ["GIF87a", GIF87A, "image/gif"],
  ["GIF89a", GIF89A, "image/gif"],
  ["WebP", WEBP, "image/webp"],
]) {
  const label = entry[0];
  const bytes = entry[1];
  const mediaType = entry[2];
  test("imagePath 无扩展名: " + label + " 按魔数判定并存储", async () => {
    const { service, calls } = makeService(bytes);
    const ref = await resolveImageRef(service, { imagePath: "/workspace/sha256-deadbeef" }, exec);
    assert.equal(calls.save.length, 1);
    assert.equal(calls.save[0].mediaType, mediaType);
    assert.equal(ref.mediaType, mediaType);
    assert.equal(calls.read.length, 1);
    assert.equal(calls.read[0].byteCap, 400, "byteCap 仍取 min(maxImageBytes, maxMessageImageBytes)");
  });
}

test("imagePath 未知非空扩展名: 任何字节都拒绝(与 read_image 一致)", async () => {
  const { service, calls } = makeService(PNG);
  await assert.rejects(
    () => resolveImageRef(service, { imagePath: "/workspace/report.dat" }, exec),
    (error) => {
      assert.match(error.message, /uses the \.dat extension, which is not a supported image format/);
      assert.match(error.message, /\.png\/\.jpg\/\.jpeg\/\.webp\/\.gif/);
      return true;
    },
  );
  assert.equal(calls.read.length, 0, "未知扩展名在任何 I/O 之前拒绝");
  assert.equal(calls.save.length, 0);
});

test("imagePath 点文件(.png): 视为无扩展名并按魔数判定", async () => {
  const { service, calls } = makeService(JPEG);
  const ref = await resolveImageRef(service, { imagePath: "/workspace/.png" }, exec);
  assert.equal(calls.save[0].mediaType, "image/jpeg");
  assert.equal(ref.mediaType, "image/jpeg");
});

test("extensionForPath: 扩展名归一化与点文件", () => {
  assert.equal(extensionForPath("/a/b/photo.PNG"), ".png");
  // Backslash-separated (UNC) paths keep only the last segment's extension.
  assert.equal(extensionForPath("\\\\host\\share\\photo.JPEG"), ".jpeg");
  assert.equal(extensionForPath("/a/b/sha256-deadbeef"), "");
  assert.equal(extensionForPath("/a/b/.png"), "");
  assert.equal(extensionForPath("/a/b/archive.tar.gz"), ".gz");
});

test("imagePath 扩展名与字节不符: 明确文案且不落盘", async () => {
  const { service, calls } = makeService(JPEG);
  await assert.rejects(
    () => resolveImageRef(service, { imagePath: "/workspace/photo.png" }, exec),
    (error) => {
      assert.match(error.message, /declares image\/png by its extension, but the bytes are image\/jpeg/);
      assert.match(error.message, /rename the file to match its actual format or convert it/);
      return true;
    },
  );
  assert.equal(calls.save.length, 0, "格式不符时不得调用 saveImage");
});

test("imagePath 无扩展名且字节不受支持: 明确文案", async () => {
  const { service, calls } = makeService([1, 2, 3]);
  await assert.rejects(
    () => resolveImageRef(service, { imagePath: "/workspace/mystery" }, exec),
    (error) => {
      assert.match(error.message, /is not a supported image/);
      assert.match(error.message, /the path declares no image extension/);
      assert.match(error.message, /match none of the PNG\/JPEG\/WebP\/GIF signatures/);
      return true;
    },
  );
  assert.equal(calls.save.length, 0);
});

test("imagePath 已知扩展名 + 不可识别字节: 仍交给 saveImage 判定(行为不变)", async () => {
  const { service, calls } = makeService([1, 2, 3], { saveError: new Error("INVALID_IMAGE") });
  await assert.rejects(
    () => resolveImageRef(service, { imagePath: "/workspace/photo.png" }, exec),
    /cannot read "\/workspace\/photo.png" as image\/png — the bytes may use a different format/,
  );
  assert.equal(calls.save.length, 1, "签名不可判定时不抢先拒绝,由附件服务给权威结论");
});

/** Real encoder output, one image per supported format (base64). */
const REAL_IMAGES = [
  [
    "png",
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "image/png",
  ],
  [
    "jpeg",
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
    "image/jpeg",
  ],
  ["gif", "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "image/gif"],
  ["webp", "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=", "image/webp"],
];

test("真跑: 真实编码器输出的无扩展名文件经真实文件系统读取后按魔数判定", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-aux-media-"));
  try {
    for (const entry of REAL_IMAGES) {
      const label = entry[0];
      const data = Buffer.from(entry[1], "base64");
      const mediaType = entry[2];
      const file = join(dir, "sha256-" + label);
      await writeFile(file, data);
      const saved = [];
      const service = {
        ctx: {
          get(key) {
            if (key === "fs") {
              return {
                async resolve(path) {
                  return { targetKey: path, displayPath: path };
                },
                async stat(target) {
                  const info = await stat(target.displayPath);
                  return { type: info.isFile() ? "file" : "dir" };
                },
                async readBytes(target, signal, byteCap) {
                  const bytes = await readFile(target.displayPath);
                  assert.ok(bytes.length <= byteCap, "读取不得超过 byteCap");
                  return new Uint8Array(bytes);
                },
              };
            }
            if (key === "attachments") {
              return {
                imageLimits: { maxImageBytes: 1_000_000, maxMessageImageBytes: 1_000_000 },
                async saveImage(input) {
                  saved.push(input);
                  return { attachmentId: "att", mediaType: input.mediaType };
                },
              };
            }
            return void 0;
          },
        },
      };
      const ref = await resolveImageRef(service, { imagePath: file }, exec);
      assert.equal(saved.length, 1, label + ": 应落盘一次");
      assert.equal(saved[0].mediaType, mediaType, label + ": 真实字节应判定为 " + mediaType);
      assert.equal(ref.mediaType, mediaType);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
