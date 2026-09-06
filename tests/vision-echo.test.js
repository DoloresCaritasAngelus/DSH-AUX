/**
 * dsh-aux 轨迹回显测试(trace echo): vision_analyze 把消费的持久图片 ref
 * 原样带回工具结果,官方 render 管线随即产出 text+image 块,轨迹视图因此
 * 能看到辅助模型实际分析过的图。
 *
 * 锁定的不变量:
 *  - 形状锁: 输出 schema 拒绝多字段/缺字段的 ref(与官方 read_image 的
 *    IMAGE_VALUE_SCHEMA 逐字段一致,"不多不少");
 *  - 官方对齐: 同一 ref 下,我们的 image block 与真实 read_image render
 *    的产物逐字段一致(按当期安装的 DSH 版本对照);
 *  - 加载边: 携带回显块的 tool/result 消息被官方 Session 种子校验原样
 *    接受(结构不变、深冻结),会话日志不因回显而损坏;
 *  - presentationMeta: 单图/多图统一产出 attachments 数组(当前无官方
 *    消费者,前向兼容声明)。
 *
 * 运行: node --test tests/vision-echo.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import { Session } from "@deepseek-ai/dsh-session";
import { apply as applyToolFs, Config as ToolFsConfig } from "@deepseek-ai/dsh-tool-fs";
import { registerAuxTools } from "../dsh-aux/src/tools/register.js";
import { sessionEvents } from "../dsh-aux/src/session-utils.js";

/** 与官方 ImageAttachmentRef 完全同形的样例 ref(含全部可选字段)。 */
const FULL_REF = {
  attachmentId: "sha256:11111111",
  mediaType: "image/png",
  bytes: 1234,
  width: 64,
  height: 32,
  name: "shot.png",
  originalDimensions: { width: 128, height: 64 },
};

const BARE_REF = {
  attachmentId: "sha256:22222222",
  mediaType: "image/jpeg",
  bytes: 10,
  width: 4,
  height: 4,
};

/** 通过最小 attachments 注入作用域捕获 vision_analyze 注册定义
 * (镜像 registerAuxTools 的挂载路径,不依赖完整 harness)。 */
function captureVisionDefinition() {
  const defs = [];
  const collector = { register: (def) => (defs.push(def), () => {}) };
  registerAuxTools({
    isToolExposed: (name) => name === "vision_analyze",
    ctx: { inject: (_deps, fn) => fn({ tools: collector }) },
  });
  const def = defs.find((d) => d.name === "vision_analyze");
  assert.ok(def, "vision_analyze 定义应已注册");
  return def;
}

/** 注册真实官方 tool-fs 插件并捕获 read_image 定义 —— 官方 render 产物
 * 是形状对齐的基准(随兼容矩阵逐版本对照)。 */
function captureReadImageDefinition() {
  const defs = [];
  const collector = { register: (def) => (defs.push(def), () => {}) };
  const noop = () => {};
  applyToolFs(
    {
      tools: collector,
      fs: {},
      get: () => void 0,
      inject: (_deps, fn) => fn({ tools: collector }),
      systemPrompt: { section: noop, getSectionOrder: () => 0 },
      logger: { info: noop, warn: noop, error: noop },
    },
    ToolFsConfig({}),
  );
  const def = defs.find((d) => d.name === "read_image");
  assert.ok(def, "read_image 定义应已注册");
  return def;
}

test("trace echo: 单图 render 产出 text + image 两块,ref 原样透传", () => {
  const def = captureVisionDefinition();
  const value = { analysis: "A red button", provider: "prov", model: "mod", attachment: FULL_REF };
  assert.deepEqual(def.output.render({}, value), [
    { type: "text", text: "A red button" },
    { type: "image", attachment: FULL_REF },
  ]);
});

test("trace echo: 多图 render 按序 text→image 交替,失败项只有 text", () => {
  const def = captureVisionDefinition();
  const value = {
    analyses: [
      { analysis: "one", provider: "prov", model: "mod", attachment: FULL_REF },
      { analysis: "vision_analyze: image failed: boom", provider: "", model: "" },
      { analysis: "three", provider: "prov", model: "mod", attachment: BARE_REF },
    ],
    provider: "prov",
    model: "mod",
  };
  const blocks = def.output.render({}, value);
  assert.equal(blocks.length, 5, "3 个 text + 2 个 image");
  assert.deepEqual(blocks[0], { type: "text", text: "【图1】one" });
  assert.deepEqual(blocks[1], { type: "image", attachment: FULL_REF });
  assert.deepEqual(blocks[2], { type: "text", text: "【图2】vision_analyze: image failed: boom" });
  assert.equal(blocks[3].type, "text", "失败项不渲染 image 块");
  assert.deepEqual(blocks[4], { type: "image", attachment: BARE_REF });
});

test("trace echo: 输出 schema 锁形 —— ref 多一字段或少一必填字段都被拒", () => {
  const schema = captureVisionDefinition().output.schema;
  const single = { analysis: "a", provider: "prov", model: "mod", attachment: FULL_REF };
  assert.deepEqual(validateJsonSchemaValue(schema, single, "value"), [], "完整 ref 应通过");
  const extra = { ...single, attachment: { ...FULL_REF, extraField: 1 } };
  assert.ok(validateJsonSchemaValue(schema, extra, "value").length > 0, "多字段 ref 应被拒");
  const missing = {
    ...single,
    attachment: { attachmentId: FULL_REF.attachmentId, bytes: 1, width: 1, height: 1 },
  };
  assert.ok(validateJsonSchemaValue(schema, missing, "value").length > 0, "缺 mediaType 的 ref 应被拒");
  const bare = { ...single, attachment: BARE_REF };
  assert.deepEqual(validateJsonSchemaValue(schema, bare, "value"), [], "无可选字段的 ref 应通过");
});

test("trace echo: 输出 schema 接受无 attachment 的失败条目(多图)", () => {
  const schema = captureVisionDefinition().output.schema;
  const value = {
    analyses: [{ analysis: "vision_analyze: image failed: boom", provider: "", model: "" }],
    provider: "",
    model: "",
  };
  assert.deepEqual(validateJsonSchemaValue(schema, value, "value"), []);
});

test("trace echo: image block 与官方 read_image render 逐字段一致", () => {
  const readImage = captureReadImageDefinition();
  const vision = captureVisionDefinition();
  const official = readImage.output.render({}, { path: "/w/shot.png", image: FULL_REF });
  const ours = vision.output.render({}, { analysis: "a", provider: "prov", model: "mod", attachment: FULL_REF });
  assert.equal(official[1].type, "image", "read_image 第二块应为 image");
  assert.deepEqual(ours[1], official[1], "回显 image block 必须与官方产物不多不少");
});

test("trace echo: 回显块通过官方 Session 种子校验且结构原样存活", () => {
  const toolResult = (seq, callId) => ({
    type: "tool/result",
    seq,
    time: 1,
    surfaceOp: "append",
    data: {
      message: {
        id: "m" + seq,
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: callId,
            content: [
              { type: "text", text: "【图1】A red button" },
              { type: "image", attachment: FULL_REF },
            ],
            isError: false,
          },
        ],
        source: { kind: "tool", callId },
      },
    },
  });
  const session = Session.create("aux-echo-test", [toolResult(0, "call-1"), toolResult(1, "call-2")]);
  const inner = sessionEvents(session)
    .slice(0, 2)
    .map((event) => event.data.message.content[0].content.find((b) => b.type === "image"));
  assert.deepEqual(inner[0], { type: "image", attachment: FULL_REF });
  assert.deepEqual(inner[1], { type: "image", attachment: FULL_REF });
  assert.equal(Object.isFrozen(inner[0]), true, "入库快照应深冻结");
});

test("trace echo: presentationMeta 统一产出 attachments 数组", () => {
  const def = captureVisionDefinition();
  const multi = {
    analyses: [
      { analysis: "one", provider: "prov", model: "mod", attachment: FULL_REF },
      { analysis: "failed", provider: "", model: "" },
      { analysis: "three", provider: "prov", model: "mod", attachment: BARE_REF },
    ],
    provider: "prov",
    model: "mod",
  };
  assert.deepEqual(def.output.presentationMeta({}, multi), { attachments: [FULL_REF, BARE_REF] });
  const single = { analysis: "a", provider: "prov", model: "mod", attachment: BARE_REF };
  assert.deepEqual(def.output.presentationMeta({}, single), { attachments: [BARE_REF] });
});
