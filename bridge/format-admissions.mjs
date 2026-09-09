#!/usr/bin/env node
/**
 * P12/P13 — `@deepseek-ai/dsh-session-format-v0-to-v1` 的 v0 冻结词表放行。
 *
 * 背景(2026-09-09 实测)
 * --------------------
 * DSH 0.1.5 的会话读取管线新增 v0→v1 多级迁移,迁移层对每个事件做两道冻结校验:
 *   1. `RELEASED_V0_EVENT_DISPOSITIONS`(冻结词表)——不在表里的类型直接拒,
 *      连 `ignorable: true` 都不放行;
 *   2. `assertReleasedEventPayload` 的逐类型语义 switch——表里有、switch 无 case
 *      同样抛 "released payload validator is missing event"。
 * 另有 `assertReleasedV0Keys` 对**多余成员**零容忍(`has unexpected member`)。
 *
 * 于是这些历史会话在 0.1.5 上永久读不出来:
 *   - P12:AUX 自己的四个 `aux/*` 事件(冻结词表没有);
 *   - P13:官方写端自己发出的形状——`permission/preset.origin`(0.1.1-rc.1)、
 *     abort cause `stack`(0.1.3 线)、官方 `thinking/language`、
 *     provider 扩展的 `assistant/chunk finish.replayState`。
 *
 * 官方没有注册缝(`defineReleasedPayloadDisposition` 只是 frozen 构造器,词表本身
 * `Object.freeze`),只能改部署文件。本模块把改动做成**纯函数**,供
 * `bridge/self-heal.mjs` 调用、供测试固定行为。
 *
 * 设计约束
 * --------
 * - 逐项幂等:每处先探测再改;已应用(含第三方救援补丁)自动跳过。
 * - P13 自退役:上游把该形状收进词表后,探测命中即跳过,不重复打。
 * - 只做文本外科手术,不改写任何会话数据;产物由调用方跑 `node --check` 后才落盘。
 *
 * @module bridge/format-admissions
 */
import { AUX_EVENT_SHAPES } from "../dsh-aux/src/event-shapes.js";

/** 部署内目标文件(相对 DSH 根)。 */
export const FORMAT_V0_TARGET = "node_modules/@deepseek-ai/dsh-session-format-v0-to-v1/lib/index.js";

const DISPOSITIONS_ANCHOR = "const RELEASED_V0_EVENT_DISPOSITIONS = Object.freeze({";
const SWITCH_DEFAULT_RE =
  /^([ \t]*)default: throw new SessionFormatError\(`released payload validator is missing event \$\{JSON\.stringify\(event\.type\)}`\);/m;
const REPLAY_FN_RE = /function replayEnvelopeValue\(value, label\) \{\r?\n([\s\S]*?)\r?\n}/;
const REPLAY_PRISTINE = 'exactRecord(value, label, ["response"], ["blocks"])';
const PERMISSION_PRESET_RE = /("permission\/preset"\s*:\s*disposition\(\s*\["preset"\])(\s*\))/;
const PERMISSION_PRESET_DONE_RE =
  /"permission\/preset"\s*:\s*disposition\(\s*\["preset"\]\s*,\s*\[[^\]]*"origin"[^\]]*\]\s*\)/;
const ABORT_CAUSE_RE = /(assertReleasedV0Keys\(cause, \["kind"\], )\[\](\s*,\s*`\$\{label} abort cause`\))/;
const ABORT_CAUSE_DONE_RE = /assertReleasedV0Keys\(cause, \["kind"\], \["stack"\]/;

/** 官方事件类型:官方写端会写、冻结词表却没登记。 */
export const OFFICIAL_THINKING_TYPE = "thinking/language";

/** 官方缺口(可选放行,上游收编后自动退役)的稳定 id。 */
export const OFFICIAL_GAP_IDS = Object.freeze([
  "permission-preset-origin",
  "replay-state-opaque",
  "abort-cause-stack",
  "thinking-language",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasDisposition(text, type) {
  return new RegExp(escapeRegExp(JSON.stringify(type)) + "\\s*:\\s*disposition\\(").test(text);
}

function hasSwitchCase(text, type) {
  return new RegExp("case\\s+" + escapeRegExp(JSON.stringify(type)) + "\\s*:").test(text);
}

function listLiteral(keys) {
  return `[${keys.map((key) => JSON.stringify(key)).join(", ")}]`;
}

/** 一行 disposition 字面量(与官方同构:required, optional, opaque)。 */
export function dispositionLine(type, shape, indent = "\t") {
  return `${indent}${JSON.stringify(type)}: disposition(${listLiteral(shape.required)}, ${listLiteral(shape.optional)}, []),`;
}

function switchCaseLines(type, indent) {
  return `${indent}case ${JSON.stringify(type)}:\n${indent}\treturn;`;
}

function shapeFor(type) {
  return AUX_EVENT_SHAPES[type] ?? { required: [], optional: [type.split("/")[1] ?? "value"] };
}

/**
 * 逐项探测目标文件当前状态。只读,供 doctor/status 与自愈日志复用。
 *
 * @param {string} text - 目标文件源码。
 * @returns {{id: string, owner: "aux"|"official", type?: string, state: "installed"|"missing"}[]}
 */
export function inspectFormatV0(text) {
  const items = [];
  for (const type of Object.keys(AUX_EVENT_SHAPES)) {
    items.push({
      id: `aux:${type}`,
      owner: "aux",
      type,
      state: hasDisposition(text, type) && hasSwitchCase(text, type) ? "installed" : "missing",
    });
  }
  items.push({
    id: "official:thinking-language",
    owner: "official",
    type: OFFICIAL_THINKING_TYPE,
    state:
      hasDisposition(text, OFFICIAL_THINKING_TYPE) && hasSwitchCase(text, OFFICIAL_THINKING_TYPE)
        ? "installed"
        : "missing",
  });
  items.push({
    id: "official:permission-preset-origin",
    owner: "official",
    state: PERMISSION_PRESET_DONE_RE.test(text) ? "installed" : "missing",
  });
  items.push({
    id: "official:replay-state-opaque",
    owner: "official",
    state: REPLAY_FN_RE.test(text) && !text.includes(REPLAY_PRISTINE) ? "installed" : "missing",
  });
  items.push({
    id: "official:abort-cause-stack",
    owner: "official",
    state: ABORT_CAUSE_DONE_RE.test(text) ? "installed" : "missing",
  });
  return items;
}

/**
 * 计算目标文件需要的全部改动(纯函数,不写盘)。
 *
 * @param {string} text - 目标文件源码。
 * @param {{includeOfficialGaps?: boolean}} [options] - `includeOfficialGaps: false` 时只放行 AUX 自有事件。
 * @returns {{text: string, applied: string[], skipped: string[], warnings: string[]}}
 */
export function planFormatV0Patch(text, options = {}) {
  const includeOfficialGaps = options.includeOfficialGaps !== false;
  const applied = [];
  const skipped = [];
  const warnings = [];
  let out = text;

  const types = [...Object.keys(AUX_EVENT_SHAPES)];
  if (includeOfficialGaps) types.push(OFFICIAL_THINKING_TYPE);

  const pendingDisposition = types.filter((type) => !hasDisposition(out, type));
  const pendingSwitch = types.filter((type) => !hasSwitchCase(out, type));
  for (const type of types) {
    if (!pendingDisposition.includes(type) && !pendingSwitch.includes(type)) skipped.push(type);
  }

  if (pendingDisposition.length > 0) {
    if (!out.includes(DISPOSITIONS_ANCHOR)) {
      warnings.push(`词表锚点缺失,跳过 ${pendingDisposition.join(", ")}`);
    } else {
      const lines = pendingDisposition.map((type) => dispositionLine(type, shapeFor(type)));
      out = out.replace(DISPOSITIONS_ANCHOR, `${DISPOSITIONS_ANCHOR}\n${lines.join("\n")}`);
      applied.push(...pendingDisposition.map((type) => `disposition ${type}`));
    }
  }

  if (pendingSwitch.length > 0) {
    const match = SWITCH_DEFAULT_RE.exec(out);
    if (match === null) {
      warnings.push(`switch 锚点缺失,跳过 ${pendingSwitch.join(", ")}`);
    } else {
      const indent = match[1];
      const cases = pendingSwitch.map((type) => switchCaseLines(type, indent)).join("\n");
      out = out.slice(0, match.index) + cases + "\n" + out.slice(match.index);
      applied.push(...pendingSwitch.map((type) => `case ${type}`));
    }
  }

  if (!includeOfficialGaps) return { text: out, applied, skipped, warnings };

  if (PERMISSION_PRESET_DONE_RE.test(out)) {
    skipped.push("permission/preset origin");
  } else if (PERMISSION_PRESET_RE.test(out)) {
    out = out.replace(PERMISSION_PRESET_RE, '$1, ["origin"]$2');
    applied.push("permission/preset origin");
  } else {
    warnings.push("permission/preset 锚点缺失,跳过 origin");
  }

  const replay = REPLAY_FN_RE.exec(out);
  if (replay !== null && replay[1].includes(REPLAY_PRISTINE)) {
    const innerIndent = /^([ \t]*)const replay/.exec(replay[1])?.[1] ?? "\t";
    const body = [
      `${innerIndent}/* dsh-aux P13:replayState 由各 provider adapter 自由扩展`,
      `${innerIndent}   (kind/api/provider/model/responseId/stopReason/blocks/usage…);`,
      `${innerIndent}   冻结词表只认 {response,blocks} 会拒掉真实历史。放宽为 opaque JSON 容器。 */`,
      `${innerIndent}const replay = releasedV0Record(value, label);`,
      `${innerIndent}void replay;`,
    ].join("\n");
    out =
      out.slice(0, replay.index) +
      `function replayEnvelopeValue(value, label) {\n${body}\n}` +
      out.slice(replay.index + replay[0].length);
    applied.push("replayState opaque");
  } else {
    skipped.push("replayState opaque");
  }

  if (ABORT_CAUSE_DONE_RE.test(out)) {
    skipped.push("abort cause stack");
  } else if (ABORT_CAUSE_RE.test(out)) {
    out = out.replace(ABORT_CAUSE_RE, '$1["stack"]$2');
    applied.push("abort cause stack");
  } else {
    warnings.push("abort cause 锚点缺失,跳过 stack");
  }

  return { text: out, applied, skipped, warnings };
}
