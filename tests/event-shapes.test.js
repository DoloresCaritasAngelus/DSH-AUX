/**
 * 写端闸:AUX 写入的会话事件类型与载荷键必须与 event-shapes.js 的登记表一致。
 *
 * 背景:`dsh-session-format-v0-to-v1` 的 v0 冻结词表对**多余成员**零容忍
 * (`data has unexpected member`),而迁移只在升级时才跑到——漂移要等用户升级后才
 * 暴露。这个测试把"加字段必须同步登记"变成 CI 门禁。
 *
 * 覆盖面:
 *   - config.js 里每个 AUX_*_EVENT 常量都有形状登记;
 *   - index.js / tools/vision.js 里每个 recordAuxEvent / recordDebugEvent 调用点的
 *     字面量键都在登记表内;
 *   - platform-status 与 image-library 的 snapshot 构造器返回键都在登记表内;
 *   - unknownEventKeys() 的判定本身;
 *   - bridge 生成的 disposition 行覆盖登记表全部字段。
 *
 * 运行:cd <仓库路径> && node --test tests/event-shapes.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUX_EVENT_SHAPES, unknownEventKeys } from "../dsh-aux/src/event-shapes.js";
import { dispositionLine } from "../bridge/format-admissions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const read = (rel) => readFileSync(join(REPO, rel), "utf8");

/** 从 `open` 处的 `{` 开始,收集深度 1 的对象字面量键名。 */
function objectKeys(text, open) {
  const keys = [];
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (depth >= 1 && ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (depth >= 1 && ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    const prev = text[i - 1] ?? " ";
    if (!/[\s,{]/.test(prev)) continue;
    const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(text.slice(i, i + 80));
    if (match !== null) keys.push(match[1]);
  }
  return keys;
}

/** 每个 `callee(` 调用点后面第一个对象字面量的键。 */
function callPayloadKeys(text, callee) {
  const out = [];
  const needle = callee + "(";
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    const brace = text.indexOf("{", at + needle.length);
    if (brace > 0) out.push(objectKeys(text, brace));
    from = at + needle.length;
  }
  return out;
}

/** 构造器里含 `markerKey` 的那个 `return { ... }` 的键。 */
function returnObjectKeys(text, markerKey) {
  const marker = text.indexOf(markerKey + ":");
  if (marker < 0) return null;
  const ret = text.lastIndexOf("return {", marker);
  if (ret < 0) return null;
  return objectKeys(text, text.indexOf("{", ret));
}

function assertRegistered(type, keys, where) {
  const shape = AUX_EVENT_SHAPES[type];
  assert.ok(shape !== undefined, "未登记的事件类型 " + type);
  for (const key of keys) {
    assert.ok(shape.optional.includes(key), where + " 的字段 " + key + " 未登记到 " + type);
  }
}

test("config.js 的每个 AUX_*_EVENT 都有形状登记", () => {
  const config = read("dsh-aux/src/config.js");
  const types = [...config.matchAll(/export const (AUX_[A-Z_]+_EVENT) = "([^"]+)";/g)].map((m) => m[2]);
  assert.ok(types.length >= 4, "应至少有四个 AUX 事件常量,实际 " + types.length);
  for (const type of types) assert.ok(AUX_EVENT_SHAPES[type] !== undefined, type + " 未登记");
});

test("index.js / tools/vision.js 的 recordAuxEvent 载荷键都已登记", () => {
  for (const file of ["dsh-aux/src/index.js", "dsh-aux/src/tools/vision.js"]) {
    const sets = callPayloadKeys(read(file), "recordAuxEvent");
    assert.ok(sets.length > 0, file + " 未找到 recordAuxEvent 调用点");
    for (const keys of sets) assertRegistered("aux/llm-call", keys, file);
  }
});

test("index.js 的 recordDebugEvent 载荷键都已登记", () => {
  const sets = callPayloadKeys(read("dsh-aux/src/index.js"), "recordDebugEvent");
  assert.ok(sets.length > 0);
  for (const keys of sets) assertRegistered("aux/debug", keys, "index.js");
});

test("platform-status 快照键都已登记", () => {
  const keys = returnObjectKeys(read("dsh-aux/src/status.js"), "generatedAt");
  assert.ok(Array.isArray(keys) && keys.length > 0, "未找到 collectPlatformStatus 的返回字面量");
  assertRegistered("aux/platform-status", keys, "status.js");
});

test("image-library 快照键都已登记", () => {
  const keys = returnObjectKeys(read("dsh-aux/src/images/image-library.js"), "generatedAt");
  assert.ok(Array.isArray(keys) && keys.length > 0);
  assertRegistered("aux/image-library", keys, "image-library.js");
});

test("unknownEventKeys 判定", () => {
  assert.deepEqual(unknownEventKeys("aux/llm-call", { task: "vision", mode: "native" }), []);
  assert.deepEqual(unknownEventKeys("aux/llm-call", { task: "vision", bogus: 1 }), ["bogus"]);
  assert.deepEqual(unknownEventKeys("nope/nope", { a: 1 }), []);
  assert.deepEqual(unknownEventKeys("aux/debug", null), []);
});

test("bridge 生成的 disposition 覆盖登记表全部字段", () => {
  for (const [type, shape] of Object.entries(AUX_EVENT_SHAPES)) {
    const line = dispositionLine(type, shape);
    for (const key of shape.optional) assert.ok(line.includes(JSON.stringify(key)), type + " 缺 " + key);
  }
});
