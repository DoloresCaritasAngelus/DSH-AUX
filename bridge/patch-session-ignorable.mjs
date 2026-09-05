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
const TARGET = guardTarget(
  deployedFile(
    "../../../@deepseek-ai/dsh-session/lib/index.js",
    "../../../node_modules/@deepseek-ai/dsh-session/lib/index.js",
  ),
  "dsh-session-ignorable",
);
const MARK = "dsh-aux ignorable (local patch)";
/** dsh-aux session event name; also used as a fingerprint for rc.7+ clean packages. */
const AUX_CALL_EVENT = "aux/llm-call";

async function block(name) {
  return (await readFile(join(HERE, name), "utf8")).trim();
}
// DSH 0.1.2-alpha.2/alpha.3 use `seq: this.log.length`; DSH 0.1.2-alpha.4+
// use `seq: SessionSeq(this.log.length)`. Both need the same ignorable write
// entry, so select the original block that matches the deployed source.
const APPEND_VARIANTS = [
  { name: "append-alpha3", origFile: "orig-session-append.txt", patchedFile: "patched-session-append.txt" },
  {
    name: "append-alpha4",
    origFile: "orig-session-append-alpha4-block.txt",
    patchedFile: "patched-session-append-alpha4-block.txt",
  },
];
const WHITELIST_STEP = ["白名单", "orig-session-whitelist.txt", "patched-session-whitelist.txt"];

function log(msg) {
  console.log("[dsh-session-ignorable] " + msg);
}

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
  try {
    await access(TARGET);
  } catch {
    log("目标不存在");
    process.exit(1);
  }
  const baks = (await readdir(dirname(TARGET))).filter((f) => f.startsWith("index.js.bak-") && !f.includes(".node"));
  baks.sort().reverse();
  if (baks.length === 0) {
    log("无备份可回滚");
    process.exit(1);
  }
  await copyFile(join(dirname(TARGET), baks[0]), TARGET);
  log("已回滚: " + baks[0]);
  syntaxCheck(TARGET);
  process.exit(0);
}

const data = await readFile(TARGET, "utf8");
if (data.includes(MARK)) {
  log("已是补丁状态,跳过");
  process.exit(0);
}
const whitelistOrig = await block(WHITELIST_STEP[1]);
const whitelistApplicable = data.includes(whitelistOrig);
// rc.7+/干净 npm 包可能没有 thinking/language 白名单锚点;白名单统一由
// self-heal P8 以 KNOWN_SESSION_EVENT_TYPES 起始标记兜底插入,这里不硬失败。
if (!whitelistApplicable && !data.includes(AUX_CALL_EVENT)) {
  log("白名单原块未命中,跳过(由 self-heal P8 兜底)");
}

// Pick the append block variant that matches the deployed dsh-session source.
const appendVariants = [];
for (const variant of APPEND_VARIANTS) {
  appendVariants.push({
    ...variant,
    origText: await block(variant.origFile),
    patchedText: await block(variant.patchedFile),
  });
}
const appendVariant = appendVariants.find((variant) => data.includes(variant.origText));
if (appendVariant === void 0) {
  log("版本不匹配,缺失 append 原块: alpha.2/3 与 alpha.4+/rc.1 均未命中");
  process.exit(1);
}
const steps = [[appendVariant.name, appendVariant.origText, appendVariant.patchedText]];
if (whitelistApplicable) steps.push(["白名单", await block(WHITELIST_STEP[1]), await block(WHITELIST_STEP[2])]);

if (dryRun) {
  log(
    `[dry-run] 可打补丁(${steps.length} 处${whitelistApplicable ? " + 白名单" : ";白名单跳过"}): ${appendVariant.name}`,
  );
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const bak = join(dirname(TARGET), "index.js.bak-" + stamp);
await copyFile(TARGET, bak);
log("备份: " + bak);
let patched = data;
for (const [name, origText, patchedText] of steps) {
  patched = patched.replace(origText, patchedText);
}
if (!patched.includes(MARK)) {
  log("替换失败,回滚");
  await copyFile(bak, TARGET);
  process.exit(1);
}
await writeFile(TARGET, patched);
log("已打补丁(" + steps.length + " 处): " + appendVariant.name);
syntaxCheck(TARGET);
