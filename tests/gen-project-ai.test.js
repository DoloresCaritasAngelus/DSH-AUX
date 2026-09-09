/**
 * gen-project-ai 回归:PROJECT.AI.md 必须等于 PROJECT.md 的生成视图。
 *
 * 背景:PROJECT.md / PROJECT.AI.md 曾双写同一组事实并各自漂移(版本、DSH 支持线、
 * 补丁族都停更)。现在 PROJECT.md 是唯一事实源,PROJECT.AI.md 是生成产物。
 * 本测试用真实脚本 scripts/gen-project-ai.mjs 断言:
 *  - 真实仓库一致(绿),且生成物带"勿手改"banner + 生成命令;
 *  - 生成视图小节 = 必需小节清单(顺序即 PROJECT.md 文档顺序);
 *  - 变异:手改生成物一行 / 删 banner / 源里删一个被提取块 / 标记未闭合 → 非零退出。
 *
 * 每个用例在临时目录里跑真实脚本(脚本按 cwd 解析仓库根,与 ci-docs-index 同约定)。
 *
 * Run: node --test tests/gen-project-ai.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BANNER, REQUIRED_SECTIONS, buildAiView, parseSections } from "../scripts/gen-project-ai.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SCRIPT = join(REPO, "scripts/gen-project-ai.mjs");
const SOURCE = readFileSync(join(REPO, "PROJECT.md"), "utf8");
const EXPECTED = buildAiView(SOURCE);

/** 在临时仓库里跑真实生成器 `--check`,返回退出码与输出。 */
function runCheck({ project = SOURCE, ai = EXPECTED } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dsh-aux-genai-"));
  try {
    writeFileSync(join(dir, "PROJECT.md"), project);
    if (ai !== null) writeFileSync(join(dir, "PROJECT.AI.md"), ai);
    const result = spawnSync(process.execPath, [SCRIPT, "--check"], { cwd: dir, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 删掉源里的一个标记块(变异夹具)。 */
function stripSection(text, id) {
  const re = new RegExp(`<!-- ai:section id="${id}"[^>]*-->[\\s\\S]*?<!-- /ai:section -->\\n?`);
  assert.match(text, re, `夹具里应存在 ai:section id="${id}"`);
  return text.replace(re, "");
}

/** 删掉最后一个 `</ai:section>`(变异夹具)。 */
function dropLastClose(text) {
  const marker = "<!-- /ai:section -->";
  const index = text.lastIndexOf(marker);
  assert.ok(index >= 0, "夹具里应有结束标记");
  return text.slice(0, index) + text.slice(index + marker.length);
}

test("gen-project-ai: 真实仓库 PROJECT.AI.md 与 PROJECT.md 生成视图一致(绿)", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--check"], { cwd: REPO, encoding: "utf8" });
  assert.equal(result.status, 0, `应通过,stderr:\n${result.stderr}`);
  assert.match(result.stdout, /PROJECT\.AI\.md 与 PROJECT\.md 同步/);

  assert.deepEqual(
    parseSections(SOURCE).map((section) => section.id),
    [...REQUIRED_SECTIONS],
    "生成视图小节必须等于必需小节清单(顺序即 PROJECT.md 文档顺序)",
  );
  const generated = readFileSync(join(REPO, "PROJECT.AI.md"), "utf8");
  assert.ok(generated.startsWith(BANNER), "生成物顶部应是 DO NOT EDIT banner");
  assert.match(generated, /DO NOT EDIT BY HAND/);
  assert.match(generated, /node scripts\/gen-project-ai\.mjs/);
});

test("gen-project-ai 变异: 手改生成物一行 → --check 非零退出", () => {
  const tampered = EXPECTED.replace("## Identity", "## Identity (tampered)");
  assert.notEqual(tampered, EXPECTED, "夹具应真的改到生成物");
  const result = runCheck({ ai: tampered });
  assert.notEqual(result.status, 0, "生成物被手改必须阻塞");
  assert.match(result.stderr, /DIFF PROJECT\.AI\.md/);
  assert.match(result.stderr, /node scripts\/gen-project-ai\.mjs/);
});

test("gen-project-ai 变异: 生成物缺 banner → --check 非零退出", () => {
  const stripped = EXPECTED.replace(BANNER, "");
  assert.ok(!stripped.startsWith("<!--"), "banner 应被移除");
  const result = runCheck({ ai: stripped });
  assert.notEqual(result.status, 0, "缺少 DO NOT EDIT banner 必须阻塞");
  assert.match(result.stderr, /DIFF PROJECT\.AI\.md/);
});

test("gen-project-ai 变异: 源里删一个被提取块 → 生成物变化且 --check 非零", () => {
  const mutated = stripSection(SOURCE, "invariants");
  assert.notEqual(buildAiView(mutated), EXPECTED, "删块后生成视图必须变化");
  const result = runCheck({ project: mutated });
  assert.notEqual(result.status, 0, "源缺必需小节必须阻塞");
  assert.match(result.stderr, /\[缺块\]/);
  assert.match(result.stderr, /invariants/);
});

test("gen-project-ai 变异: 标记未闭合 → --check 非零退出", () => {
  const mutated = dropLastClose(SOURCE);
  assert.notEqual(mutated, SOURCE, "夹具应真的删掉一个结束标记");
  const result = runCheck({ project: mutated });
  assert.notEqual(result.status, 0, "未闭合标记必须阻塞");
  assert.match(result.stderr, /\[标记未闭合\]/);
});
