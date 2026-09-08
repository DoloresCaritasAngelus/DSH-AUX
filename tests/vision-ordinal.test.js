/**
 * P5.6: display ordinals for analyzed images. An image that came from a user
 * message is numbered inside that message (the bridge numbering, same source
 * and order); anything else is numbered inside the tool call. The value also
 * rides along in presentationMeta so the AUX toolview card can label each
 * thumbnail without parsing content text.
 *
 * Run: node --test tests/vision-ordinal.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { messageOrdinalFor } from "../dsh-aux/src/images/refs.js";
import { runVision } from "../dsh-aux/src/tools/vision.js";

function userMessage(ids) {
  return {
    type: "user/message",
    message: { content: ids.map((attachmentId) => ({ type: "image", attachment: { attachmentId } })) },
  };
}

test("messageOrdinalFor: 消息内 1 基序号与总数", () => {
  const events = [userMessage(["a", "b", "c"])];
  assert.deepEqual(messageOrdinalFor(events, "a"), { index: 1, total: 3 });
  assert.deepEqual(messageOrdinalFor(events, "c"), { index: 3, total: 3 });
  assert.equal(messageOrdinalFor(events, "zz"), void 0);
  assert.equal(messageOrdinalFor(events, void 0), void 0);
});

test("messageOrdinalFor: 最新一条命中消息优先,工具产物不计入消息编号", () => {
  const events = [
    userMessage(["a", "b"]),
    {
      type: "tool/result",
      message: { content: [{ type: "tool-result", content: [{ type: "image", attachment: { attachmentId: "a" } }] }] },
    },
    userMessage(["c", "a"]),
  ];
  assert.deepEqual(messageOrdinalFor(events, "a"), { index: 2, total: 2 }, "取最新消息里的位置");
  assert.equal(messageOrdinalFor([{ type: "tool/result", message: { content: [] } }], "a"), void 0);
});

/** Vision stub: attachments.readImage returns a durable ref per id. */
function makeStub(behavior, events) {
  const attachments = {
    imageLimits: { maxImageBytes: 1000, maxMessageImageBytes: 1000 },
    readImage: async (att) => ({
      ref: { attachmentId: att.attachmentId, mediaType: "image/png", bytes: 8, width: 2, height: 2 },
    }),
    saveImage: async (input) => ({
      attachmentId: "att-" + (input.name ?? "x"),
      mediaType: input.mediaType,
      bytes: input.data.length,
      width: 1,
      height: 1,
    }),
  };
  const service = {
    _imageCtx: void 0,
    _memoryQueue: Promise.resolve(),
    allowInternalUrls: true,
    ctx: {
      get(key) {
        if (key === "attachments") return attachments;
        if (key === "fs") {
          return {
            async resolve(path) {
              return { targetKey: path, displayPath: path };
            },
            async stat() {
              return { type: "file" };
            },
            async readBytes() {
              return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            },
          };
        }
        return void 0;
      },
    },
    async call(task, request) {
      const id = request.messages[0].content[0].attachment.attachmentId;
      return behavior(id);
    },
  };
  const exec = { signal: void 0, agent: { session: { events } } };
  return { service, exec };
}

test("runVision: 消息图片按消息编号,imagePath 按调用编号", async () => {
  const events = [userMessage(["ok1", "ok2", "ok3"])];
  const { service, exec } = makeStub(() => ({ text: "seen", provider: "p", model: "m" }), events);
  const result = await runVision(
    service,
    {
      question: "q",
      images: [{ attachmentId: "ok2" }, { imagePath: "/workspace/note" }],
    },
    exec,
  );
  assert.deepEqual(result.analyses[0].imageOrdinal, { scope: "message", index: 2, total: 3 });
  assert.deepEqual(result.analyses[1].imageOrdinal, { scope: "call", index: 2, total: 2 });
});

test("runVision: 单图 attachmentId 走消息编号,单图 imagePath 走调用编号", async () => {
  const events = [userMessage(["solo"])];
  const fromMessage = makeStub(() => ({ text: "seen", provider: "p", model: "m" }), events);
  const single = await runVision(fromMessage.service, { attachmentId: "solo", question: "q" }, fromMessage.exec);
  assert.deepEqual(single.imageOrdinal, { scope: "message", index: 1, total: 1 });

  const fromPath = makeStub(() => ({ text: "seen", provider: "p", model: "m" }), []);
  const singlePath = await runVision(fromPath.service, { imagePath: "/workspace/a.png", question: "q" }, fromPath.exec);
  assert.deepEqual(singlePath.imageOrdinal, { scope: "call", index: 1, total: 1 });
});

test("runVision: 失败条目不携带 imageOrdinal(卡片只出文本)", async () => {
  const events = [userMessage(["bad1"])];
  const { service, exec } = makeStub(() => {
    throw new Error("boom");
  }, events);
  const result = await runVision(service, { question: "q", images: [{ attachmentId: "bad1" }] }, exec);
  assert.equal(result.analyses[0].imageOrdinal, void 0);
  assert.equal(result.analyses[0].error.code, "other");
});
