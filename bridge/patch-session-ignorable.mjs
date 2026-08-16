#!/usr/bin/env node
/**
 * dsh-session ignorable 补丁(dsh-aux 会话事件注册通道)
 *
 * 问题:持久化读链(assertEventsSupported)对 KNOWN_SESSION_EVENT_TYPES
 * 白名单之外的事件类型严格拒绝整个日志;白名单是构建时生成的,官方注释
 * 承认 out-of-repo 插件事件没有注册通道(deferred)。
 *
 * 本补丁实现两件事:
 *  1) append(type, data, opts, { ignorable: true }):支持为事件标记
 *     ignorable —— 读回时该事件被跳过而非拒绝,事件本身保留在日志中
 *     (投影/事件溯源照常回放)。这是官方 SessionEvent envelope 预留的
 *     通道,此处补齐了写入入口。
 *  2) 白名单补充 "aux/llm-call":放行补丁之前已写入的旧日志。
 *
 * dsh-aux 的 _recordEvent 以 ignorable 写入;thinking-zh 等其它插件
 * 可同样调用。npm 更新后需重打。
 *
 * 用法:
 *   node patch-session-ignorable.mjs            # apply
 *   node patch-session-ignorable.mjs --dry-run  # check only
 *   node patch-session-ignorable.mjs --rollback # roll back
 */
import { readFile, writeFile, copyFile, readdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deployedFile, guardTarget } from "./target.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// 不写死用户绝对路径:按部署形态相对解析(symlink / 源码树),并在读写前校验。
const TARGET = guardTarget(deployedFile(
  "../../../@deepseek-ai/dsh-session/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-session/lib/index.js"
), "dsh-session-ignorable");
const MARK = "dsh-aux ignorable (local patch)";

async function block(name) {
  return (await readFile(join(HERE, name), "utf8")).trim();
}
const STEPS = [
  ["append", "orig-session-append.txt", "patched-session-append.txt"],
  ["白名单", "orig-session-whitelist.txt", "patched-session-whitelist.txt"]
];

function log(msg) { console.log("[dsh-session-ignorable] " + msg); }

function syntaxCheck(file) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    log("语法检查通过");
  } catch (error) {
    log("语法检查失败: " + (error.stderr?.toString() ?? error.message));
    process.exitCode = 1;
  }
}

const dryRun = process.argv.includes("--dry-run");
const rollbackMode = process.argv.includes("--rollback");

if (rollbackMode) {
  try { await access(TARGET); } catch { log("目标不存在"); process.exit(1); }
  const baks = (await readdir(dirname(TARGET))).filter((f) => f.startsWith("index.js.bak-") && !f.includes(".node"));
  baks.sort().reverse();
  if (baks.length === 0) { log("无备份可回滚"); process.exit(1); }
  await copyFile(join(dirname(TARGET), baks[0]), TARGET);
  log("已回滚: " + baks[0]);
  syntaxCheck(TARGET);
  process.exit(0);
}

const data = await readFile(TARGET, "utf8");
if (data.includes(MARK)) { log("已是补丁状态,跳过"); process.exit(0); }
const missing = [];
for (const [name, origFile] of STEPS) {
  if (!data.includes(await block(origFile))) missing.push(name);
}
if (missing.length > 0) { log("版本不匹配,缺失块: " + missing.join(", ")); process.exit(1); }
if (dryRun) { log("[dry-run] 可打补丁(" + STEPS.length + " 处)"); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const bak = join(dirname(TARGET), "index.js.bak-" + stamp);
await copyFile(TARGET, bak);
log("备份: " + bak);
let patched = data;
for (const [name, origFile, patchedFile] of STEPS) {
  patched = patched.replace(await block(origFile), await block(patchedFile));
}
if (!patched.includes(MARK)) { log("替换失败,回滚"); await copyFile(bak, TARGET); process.exit(1); }
await writeFile(TARGET, patched);
log("已打补丁(" + STEPS.length + " 处)");
syntaxCheck(TARGET);
