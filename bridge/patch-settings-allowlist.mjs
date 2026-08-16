#!/usr/bin/env node
/**
 * dsh-aux settings 动态暴露补丁 v2(配合 patch-settings-dynamic-expose.mjs)
 *
 * 让插件注册的 settings namespace 能被 Web 设置页读写(settings.describe /
 * settings.mutate),无需集中式白名单。v2 改为:
 *
 *  1) dsh-host-apiproxy:exposedNamespaces() 从 settings.listExposed()
 *     动态合并声明过 exposedToWeb 的 namespace;WEB_SETTINGS_NAMESPACES
 *     还原为平台原始白名单(不再特化 aux)。
 *  2) dsh-settings:见 patch-settings-dynamic-expose.mjs(register 支持
 *     exposedToWeb + listExposed())。
 *
 * dsh-aux 注册 aux namespace 时声明 exposedToWeb: true → 设置页原生可写。
 * 这是 api-proxy 注释中"deferred work"的本地实现,可整理为 upstream PR。
 *
 * 用法:
 *   node patch-settings-allowlist.mjs            # apply / 升级(v1 → v2)
 *   node patch-settings-allowlist.mjs --dry-run  # check only
 *   node patch-settings-allowlist.mjs --rollback # roll back
 */
import { readFile, writeFile, copyFile, readdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deployedFile, guardTarget } from "./target.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// 不写死用户绝对路径:按部署形态相对解析(symlink / 源码树),并在读写前校验。
const TARGET = guardTarget(deployedFile(
  "../../../@deepseek-ai/dsh-host-apiproxy/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js"
), "dsh-aux-allowlist");
const MARK_V2 = "dsh-aux settings dynamic expose (local patch)";

// v1 补丁状态(白名单里带 aux)
const V1_WHITELIST = `const WEB_SETTINGS_NAMESPACES = [
	"agent-loop",
	"shell",
	"locale",
	"permission",
	"ui-conversation",
	"ui-theme",
	"web-search-deepseek",
	"aux" // dsh-aux settings allowlist (local patch)
];`;
const ORIG_WHITELIST = `const WEB_SETTINGS_NAMESPACES = [
	"agent-loop",
	"shell",
	"locale",
	"permission",
	"ui-conversation",
	"ui-theme",
	"web-search-deepseek"
];`;

const ORIG_EXPOSED = `	function exposedNamespaces() {
		const exposed = modelProviderNamespaces();
		for (const ns of WEB_SETTINGS_NAMESPACES) exposed.add(ns);
		for (const ns of PRODUCT_SETTINGS_NAMESPACES) exposed.add(ns);
		return exposed;
	}`;

const PATCHED_EXPOSED = `	function exposedNamespaces() {
		const exposed = modelProviderNamespaces();
		for (const ns of WEB_SETTINGS_NAMESPACES) exposed.add(ns);
		for (const ns of PRODUCT_SETTINGS_NAMESPACES) exposed.add(ns);
		// dsh-aux settings dynamic expose (local patch): namespaces whose
		// owner declared exposedToWeb at settings.register() are served too,
		// so a plugin can open its own settings section without a whitelist
		// change in this package (api-proxy's deferred work, implemented
		// locally; upstreamable).
		try {
			const settings = ctx.get("settings");
			if (settings !== void 0 && typeof settings.listExposed === "function") {
				for (const ns of settings.listExposed()) exposed.add(ns);
			}
		} catch { /* settings absent: keep the static sets */ }
		return exposed;
	}`;

function log(msg) { console.log("[dsh-aux-allowlist] " + msg); }

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
if (data.includes(MARK_V2)) { log("已是 v2,跳过"); process.exit(0); }
const steps = [];
if (data.includes(ORIG_EXPOSED.trim())) steps.push(["exposedNamespaces", ORIG_EXPOSED.trim(), PATCHED_EXPOSED.trim()]);
else if (data.includes(PATCHED_EXPOSED.trim())) { /* already has the function */ }
else { log("版本不匹配: exposedNamespaces 代码块未找到"); process.exit(1); }
// 白名单:还原(若带 aux)
if (data.includes(V1_WHITELIST.trim())) steps.push(["whitelist", V1_WHITELIST.trim(), ORIG_WHITELIST.trim()]);

if (dryRun) { log("[dry-run] 将应用 " + steps.length + " 处替换"); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const bak = join(dirname(TARGET), "index.js.bak-" + stamp);
await copyFile(TARGET, bak);
log("备份: " + bak);
let patched = data;
for (const [name, orig, repl] of steps) patched = patched.replace(orig, repl);
if (!patched.includes(MARK_V2)) { log("替换失败,回滚"); await copyFile(bak, TARGET); process.exit(1); }
await writeFile(TARGET, patched);
log("已打补丁(v2," + steps.length + " 处)");
syntaxCheck(TARGET);
