#!/usr/bin/env node
/**
 * gen-project-ai — PROJECT.AI.md 由 PROJECT.md 生成(文档单一真相)。
 *
 * 背景/契约:PROJECT.md 是人类维护的长期项目文档,也是**唯一事实源**;
 * PROJECT.AI.md 是给 AI/自动化代理的**生成视图**,不得手改。事实只写一份
 * (PROJECT.md),AI 视图由 PROJECT.md 里的标记块拼装:
 *
 *   <!-- ai:section id="identity" title="Identity" -->
 *   ...原文(人类版与 AI 版共用同一份)...
 *   <!-- /ai:section -->
 *
 * 标记是 HTML 注释,渲染时不可见,人类文档保持可读;生成器按文档顺序提取标记块,
 * 以 `## <title>` 为小节标题输出,并加"勿手改"banner。未标记的段落(叙述/问答)
 * 只留在人类版,不进 AI 视图。
 *
 * 读取位置:以**当前工作目录**为仓库根(CI 在仓库根跑;测试在临时树里跑),
 * 与 scripts/ci-docs-index.mjs 同一约定。
 *
 * 用法:
 *   node scripts/gen-project-ai.mjs          # 写盘
 *   node scripts/gen-project-ai.mjs --check  # 只比对,不一致退出码非 0
 *
 * 退出码:0 = 一致 / 已生成;1 = 结构错误、缺必需小节或与磁盘不同步。
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SOURCE = join(ROOT, "PROJECT.md");
const DEST = join(ROOT, "PROJECT.AI.md");

/** 生成物顶部 banner:声明"勿手改"并给出生成命令与 CI 门禁命令。 */
export const BANNER = [
  "<!--",
  "  PROJECT.AI.md — generated view of the repo-root <PROJECT.md> (single source of truth).",
  "  DO NOT EDIT BY HAND. Regenerate with: node scripts/gen-project-ai.mjs",
  "  CI gate: node scripts/gen-project-ai.mjs --check",
  "-->",
].join("\n");

/** AI 视图的 H1 与导语:只描述生成关系,不承载事实。 */
const TITLE = "# DSH-AUX Project Brief (AI / Automation Friendly)";
const INTRO = [
  "> Generated from [PROJECT.md](./PROJECT.md) by `node scripts/gen-project-ai.mjs`;",
  "> edit PROJECT.md, never this file. CI gate: `node scripts/gen-project-ai.mjs --check`.",
  "> Human-oriented version: [PROJECT.md](./PROJECT.md).",
  "> 🔻 Version / test-count / external snapshots drift; code, CHANGELOG.md and an actual test run are authoritative.",
].join("\n");

/** 必需小节:PROJECT.md 少一个即视为事实源被破坏,生成与 --check 都非零退出。 */
export const REQUIRED_SECTIONS = Object.freeze([
  "identity",
  "support",
  "what-it-does",
  "repo-layout",
  "invariants",
  "bridge-patch",
  "client-settings",
  "tests",
  "pitfalls",
  "open-work",
  "docs-map",
]);

const OPEN_RE = /^<!--\s*ai:section\s+(.+?)\s*-->\s*$/;
const CLOSE_RE = /^<!--\s*\/ai:section\s*-->\s*$/;
const ATTR_RE = /([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/g;

/** 解析 `id="x" title="Y"` 形式的标记属性。 */
function parseAttrs(raw) {
  const attrs = {};
  let match;
  while ((match = ATTR_RE.exec(raw)) !== null) attrs[match[1]] = match[2];
  return attrs;
}

/**
 * 提取 PROJECT.md 中的 `ai:section` 标记块(按文档顺序)。
 * @param {string} projectText PROJECT.md 全文。
 * @returns {{id: string, title: string, body: string}[]}
 */
export function parseSections(projectText) {
  const lines = projectText.split("\n");
  const sections = [];
  const seen = new Set();
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (current === null) {
      if (CLOSE_RE.test(line)) {
        throw new Error(`[标记未配对] PROJECT.md:${i + 1} 出现 </ai:section> 但没有对应的开始标记`);
      }
      const open = OPEN_RE.exec(line);
      if (!open) continue;
      const attrs = parseAttrs(open[1]);
      if (!attrs.id) throw new Error(`[缺 id] PROJECT.md:${i + 1} ai:section 缺少 id 属性`);
      if (seen.has(attrs.id)) throw new Error(`[重复块] PROJECT.md:${i + 1} ai:section id="${attrs.id}" 出现多次`);
      seen.add(attrs.id);
      current = { id: attrs.id, title: attrs.title ?? attrs.id, line: i + 1, body: [] };
      continue;
    }
    if (OPEN_RE.test(line)) {
      throw new Error(`[嵌套块] PROJECT.md:${i + 1} ai:section 不能嵌套(当前 "${current.id}" 未闭合)`);
    }
    if (CLOSE_RE.test(line)) {
      const body = current.body.join("\n").replace(/^\n+|\n+$/g, "");
      if (body === "") throw new Error(`[空块] PROJECT.md:${current.line} ai:section "${current.id}" 没有正文`);
      sections.push({ id: current.id, title: current.title, body });
      current = null;
      continue;
    }
    current.body.push(line);
  }
  if (current !== null) {
    throw new Error(`[标记未闭合] PROJECT.md:${current.line} ai:section "${current.id}" 缺少 </ai:section>`);
  }
  return sections;
}

/** 必需小节齐备性检查(缺一块即抛错,避免生成视图静默少一节)。 */
export function assertRequired(sections) {
  const ids = new Set(sections.map((section) => section.id));
  const missing = REQUIRED_SECTIONS.filter((id) => !ids.has(id));
  if (missing.length > 0) throw new Error(`[缺块] PROJECT.md 缺少必需小节: ${missing.join(", ")}`);
}

/** 由 PROJECT.md 全文构建 PROJECT.AI.md 全文(banner + H1 + 导语 + 各标记块)。 */
export function buildAiView(projectText) {
  const sections = parseSections(projectText);
  const parts = [BANNER, "", TITLE, "", INTRO, ""];
  for (const section of sections) parts.push(`## ${section.title}`, "", section.body, "");
  return `${parts.join("\n").replace(/\n+$/, "")}\n`;
}

/** 读源文件。 */
export async function readProject() {
  return readFile(SOURCE, "utf8");
}

/** 生成态:期望文本 / 磁盘文本 / 是否一致。 */
export async function checkAiView() {
  const source = await readProject();
  assertRequired(parseSections(source));
  const expected = buildAiView(source);
  let actual = null;
  try {
    actual = await readFile(DEST, "utf8");
  } catch {
    actual = null;
  }
  return { expected, actual, inSync: actual === expected };
}

/** 写盘:用 PROJECT.md 重新生成 PROJECT.AI.md。 */
export async function writeAiView() {
  const source = await readProject();
  assertRequired(parseSections(source));
  const expected = buildAiView(source);
  await writeFile(DEST, expected, "utf8");
  return expected;
}

async function main() {
  if (process.argv.includes("--check")) {
    let state;
    try {
      state = await checkAiView();
    } catch (error) {
      console.error(`PROJECT.AI.md 生成失败: ${error.message}`);
      process.exit(1);
    }
    if (state.actual === null) {
      console.error("DIFF PROJECT.AI.md(缺少生成产物)");
    } else if (!state.inSync) {
      console.error("DIFF PROJECT.AI.md");
    } else {
      console.log("ok   PROJECT.AI.md");
      console.log("PROJECT.AI.md 与 PROJECT.md 同步。");
      return;
    }
    console.error("\nPROJECT.AI.md 与 PROJECT.md 不同步。运行: node scripts/gen-project-ai.mjs");
    process.exit(1);
  }
  try {
    await writeAiView();
  } catch (error) {
    console.error(`PROJECT.AI.md 生成失败: ${error.message}`);
    process.exit(1);
  }
  console.log("已从 PROJECT.md 重新生成 PROJECT.AI.md。");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
