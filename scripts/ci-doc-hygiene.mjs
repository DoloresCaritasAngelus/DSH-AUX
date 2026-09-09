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
 * 退出码:发现命中 = 1(阻塞 CI);干净 = 0。
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEXT_EXT = /\.(md|mjs|js|yml|yaml|json|sh|txt)$/;
const SKIP = [
  /^scripts\/ci-doc-hygiene\.mjs$/, // 本脚本自身包含模式字面量
];

const RULES = [
  {
    name: "aux-notes 私有工作区引用",
    re: /aux-notes\//,
    allow: [/^\.gitignore$/, /^CONTRIBUTING\.md$/, /^\.github\//, /^\.agents\//],
  },
  {
    name: "私有台账文件名",
    re: /02-patch-ledger/,
    allow: [/^\.gitignore$/, /^CONTRIBUTING\.md$/, /^\.github\//, /^\.agents\//],
  },
  {
    name: "私有交接/计划文档名",
    re: /HANDOFF|EXECUTION-PLAN|maintenance-debt|version-support-plan|04-glossary|u1-readme/,
  },
  { name: "内部蓝图章节引用", re: /蓝图 §/ },
  { name: "本机绝对路径 /home/<user>", re: /\/home\/(?!user\b|\.\.\/?\.?)/ },
  { name: "Windows 盘符路径", re: /[A-Z]:\\(?![ntr0])/ },
];

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter((f) => TEXT_EXT.test(f) && !SKIP.some((re) => re.test(f)));

let hits = 0;
for (const file of files) {
  let lines;
  try {
    lines = readFileSync(file, "utf8").split("\n");
  } catch {
    continue;
  }
  for (let i = 0; i < lines.length; i++) {
    for (const rule of RULES) {
      if (rule.allow?.some((re) => re.test(file))) continue;
      if (rule.re.test(lines[i])) {
        console.error(`DOC-HYGIENE ${file}:${i + 1} [${rule.name}] ${lines[i].trim().slice(0, 100)}`);
        hits += 1;
      }
    }
  }
}

// 提交信息扫描(本地/PR 场景:origin/main..HEAD 可解析时生效;CI 浅克隆自动跳过)。
// 规则比文件扫描更严:提交信息只允许描述 diff 可见的变更,因此 aux-notes 等即使
// 与 diff 相关也统一不豁免——涉及私有路径的描述留在 aux-notes,不进提交信息。
const MSG_RULES = [
  { name: "私有工作区引用", re: /aux-notes\/|\.local\/|HANDOFF|EXECUTION-PLAN/ },
  { name: "内部蓝图编号引用", re: /蓝图 §|04-glossary|A1[6-9] §/ },
  { name: "本机绝对路径 /home/<user>", re: /\/home\/(?!user\b|\.\.\/?\.?)/ },
  { name: "Windows 盘符路径", re: /[A-Z]:\\(?![ntr0])/ },
  { name: "会话归属式提法", re: /等用户指示|用户确认[后了对]?再|本地未推送/ },
  { name: "会话叙事/事故叙述", re: /事故|AI (起草|未与维护者)|对齐意图|已决定接受/ },
];

let msgHits = 0;
try {
  const msgs = execSync("git log --format=%B origin/main..HEAD", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  for (const line of msgs.split("\n")) {
    for (const rule of MSG_RULES) {
      if (rule.re.test(line)) {
        console.error(`DOC-HYGIENE (commit message) [${rule.name}] ${line.trim().slice(0, 100)}`);
        msgHits += 1;
      }
    }
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
const CHANGELOG_RELEASE_BASELINE = 23; // 基线 v0.4.4 时的已发布版本段数量

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
  if (!/^## 0\.4\.4\b/m.test(changelog)) {
    console.error("DOC-HYGIENE CHANGELOG.md [发布历史缺失] 未找到 v0.4.4 段。");
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
