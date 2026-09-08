/**
 * P5.3: ordered auxiliary fallback chains (`tasks.<task>.models`), the singular
 * provider/model compatibility path, and the settings projection/validation
 * that carries the chain.
 *
 * Run: node --test tests/route-chain.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertRouteSpecList,
  mergeTaskConfig,
  parseRouteSpec,
  resolveConfig,
  resolvePrimaryRoute,
  resolveRouteChain,
} from "../dsh-aux/src/route.js";
import { projectSettings, validateAuxSettings } from "../dsh-aux/src/config.js";

const DEFAULTS = { vision: { provider: "def", model: "def-model" }, _any: { provider: "any", model: "any-model" } };

test("resolveRouteChain: models 优先于单数 provider/model", () => {
  const merged = { task: "vision", provider: "single", model: "single-model", models: ["a/one", "b/two"] };
  assert.deepEqual(resolveRouteChain(merged, DEFAULTS), [
    { provider: "a", model: "one" },
    { provider: "b", model: "two" },
  ]);
  // 单数仍可见于 resolvePrimaryRoute 的语义:链首
  assert.deepEqual(resolvePrimaryRoute(merged, DEFAULTS), { provider: "a", model: "one" });
});

test("resolveRouteChain: 无 models 时回落单数,再回落任务默认", () => {
  assert.deepEqual(resolveRouteChain({ task: "vision", provider: "s", model: "m" }, DEFAULTS), [
    { provider: "s", model: "m" },
  ]);
  assert.deepEqual(resolveRouteChain({ task: "vision" }, DEFAULTS), [{ provider: "def", model: "def-model" }]);
  assert.deepEqual(resolveRouteChain({ task: "compress" }, DEFAULTS), [{ provider: "any", model: "any-model" }]);
  assert.deepEqual(resolveRouteChain({ task: "compress" }, {}), []);
  assert.equal(resolvePrimaryRoute({ task: "compress" }, {}), void 0);
});

test("resolveRouteChain: 空 models 数组不生效,重复项去重保序", () => {
  assert.deepEqual(resolveRouteChain({ task: "vision", models: [], provider: "s", model: "m" }, DEFAULTS), [
    { provider: "s", model: "m" },
  ]);
  assert.deepEqual(resolveRouteChain({ task: "vision", models: ["a/one", "a/one", "b/two", "a/one"] }, DEFAULTS), [
    { provider: "a", model: "one" },
    { provider: "b", model: "two" },
  ]);
});

test("parseRouteSpec: 只按第一个斜杠切分,非法形状抛错", () => {
  assert.deepEqual(parseRouteSpec("openrouter/deepseek/deepseek-v4"), {
    provider: "openrouter",
    model: "deepseek/deepseek-v4",
  });
  assert.throws(() => parseRouteSpec("no-slash"), /provider\/model/);
  assert.throws(() => parseRouteSpec("/model"), /provider\/model/);
  assert.throws(() => parseRouteSpec("provider/"), /provider\/model/);
});

test("resolveConfig: tasks.models 被接受并校验", () => {
  const config = resolveConfig({ tasks: { vision: { models: [" a/one ", "b/two"] } } });
  assert.deepEqual(config.tasks.vision.models, ["a/one", "b/two"], "条目应 trim");
  assert.equal(config.tasks.vision.provider, void 0);
  // 单数仍可用,且可与 models 并存(链胜出,不报错)
  const both = resolveConfig({ tasks: { vision: { provider: "p", model: "m", models: ["a/one"] } } });
  assert.deepEqual(both.tasks.vision.models, ["a/one"]);
  assert.equal(both.tasks.vision.provider, "p");
  assert.throws(() => resolveConfig({ tasks: { vision: { models: "a/one" } } }), /must be an array/);
  assert.throws(() => resolveConfig({ tasks: { vision: { models: [""] } } }), /non-empty/);
  assert.throws(() => resolveConfig({ tasks: { vision: { models: ["no-slash"] } } }), /provider\/model/);
});

test("assertRouteSpecList: 非数组/非字符串/空串被拒", () => {
  assert.deepEqual(assertRouteSpecList(["a/b"], "x.models"), ["a/b"]);
  assert.throws(() => assertRouteSpecList(void 0, "x.models"), /must be an array/);
  assert.throws(() => assertRouteSpecList([1], "x.models"), /non-empty/);
  assert.throws(() => assertRouteSpecList(["  "], "x.models"), /non-empty/);
});

test("mergeTaskConfig: 设置里的 models 覆盖插件配置", () => {
  const merged = mergeTaskConfig({ models: ["plugin/one"] }, { models: ["settings/one", "settings/two"] });
  assert.deepEqual(merged.models, ["settings/one", "settings/two"]);
  assert.deepEqual(mergeTaskConfig({ models: ["plugin/one"] }, {}).models, ["plugin/one"]);
});

test("projectSettings: models 仅非空时投影", () => {
  const withChain = projectSettings({ tasks: { vision: { models: ["a/one", "b/two"] } } });
  assert.deepEqual(withChain.tasks.vision.models, ["a/one", "b/two"]);
  assert.equal(withChain.tasks.vision.provider, void 0);
  const without = projectSettings({ tasks: { vision: { models: [] } } });
  assert.equal(without.tasks.vision.models, void 0);
  const copied = projectSettings({ tasks: { vision: { models: ["a/one"] } } });
  copied.tasks.vision.models.push("c/three");
  assert.equal(copied.tasks.vision.models.length, 2, "投影必须是副本");
});

test("validateAuxSettings: 非法链条目被拒,链+单数并存不报错", () => {
  validateAuxSettings({ tasks: { vision: { models: ["a/one", "b/two"] } } });
  validateAuxSettings({ tasks: { vision: { provider: "p", model: "m", models: ["a/one"] } } });
  assert.throws(
    () => validateAuxSettings({ tasks: { vision: { models: ["no-slash"] } } }),
    /must be "provider\/model"/,
  );
  assert.throws(() => validateAuxSettings({ tasks: { vision: { models: [""] } } }), /non-empty/);
  // 单数成对规则不变
  assert.throws(
    () => validateAuxSettings({ tasks: { vision: { provider: "p" } } }),
    /provider and model must be supplied together/,
  );
});
