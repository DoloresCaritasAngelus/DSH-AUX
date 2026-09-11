/**
 * 设置页诊断面板的两条契约。
 *
 * 1. i18n 覆盖率:面板用 t("status.reason." + reason) 这类拼键查表,键缺失时 t() 会把
 *    键名原样显示,用户看到的是 status.reason.force-aux-vision-overrides-route 这种
 *    字符串。漏键不会报错,只会难看且难懂,所以这里对着 status.js 实际产出的字面量核对。
 * 2. 严重度分级:severity === "note" 的是「配置后果说明」,不该计入「需处理」——
 *    把提示当待办会训练读者忽略面板。
 *
 * 运行:cd <仓库路径> && node --test tests/status-panel.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPlatformStatus } from "../dsh-aux/src/status.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const read = (rel) => readFileSync(join(REPO, rel), "utf8");

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
    forceAuxVision: false,
    visionRoute: "aux",
    nativeRoutes: [],
    subagentMode: "native",
    subagentPrepareTools: true,
    subagentIncludeWorkflow: true,
    skillMode: "native",
    ctx: { logger: { warn: () => {} } },
    ...overrides,
  };
}

test("i18n:status.js 产出的每个 reason/action/state 都有 client.js 文案", () => {
  const status = read("dsh-aux/src/status.js");
  const client = read("dsh-aux/src/client.js");
  const keys = new Set([...client.matchAll(/"(status\.[a-z0-9.-]+)":/g)].map((m) => m[1]));
  const literals = new Set();
  const fields = ["reason", "action", "state"];
  for (const field of fields) {
    const re = new RegExp(field + ':\\s*"([a-z0-9-]+)"', "g");
    for (const m of status.matchAll(re)) literals.add("status." + field + "." + m[1]);
  }
  assert.ok(literals.size > 0, "没有解析到任何字面量,闸失效");
  const missing = [...literals].filter((key) => !keys.has(key)).sort();
  assert.deepEqual(missing, [], "这些键在 client.js 里没有文案(会原样显示给用户): " + missing.join(", "));
});

test("i18n:中英两套文案的键集一致(漏译会让某一语言回落成键名)", () => {
  const client = read("dsh-aux/src/client.js");
  const hits = [...client.matchAll(/"(status\.[a-z0-9.-]+)":/g)].map((m) => m[1]);
  const counts = new Map();
  for (const key of hits) counts.set(key, (counts.get(key) ?? 0) + 1);
  const once = [...counts]
    .filter((pair) => pair[1] === 1)
    .map((pair) => pair[0])
    .sort();
  assert.deepEqual(once, [], "这些键只出现一次(疑似漏了一种语言): " + once.join(", "));
});

test("严重度:forceAuxVision 覆盖 visionRoute 属配置说明(note),不计入待处理", async () => {
  const snapshot = await collectPlatformStatus(fakeService({ forceAuxVision: true, visionRoute: "auto" }));
  const note = (snapshot.warnings ?? []).find((w) => w.code === "force-aux-vision-overrides-route");
  assert.ok(note, "该配置组合必须产出提示");
  assert.equal(note.severity, "note", "它描述的是既有配置的后果,不该计入「需处理」");
});

test("严重度:vision_analyze 关闭但 imageBridge 开启仍属待处理", async () => {
  const snapshot = await collectPlatformStatus(
    fakeService({ _enabled: { vision_analyze: "native", imageBridge: "aux" } }),
  );
  const warning = (snapshot.warnings ?? []).find((w) => w.code === "vision-disabled-image-bridge-enabled");
  assert.ok(warning, "该组合必须产出提示");
  assert.notEqual(warning.severity, "note", "这条需要用户处理,不能降级成说明");
});
