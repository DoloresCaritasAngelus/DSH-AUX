/**
 * S1 / #26 / #27 锁:多图 vision_analyze 的**真实返回**必须通过 defineTool 编译后的
 * 输出 schema,顶层多来源必须显式拒绝,visionDelivery 每批只决策一次。
 *
 * 与 vision-echo.test.js 的「手工构造形状」用例互补:这里的每个值都由真实
 * runVision 产出,再喂给与运行时同源的 validateJsonSchemaValue(见 dsh-tools
 * createSuccessResult 的校验路径),因此 schema 漂移会真的红,而不是被手写的
 * 期望形状掩盖。
 *
 * 运行: node --test tests/vision-batch-mode.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import { registerAuxTools } from "../dsh-aux/src/tools/register.js";
import { runVision } from "../dsh-aux/src/tools/vision.js";

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

const SCHEMA = captureVisionDefinition().output.schema;

/** 会话日志里可用的图片 id;ok* 成功,bad* 抛错。 */
const MESSAGE_IDS = ["ok1", "ok2", "ok3", "bad1", "bad2"];

/** 真实会话日志形状:user/message 的 data 是扁平 UserMessage。 */
function userMessage(ids) {
  return {
    type: "user/message",
    seq: 1,
    time: 1000,
    data: {
      content: ids.map((attachmentId) => ({ type: "image", attachment: { attachmentId } })),
      source: { kind: "user" },
      role: "user",
      id: "msg-1",
    },
    surfaceOp: "append",
  };
}

/** Vision stub:真实 attachments 形状 + 可计数交付决策/辅助调用/图片读取。
 * `refFor` 可让某张图解析不出持久 ref(用于 native 交付失败面)。 */
function makeService({ delivery, behavior, refFor } = {}) {
  const counters = { delivery: 0, calls: 0, readImage: 0 };
  const attachments = {
    imageLimits: { maxImageBytes: 1000, maxMessageImageBytes: 1000, maxImagesPerMessage: 5 },
    async readImage(att) {
      counters.readImage += 1;
      if (refFor !== void 0) return { ref: refFor(att.attachmentId) };
      return { ref: { attachmentId: att.attachmentId, mediaType: "image/png", bytes: 8, width: 2, height: 2 } };
    },
    async saveImage(input) {
      return {
        attachmentId: "att-" + (input.name ?? "x"),
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 1,
        height: 1,
      };
    },
  };
  const service = {
    _imageCtx: void 0,
    _memoryQueue: Promise.resolve(),
    // 预置:recordAuxEvent 不探测已部署的 dsh-session 包。
    _sessionEventsSupportedCache: true,
    allowInternalUrls: true,
    ctx: { get: (key) => (key === "attachments" ? attachments : void 0) },
    async call(task, request) {
      counters.calls += 1;
      const id = request.messages[0].content[0].attachment.attachmentId;
      if (behavior !== void 0) return behavior(id);
      return { text: "seen " + id, provider: "prov", model: "mod" };
    },
    async visionDelivery() {
      counters.delivery += 1;
      return delivery ?? { mode: "aux", reason: "route-aux" };
    },
  };
  const exec = {
    signal: void 0,
    agent: {
      // 无 session.id:归属/记忆副作用不落盘。
      session: { events: [userMessage(MESSAGE_IDS)], append() {} },
    },
  };
  return { service, exec, counters };
}

const failBad = (id) => {
  if (id.startsWith("bad")) throw new Error("boom for " + id);
  return { text: "seen " + id, provider: "prov", model: "mod" };
};

test("定义锁: 编译后 schema 顶层 required 含 mode", () => {
  assert.deepEqual([...SCHEMA.required].sort(), ["mode", "model", "provider"]);
  assert.deepEqual([...SCHEMA.properties.analyses.items.required].sort(), ["analysis", "mode", "model", "provider"]);
});

test("S1: images[2] 全成功 → 真实返回通过编译后 schema,顶层 mode=aux", async () => {
  const { service, exec } = makeService({ behavior: failBad });
  const result = await runVision(
    service,
    { question: "q", images: [{ attachmentId: "ok1" }, { attachmentId: "ok2" }] },
    exec,
  );
  assert.deepEqual(validateJsonSchemaValue(SCHEMA, result, "value"), []);
  assert.deepEqual(Object.keys(result).sort(), ["analyses", "mode", "model", "provider"]);
  assert.equal(result.mode, "aux");
  assert.equal(result.mode, result.analyses[0].mode);
  assert.equal(result.provider, "prov");
  assert.equal(result.model, "mod");
});

test("S1: images[1] 单元素数组 → 真实返回通过编译后 schema", async () => {
  const { service, exec } = makeService({ behavior: failBad });
  const result = await runVision(service, { question: "q", images: [{ attachmentId: "ok1" }] }, exec);
  assert.deepEqual(validateJsonSchemaValue(SCHEMA, result, "value"), []);
  assert.equal(result.mode, "aux");
  assert.equal(result.analyses.length, 1);
});

test("S1: 部分失败 → 真实返回通过编译后 schema", async () => {
  const { service, exec } = makeService({ behavior: failBad });
  const result = await runVision(
    service,
    { question: "q", images: [{ attachmentId: "ok1" }, { attachmentId: "bad1" }, { attachmentId: "ok2" }] },
    exec,
  );
  assert.deepEqual(validateJsonSchemaValue(SCHEMA, result, "value"), []);
  assert.equal(result.analyses[1].error.code, "other");
  assert.equal(result.mode, "aux");
});

test("S1: 全失败 → 真实返回通过编译后 schema", async () => {
  const { service, exec } = makeService({ behavior: failBad });
  const result = await runVision(
    service,
    { question: "q", images: [{ attachmentId: "bad1" }, { attachmentId: "bad2" }] },
    exec,
  );
  assert.deepEqual(validateJsonSchemaValue(SCHEMA, result, "value"), []);
  assert.equal(result.provider, "");
  assert.equal(result.model, "");
  assert.equal(result.mode, "aux");
});

test("S1: native 多图 → 真实返回通过编译后 schema,顶层 mode=native", async () => {
  const mainRoute = { provider: "main-prov", model: "main-mod" };
  const { service, exec } = makeService({
    behavior: failBad,
    delivery: { mode: "native", reason: "native-capable", mainRoute },
  });
  const result = await runVision(
    service,
    { question: "q", images: [{ attachmentId: "ok1" }, { attachmentId: "ok2" }] },
    exec,
  );
  assert.deepEqual(validateJsonSchemaValue(SCHEMA, result, "value"), []);
  assert.equal(result.mode, "native");
  assert.equal(result.analyses[0].mode, "native");
  assert.equal(result.provider, mainRoute.provider);
  assert.equal(result.model, mainRoute.model);
});

test("S1: native 单图(经典字段) → 真实返回通过编译后 schema(回归)", async () => {
  const mainRoute = { provider: "main-prov", model: "main-mod" };
  const { service, exec } = makeService({
    behavior: failBad,
    delivery: { mode: "native", reason: "native-capable", mainRoute },
  });
  const result = await runVision(service, { attachmentId: "ok1", question: "q" }, exec);
  assert.deepEqual(validateJsonSchemaValue(SCHEMA, result, "value"), []);
  assert.equal(result.mode, "native");
});

test("S1: native 批次首项交付失败 → 顶层 mode 仍取批次决策且 schema 通过", async () => {
  const mainRoute = { provider: "main-prov", model: "main-mod" };
  const { service, exec } = makeService({
    behavior: failBad,
    // bad1 解析不出持久 ref:native 交付必须显式失败,而不是静默回落 aux。
    refFor: (id) => (id === "bad1" ? {} : { attachmentId: id, mediaType: "image/png", bytes: 8, width: 2, height: 2 }),
    delivery: { mode: "native", reason: "native-capable", mainRoute },
  });
  const result = await runVision(
    service,
    { question: "q", images: [{ attachmentId: "bad1" }, { attachmentId: "ok1" }] },
    exec,
  );
  assert.deepEqual(validateJsonSchemaValue(SCHEMA, result, "value"), []);
  assert.equal(result.mode, "native", "顶层取批次决策,而不是首个失败条目的 aux 标签");
  assert.equal(result.analyses[0].mode, "aux", "失败条目沿用既有 aux 兜底标签");
  assert.equal(result.analyses[0].error.code, "other");
  assert.equal(result.analyses[1].mode, "native");
  assert.equal(result.analyses[1].provider, mainRoute.provider);
});

test("#26: 顶层多来源显式拒绝,不静默取 attachmentId", async () => {
  const { service, exec, counters } = makeService({ behavior: failBad });
  await assert.rejects(
    () => runVision(service, { question: "q", attachmentId: "ok1", imagePath: "/workspace/x.png" }, exec),
    /exactly one of attachmentId, imagePath, or imageUrl/,
  );
  assert.equal(counters.readImage, 0, "拒绝必须发生在解析之前");
  assert.equal(counters.delivery, 0, "拒绝必须发生在交付决策之前");
  await assert.rejects(
    () => runVision(service, { question: "q", attachmentId: "ok1", imageUrl: "https://example.com/x.png" }, exec),
    /exactly one of attachmentId, imagePath, or imageUrl/,
  );
  await assert.rejects(
    () => runVision(service, { question: "q", imagePath: "/a.png", imageUrl: "https://example.com/x.png" }, exec),
    /exactly one of attachmentId, imagePath, or imageUrl/,
  );
  await assert.rejects(
    () =>
      runVision(
        service,
        { question: "q", attachmentId: "ok1", imagePath: "/a.png", imageUrl: "https://example.com/x.png" },
        exec,
      ),
    /exactly one of attachmentId, imagePath, or imageUrl/,
  );
});

test("#27: images[3] 每批只决策一次 visionDelivery", async () => {
  const { service, exec, counters } = makeService({ behavior: failBad });
  const result = await runVision(
    service,
    { question: "q", images: [{ attachmentId: "ok1" }, { attachmentId: "ok2" }, { attachmentId: "ok3" }] },
    exec,
  );
  assert.equal(counters.delivery, 1, "每批一次,而非每图一次");
  assert.equal(counters.calls, 3);
  assert.equal(result.analyses.length, 3);
});

test("#27: 批次内重试不重复决策(429 重试一次仍为 1)", async () => {
  const attempts = new Map();
  const { service, exec, counters } = makeService({
    behavior: (id) => {
      const seen = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, seen);
      if (seen === 1) {
        const error = new Error("429 rate limit");
        error.status = 429;
        throw error;
      }
      return { text: "seen " + id, provider: "prov", model: "mod" };
    },
  });
  const result = await runVision(service, { question: "q", images: [{ attachmentId: "bad1" }] }, exec);
  assert.equal(counters.delivery, 1, "重试不得重复交付决策");
  assert.equal(counters.calls, 2, "仍恰好重试一次");
  assert.equal(result.mode, "aux");
});

test("#27: 经典单图同样只决策一次", async () => {
  const { service, exec, counters } = makeService({ behavior: failBad });
  await runVision(service, { attachmentId: "ok1", question: "q" }, exec);
  assert.equal(counters.delivery, 1);
});
