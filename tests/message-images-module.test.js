/**
 * T1 (Phase 4): unit tests for the message-image ordinal helper and the
 * generator that inlines the module into the shipped browser bundle.
 *
 * Run: node --test tests/message-images-module.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { contentImageIds, messageImageOrdinal } from "../dsh-aux/src/client/message-images.js";
import {
  BUNDLE_PATH,
  MODULE_PATH,
  assertDependencyFree,
  isInSync,
  renderBlock,
} from "../scripts/gen-client-message-images.mjs";

const REF_A = { attachmentId: "sha256:" + "aa".repeat(32) };
const REF_B = { attachmentId: "sha256:" + "bb".repeat(32) };

function imageBlock(attachment) {
  return { type: "image", attachment };
}
function userNode(blocks, kind = "user") {
  return { kind, seq: 1, time: 1, content: blocks, source: { kind: "user" } };
}
function trajectoryOf(nodes) {
  return (selector) => selector({ eventNodes: nodes });
}

test("contentImageIds: 只数顶层 image 块并保序", () => {
  const ids = contentImageIds([
    imageBlock(REF_A),
    { type: "text", text: "hi" },
    imageBlock(REF_B),
    { type: "tool-result", content: [imageBlock({ attachmentId: "sha256:" + "cc".repeat(32) })] },
    imageBlock({}),
    null,
  ]);
  assert.deepEqual(ids, [REF_A.attachmentId, REF_B.attachmentId], "嵌套工具图不计入,无 id 的块跳过");
  assert.deepEqual(contentImageIds(void 0), []);
});

test("messageImageOrdinal: 只在 align=end 的用户/steering 消息上编号", () => {
  const nodes = [userNode([imageBlock(REF_A), imageBlock(REF_B), imageBlock(REF_A)])];
  assert.deepEqual(
    messageImageOrdinal({ useTrajectory: trajectoryOf(nodes), image: { attachment: REF_B }, align: "end" }),
    {
      index: 2,
      total: 3,
    },
  );
  assert.equal(
    messageImageOrdinal({ useTrajectory: trajectoryOf(nodes), image: { attachment: REF_B }, align: "start" }),
    null,
    "assistant markdown 组不编号",
  );
  assert.deepEqual(
    messageImageOrdinal({
      useTrajectory: trajectoryOf([userNode([imageBlock(REF_A), imageBlock(REF_B)], "steering")]),
      image: { attachment: REF_A },
      align: "end",
    }),
    { index: 1, total: 2 },
    "steering 也是用户消息",
  );
});

test("messageImageOrdinal: 预览臂、缺 hook、hook 抛错、找不到都返回 null", () => {
  const nodes = [userNode([imageBlock(REF_A)])];
  assert.equal(
    messageImageOrdinal({ useTrajectory: trajectoryOf(nodes), image: { preview: { url: "blob:x" } }, align: "end" }),
    null,
  );
  assert.equal(messageImageOrdinal({ image: { attachment: REF_A }, align: "end" }), null);
  assert.equal(
    messageImageOrdinal({
      useTrajectory: () => {
        throw new Error("no trajectory");
      },
      image: { attachment: REF_A },
      align: "end",
    }),
    null,
  );
  assert.equal(
    messageImageOrdinal({ useTrajectory: trajectoryOf(nodes), image: { attachment: REF_B }, align: "end" }),
    null,
  );
  assert.equal(messageImageOrdinal({ useTrajectory: trajectoryOf(nodes), image: null, align: "end" }), null);
});

test("角标契约: 单图消息不显示(消歧才有意义)", async () => {
  // 位置仍由 messageImageOrdinal 给出;是否显示由组件按 total 决定。
  const nodes = [userNode([imageBlock(REF_A)])];
  assert.deepEqual(
    messageImageOrdinal({ useTrajectory: trajectoryOf(nodes), image: { attachment: REF_A }, align: "end" }),
    { index: 1, total: 1 },
  );
  const source = await readFile(MODULE_PATH, "utf8");
  assert.match(source, /ordinal\.total < 2 \? null/, "组件必须在 total < 2 时不显示角标");
});

test("messageImageOrdinal: 同一 id 命中多条消息(歧义)时不编号", () => {
  const ambiguous = trajectoryOf([userNode([imageBlock(REF_A)]), userNode([imageBlock(REF_A), imageBlock(REF_B)])]);
  assert.equal(messageImageOrdinal({ useTrajectory: ambiguous, image: { attachment: REF_A }, align: "end" }), null);
});

test("生成器: 拒绝任何依赖,渲染块去掉 export,且与已提交的 bundle 同步", async () => {
  assert.throws(() => assertDependencyFree('import x from "y";'), /dependency-free/);
  assert.throws(() => assertDependencyFree('const x = require("y");'), /dependency-free/);
  assert.throws(() => assertDependencyFree('const m = import("y");'), /dependency-free/);
  const source = await readFile(MODULE_PATH, "utf8");
  assert.doesNotThrow(() => assertDependencyFree(source), "源文件必须无依赖");
  const block = renderBlock(source);
  assert.ok(block.includes("function installMessageImages"), "块内应含实现");
  assert.ok(!/^export /m.test(block), "块内不得残留 export");
  const bundle = await readFile(BUNDLE_PATH, "utf8");
  assert.equal(await isInSync(bundle, source), true, "bundle 生成块必须与源文件同步");
});
