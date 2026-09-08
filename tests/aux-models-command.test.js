/**
 * T2 (Phase 4): the read-only `/aux models --json` capability probe behind the
 * settings picker. Tri-state per route, cached in-process.
 *
 * Run: node --test tests/aux-models-command.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { handleModelsCommand } from "../dsh-aux/src/commands.js";

function makeService(modalities, { throwOn = [] } = {}) {
  const calls = { resolve: 0, list: 0 };
  const llm = {
    listProviders() {
      return [{ id: "prov-a" }, { id: "prov-b" }];
    },
    async listModels(provider) {
      calls.list += 1;
      if (provider === "prov-b") throw new Error("catalog unavailable");
      return [
        { id: "vision-model", name: "Vision" },
        { id: "text-model", name: "Text" },
        { id: "unknown-model", name: "?" },
      ];
    },
    async resolveModelInfo(provider, model) {
      calls.resolve += 1;
      if (throwOn.includes(model)) throw new Error("resolve failed");
      return { provider, model, inputModalities: modalities[model] };
    },
  };
  const service = {
    ctx: { get: (key) => (key === "llm" ? llm : void 0) },
    _imageCapabilityCache: new Map(),
  };
  return { service, calls };
}

const MODALITIES = {
  "vision-model": ["text", "image"],
  "text-model": ["text"],
  "unknown-model": [],
};

test("/aux models --json: 三态与不可用目录降级", async () => {
  const { service } = makeService(MODALITIES);
  const out = await handleModelsCommand(service, ["--json"]);
  assert.equal(out.kind, "success");
  const data = JSON.parse(out.text);
  assert.deepEqual(
    data.routes,
    [
      { provider: "prov-a", model: "vision-model", name: "Vision", imageCapable: true },
      { provider: "prov-a", model: "text-model", name: "Text", imageCapable: false },
      { provider: "prov-a", model: "unknown-model", name: "?", imageCapable: null },
    ],
    "prov-b 目录不可用应被跳过,空模态列表 = unknown",
  );
});

test("/aux models: 解析失败记 unknown,结果按 provider+model 进程内缓存", async () => {
  const { service, calls } = makeService({ ...MODALITIES, "text-model": void 0 }, { throwOn: ["text-model"] });
  const first = await handleModelsCommand(service, ["--json"]);
  assert.equal(JSON.parse(first.text).routes[1].imageCapable, null, "resolve 抛错 = unknown");
  const resolvesAfterFirst = calls.resolve;
  const second = await handleModelsCommand(service, ["--json"]);
  assert.equal(JSON.parse(second.text).routes[1].imageCapable, null, "缓存命中仍是 unknown");
  assert.equal(calls.resolve, resolvesAfterFirst, "第二次不得再解析");
  assert.equal(calls.list > 1, true, "目录本身每次都会列(只有能力解析被缓存)");
});

test("/aux models: 未挂载 llm 时返回错误;人类可读输出含三态", async () => {
  const bare = { ctx: { get: () => void 0 } };
  const missing = await handleModelsCommand(bare, []);
  assert.equal(missing.kind, "error");
  assert.match(missing.text, /llm service is not mounted/);

  const { service } = makeService(MODALITIES);
  const out = await handleModelsCommand(service, []);
  assert.equal(out.kind, "success");
  assert.match(out.text, /prov-a\/vision-model: true/);
  assert.match(out.text, /prov-a\/text-model: false/);
  assert.match(out.text, /prov-a\/unknown-model: unknown/);
});
