/**
 * C3 boundary tests: `vision_analyze` imagePath must delegate path resolution
 * and reading to the host `fs` service, and must not bypass a host-side
 * sandbox rejection by re-resolving the raw path itself.
 *
 * Run: node --test tests/fs-boundary.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveImageRef } from "../dsh-aux/src/images/resolve.js";

function makeService(fs, attachments) {
  return {
    ctx: {
      get(key) {
        if (key === "fs") return fs;
        if (key === "attachments") return attachments;
        return void 0;
      },
    },
  };
}

const exec = {
  signal: void 0,
  agent: { session: { header: { cwd: "/workspace" } } },
};

test("imagePath: 宿主 fs 拒绝时插件原样传播,不绕过沙箱", async () => {
  let resolveCalled = false;
  const fs = {
    async resolve() {
      resolveCalled = true;
      const error = new Error("fs sandbox denied: outside writable roots");
      error.code = "FS_DENIED";
      throw error;
    },
    async stat() {
      throw new Error("should not reach stat");
    },
    async readBytes() {
      throw new Error("should not reach readBytes");
    },
  };
  const attachments = {
    imageLimits: { maxImageBytes: 1000, maxMessageImageBytes: 1000 },
    async saveImage() {
      throw new Error("should not reach saveImage");
    },
  };
  const service = makeService(fs, attachments);
  await assert.rejects(() => resolveImageRef(service, { imagePath: "/etc/passwd.png" }, exec), /fs sandbox denied/);
  assert.equal(resolveCalled, true, "必须经过 fs.resolve");
});

test("imagePath: readBytes 收到的是 fs.resolve 返回的 target,而不是原始用户路径", async () => {
  const resolvedTarget = { targetKey: "/workspace/img.png", displayPath: "/workspace/img.png" };
  const readTargets = [];
  const fs = {
    async resolve() {
      return resolvedTarget;
    },
    async stat() {
      return { type: "file" };
    },
    async readBytes(target, signal, byteCap) {
      readTargets.push(target);
      return new Uint8Array([1, 2, 3]);
    },
  };
  const attachments = {
    imageLimits: { maxImageBytes: 1000, maxMessageImageBytes: 1000 },
    async saveImage(input) {
      return { attachmentId: "att", mediaType: input.mediaType };
    },
  };
  const service = makeService(fs, attachments);
  const ref = await resolveImageRef(service, { imagePath: "../../etc/passwd.png" }, exec);
  assert.equal(readTargets.length, 1);
  assert.equal(readTargets[0], resolvedTarget, "读取必须使用 fs 解析后的 target");
  assert.ok(ref);
});
