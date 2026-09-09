#!/usr/bin/env node
/**
 * ci-docs-index — docs/ 文档树索引闸(确定性,命中即退出 1)。
 *
 * 目的:让 `docs/` 的索引与状态头不再腐烂。检查五条:
 *  1. docs/ 下全部 .md(除 `docs/README.md` 自身)必须在 `docs/README.md` 的索引表里
 *     出现且恰好一次 —— 缺行 = [索引缺失],重复 = [索引重复];
 *  2. 索引行指向的文件必须存在 —— 否则 [索引路径不存在];
 *  3. 索引行的状态词必须来自五词表 —— 否则 [状态词非法];
 *  4. 每篇文档状态头(`> 状态:…`,取文件前 HEADER_LINES 行)的状态词必须与索引行一致
 *     —— 缺状态头 = [状态头缺失],不一致 = [状态头不一致];
 *  5. `docs/archive/**` 的每篇必须带退役头(前 HEADER_LINES 行内含「退役原因」或
 *     「取代者」)—— 否则 [退役头缺失]。
 *     例外:`docs/archive/README.md` 是归档索引本身,不是被退役的文档,只按 1–4 检查。
 *
 * 读取位置:以**当前工作目录**为仓库根(CI 在仓库根跑;测试在临时树里跑),与
 * `scripts/ci-doc-hygiene.mjs` 同一约定。
 * 退出码:0 = 索引与状态头一致;1 = 有命中(逐条打印文件与规则)。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = process.cwd();
const DOCS = join(ROOT, "docs");
const INDEX = join(DOCS, "README.md");
const ARCHIVE = join(DOCS, "archive");
const ARCHIVE_INDEX = join(ARCHIVE, "README.md");
/** 状态头/退役头只看文件前 N 行,避免正文里的散词误判。 */
const HEADER_LINES = 40;

/** 五词状态表(与 docs/README.md 的状态词表一字不差)。 */
const STATUS_WORDS = ["✅ 活跃", "🟡 部分被取代", "🔵 已实现(保留作回执)", "⬜ 历史", "🗄 已归档"];

/** 索引行:`| [docs/xxx.md](./xxx.md) | 状态 | 一句话 | 易腐烂 |`。 */
const ROW_RE = /^\|\s*\[([^\]]+)\]\(([^)\s]+)\)\s*\|([^|]*)\|/;
/** 状态头:`> 状态:✅ 活跃`(允许 `**状态**` 与全/半角冒号)。 */
const STATUS_LINE_RE = /^>\s*\*{0,2}状态\*{0,2}\s*[:：]\s*(.+)$/;

const hits = [];
/**
 * 记录一处命中。
 * @param {string} file 仓库根相对路径。
 * @param {string} rule 规则标签。
 * @param {string} detail 人类可读细节。
 */
function hit(file, rule, detail) {
  hits.push({ file, rule, detail });
}

/** 递归收集 docs/ 下全部 .md,返回仓库根相对 POSIX 路径。 */
function collectDocs(dir = DOCS, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) collectDocs(abs, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(relative(ROOT, abs).split(sep).join("/"));
  }
  return out.sort();
}

/** 读取文件前 HEADER_LINES 行(读不到返回空数组)。 */
function headerLines(abs) {
  try {
    return readFileSync(abs, "utf8").split("\n").slice(0, HEADER_LINES);
  } catch {
    return [];
  }
}

/** 取状态头里的状态词;没有状态头返回 null。 */
function headerStatus(lines) {
  for (const line of lines) {
    const m = STATUS_LINE_RE.exec(line);
    if (m) return STATUS_WORDS.find((word) => m[1].trim().startsWith(word)) ?? "";
  }
  return null;
}

/** 解析 docs/README.md 的索引行。 */
function parseIndex(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const target = m[2];
    if (!target.endsWith(".md")) continue;
    const abs = resolve(DOCS, target);
    rows.push({
      label: m[1].trim(),
      abs,
      path: relative(ROOT, abs).split(sep).join("/"),
      status: m[3].trim(),
    });
  }
  return rows;
}

let indexText;
try {
  indexText = readFileSync(INDEX, "utf8");
} catch {
  console.error("DOCS-INDEX docs/README.md [索引缺失] 找不到 docs/README.md(请在仓库根运行)。");
  process.exit(1);
}

const rows = parseIndex(indexText);
const files = collectDocs();
const indexed = new Map();
for (const row of rows) {
  if (indexed.has(row.path)) hit(row.path, "索引重复", `索引表出现多次(第 ${indexed.size + 1} 行起)`);
  else indexed.set(row.path, row);
}

// 1/3 —— 每篇文档在索引里且有合法状态词。
for (const file of files) {
  if (file === "docs/README.md") continue;
  const row = indexed.get(file);
  if (!row) {
    hit(file, "索引缺失", "docs/README.md 索引表没有这一行");
    continue;
  }
  if (!STATUS_WORDS.some((word) => row.status.startsWith(word))) {
    hit(file, "状态词非法", `索引状态词“${row.status}”不在五词表内`);
  }
}

// 2 —— 索引行指向的文件必须存在。
for (const row of rows) {
  if (!files.includes(row.path)) hit(row.path, "索引路径不存在", "索引行指向的文件在 docs/ 下不存在");
}

// 4 —— 文档状态头与索引行一致。
for (const file of files) {
  if (file === "docs/README.md") continue;
  const row = indexed.get(file);
  if (!row) continue;
  const status = headerStatus(headerLines(join(ROOT, file)));
  if (status === null) {
    hit(file, "状态头缺失", "文件前 40 行没有“> 状态:…”状态头");
  } else if (status === "") {
    hit(file, "状态词非法", "文件状态头里的状态词不在五词表内");
  } else if (!row.status.startsWith(status)) {
    hit(file, "状态头不一致", `文件状态头“${status}”与索引“${row.status}”不一致`);
  }
}

// 5 —— archive/** 必须带退役头(归档索引 docs/archive/README.md 例外)。
for (const file of files) {
  if (!file.startsWith("docs/archive/")) continue;
  if (join(ROOT, file) === ARCHIVE_INDEX) continue;
  const header = headerLines(join(ROOT, file)).join("\n");
  if (!/退役原因|取代者/.test(header)) {
    hit(file, "退役头缺失", "归档文档前 40 行缺少「退役原因」或「取代者」");
  }
}

if (hits.length > 0) {
  for (const h of hits) console.error(`DOCS-INDEX ${h.file} [${h.rule}] ${h.detail}`);
  console.error(
    `\n${hits.length} 处文档索引/状态头命中:docs/README.md 是唯一索引,新增、移动、退役文档必须同步索引与状态头。`,
  );
  console.error("规则见 docs/README.md 第 3–5 节;归档文档还要写退役头(退役原因/取代者/复盘点)。");
  process.exit(1);
}
console.log(`文档索引检查通过(${files.length - 1} 篇文档 + docs/README.md 索引;状态头与退役头一致)。`);
