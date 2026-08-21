#!/usr/bin/env node
/**
 * dsh-aux self-heal — DSH 启动/升级后的幂等自愈。
 *
 * 背景(2026-08-19 事故):npm 重装/升级 DSH 会
 *   1) prune 手工建的插件 symlink(dsh-aux 等);
 *   2) 清掉 node_modules 里所有本地补丁(P1-P11);
 *   3) 重生成官方 KNOWN_SESSION_EVENT_TYPES(白名单),自定义事件(aux/llm-call)
 *      从打包产物中消失 → 旧会话/新事件一读就 unknown。
 * 本脚本把"检查 + 重打"固化成启动自愈(蓝图 §2.3 版本检测+动态补丁)。
 *
 * 职责(AUX 自持,不碰其它插件):
 *   1. dsh-aux 插件 symlink 存在(缺失重建);
 *   2. P1-P6 + P11 + P12 桥接补丁(image/subagent/workflow/skill-audit/web_fetch compat):
 *      重跑 bridge/apply-patch.mjs(幂等);
 *   3. P7 session append ignorable 写入口:缺失时外科式补上(专用块,不做白名单整跑);
 *   4. P8 白名单:保证 lib/index.js 与 lib/types/known-event-types.js 都含
 *      "aux/llm-call"(不负责 thinking/language——那是 dsh-thinking-zh 插件的事);
 *   5. P9/P10 settings:调带 rc 守卫的脚本(rc.6 需要则打,rc.7+ 原生自动跳过)。
 *
 * 用法:
 *   node bridge/self-heal.mjs            # 实际自愈(写盘)
 *   node bridge/self-heal.mjs --dry-run  # 只报告会做什么,不写盘
 * 被 ~/dsh/start-dsh.sh 在启动 DSH 前调用;失败不致命(继续启动)。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deployedFile, guardTarget, readPackageVersion, isRc7OrNewer } from "./target.js";

const HERE = dirname(fileURLToPath(import.meta.url)); // <repo>/bridge
const REPO = resolve(HERE, "..");
const DRY = process.argv.includes("--dry-run");

function log(msg) { console.log(`[dsh-aux-self-heal] ${msg}`); }

function detectDshRoot() {
  if (process.env.DSH_ROOT) return process.env.DSH_ROOT;
  const home = process.env.HOME;
  const candidates = [join(home, "dsh"), join(home, ".local/share/dsh"), "/opt/dsh"];
  for (const c of candidates) if (existsSync(join(c, "node_modules/@deepseek-ai"))) return c;
  return null;
}

function dshAuxTarget(root) {
  return join(root, "node_modules/@dolorescaritasangelus/dsh-aux");
}

function ensureSymlink(root) {
  const target = dshAuxTarget(root);
  if (existsSync(target)) { log(`symlink 存在,跳过: ${target}`); return; }
  if (DRY) { log(`[dry-run] 将重建 symlink: ${target} -> ${join(REPO, "dsh-aux")}`); return; }
  // npm prune 可能连 @dolorescaritasangelus/ 目录一起删掉,先确保父目录存在。
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(join(REPO, "dsh-aux"), target, "dir");
  log(`已重建 symlink: ${target} -> ${join(REPO, "dsh-aux")}`);
}

function runNode(script, args = []) {
  const argv = [script, ...args];
  if (DRY) argv.push("--dry-run");
  const out = execFileSync(process.execPath, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  for (const line of out.split("\n")) if (line.trim()) log(`  ${line.trim()}`);
  if (/(版本不匹配|未找到已知代码块|无法自动补|缺失块|替换失败)/.test(out)) {
    log("⚠️ 检测到补丁/自愈不匹配——当前 DSH 版本可能与 dsh-aux 不兼容,请运行 ./update.sh 或更新 dsh-aux");
  }
}

/** P7: 只打 session append 的 ignorable 写入口(整跑 patch-session-ignorable 会因 rc.7 白名单块不匹配失败)。 */
function ensureSessionAppendIgnorable() {
  const tgt = guardTarget(deployedFile(
    "../../../@deepseek-ai/dsh-session/lib/index.js",
    "../../../node_modules/@deepseek-ai/dsh-session/lib/index.js"
  ), "dsh-aux-self-heal");
  const data = readFileSync(tgt, "utf8");
  if (data.includes("opts[1]?.ignorable")) { log("P7 已打,跳过"); return; }
  const orig = readFileSync(join(HERE, "orig-session-append.txt"), "utf8").trim();
  const patched = readFileSync(join(HERE, "patched-session-append.txt"), "utf8").trim();
  if (!data.includes(orig)) { log("⚠️ P7 无法自动补:append 原块不匹配,请人工核对 rc 版本"); return; }
  if (DRY) { log("[dry-run] 将打 P7 session append ignorable"); return; }
  const bak = `${tgt}.bak-selfheal-${Date.now()}`;
  copyFileSync(tgt, bak);
  const out = data.replace(orig, patched);
  if (!out.includes("opts[1]?.ignorable")) { log("⚠️ P7 替换失败,已回滚"); copyFileSync(bak, tgt); return; }
  writeFileSync(tgt, out);
  log(`P7 已打(备份 ${bak})`);
}

/** P8: 保证两处白名单都含 aux/llm-call(不负责 thinking/language)。 */
function ensureWhitelist(root) {
  const files = [
    join(root, "node_modules/@deepseek-ai/dsh-session/lib/index.js"),
    join(root, "node_modules/@deepseek-ai/dsh-session/lib/types/known-event-types.js")
  ];
  for (const f of files) {
    if (!existsSync(f)) { log(`白名单文件缺失,跳过: ${f}`); continue; }
    const data = readFileSync(f, "utf8");
    if (data.includes('"aux/llm-call"') || data.includes("'aux/llm-call'")) { log(`P8 已含 aux/llm-call,跳过: ${f}`); continue; }
    const marker = "const KNOWN_SESSION_EVENT_TYPES = new Set([";
    if (!data.includes(marker)) { log(`⚠️ P8 无法自动补:未找到目录声明(${f})`); continue; }
    if (DRY) { log(`[dry-run] 将向白名单插入 aux/llm-call: ${f}`); continue; }
    const out = data.replace(marker, `${marker}\n\t"aux/llm-call",`);
    writeFileSync(f, out);
    log(`P8 已插入 aux/llm-call: ${f}`);
  }
}

function main() {
  const root = detectDshRoot();
  if (!root) { log("未找到 DSH 部署根(跳过自愈)"); return; }
  log(`DSH 根: ${root} (${DRY ? "dry-run" : "实际修复"})`);
  // 每步独立容错:某一步失败(如某个补丁目标版本不匹配)不中断后续步骤。
  const step = (name, fn) => {
    try { fn(); } catch (error) { log(`${name} 失败(继续): ${error?.message ?? error}`); }
  };
  step("symlink", () => ensureSymlink(root));
  step("P1-P6/P11/P12", () => { log("重跑 P1-P6/P11/P12 桥接补丁(幂等)..."); runNode(join(HERE, "apply-patch.mjs")); });
  step("P7", () => ensureSessionAppendIgnorable());
  step("P8", () => ensureWhitelist(root));
  step("P9/P10", () => {
    log("settings 补丁(rc 守卫自动决定)...");
    runNode(join(HERE, "patch-settings-dynamic-expose.mjs"));
    runNode(join(HERE, "patch-settings-allowlist.mjs"));
  });
  log(DRY ? "dry-run 完成(未写盘)" : "自愈完成。若本次有修复,请重启 DSH 生效。");
}

main();
