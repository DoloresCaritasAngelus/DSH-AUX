#!/usr/bin/env node
/**
 * CI helper: build a minimal fake DSH deployment root from the workspace's
 * installed `node_modules/@deepseek-ai` packages, then verify that all dsh-aux
 * bridge patches still match the installed DSH version.
 *
 * This is the cheap, container-free equivalent of a deployment smoke test:
 *   - It does NOT start DSH or load the UI.
 *   - It DOES verify the text-level patch blocks against the actual installed
 *     DSH package sources, which is the part most likely to break when DSH
 *     changes between rc.6 / rc.8 / 0.1.1-rc.x.
 *
 * Modes:
 *   node scripts/ci-fake-dsh.mjs            # dry-run: assert patches are applicable
 *   node scripts/ci-fake-dsh.mjs --apply    # actually apply to fake root, then run doctor
 *   node scripts/ci-fake-dsh.mjs --keep     # keep temp fake root for debugging
 *
 * In --apply mode the fake root symlinks back to this workspace's
 * `node_modules/@deepseek-ai`, so patch writes go into the workspace node_modules.
 * That is intentional for disposable CI runners; do not run --apply against a
 * real DSH deployment or a node_modules you need to keep pristine.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const KEEP = args.includes("--keep");

const ROOT = mkdtempSync(join(tmpdir(), "dsh-aux-ci-"));
const FAKE_HOME = join(ROOT, "home");
let failed = false;

function fail(message) {
  console.error(`❌ ${message}`);
  failed = true;
}

function run(label, scriptRel, extraArgs = []) {
  const script = join(REPO, scriptRel);
  const args2 = APPLY ? extraArgs : [...extraArgs, "--dry-run"];
  const res = spawnSync(process.execPath, [script, ...args2], {
    cwd: REPO,
    env: { ...process.env, DSH_ROOT: ROOT, HOME: FAKE_HOME },
    encoding: "utf8"
  });
  console.log(`\n== ${label} ==`);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);

  if (res.status !== 0) {
    fail(`${label} 退出码 ${res.status}`);
    return;
  }

  if (!APPLY) {
    // Dry-run must prove the patch blocks are still understood. A patch that
    // cannot find its original block is treated as a compatibility failure.
    const fatal = /版本不匹配|未找到已知代码块|缺失块|替换失败|步骤块未命中|无法自动补/.test(res.stdout ?? "");
    if (fatal) {
      fail(`${label} dry-run 发现补丁块不匹配`);
      return;
    }
    const applicable = /可从 .* 升级|可打补丁|已是 .*跳过|跳过|将应用|rc\.7\+.*跳过/.test(res.stdout ?? "");
    if (!applicable) {
      fail(`${label} dry-run 未识别到可应用/跳过状态`);
    }
  }
}

function setupFakeRoot() {
  // node_modules/@deepseek-ai -> workspace node_modules (read-only for dry-run)
  mkdirSync(join(ROOT, "node_modules"), { recursive: true });
  symlinkSync(join(REPO, "node_modules/@deepseek-ai"), join(ROOT, "node_modules/@deepseek-ai"), "dir");

  // dsh-aux plugin symlink (doctor/install dry-run expect this)
  mkdirSync(join(ROOT, "node_modules/@dolorescaritasangelus"), { recursive: true });
  symlinkSync(join(REPO, "dsh-aux"), join(ROOT, "node_modules/@dolorescaritasangelus/dsh-aux"), "dir");

  // fake user profile used by scripts/doctor.mjs
  mkdirSync(join(FAKE_HOME, ".dsh/profiles/web"), { recursive: true });
  writeFileSync(join(FAKE_HOME, ".dsh/profiles/web/cordis.patch.yml"), "id: aux\n");

  // fake start script so doctor's start-hook check can be satisfied
  writeFileSync(join(ROOT, "start-dsh.sh"), "#!/bin/bash\n# dsh-aux self-heal\n");
}

function runDoctor() {
  const res = spawnSync(
    process.execPath,
    [join(REPO, "scripts/doctor.mjs"), "--dsh-root", ROOT, "--json"],
    { cwd: REPO, env: { ...process.env, DSH_ROOT: ROOT, HOME: FAKE_HOME }, encoding: "utf8" }
  );
  console.log("\n== doctor ==");
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    fail(`doctor 退出码 ${res.status}`);
    return;
  }
  try {
    const report = JSON.parse(res.stdout);
    if (!report.ok) fail(`doctor 报告 ${report.errors} error(s)`);
  } catch {
    fail("doctor JSON 输出无法解析");
  }
}

try {
  setupFakeRoot();
  console.log(`fake DSH 根: ${ROOT}  (模式: ${APPLY ? "apply" : "dry-run"})`);

  run("apply-patch (P1-P6/P11)", "bridge/apply-patch.mjs");
  run("session-ignorable (P7)", "bridge/patch-session-ignorable.mjs");
  run("settings-dynamic-expose (P9)", "bridge/patch-settings-dynamic-expose.mjs");
  run("settings-allowlist (P10)", "bridge/patch-settings-allowlist.mjs");

  if (APPLY) {
    // Simulate the start-hook self-heal so P7/P8 whitelist writes also happen,
    // then verify the deployment with scripts/doctor.mjs.
    run("self-heal", "bridge/self-heal.mjs");
    runDoctor();
  }
} finally {
  if (!KEEP) {
    rmSync(ROOT, { recursive: true, force: true });
  } else {
    console.log(`保留 fake DSH 根: ${ROOT}`);
  }
}

if (failed) {
  console.error("\nci-fake-dsh: 失败");
  process.exit(1);
}
console.log("\nci-fake-dsh: OK");
