#!/usr/bin/env node
/**
 * pr-body-hygiene — PR 标题与描述的脱密守门(本地执行;CI 不跑)。
 *
 * 为什么单独有这一道闸
 * --------------------
 * 文件有闸(`ci-doc-hygiene` 扫 `git ls-files`),提交信息也有闸(扫
 * `origin/main..HEAD`)。但 PR 标题与描述既不在工作树里、也不在提交历史里 ——
 * 它们**同样进入公网**,却是唯一没有被覆盖的公开信道。历史上正是一次 PR 描述
 * 把私有台账路径、内部环境名与评审过程叙述一起写了出去,而当时两道闸都是绿的。
 *
 * 规则表与提交信息扫描共用 `scripts/hygiene-rules.mjs` 的 `MESSAGE_RULES`
 * (单一真相源):能写进提交信息的,才允许写进 PR 描述。
 *
 * 顺带提供规模数字的正确基准
 * --------------------------
 * 描述里的 `files changed / insertions / deletions` 应以 `origin/main...HEAD` 计。
 * 本地 `main` 引用落后于 `origin/main` 时,`main...HEAD` 会把**已经合并的提交**
 * 一起算进去,数字凭空变大。本脚本在最后打印正确基准,并在本地 main 落后时告警。
 *
 * 用法:
 *   node scripts/pr-body-hygiene.mjs            # 当前分支对应的 PR
 *   node scripts/pr-body-hygiene.mjs --pr 34    # 指定 PR(编号或 URL 均可)
 *   node scripts/pr-body-hygiene.mjs --stdin < draft.md   # 开 PR 前预检草稿
 *
 * 退出码:0 = 干净;1 = 命中脱密规则;2 = 取不到 PR 或参数错误。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MESSAGE_RULES, scanText } from "./hygiene-rules.mjs";

const USAGE = `用法:
  node scripts/pr-body-hygiene.mjs            # 当前分支对应的 PR
  node scripts/pr-body-hygiene.mjs --pr 34    # 指定 PR
  node scripts/pr-body-hygiene.mjs --stdin < draft.md   # 预检草稿(不联网)`;

/** 定位 gh:先 PATH,再 ${HOME}/.local/bin(常见的手动安装位置)。 */
function ghBinary() {
  const candidates = [process.env.GH_BIN, "gh", join(homedir(), ".local", "bin", "gh")].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/** 解析 `--pr <n>` / `--stdin`;未知参数直接报错。 */
function parseArgs(argv) {
  const options = { pr: null, stdin: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stdin") options.stdin = true;
    else if (arg === "--pr") {
      options.pr = argv[++i] ?? null;
      if (options.pr === null) throw new Error("--pr 需要一个编号或 URL");
    } else if (arg === "-h" || arg === "--help") options.help = true;
    else throw new Error(`未知参数:${arg}`);
  }
  return options;
}

/** 取回 PR 的标题与正文。 */
function fetchPullRequest(gh, pr) {
  const args = ["pr", "view", ...(pr ? [pr] : []), "--json", "number,title,body,url"];
  try {
    return JSON.parse(execFileSync(gh, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (error) {
    process.stderr.write(
      `取不到 PR(gh pr view 失败):${error?.stderr?.toString().trim() || error?.message || String(error)}\n` +
        "若尚未开 PR,可先用 --stdin 预检草稿。\n",
    );
    process.exit(2);
  }
}

/**
 * 规模数字的正确基准。返回展示文本;不在 git 工作树里时返回 null。
 */
function baseNote() {
  try {
    const stat = execFileSync("git", ["diff", "--shortstat", "origin/main...HEAD"], { encoding: "utf8" }).trim();
    const behind = execFileSync("git", ["rev-list", "--count", "main..origin/main"], { encoding: "utf8" }).trim();
    const lines = [];
    if (stat) lines.push(`规模数字请以 origin/main...HEAD 为准:${stat}`);
    else lines.push("规模数字请以 origin/main...HEAD 为准(当前为空:分支尚无差异或 origin/main 未取回)");
    if (behind !== "0" && behind !== "") {
      lines.push(
        `⚠️ 本地 main 落后 origin/main ${behind} 个提交 —— 用 main...HEAD 计规模会把已合并提交一起算进去(数字虚高)。`,
      );
    }
    return lines;
  } catch {
    return null;
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

let label;
let text;
if (options.stdin) {
  label = "stdin(草稿预检)";
  text = readFileSync(0, "utf8");
} else {
  const gh = ghBinary();
  if (gh === null) {
    process.stderr.write("找不到 gh;请安装 GitHub CLI,或改用 --stdin 预检草稿。\n");
    process.exit(2);
  }
  const pr = fetchPullRequest(gh, options.pr);
  label = `#${pr.number}(${pr.url})`;
  text = `${pr.title ?? ""}\n${pr.body ?? ""}`;
}

const hits = scanText(text, MESSAGE_RULES);
for (const hit of hits) {
  process.stderr.write(`PR-BODY-HYGIENE [${hit.rule}] ${hit.text}\n`);
}
for (const line of baseNote() ?? []) console.log(line);

if (hits.length > 0) {
  process.stderr.write(
    `\n${hits.length} 处 PR 标题/描述脱密命中:PR 描述与提交信息同级 —— 只写 diff 可见的变更语义,\n` +
      "私有台账、本机路径、内部环境与评审过程一律留在私有笔记里。\n",
  );
  process.exit(1);
}
console.log(`PR 标题/描述脱密检查通过:${label}`);
