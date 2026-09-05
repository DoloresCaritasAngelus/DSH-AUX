#!/usr/bin/env node
/**
 * ci-install-smoke — 在 CI 里端到端真跑用户的安装路径。
 *
 * 与 ci-fake-dsh(--apply)互补:那个验证补丁块与 DSH 版本匹配;本脚本验证
 * 「用户从 GitHub 下载仓库后,一条 install.sh 命令装好 + update.sh 幂等」的完整路径。
 *
 * 步骤:
 *   1. 复制 workspace 的 node_modules/@deepseek-ai 真实 DSH 包,构造临时 fake 部署根
 *      (用副本而非 symlink:补丁写入落在临时目录,不污染 workspace);
 *   2. 写最小 start-dsh.sh 桩(含 install-start-hook 可识别的启动行);
 *   3. HOME 指向临时 fake home(profile 补丁层写入被隔离),真跑 ./install.sh --dsh-root <fake>;
 *   4. 断言:symlink / profile 补丁层注册 / start-hook 标记 / doctor 全绿;
 *   5. 真跑 ./update.sh --no-pull --dsh-root <fake>,断言幂等(二次安装不破坏)。
 *
 * 零第三方依赖。仅在 CI/一次性临时目录运行;绝不针对真实 DSH 部署。
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (m) => {
  console.error(`❌ ${m}`);
  process.exit(1);
};

const ROOT = mkdtempSync(join(tmpdir(), "dsh-aux-install-smoke-"));
const DSH_ROOT = join(ROOT, "dsh");
const FAKE_HOME = join(ROOT, "home");
mkdirSync(join(DSH_ROOT, "node_modules", "@deepseek-ai"), { recursive: true });
mkdirSync(FAKE_HOME, { recursive: true });

// 1. 复制真实 DSH 官方包(补丁锚点需要真实源文件)
cpSync(join(REPO, "node_modules", "@deepseek-ai"), join(DSH_ROOT, "node_modules", "@deepseek-ai"), {
  recursive: true,
});
writeFileSync(join(DSH_ROOT, "start-dsh.sh"), '#!/bin/bash\ncd "$HOME/dsh"\nexec npx @deepseek-ai/dsh web\n');

const env = { ...process.env, HOME: FAKE_HOME, DSH_ROOT };
const run = (label, cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: REPO, env, encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`❌ ${label} 退出码 ${r.status}`);
    if (r.stdout) console.error(r.stdout.slice(-2000));
    if (r.stderr) console.error(r.stderr.slice(-2000));
    process.exit(1);
  }
  console.log(`✅ ${label}`);
};

// 2. 真跑用户安装路径(install.sh 内部会:建 symlink、注册 profile 补丁层、
//    apply-patch + session-ignorable、写 start-hook)
run("install.sh --dsh-root", "bash", ["./install.sh", "--dsh-root", DSH_ROOT]);

// 2.5 模拟「重启 DSH」:启动自愈 hook 会在 DSH 启动前跑 self-heal(P7/P8 等)。
//     install.sh 本身不装 P8,健康状态在首次启动自愈之后达成——这是用户真实旅程。
run("self-heal(模拟启动自愈)", process.execPath, ["bridge/self-heal.mjs"]);

// 3. 断言
const AUX_TARGET = join(DSH_ROOT, "node_modules", "@dolorescaritasangelus", "dsh-aux");
if (!existsSync(AUX_TARGET)) fail(`插件 symlink 未创建: ${AUX_TARGET}`);
const profile = readFileSync(join(FAKE_HOME, ".dsh/profiles/web/cordis.patch.yml"), "utf8");
if (!profile.includes("id: aux")) fail("profile 补丁层未注册 aux");
const startSh = readFileSync(join(DSH_ROOT, "start-dsh.sh"), "utf8");
if (!startSh.includes("dsh-aux self-heal")) fail("start-hook 未写入 start-dsh.sh");

// 4. doctor 健康检查(内部含 apply-patch --dry-run 复核)
run("doctor --dsh-root", process.execPath, ["scripts/doctor.mjs", "--dsh-root", DSH_ROOT]);

// 5. update.sh 幂等(CI 内 --no-pull:不拉远端,只重跑接线)
run("update.sh --no-pull(幂等)", "bash", ["./update.sh", "--no-pull", "--dsh-root", DSH_ROOT]);
if (!existsSync(AUX_TARGET)) fail("update.sh 之后插件 symlink 丢失");

rmSync(ROOT, { recursive: true, force: true });
console.log("install-smoke 通过。");
