/**
 * Core review tests for the medium/low fixes (A1/A2/B5):
 *  - A2: a call with no candidates records an aux/llm-call failure event
 *    (`errorCode: 'no-route'`) before throwing.
 *  - B5: custom tasks registered via registerTask/registerAuxTask appear in
 *    describe() and are viewable (but not configurable) via /aux model.
 *
 * Run: cd <repo>/tests && node --test core-review.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import AuxLlmService, { AUX_CALL_EVENT } from "../dsh-aux/src/index.js";

/** Drain macrotask queue so ctx.inject child fibers land. */
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function makeHarness(config) {
  const ctx = new Context();
  const commands = [];
  await ctx.plugin({
    name: "review-stubs",
    apply(stubCtx) {
      stubCtx.provide("tools", {
        register() {
          return () => {};
        },
      });
      stubCtx.provide("settings", {});
      stubCtx.provide("systemPrompt", {
        section() {
          return () => {};
        },
      });
      stubCtx.provide("web", {
        async fetch() {
          throw new Error("no");
        },
      });
      stubCtx.provide("fs", {
        async resolve(p) {
          return { displayPath: p };
        },
        async stat() {
          return { type: "file" };
        },
        async readBytes() {
          return new Uint8Array(0);
        },
      });
      stubCtx.provide("attachments", {
        imageLimits: {
          maxImageBytes: 1000,
          maxMessageImageBytes: 1000,
          maxImagesPerMessage: 1,
          maxImagePixels: 1000,
          mediaTypes: ["image/png"],
        },
        async validateImage() {},
        async saveImage(i) {
          return { attachmentId: "a", mediaType: i.mediaType, bytes: 0, width: 1, height: 1 };
        },
        async readImage(r) {
          return { ref: r, data: new Uint8Array(0) };
        },
      });
      stubCtx.provide("llm", {
        async stream() {
          throw new Error("no");
        },
      });
      stubCtx.provide("sessionProjections", {
        register() {
          return () => {};
        },
      });
      stubCtx.provide("commands", {
        register(def) {
          commands.push(def);
          return () => {};
        },
      });
    },
  });
  await ctx.plugin(AuxLlmService, config ?? {});
  await settle();
  // Simulate deployed dsh-session with the ignorable patch (event writes on).
  ctx.auxLlm._sessionEventsSupportedCache = true;
  return { ctx, commands };
}

test("A2: no route and no main model records a no-route failure event before throwing", async () => {
  const { ctx } = await makeHarness();
  // A custom task with no provider/model and no main model available.
  ctx.auxLlm.registerTask({ key: "bare" });
  // Session without requestHeader → no session main route; no agentDefaultModel
  // is provided in the harness → _mainRoute returns undefined → no candidates.
  const session = {
    id: "sess-review",
    events: [],
    append(type, data) {
      this.events.push({ type, data });
    },
  };
  await assert.rejects(
    () => ctx.auxLlm.call("bare", { messages: [], session }),
    /no route configured and no main model available/,
  );
  const events = session.events.filter((e) => e.type === AUX_CALL_EVENT);
  assert.equal(events.length, 1);
  const data = events[0].data;
  assert.equal(data.task, "bare");
  assert.equal(data.provider, "");
  assert.equal(data.model, "");
  assert.equal(data.ok, false);
  assert.equal(data.errorCode, "no-route");
  assert.equal(data.fallbackUsed, false);
  assert.equal(typeof data.durationMs, "number");
});

test("B5: custom tasks appear in describe() with label/route/timeout/concurrency", async () => {
  const { ctx } = await makeHarness();
  ctx.auxLlm.registerTask({
    key: "custom-summary",
    label: "自定义摘要",
    provider: "opencode-go",
    model: "glm-5.2",
    timeoutMs: 30_000,
    maxConcurrency: 4,
  });
  const status = ctx.auxLlm.describe();
  const entry = status.find((s) => s.task === "custom-summary");
  assert.ok(entry, "custom task should be listed in describe()");
  assert.equal(entry.label, "自定义摘要");
  assert.equal(entry.configured, true);
  assert.deepEqual(entry.primary, { provider: "opencode-go", model: "glm-5.2" });
  assert.equal(entry.timeoutMs, 30_000);
  assert.equal(entry.maxConcurrency, 4);
  // Label defaults to the task key when not provided.
  ctx.auxLlm.registerTask({ key: "bare" });
  const bare = ctx.auxLlm.describe().find((s) => s.task === "bare");
  assert.ok(bare);
  assert.equal(bare.label, "bare");
  assert.equal(bare.configured, false);
  assert.equal(bare.primary, null);
});

test("B5: /aux model views a custom task route but rejects writes", async () => {
  const { ctx, commands } = await makeHarness();
  const handler = commands[0].handler;
  ctx.auxLlm.registerTask({
    key: "custom-summary",
    label: "自定义摘要",
    provider: "opencode-go",
    model: "glm-5.2",
  });
  // VIEW: custom task is inspectable.
  const viewed = await handler({ agent: void 0, rawInput: "model custom-summary" });
  assert.equal(viewed.kind, "success");
  assert.ok(viewed.text.includes("辅助模型 [custom-summary]"));
  assert.ok(viewed.text.includes("opencode-go/glm-5.2"));
  // WRITE: custom tasks are not configurable.
  const written = await handler({ agent: void 0, rawInput: "model custom-summary volcengine-ark/glm-5.2" });
  assert.equal(written.kind, "error");
  assert.ok(written.text.includes("custom tasks are not configurable via /aux model"));
});

test("B5: unknown task (not built-in, not custom) still errors on /aux model", async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: "model nope" });
  assert.equal(out.kind, "error");
  assert.ok(out.text.includes("task"));
});
