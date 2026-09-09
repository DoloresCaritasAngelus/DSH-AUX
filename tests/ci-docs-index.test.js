/**
 * ci-docs-index 文档索引闸回归。
 *
 * 背景:docs/ 没有索引、状态头腐烂(已上线的设计仍写"待评审后实施")、
 * 归档目录缺退役头。本测试用最小文档树驱动真实脚本 scripts/ci-docs-index.mjs,断言:
 *  - 真实仓库与最小树通过(绿);
 *  - 索引缺一行 / 状态词非法 / 归档缺退役头 / 状态头与索引不一致 / 索引指向不存在的文件
 *    → 非零退出(红),且命中的是预期规则标签(避免"脚本崩溃恰好非零"的假绿)。
 *
 * 每个用例在临时目录里跑真实脚本(脚本按 cwd 解析仓库根,与 ci-doc-hygiene 同约定)。
 *
 * Run: node --test tests/ci-docs-index.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SCRIPT = join(REPO, "scripts/ci-docs-index.mjs");

const ACTIVE = "docs/design/WEB-CRAWL-DESIGN.md";
const ARCHIVED = "docs/archive/OLD.md";

/** 造一个文档正文(状态头 + 可选退役头)。 */
function doc(status, extra = []) {
  return ["# 假文档", "", `> 状态:${status}`, "> 最后核实:2026-09-09", ...extra, "", "正文。", ""].join("\n");
}

const DEFAULT_FILES = {
  [ACTIVE]: doc("✅ 活跃"),
  [ARCHIVED]: doc("🔵 已实现(保留作回执)", ["> 退役原因:假功能已上线", "> 取代者:假代码路径", "> 复盘点:假条件"]),
  "docs/archive/README.md": doc("✅ 活跃"),
};

const DEFAULT_ROWS = [
  { path: ACTIVE, status: "✅ 活跃" },
  { path: "docs/archive/README.md", status: "✅ 活跃" },
  { path: ARCHIVED, status: "🔵 已实现(保留作回执)" },
];

/** 由行集合生成 docs/README.md 索引表。 */
function buildIndex(rows) {
  const lines = ["# docs", "", "| 文档 | 状态 | 一句话 | 易腐烂 |", "|---|---|---|---|"];
  for (const row of rows)
    lines.push(`| [${row.path}](${row.path.replace(/^docs\//, "./")}) | ${row.status} | 假一句话 | — |`);
  return `${lines.join("\n")}\n`;
}

/** 在临时仓库里写入文档树并跑真实门禁。 */
function runGate({ files = DEFAULT_FILES, rows = DEFAULT_ROWS, index = buildIndex(rows) } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dsh-aux-docsindex-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    writeFileSync(join(dir, "docs", "README.md"), index);
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("ci-docs-index: 真实仓库 docs/ 索引与状态头一致(绿)", () => {
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: "utf8" });
  assert.equal(result.status, 0, `应通过,stderr:\n${result.stderr}`);
  assert.match(result.stdout, /文档索引检查通过/);
});

test("ci-docs-index: 最小文档树通过(绿)", () => {
  const result = runGate();
  assert.equal(result.status, 0, `应通过,stderr:\n${result.stderr}`);
  assert.match(result.stdout, /文档索引检查通过/);
});

test("ci-docs-index: 索引缺一行 → 非零退出", () => {
  const rows = DEFAULT_ROWS.filter((row) => row.path !== ARCHIVED);
  const result = runGate({ rows });
  assert.notEqual(result.status, 0, "归档文档不在索引表里必须阻塞");
  assert.match(result.stderr, /\[索引缺失\]/);
  assert.match(result.stderr, /docs\/archive\/OLD\.md/);
});

test("ci-docs-index: 状态词非法 → 非零退出", () => {
  const rows = DEFAULT_ROWS.map((row) => (row.path === ACTIVE ? { ...row, status: "🟢 已完成" } : row));
  const result = runGate({ rows });
  assert.notEqual(result.status, 0, "索引状态词不在五词表内必须阻塞");
  assert.match(result.stderr, /\[状态词非法\]/);
});

test("ci-docs-index: 归档文档缺退役头 → 非零退出", () => {
  const files = { ...DEFAULT_FILES, [ARCHIVED]: doc("🔵 已实现(保留作回执)") };
  const result = runGate({ files });
  assert.notEqual(result.status, 0, "归档文档没有退役原因/取代者必须阻塞");
  assert.match(result.stderr, /\[退役头缺失\]/);
  assert.match(result.stderr, /docs\/archive\/OLD\.md/);
});

test("ci-docs-index: 文件状态头与索引不一致 → 非零退出", () => {
  const files = { ...DEFAULT_FILES, [ACTIVE]: doc("⬜ 历史") };
  const result = runGate({ files });
  assert.notEqual(result.status, 0, "状态头与索引漂移必须阻塞");
  assert.match(result.stderr, /\[状态头不一致\]/);
});

test("ci-docs-index: 索引行指向不存在的文件 → 非零退出", () => {
  const rows = [...DEFAULT_ROWS, { path: "docs/design/GHOST.md", status: "✅ 活跃" }];
  const result = runGate({ rows });
  assert.notEqual(result.status, 0, "索引指向磁盘上没有的文件必须阻塞");
  assert.match(result.stderr, /\[索引路径不存在\]/);
});
