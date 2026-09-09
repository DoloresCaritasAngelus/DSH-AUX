/**
 * dsh-aux review tests for fetch body cancellation (A6) and multi-image
 * vision_analyze allSettled handling (A7). Zero external dependencies: the
 * the direct transport is stubbed for the cancellation test and the vision service
 * is stubbed for the multi-image tests.
 *
 * Run: node --test tests/fetch-vision-review.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveImageRef } from "../dsh-aux/src/images/resolve.js";
import { failureInstruction, runVision } from "../dsh-aux/src/tools/vision.js";
import { classifyFailure, DSH_FAILURE_CODES, isRetryableFailure } from "../dsh-aux/src/route.js";

test("resolveImageRef: cancelable body is cancelled on non-OK imageUrl response", async () => {
  const cancelCalls = [];
  const body = {
    cancel: async () => {
      cancelCalls.push(1);
    },
  };
  const response = {
    ok: false,
    status: 404,
    headers: { get: () => null },
    body,
  };
  const service = {
    allowInternalUrls: true,
    _httpRequest: async () => response,
    ctx: { get: (k) => (k === "attachments" ? {} : void 0) },
  };
  const exec = { signal: void 0 };
  await assert.rejects(() => resolveImageRef(service, { imageUrl: "https://example.com/img.png" }, exec), /HTTP 404/);
  assert.equal(cancelCalls.length, 1, "non-OK response body must be cancelled before throwing");
});

/** Build a stub vision service whose image attachment resolution and vision
 * call are driven by `behavior(id)`, which either returns an analysis text
 * or throws. readImage hands back a full official ImageAttachmentRef so the
 * trace-echo pass-through can be asserted. */
function makeVisionStub(behavior) {
  const attachments = {
    readImage: async (att) => ({
      ref: { attachmentId: att.attachmentId, mediaType: "image/png", bytes: 8, width: 2, height: 2 },
    }),
  };
  const calls = { count: 0, ids: [] };
  const service = {
    _imageCtx: void 0,
    _memoryQueue: Promise.resolve(),
    ctx: { get: (k) => (k === "attachments" ? attachments : void 0) },
    async call(task, request) {
      const id = request.messages[0].content[0].attachment.attachmentId;
      calls.count += 1;
      calls.ids.push(id);
      return behavior(id);
    },
  };
  const exec = {
    signal: void 0,
    agent: {
      // No session.id so ownership/memory side-effects are skipped.
      session: {
        events: [
          {
            // 真实会话日志形状:user/message 的 data 是扁平 UserMessage。
            type: "user/message",
            seq: 1,
            time: 1000,
            data: {
              content: [
                { type: "image", attachment: { attachmentId: "ok1" } },
                { type: "image", attachment: { attachmentId: "ok2" } },
                { type: "image", attachment: { attachmentId: "bad1" } },
              ],
              source: { kind: "user" },
              role: "user",
              id: "msg-1",
            },
            surfaceOp: "append",
          },
        ],
      },
    },
  };
  return { service, exec, calls };
}

test("vision_analyze multi-image: partial failure preserves successful analyses", async () => {
  const { service, exec } = makeVisionStub((id) => {
    if (id === "bad1") throw new Error("boom for bad1");
    return { text: `OK ${id}`, provider: "prov", model: "mod" };
  });
  const result = await runVision(
    service,
    {
      question: "what do you see?",
      images: [{ attachmentId: "ok1" }, { attachmentId: "bad1" }, { attachmentId: "ok2" }],
    },
    exec,
  );
  assert.equal(result.analyses.length, 3);
  assert.deepEqual(result.analyses[0], {
    analysis: "OK ok1",
    provider: "prov",
    model: "mod",
    mode: "aux",
    attachment: { attachmentId: "ok1", mediaType: "image/png", bytes: 8, width: 2, height: 2 },
    imageOrdinal: { scope: "message", index: 1, total: 3 },
  });
  assert.deepEqual(result.analyses[1], {
    analysis: failureInstruction("other"),
    provider: "",
    model: "",
    mode: "aux",
    error: { code: "other", message: "boom for bad1", retryable: false },
  });
  assert.deepEqual(result.analyses[2], {
    analysis: "OK ok2",
    provider: "prov",
    model: "mod",
    mode: "aux",
    attachment: { attachmentId: "ok2", mediaType: "image/png", bytes: 8, width: 2, height: 2 },
    imageOrdinal: { scope: "message", index: 2, total: 3 },
  });
});

test("vision_analyze multi-image: all failures produce error entries without throwing", async () => {
  const { service, exec } = makeVisionStub(() => {
    throw new Error("always fails");
  });
  const result = await runVision(
    service,
    {
      question: "what do you see?",
      images: [{ attachmentId: "ok1" }, { attachmentId: "ok2" }, { attachmentId: "bad1" }],
    },
    exec,
  );
  assert.equal(result.analyses.length, 3);
  for (const entry of result.analyses) {
    assert.equal(entry.analysis, failureInstruction("other"));
    assert.equal(entry.provider, "");
    assert.equal(entry.model, "");
    assert.deepEqual(entry.error, { code: "other", message: "always fails", retryable: false });
  }
});

test("vision_analyze single-image: failure still throws (classic shape preserved)", async () => {
  const { service, exec } = makeVisionStub(() => {
    throw new Error("single boom");
  });
  await assert.rejects(
    () => runVision(service, { attachmentId: "ok1", question: "what is this?" }, exec),
    /single boom/,
  );
});

test("vision_analyze multi-image: 可重试失败(限流)自动重试一次,第二次成功", async () => {
  const attempts = new Map();
  const { service, exec, calls } = makeVisionStub((id) => {
    const seen = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, seen);
    if (id === "bad1" && seen === 1) {
      const error = new Error("429 too many requests");
      error.status = 429;
      throw error;
    }
    return { text: "OK " + id + " #" + seen, provider: "prov", model: "mod" };
  });
  const result = await runVision(service, { question: "q", images: [{ attachmentId: "bad1" }] }, exec);
  assert.equal(calls.count, 2, "可重试失败应恰好重试一次");
  assert.deepEqual(result.analyses[0], {
    analysis: "OK bad1 #2",
    provider: "prov",
    model: "mod",
    mode: "aux",
    attachment: { attachmentId: "bad1", mediaType: "image/png", bytes: 8, width: 2, height: 2 },
    imageOrdinal: { scope: "message", index: 3, total: 3 },
  });
});

test("vision_analyze multi-image: 可重试失败重试后仍失败 → 结构化 error + 指令式文案", async () => {
  const { service, exec, calls } = makeVisionStub(() => {
    throw new Error("fetch failed");
  });
  const result = await runVision(service, { question: "q", images: [{ attachmentId: "bad1" }] }, exec);
  assert.equal(calls.count, 2, "可重试失败应恰好重试一次");
  const entry = result.analyses[0];
  assert.equal(entry.analysis, failureInstruction("connection"));
  assert.match(entry.analysis, /可重试/);
  assert.match(entry.analysis, /请稍后重试本图或单图重发/);
  assert.deepEqual(entry.error, {
    code: "connection",
    message: "fetch failed",
    retryable: true,
  });
});

test("vision_analyze multi-image: 不可重试失败不重试(调用计数 1)", async () => {
  const { service, exec, calls } = makeVisionStub(() => {
    const error = new Error("the model does not support image input");
    throw error;
  });
  const result = await runVision(service, { question: "q", images: [{ attachmentId: "bad1" }] }, exec);
  assert.equal(calls.count, 1, "非可重试失败不得重试");
  assert.deepEqual(result.analyses[0].error, {
    code: "content",
    message: "the model does not support image input",
    retryable: false,
  });
  assert.match(result.analyses[0].analysis, /不可重试/);
  assert.match(result.analyses[0].analysis, /请勿重复调用同一来源/);
});

test("vision_analyze single-image: 可重试失败重试一次后仍失败 → 抛出且计数 2", async () => {
  const { service, exec, calls } = makeVisionStub(() => {
    const error = new Error("429 rate limit");
    error.status = 429;
    throw error;
  });
  await assert.rejects(() => runVision(service, { attachmentId: "ok1", question: "q" }, exec), /429 rate limit/);
  assert.equal(calls.count, 2, "单图路径同样重试一次,失败后保持抛错契约");
});

test("vision_analyze: 取消后不重试(调用计数 1)", async () => {
  const controller = new AbortController();
  const { service, exec, calls } = makeVisionStub(() => {
    controller.abort();
    const error = new Error("429 rate limit");
    error.status = 429;
    throw error;
  });
  exec.signal = controller.signal;
  const result = await runVision(service, { question: "q", images: [{ attachmentId: "bad1" }] }, exec);
  assert.equal(calls.count, 1, "已取消的调用不得重试");
  assert.equal(result.analyses[0].error.code, "aborted");
  assert.equal(result.analyses[0].error.retryable, false);
});

test("失败分类: 可重试集合与 DSH LlmError 码对齐表", () => {
  assert.equal(isRetryableFailure("rate-limit"), true);
  assert.equal(isRetryableFailure("timeout"), true);
  assert.equal(isRetryableFailure("connection"), true);
  for (const kind of ["aborted", "auth", "payment", "model-not-found", "content", "other"]) {
    assert.equal(isRetryableFailure(kind), false, kind + " 不得自动重试");
  }
  // DSH 默认可重试码 = EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT;
  // AUX 只重试其中三个瞬态类(other 覆盖的 5xx 不重试,有意分歧)。
  assert.equal(DSH_FAILURE_CODES["rate-limit"], "RATE_LIMIT");
  assert.equal(DSH_FAILURE_CODES.timeout, "TIMEOUT");
  assert.equal(DSH_FAILURE_CODES.connection, "TRANSPORT");
  assert.equal(DSH_FAILURE_CODES.other, "UNKNOWN");
  // 分类器能产出的每个 kind 都必须在映射表里
  const samples = [
    [{ code: "ABORTED" }, "aborted"],
    [{ code: "TIMEOUT" }, "timeout"],
    [{ status: 429 }, "rate-limit"],
    [{ status: 402 }, "payment"],
    [{ status: 401 }, "auth"],
    [{ status: 404 }, "model-not-found"],
    [{ message: "ECONNREFUSED" }, "connection"],
    [{ code: "UNSUPPORTED_CONTENT" }, "content"],
    [{ message: "boom" }, "other"],
  ];
  for (const entry of samples) {
    const kind = classifyFailure(entry[0]);
    assert.equal(kind, entry[1]);
    assert.equal(typeof DSH_FAILURE_CODES[kind], "string", kind + " 缺少 DSH 映射");
  }
});
