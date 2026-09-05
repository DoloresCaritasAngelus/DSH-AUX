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
 * 退出码:发现命中 = 1(阻塞 CI);干净 = 0。
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEXT_EXT = /\.(md|mjs|js|yml|yaml|json|sh|txt)$/;
const SKIP = [
  /^scripts\/ci-doc-hygiene\.mjs$/, // 本脚本自身包含模式字面量
  /^bridge\/retired\//, // 冻结的历史补丁(其中的锚点文本不可改动)
  /^tests\//, // 测试用 /home/user 等占位路径
];

const RULES = [
  { name: "aux-notes 私有工作区引用", re: /aux-notes\//, allow: [/^\.gitignore$/, /^CONTRIBUTING\.md$/, /^\.github\//, /^\.agents\//] },
  { name: "私有台账文件名", re: /02-patch-ledger/, allow: [/^\.gitignore$/, /^CONTRIBUTING\.md$/, /^\.github\//, /^\.agents\//] },
  { name: "私有交接/计划文档名", re: /HANDOFF|EXECUTION-PLAN|maintenance-debt|version-support-plan|04-glossary|u1-readme/ },
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
  // 无 origin/main(浅克隆/首次推送前):跳过提交信息扫描
}

if (hits > 0) {
  console.error(`\n${hits} 处文件内容脱密命中:公开文档不得依赖私有文件或携带本机路径。`);
  console.error("维护者内容请写入 aux-notes/(gitignore);引用私有台账须带「本地 gitignore,不随仓库分发」注记。");
}
if (msgHits > 0) {
  console.error(`\n${msgHits} 处提交信息脱密命中:提交信息只写 diff 可见的变更语义,过程内容留在 aux-notes。`);
}
if (hits > 0 || msgHits > 0) process.exit(1);
console.log("文档脱密检查通过。");
