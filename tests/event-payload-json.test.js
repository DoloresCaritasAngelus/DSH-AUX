/**
 * 会话事件载荷必须 JSON 可序列化(回归:平台状态面板曾经一直读不到)。
 *
 * 症状:设置页显示「无法获取平台状态」,而 `aux/platform-status` 事件在会话里
 * 一条也没有 —— `session.append` 因载荷含 `undefined` 被 DSH 拒绝
 * (`carries non-JSON-serializable data`),而写入路径把它静默吞掉了。
 *
 * 根因:`imageLifecycle.blockedReason` 在「删除就绪」这个**正常**状态下是 undefined,
 * 而当时的过滤只清顶层 undefined,嵌套的照样进载荷。
 *
 * 运行:cd <仓库路径> && node --test tests/event-payload-json.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { withoutUndefined } from "../dsh-aux/src/events.js";
import { collectPlatformStatus } from "../dsh-aux/src/status.js";

/** 走查:返回载荷里所有 `undefined` 的路径。 */
function undefinedPaths(value, path = "status", out = []) {
  if (value === undefined) {
    out.push(path);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => undefinedPaths(entry, `${path}[${index}]`, out));
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) undefinedPaths(entry, `${path}.${key}`, out);
  }
  return out;
}

/** 最小可用的 service 形状(collectPlatformStatus 只读这些字段)。 */
function fakeService(overrides = {}) {
  return {
    _enabled: {},
    toolBridgeMode(key) {
      return this._enabled?.[key] ?? "aux";
    },
    isToolExposed(key) {
      return this.toolBridgeMode(key) === "aux";
    },
    forceAuxVision: true,
    visionRoute: "auto",
    nativeRoutes: [],
    subagentMode: "native",
    subagentPrepareTools: true,
    subagentIncludeWorkflow: true,
    skillMode: "native",
    ctx: { logger: { warn: () => {} } },
    ...overrides,
  };
}

test("withoutUndefined:清掉对象与数组里的嵌套 undefined", () => {
  const input = { a: 1, b: undefined, c: { d: undefined, e: [1, undefined, { f: undefined, g: 2 }] } };
  const out = withoutUndefined(input);
  assert.deepEqual(out, { a: 1, c: { e: [1, { g: 2 }] } });
  assert.deepEqual(undefinedPaths(out, "out"), [], "不得残留 undefined");
  assert.equal(JSON.parse(JSON.stringify(out)).c.e[1].g, 2, "应为合法 JSON");
});

test("平台状态快照经 withoutUndefined 后不再含 undefined(事件可序列化)", async () => {
  const snapshot = await collectPlatformStatus(fakeService());
  // 「删除就绪」正是阻塞项为 undefined 的正常状态,这里必须能复现它,否则本测试失效。
  assert.equal(snapshot.imageLifecycle?.deletionReady, true, "fixture 应处于删除就绪态");
  assert.ok(undefinedPaths(snapshot).length > 0, "原始快照应确实带 undefined(证明这是真回归,而不是测试自证)");
  const safe = withoutUndefined(snapshot);
  assert.deepEqual(undefinedPaths(safe), [], "清理后不得残留 undefined");
  assert.doesNotThrow(() => structuredClone(safe), "清理后应可结构化克隆(与会话写入同判据)");
});
