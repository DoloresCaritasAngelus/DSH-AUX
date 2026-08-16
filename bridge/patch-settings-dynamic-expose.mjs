#!/usr/bin/env node
/**
 * dsh-settings 动态暴露补丁(实现 api-proxy 注释中声明的 deferred work):
 *
 * settings.register() 增加 exposedToWeb 选项 + SettingsProvider.listExposed(),
 * 让插件注册自己的配置 namespace 时显式声明"可被 Web 配置客户端读写",
 * 不再需要集中式白名单(api-proxy 的 WEB_SETTINGS_NAMESPACES)。
 *
 * 配套:dsh-host-apiproxy 的 patch-settings-allowlist.mjs 从 listExposed()
 * 动态合并 namespace;dsh-aux 注册时声明 exposedToWeb: true,设置页原生可用。
 *
 * 用法:
 *   node patch-settings-dynamic-expose.mjs            # apply
 *   node patch-settings-dynamic-expose.mjs --dry-run  # check only
 *   node patch-settings-dynamic-expose.mjs --rollback # roll back
 */
import { readFile, writeFile, copyFile, readdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deployedFile, guardTarget } from "./target.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// 不写死用户绝对路径:按部署形态相对解析(symlink / 源码树),并在读写前校验。
const TARGET = guardTarget(deployedFile(
  "../../../@deepseek-ai/dsh-settings/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-settings/lib/index.js"
), "dsh-settings-dynamic-expose");
const MARK = "dsh-aux dynamic expose (local patch)";

async function block(name) {
  return (await readFile(join(HERE, name), "utf8")).trim();
}
const REPLACEMENTS = [
  ["register", "orig-settings-register.txt", "patched-settings-register.txt"],
  ["listExposed", "orig-settings-list.txt", "patched-settings-list.txt"],
  ["installSettingsSection", "orig-settings-section.txt", "patched-settings-section.txt"]
];

function log(msg) { console.log("[dsh-settings-dynamic-expose] " + msg); }

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
for (const [name, origFile] of REPLACEMENTS) {
  if (!data.includes(await block(origFile))) missing.push(name);
}
if (missing.length > 0) { log("版本不匹配,缺失块: " + missing.join(", ")); process.exit(1); }
if (dryRun) { log("[dry-run] 可打补丁"); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const bak = join(dirname(TARGET), "index.js.bak-" + stamp);
await copyFile(TARGET, bak);
log("备份: " + bak);
let patched = data;
for (const [name, origFile, patchedFile] of REPLACEMENTS) {
  patched = patched.replace(await block(origFile), await block(patchedFile));
}
if (!patched.includes(MARK)) { log("替换失败,回滚"); await copyFile(bak, TARGET); process.exit(1); }
await writeFile(TARGET, patched);
log("已打补丁");
syntaxCheck(TARGET);
