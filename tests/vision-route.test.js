/**
 * Vision delivery routing tests (P2): the pure aux/native decision, the
 * zero-call guarantee, the delivery shape and the explicit failure path.
 *
 * Run: cd <仓库路径> && node --test tests/vision-route.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveVisionDelivery, routeKey } from "../dsh-aux/src/vision-route.js";
import { analyzeOne } from "../dsh-aux/src/tools/vision.js";

const MAIN = { provider: "deepseek-official", model: "deepseek-v4.1-flash" };
const MAIN_KEY = routeKey(MAIN.provider, MAIN.model);
const AUX = { provider: "volcengine-ark", model: "minimax-m3" };

test("resolveVisionDelivery: 默认 aux,native 需白名单且不被否定模态否决", () => {
  assert.deepEqual(resolveVisionDelivery({ mainRoute: MAIN, nativeRoutes: [MAIN_KEY] }), {
    mode: "aux",
    reason: "route-aux",
  });
  assert.deepEqual(
    resolveVisionDelivery({ visionRoute: "native-when-capable", nativeRoutes: [MAIN_KEY], mainRoute: MAIN }),
    {
      mode: "native",
      reason: "native-capable",
    },
  );
  assert.deepEqual(
    resolveVisionDelivery({
      visionRoute: "native-when-capable",
      nativeRoutes: [MAIN_KEY],
      mainRoute: MAIN,
      mainInputModalities: ["text", "image"],
    }),
    { mode: "native", reason: "native-capable" },
  );
  assert.deepEqual(
    resolveVisionDelivery({
      visionRoute: "native-when-capable",
      nativeRoutes: [MAIN_KEY],
      mainRoute: MAIN,
      mainInputModalities: ["text"],
    }),
    { mode: "aux", reason: "main-text-only" },
    "非空且不含 image 的模态是否定门",
  );
  assert.deepEqual(resolveVisionDelivery({ visionRoute: "native-when-capable", nativeRoutes: [], mainRoute: MAIN }), {
    mode: "aux",
    reason: "route-not-whitelisted",
  });
  assert.deepEqual(
    resolveVisionDelivery({
      visionRoute: "native-when-capable",
      nativeRoutes: [MAIN_KEY],
      forceAuxVision: true,
      mainRoute: MAIN,
    }),
    { mode: "aux", reason: "force-aux-vision" },
    "forceAuxVision 覆盖一切",
  );
  assert.deepEqual(resolveVisionDelivery({ visionRoute: "native-when-capable", nativeRoutes: [MAIN_KEY] }), {
    mode: "aux",
    reason: "no-main-route",
  });
  assert.deepEqual(
    resolveVisionDelivery({ visionRoute: "native-only", nativeRoutes: [MAIN_KEY], mainRoute: MAIN }),
    {
      mode: "aux",
      reason: "route-aux",
    },
    "未支持的取值按 aux 处理(不存在 native-only)",
  );
});

test("resolveVisionDelivery: auto 只在主路由 == 解析后的 aux 路由时 native", () => {
  assert.deepEqual(
    resolveVisionDelivery({ visionRoute: "auto", nativeRoutes: [MAIN_KEY], mainRoute: MAIN, auxRoute: { ...MAIN } }),
    { mode: "native", reason: "native-capable" },
  );
  assert.deepEqual(
    resolveVisionDelivery({ visionRoute: "auto", nativeRoutes: [MAIN_KEY], mainRoute: MAIN, auxRoute: AUX }),
    { mode: "aux", reason: "auto-route-mismatch" },
    "配置了不同的辅助视觉路由时仍走 aux",
  );
  assert.deepEqual(
    resolveVisionDelivery({ visionRoute: "auto", nativeRoutes: [MAIN_KEY], mainRoute: MAIN }),
    { mode: "native", reason: "native-capable" },
    "auto 且未配置辅助路由:主模型是唯一选择",
  );
});

/** Service stub: records aux calls; attachment read returns a durable ref. */
function makeStub({ delivery, ref, attachmentId } = {}) {
  const calls = [];
  const attachments = {
    readImage: async (att) => ({
      ref: ref ?? { attachmentId: att.attachmentId, mediaType: "image/png", bytes: 8, width: 2, height: 2 },
    }),
  };
  const service = {
    _memoryQueue: Promise.resolve(),
    ctx: { get: (key) => (key === "attachments" ? attachments : void 0) },
    async call(task, request) {
      calls.push({ task, request });
      return { text: "aux answer", provider: AUX.provider, model: AUX.model };
    },
    async visionDelivery() {
      return delivery ?? { mode: "aux", reason: "route-aux" };
    },
  };
  const exec = {
    signal: void 0,
    agent: {
      // No session id: ownership/memory side effects (and any DSH_HOME write)
      // stay out of this routing test. The image is referenced from the log so
      // resolveImageRef can find it.
      session: {
        events:
          attachmentId === void 0
            ? []
            : [{ type: "user/message", message: { content: [{ type: "image", attachment: { attachmentId } }] } }],
      },
    },
  };
  return { service, exec, calls };
}

test("analyzeOne: native 交付零辅助调用,形状含 mode 与主路由", async () => {
  const target = "sha256:" + "a".repeat(64);
  const { service, exec, calls } = makeStub({
    delivery: { mode: "native", reason: "native-capable", mainRoute: MAIN },
    attachmentId: target,
  });
  const result = await analyzeOne(service, { attachmentId: target }, "这张图是什么?", exec);
  assert.equal(calls.length, 0, "native 下不得调用辅助模型(零调用断言)");
  assert.equal(result.mode, "native");
  assert.equal(result.provider, MAIN.provider);
  assert.equal(result.model, MAIN.model);
  assert.equal(result.attachment.attachmentId, target);
  assert.match(result.analysis, /原生视觉交付/);
});

test("analyzeOne: aux 交付照常调用辅助模型并标 mode=aux", async () => {
  const target = "sha256:" + "b".repeat(64);
  const { service, exec, calls } = makeStub({ delivery: { mode: "aux", reason: "route-aux" }, attachmentId: target });
  const result = await analyzeOne(service, { attachmentId: target }, "问题", exec);
  assert.equal(calls.length, 1);
  assert.equal(result.mode, "aux");
  assert.equal(result.analysis, "aux answer");
  assert.equal(result.provider, AUX.provider);
});

test("analyzeOne: native 交付拿不到持久 ref 时显式报错并点名 visionRoute: 'aux'", async () => {
  const target = "sha256:" + "c".repeat(64);
  const { service, exec } = makeStub({
    delivery: { mode: "native", reason: "native-capable", mainRoute: MAIN },
    ref: {},
    attachmentId: target,
  });
  await assert.rejects(
    () => analyzeOne(service, { attachmentId: target }, "问题", exec),
    /aux\.visionRoute: 'aux'/,
    "不得静默回落到 aux",
  );
});
