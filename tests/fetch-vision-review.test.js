/**
 * dsh-aux review tests for fetch body cancellation (A6) and multi-image
 * vision_analyze allSettled handling (A7). Zero external dependencies: the
 * global fetch is stubbed for the cancellation test and the vision service
 * is stubbed for the multi-image tests.
 *
 * Run: node --test tests/fetch-vision-review.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveImageRef } from "../dsh-aux/src/images/resolve.js";
import { runVision } from "../dsh-aux/src/tools/vision.js";

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
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    const service = {
      allowInternalUrls: true,
      ctx: { get: (k) => (k === "attachments" ? {} : void 0) },
    };
    const exec = { signal: void 0 };
    await assert.rejects(() => resolveImageRef(service, { imageUrl: "https://example.com/img.png" }, exec), /HTTP 404/);
    assert.equal(cancelCalls.length, 1, "non-OK response body must be cancelled before throwing");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

/** Build a stub vision service whose image attachment resolution and vision
 * call are driven by `behavior(id)`, which either returns an analysis text
 * or throws. */
function makeVisionStub(behavior) {
  const attachments = {
    readImage: async (att) => ({ ref: { attachmentId: att.attachmentId } }),
  };
  const service = {
    _imageCtx: void 0,
    _memoryQueue: Promise.resolve(),
    ctx: { get: (k) => (k === "attachments" ? attachments : void 0) },
    async call(task, request) {
      const id = request.messages[0].content[0].attachment.attachmentId;
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
            type: "user/message",
            message: {
              content: [
                { type: "image", attachment: { attachmentId: "ok1" } },
                { type: "image", attachment: { attachmentId: "ok2" } },
                { type: "image", attachment: { attachmentId: "bad1" } },
              ],
            },
          },
        ],
      },
    },
  };
  return { service, exec };
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
  assert.deepEqual(result.analyses[0], { analysis: "OK ok1", provider: "prov", model: "mod" });
  assert.deepEqual(result.analyses[1], {
    analysis: "vision_analyze: image failed: boom for bad1",
    provider: "",
    model: "",
  });
  assert.deepEqual(result.analyses[2], { analysis: "OK ok2", provider: "prov", model: "mod" });
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
    assert.match(entry.analysis, /^vision_analyze: image failed: always fails$/);
    assert.equal(entry.provider, "");
    assert.equal(entry.model, "");
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
