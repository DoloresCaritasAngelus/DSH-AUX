#!/usr/bin/env node
/**
 * install-start-hook — 把 dsh-aux 启动自愈 hook 幂等写入 DSH 的 start-dsh.sh。
 *
 * 背景:rc.7 升级事故证明 npm 升级会清 symlink/补丁/白名单;自愈脚本
 * `bridge/self-heal.mjs` 必须在 DSH 启动前跑。本脚本让 `install.sh` 能安全地
 * 把 hook 写进用户启动脚本,避免"换机/别人安装后没有自愈"。
 *
 * 安全设计(风险可控):
 *   - 只在文件存在且含可识别 `exec npx @deepseek-ai/dsh web` 行时插入;
 *   - 带标记 `dsh-aux self-heal`,已存在则跳过(不重复);
 *   - 首次写入前备份 `start-dsh.sh.bak-<ts>`;
 *   - `--dry-run` 只报告不写;
 *   - 文件缺失/结构未知 → 跳过并提示,绝不猜测/破坏。
 *
 * 用法:
 *   node bridge/install-start-hook.mjs <start-dsh.sh> <repo> [--dry-run]
 * 由 install.sh 调用(可 `--no-start-hook` 整体跳过)。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const [startSh, repo] = process.argv.slice(2);
const DRY = process.argv.includes("--dry-run");
const MARK = "dsh-aux self-heal";

function log(msg) { console.log(`[dsh-aux-install-start-hook] ${msg}`); }

if (!startSh || !repo) { log("用法: node install-start-hook.mjs <start-dsh.sh> <repo> [--dry-run]"); process.exit(2); }

if (!existsSync(startSh)) { log(`未找到 ${startSh},跳过(不会创建)`); process.exit(0); }
const data = readFileSync(startSh, "utf8");
if (data.includes(MARK)) { log("hook 已存在,跳过"); process.exit(0); }

const EXEC_LINE = "exec npx @deepseek-ai/dsh web";
const idx = data.lastIndexOf(EXEC_LINE);
if (idx === -1) { log(`未找到可识别的 "${EXEC_LINE}" 行,跳过(不猜测)`); process.exit(0); }

const block =
`\n# dsh-aux self-heal(幂等):npm 升级会清掉手工 symlink、本地补丁与自定义事件\n` +
`# 白名单(aux/llm-call),启动前自动检查并重打;失败不阻塞启动。\n` +
`AUX_SELF_HEAL="${repo}/bridge/self-heal.mjs"\n` +
`if [ -f "$AUX_SELF_HEAL" ]; then\n` +
`  node "$AUX_SELF_HEAL" >> "$HOME/dsh/dsh-web.log" 2>&1 || echo "WARN: dsh-aux self-heal failed (non-fatal)"\n` +
`fi\n`;

if (DRY) { log(`[dry-run] 将在 ${startSh} 的 exec 行前插入自愈 hook`); process.exit(0); }

// 备份(仅首次,幂等)
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const bak = `${startSh}.bak-${stamp}`;
copyFileSync(startSh, bak);
log(`备份: ${bak}`);

const out = data.slice(0, idx) + block + data.slice(idx);
writeFileSync(startSh, out);
log("已插入自愈 hook");

// bash 语法校验
try {
  execFileSync("bash", ["-n", startSh], { stdio: "pipe" });
  log("bash 语法检查通过");
} catch (e) {
  log(`bash 语法检查失败: ${e.stderr?.toString() ?? e.message};请检查 ${startSh}`);
  process.exitCode = 1;
}
