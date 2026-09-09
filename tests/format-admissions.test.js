/**
 * P12/P13: `dsh-session-format-v0-to-v1` v0 冻结词表放行的纯函数回归。
 *
 * 部署文件不在仓库里(由 npm 安装),所以这里用一份**最小同构 fixture**复刻官方
 * 0.1.5-alpha.1 的四个锚点(词表字面量 / semantic switch 的 default /
 * replayEnvelopeValue / permission-preset 与 abort-cause 的键校验),断言:
 *   - 该补什么、不该补什么;
 *   - 幂等(连跑两次第二次零改动);
 *   - 已打第三方救援补丁的文件被识别为已就绪;
 *   - 产物能过 `node --check`。
 *
 * 运行:cd <仓库路径> && node --test tests/format-admissions.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OFFICIAL_THINKING_TYPE,
  dispositionLine,
  inspectFormatV0,
  planFormatV0Patch,
} from "../bridge/format-admissions.mjs";
import { AUX_EVENT_SHAPES } from "../dsh-aux/src/event-shapes.js";

/** 官方 0.1.5-alpha.1 的四个锚点(最小同构;缩进与官方一致用 tab)。 */
const PRISTINE = [
  "const disposition = defineReleasedPayloadDisposition;",
  "const RELEASED_V0_EVENT_DISPOSITIONS = Object.freeze({",
  '\t"agent-preset/selected": disposition(["agentPreset"]),',
  '\t"model/selection": disposition(["provider", "model"], ["reasoningEffort"]),',
  '\t"permission/preset": disposition(["preset"]),',
  "});",
  "function assertReleasedV0Keys(record, required, optional = [], label) {",
  "\tconst allowed = new Set([...required, ...optional]);",
  "\tvoid allowed;",
  "}",
  "function assertReleasedPayloadSemantics(event, version) {",
  "\tswitch (event.type) {",
  '\t\tcase "model/selection":',
  "\t\t\treturn;",
  '\t\tcase "permission/preset":',
  "\t\t\treturn;",
  "\t\tdefault: throw new SessionFormatError(`released payload validator is missing event ${JSON.stringify(event.type)}`);",
  "\t}",
  "}",
  "function replayEnvelopeValue(value, label) {",
  '\tconst replay = exactRecord(value, label, ["response"], ["blocks"]);',
  '\tif (replay["blocks"] !== void 0 && !Array.isArray(replay["blocks"])) throw new SessionFormatError(`${label} blocks must be an array`);',
  "}",
  "function turnEndReasonValue(value, label) {",
  "\tconst cause = releasedV0Record(value, label);",
  '\tif (cause["kind"] === "hook") {',
  '\t\tassertReleasedV0Keys(cause, ["kind", "reason"], [], `${label} abort cause`);',
  "\t} else {",
  '\t\tassertReleasedV0Keys(cause, ["kind"], [], `${label} abort cause`);',
  "\t}",
  "}",
  "",
].join("\n");

test("P12:四个 aux/* 事件都补上 disposition + 透传 case", () => {
  const result = planFormatV0Patch(PRISTINE);
  for (const type of Object.keys(AUX_EVENT_SHAPES)) {
    assert.ok(result.applied.includes("disposition " + type), "缺少 disposition " + type);
    assert.ok(result.applied.includes("case " + type), "缺少 case " + type);
    assert.ok(result.text.includes(JSON.stringify(type) + ": disposition("), type + " 未落盘");
    assert.ok(result.text.includes("case " + JSON.stringify(type) + ":"), type + " 的 case 未落盘");
  }
});

test("P12:登记表的每个字段都出现在生成的 disposition 里", () => {
  for (const [type, shape] of Object.entries(AUX_EVENT_SHAPES)) {
    const line = dispositionLine(type, shape);
    for (const key of shape.optional) assert.ok(line.includes(JSON.stringify(key)), type + " 少了字段 " + key);
  }
});

test("P13:官方写端缺口一并放行,thinking/language 走同一条通道", () => {
  const result = planFormatV0Patch(PRISTINE);
  assert.ok(result.applied.includes("permission/preset origin"));
  assert.ok(result.applied.includes("replayState opaque"));
  assert.ok(result.applied.includes("abort cause stack"));
  assert.ok(result.applied.includes("disposition " + OFFICIAL_THINKING_TYPE));
  assert.ok(result.text.includes('"permission/preset": disposition(["preset"], ["origin"])'));
  assert.ok(result.text.includes('assertReleasedV0Keys(cause, ["kind"], ["stack"]'));
  assert.ok(result.text.includes("const replay = releasedV0Record(value, label);"));
  assert.equal(result.text.includes("exactRecord(value, label"), false);
  assert.deepEqual(result.warnings, []);
});

test("P13 可关闭:includeOfficialGaps=false 时只动 AUX 自有事件", () => {
  const result = planFormatV0Patch(PRISTINE, { includeOfficialGaps: false });
  assert.equal(result.text.includes('"origin"'), false);
  assert.equal(result.text.includes('"stack"'), false);
  assert.equal(result.text.includes(OFFICIAL_THINKING_TYPE), false);
  assert.ok(result.text.includes('"aux/llm-call": disposition('));
});

test("幂等:对产物再规划一次是零改动", () => {
  const first = planFormatV0Patch(PRISTINE);
  const second = planFormatV0Patch(first.text);
  assert.deepEqual(second.applied, []);
  assert.equal(second.text, first.text);
  assert.ok(second.skipped.length >= Object.keys(AUX_EVENT_SHAPES).length);
});

test("第三方救援补丁已打:全部识别为已就绪,零改动", () => {
  const rescue = planFormatV0Patch(PRISTINE).text;
  const items = inspectFormatV0(rescue);
  assert.deepEqual(
    items.filter((item) => item.state !== "installed"),
    [],
  );
});

test("inspectFormatV0 在原始文件上报告全部缺失", () => {
  const items = inspectFormatV0(PRISTINE);
  assert.equal(
    items.every((item) => item.state === "missing"),
    true,
  );
});

test("产物通过 node --check", () => {
  const result = planFormatV0Patch(PRISTINE);
  const dir = mkdtempSync(join(tmpdir(), "dsh-aux-p12-"));
  try {
    const file = join(dir, "index.mjs");
    writeFileSync(file, result.text);
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("锚点缺失只告警,不抛错", () => {
  const result = planFormatV0Patch("const x = 1;\n");
  assert.ok(result.warnings.length >= 2);
  assert.equal(result.text, "const x = 1;\n");
});
