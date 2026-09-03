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
 *   2. P1-P6 + P11 桥接补丁(image/subagent/workflow/skill-audit):
 *      重跑 bridge/apply-patch.mjs(幂等);
 *   3. P7 session append ignorable 写入口:缺失时外科式补上(专用块,不做白名单整跑);
 *   4. P8 白名单:保证 lib/index.js 与 lib/types/known-event-types.js 都含
 *      "aux/llm-call"(不负责 thinking/language——那是 dsh-thinking-zh 插件的事);
 *   5. 旧版 rc.6 settings 补丁(P9/P10)已退役,见 bridge/retired/,主支不再调用。
 *
 * 用法:
 *   node bridge/self-heal.mjs            # 实际自愈(写盘)
 *   node bridge/self-heal.mjs --dry-run  # 只报告会做什么,不写盘
 * 被 ~/dsh/start-dsh.sh 在启动 DSH 前调用;失败不致命(继续启动)。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deployedFile, guardPackageFile, guardTarget } from "./target.js";

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
  let st;
  try {
    st = lstatSync(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const brokenSymlink = st?.isSymbolicLink() === true && !existsSync(target);
  if (brokenSymlink) {
    if (DRY) { log(`[dry-run] 将移除损坏 symlink 并重建: ${target} -> ${join(REPO, "dsh-aux")}`); return; }
    unlinkSync(target);
    log(`已移除损坏 symlink: ${target}`);
  } else if (st) {
    log(`symlink 存在,跳过: ${target}`);
    return;
  }
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

function syntaxCheck(file, label) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    log(`${label} 语法检查通过`);
    return true;
  } catch (error) {
    log(`${label} 语法检查失败: ${error.stderr?.toString() ?? error.message}`);
    return false;
  }
}

function backupFile(file, tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  let bak = `${file}.bak-selfheal-${stamp}`;
  let suffix = 0;
  while (existsSync(bak)) {
    suffix += 1;
    bak = `${file}.bak-selfheal-${stamp}-${suffix}`;
  }
  copyFileSync(file, bak);
  log(`${tag} 备份: ${bak}`);
  return bak;
}

/** P7: 只打 session append 的 ignorable 写入口(整跑 patch-session-ignorable 会因 rc.7 白名单块不匹配失败)。 */
function ensureSessionAppendIgnorable() {
  const tgt = guardTarget(deployedFile(
    "../../../@deepseek-ai/dsh-session/lib/index.js",
    "../../../node_modules/@deepseek-ai/dsh-session/lib/index.js"
  ), "dsh-aux-self-heal");
  const data = readFileSync(tgt, "utf8");
  if (data.includes("opts[1]?.ignorable")) { log("P7 已打,跳过"); return; }

  // DSH 0.1.2-alpha.2/alpha.3 and 0.1.2-alpha.4+/rc.1 have different
  // append internals (`seq: this.log.length` vs `seq: SessionSeq(...)`),
  // so choose the matching original block before replacing.
  const appendVariants = [
    ["alpha.2/3", "orig-session-append.txt", "patched-session-append.txt"],
    ["alpha.4+/rc.1", "orig-session-append-alpha4-block.txt", "patched-session-append-alpha4-block.txt"]
  ];
  const variant = appendVariants.find(([label, origFile]) =>
    data.includes(readFileSync(join(HERE, origFile), "utf8").trim())
  );
  if (variant === void 0) {
    log("⚠️ P7 无法自动补:append 原块不匹配(alpha.2/3 与 alpha.4+/rc.1 均未命中),请人工核对 DSH 版本");
    return;
  }
  const [label, origFile, patchedFile] = variant;
  const orig = readFileSync(join(HERE, origFile), "utf8").trim();
  const patched = readFileSync(join(HERE, patchedFile), "utf8").trim();
  if (DRY) { log(`[dry-run] 将打 P7 session append ignorable(${label})`); return; }
  const bak = `${tgt}.bak-selfheal-${Date.now()}`;
  copyFileSync(tgt, bak);
  const out = data.replace(orig, patched);
  if (!out.includes("opts[1]?.ignorable")) { log("⚠️ P7 替换失败,已回滚"); copyFileSync(bak, tgt); return; }
  writeFileSync(tgt, out);
  log(`P7 已打(${label},备份 ${bak})`);
}

/** P8: 保证两处白名单都含 aux/llm-call(不负责 thinking/language)。 */
function ensureWhitelist(root) {
  const files = [
    guardPackageFile(join(root, "node_modules/@deepseek-ai/dsh-session/lib/index.js"), "dsh-aux-self-heal"),
    guardPackageFile(join(root, "node_modules/@deepseek-ai/dsh-session/lib/types/known-event-types.js"), "dsh-aux-self-heal")
  ];
  for (const f of files) {
    if (!existsSync(f)) { log(`白名单文件缺失,跳过: ${f}`); continue; }
    const data = readFileSync(f, "utf8");
    if (data.includes('"aux/llm-call"') || data.includes("'aux/llm-call'")) { log(`P8 已含 aux/llm-call,跳过: ${f}`); continue; }
    const marker = "const KNOWN_SESSION_EVENT_TYPES = new Set([";
    if (!data.includes(marker)) { log(`⚠️ P8 无法自动补:未找到目录声明(${f})`); continue; }
    if (DRY) { log(`[dry-run] 将向白名单插入 aux/llm-call: ${f}`); continue; }
    const bak = backupFile(f, `P8`);
    const out = data.replace(marker, `${marker}\n\t"aux/llm-call",`);
    if (!out.includes('"aux/llm-call"') && !out.includes("'aux/llm-call'")) {
      log(`⚠️ P8 替换失败,已回滚: ${f}`);
      copyFileSync(bak, f);
      continue;
    }
    try {
      writeFileSync(f, out);
    } catch (error) {
      log(`P8 写盘失败,已回滚: ${error?.message ?? error}`);
      copyFileSync(bak, f);
      continue;
    }
    if (!syntaxCheck(f, `P8`)) {
      copyFileSync(bak, f);
      log(`P8 语法检查失败,已回滚: ${f}`);
      continue;
    }
    log(`P8 已插入 aux/llm-call: ${f}`);
  }
}

function main() {
  const root = detectDshRoot();
  if (!root) { log("未找到 DSH 部署根(跳过自愈)"); return; }
  // 子脚本(apply-patch)需要 DSH_ROOT 解析目标;不设置时,
  // 包缺失会回退到仓库相对路径并触发 unsafe patch target。
  process.env.DSH_ROOT = root;
  log(`DSH 根: ${root} (${DRY ? "dry-run" : "实际修复"})`);
  // 每步独立容错:某一步失败(如某个补丁目标版本不匹配)不中断后续步骤。
  const step = (name, fn) => {
    try { fn(); } catch (error) { log(`${name} 失败(继续): ${error?.message ?? error}`); }
  };
  step("symlink", () => ensureSymlink(root));
  step("P1-P6/P11", () => { log("重跑 P1-P6/P11 桥接补丁(幂等)..."); runNode(join(HERE, "apply-patch.mjs")); });
  step("P7", () => ensureSessionAppendIgnorable());
  step("P8", () => ensureWhitelist(root));
  log(DRY ? "dry-run 完成(未写盘)" : "自愈完成。若本次有修复,请重启 DSH 生效。");
}

main();
