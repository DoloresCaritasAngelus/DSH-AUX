#!/usr/bin/env node
/**
 * ci-doc-hygiene — 文档脱密守门(确定性模式,宁可漏报不误报)。
 *
 * 扫描所有被跟踪的文本文件,拦截两类内容:
 *  1. 私有工作区引用:aux-notes/、HANDOFF、EXECUTION-PLAN、蓝图 §、04-glossary
 *     —— 公开文档允许"提及维护者存在私有台账"(带不随仓库分发说明),
 *        不允许把理解产品的前提建立在私有文件上;
 *  2. 本机痕迹:/home/<user> 绝对路径(允许 /home/user 占位)、Windows 盘符路径。
 *
 * 白名单(允许出现 aux-notes/ 或 02-patch-ledger 的文件):
 *   .gitignore(规则本身)、CONTRIBUTING.md、.github/**、.agents/skills/**
 *   —— 这些文件已注明"本地 gitignore,不随仓库分发"。
 * 另有 CHANGELOG.md 结构闸(见文件末尾):发布段只增不减、每段必须有非空正文、
 * 两个哨兵节必须在位 —— 整段发布历史被截断或替换成空壳标题时同样退出 1。
 *
 * 规则表在 `scripts/hygiene-rules.mjs`(单一真相源):除本脚本外,
 * `scripts/pr-body-hygiene.mjs` 也用它扫 PR 描述与标题 —— 三条公开信道共用一张表。
 * 退出码:发现命中 = 1(阻塞 CI);干净 = 0。
 */
import { execSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { FILE_RULES, MESSAGE_RULES, scanText } from "./hygiene-rules.mjs";

const SKIP = [
  /^scripts\/ci-doc-hygiene\.mjs$/, // 本脚本自身包含模式字面量
  /^scripts\/hygiene-rules\.mjs$/, // 规则表必须写出被拦截的字面量才能自解释
];

// 扫**全部被跟踪文件**,不再按扩展名挑选。
// 起因:一条 node_modules 符号链接被误提交,内容是本机绝对路径 —— 它没有扩展名,
// 按扩展名过滤的名单直接把它跳过,而它恰恰是最该拦的一类(符号链接的本机路径)。
// 现在的判据是内容而不是文件名:符号链接读**链接目标字符串**;普通文件按 UTF-8 读,
// 含 NUL 字节的判为二进制跳过(PNG 之类既不误报,也不会被解码坏)。
const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f !== "" && !SKIP.some((re) => re.test(f)));

let hits = 0;
for (const file of files) {
  let text;
  try {
    if (lstatSync(file).isSymbolicLink()) {
      text = readlinkSync(file); // 符号链接的目标本身就是可能泄漏的字符串
    } else {
      const raw = readFileSync(file);
      if (raw.includes(0)) continue; // 二进制(NUL 字节)—— 跳过
      text = raw.toString("utf8");
    }
  } catch {
    continue;
  }
  for (const hit of scanText(text, FILE_RULES, file)) {
    console.error(`DOC-HYGIENE ${file}:${hit.line} [${hit.rule}] ${hit.text}`);
    hits += 1;
  }
}

// 提交信息扫描(本地/PR 场景:origin/main..HEAD 可解析时生效;CI 浅克隆自动跳过)。
// 规则比文件扫描更严(见 hygiene-rules.mjs):提交信息只允许描述 diff 可见的变更,
// 涉及私有路径的描述留在私有笔记里,不进提交信息。PR 描述走同一张表,
// 由 scripts/pr-body-hygiene.mjs 执行。
let msgHits = 0;
try {
  const msgs = execSync("git log --format=%B origin/main..HEAD", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  for (const hit of scanText(msgs, MESSAGE_RULES)) {
    console.error(`DOC-HYGIENE (commit message) [${hit.rule}] ${hit.text}`);
    msgHits += 1;
  }
} catch {
  console.log("提示:无法解析 origin/main..HEAD(浅克隆或首次推送前),本次跳过提交信息扫描。");
  console.log("CI 中应为 checkout 设置 fetch-depth: 0,避免静默跳过。");
}

if (hits > 0) {
  console.error(`\n${hits} 处文件内容脱密命中:公开文档不得依赖私有文件或携带本机路径。`);
  console.error("维护者内容请写入 aux-notes/(gitignore);引用私有台账须带「本地 gitignore,不随仓库分发」注记。");
}
if (msgHits > 0) {
  console.error(`\n${msgHits} 处提交信息脱密命中:提交信息只写 diff 可见的变更语义,过程内容留在 aux-notes。`);
}
// CHANGELOG 完整性闸(防截断 + 防空壳):发布段只增不减,且每段必须有正文。
// 历史事故模式一:整文件被 write 覆盖成"未发布"节的前几行,发布历史静默丢失;
// 历史事故模式二(变异 B):文件被替换成 N 个 `## 0.x` 假标题 + 两个哨兵、零正文,
// 只数段数与哨兵的门禁会 exit 0 漏网。脱密规则不会命中这两种删除/伪造,
// 所以这里单独断言结构下限 + 正文非空。
const CHANGELOG_RELEASE_BASELINE = 25; // 基线 v0.4.6 时的已发布版本段数量

/**
 * 按 `## ` 切 CHANGELOG 段,并判断每段是否有正文。
 * 正文 = 段内至少一行非空、且不是更深的 Markdown 标题(如 `###`)。
 * 只有标题和空行 = 空壳段,必须拦截。
 * @param {string} text CHANGELOG 全文。
 * @returns {{heading: string, hasBody: boolean}[]}
 */
function parseChangelogSections(text) {
  const sections = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (/^## /.test(line)) {
      current = { heading: line, hasBody: false };
      sections.push(current);
      continue;
    }
    if (current && line.trim() !== "" && !/^#{1,6}\s/.test(line)) current.hasBody = true;
  }
  return sections;
}

let changelogHits = 0;
try {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const releases = parseChangelogSections(changelog).filter((section) => /^## 0\./.test(section.heading));
  if (releases.length < CHANGELOG_RELEASE_BASELINE) {
    console.error(
      `DOC-HYGIENE CHANGELOG.md [发布历史截断] 已发布版本段 ${releases.length} < 基线 ${CHANGELOG_RELEASE_BASELINE};` +
        " 追加新版本小节时不得删除既有发布段。",
    );
    changelogHits += 1;
  }
  const emptyReleases = releases.filter((section) => !section.hasBody);
  if (emptyReleases.length > 0) {
    const sample = emptyReleases
      .slice(0, 3)
      .map((section) => section.heading.trim())
      .join(" / ");
    console.error(
      `DOC-HYGIENE CHANGELOG.md [发布段空正文] ${emptyReleases.length} 个已发布版本段只有标题/空行(例:${sample});` +
        " 发布段必须有非空正文,防整段被截断或替换成空壳标题。",
    );
    changelogHits += 1;
  }
  if (!/^## 0\.4\.6\b/m.test(changelog)) {
    console.error("DOC-HYGIENE CHANGELOG.md [发布历史缺失] 未找到 v0.4.6 段。");
    changelogHits += 1;
  }
  if (!/^## 未发布 \(Unreleased\)$/m.test(changelog)) {
    console.error("DOC-HYGIENE CHANGELOG.md [结构缺失] 未找到「未发布 (Unreleased)」节。");
    changelogHits += 1;
  }
} catch (error) {
  console.error(`DOC-HYGIENE CHANGELOG.md [不可读] ${error?.message ?? String(error)}`);
  changelogHits += 1;
}

if (hits > 0 || msgHits > 0 || changelogHits > 0) process.exit(1);
console.log(`文档脱密检查通过(CHANGELOG 发布段完整性:${CHANGELOG_RELEASE_BASELINE} 段基线 + 非空正文)。`);
