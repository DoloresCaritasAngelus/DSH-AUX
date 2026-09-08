/**
 * P0 regression (A42): a `user/message` event stores the UserMessage itself as
 * `event.data` (flat: content / role / id / source), so image extraction must
 * normalize per event type. The fixture below mirrors the real session log
 * shape recorded from a live session; it is deliberately not the older nested
 * `data.message` shape, which never matched a pasted image.
 *
 * Run: node --test tests/user-message-image.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { eventImageRefs, messageOrdinalFor, sessionImageRefs } from "../dsh-aux/src/images/refs.js";
import { resolveImageRef } from "../dsh-aux/src/images/resolve.js";

const PASTED_ID = "sha256:6d5f" + "a".repeat(60);
const TOOL_ID = "sha256:7e6a" + "b".repeat(60);

/** Real `user/message` event: `data` is the flat UserMessage itself. */
function pastedMessageEvent(ids = [PASTED_ID], seq = 9) {
  return {
    type: "user/message",
    seq,
    time: 1757300000000,
    data: {
      content: [
        ...ids.map((attachmentId) => ({
          type: "image",
          attachment: {
            attachmentId,
            mediaType: "image/png",
            bytes: 12345,
            width: 800,
            height: 600,
            name: "image.png",
          },
        })),
        { type: "text", text: "测试." },
      ],
      source: { kind: "user" },
      role: "user",
      id: "msg-" + seq,
    },
    surfaceOp: "append",
  };
}

/** Real `tool/result` event: the message is nested under `data.message`. */
function toolResultEvent(attachmentId = TOOL_ID) {
  return {
    type: "tool/result",
    seq: 10,
    time: 1757300001000,
    data: {
      turn: 1,
      step: 1,
      message: {
        content: [{ type: "tool-result", content: [{ type: "image", attachment: { attachmentId } }] }],
      },
    },
  };
}

test("真实 user/message 形状: eventImageRefs/sessionImageRefs 能取到粘贴图", () => {
  const event = pastedMessageEvent();
  assert.deepEqual(
    eventImageRefs(event).map((ref) => ref.attachmentId),
    [PASTED_ID],
    "data 是扁平 UserMessage,必须直接读 data.content",
  );
  assert.deepEqual(
    sessionImageRefs([event, toolResultEvent()]).map((ref) => ref.attachmentId),
    [PASTED_ID, TOOL_ID],
  );
});

test("真实 user/message 形状: resolveImageRef(attachmentId) 找得到(影响 ①)", async () => {
  const attachments = {
    async readImage(attachment) {
      return { ref: { attachmentId: attachment.attachmentId, mediaType: "image/png" } };
    },
  };
  const service = {
    _imageCtx: void 0,
    ctx: { get: (key) => (key === "attachments" ? attachments : void 0) },
  };
  const session = { id: "s-1", snapshotEvents: () => [pastedMessageEvent()] };
  const ref = await resolveImageRef(
    service,
    { attachmentId: PASTED_ID },
    {
      agent: { session },
      signal: void 0,
    },
  );
  assert.deepEqual(ref, { attachmentId: PASTED_ID, mediaType: "image/png" });
});

test("真实 user/message 形状: messageOrdinalFor 返回消息级 N/M(影响 ③)", () => {
  const first = pastedMessageEvent(["sha256:" + "1".repeat(64), "sha256:" + "2".repeat(64)], 4);
  const second = pastedMessageEvent([PASTED_ID, "sha256:" + "3".repeat(64)], 9);
  assert.deepEqual(messageOrdinalFor([first, second], PASTED_ID), { index: 1, total: 2 });
  assert.deepEqual(messageOrdinalFor([first, second], "sha256:" + "2".repeat(64)), { index: 2, total: 2 });
  assert.equal(messageOrdinalFor([first], "sha256:" + "9".repeat(64)), void 0);
});

test("容错与排除: 派生 event.message 仍可解析,inbox/spliced 不计入", () => {
  const derived = {
    type: "user/message",
    message: { content: [{ type: "image", attachment: { attachmentId: PASTED_ID } }] },
  };
  assert.deepEqual(
    eventImageRefs(derived).map((ref) => ref.attachmentId),
    [PASTED_ID],
  );
  const spliced = {
    type: "agent/inbox/spliced",
    data: { inserted: [{ content: [{ type: "image", attachment: { attachmentId: PASTED_ID } }] }] },
  };
  assert.deepEqual(eventImageRefs(spliced), [], "spliced 的 inserted 随后会成为 user/message,计入会重复");
  assert.equal(messageOrdinalFor([spliced], PASTED_ID), void 0);
});
