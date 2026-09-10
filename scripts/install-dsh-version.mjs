#!/usr/bin/env node
/**
 * CI helper: temporarily install a chosen DSH package version into the
 * workspace node_modules, then restore the original package.json.
 *
 * ⚠️ 只切换 package.json,不还原 node_modules(E1-S3 的根因):
 *   脚本在 `npm install` 之后只把 package.json 写回原样;node_modules 里的
 *   `@deepseek-ai/*` 会保持目标版本,直到你按还原后的 package.json 重新安装。
 *   跑完本脚本后若不需要目标版本,请显式重装(例如
 *   `npm install --no-package-lock --no-audit --no-fund`)或改用独立工作树,
 *   不要让 node_modules 与 package.json 漂移 —— 那会静默改变本地测试口径
 *   (按还原后的 package.json 重新安装即可对齐)。
 *   `--keep` 时连 package.json 也不还原,仅供本地调试。
 *
 * DSH-AUX is not published to npm; this script only swaps the local
 * `@deepseek-ai/*` devDependencies used by the test suite so we can run the
 * same tests against the supported DSH line (supported line declared in compat.json) in
 * GitHub Actions without a full containerized DSH.
 *
 * Usage:
 *   node scripts/install-dsh-version.mjs --version 0.1.5-alpha.1
 *   node scripts/install-dsh-version.mjs --version 0.1.5-alpha.1 --keep
 *
 * --keep keeps the modified package.json (useful when debugging CI locally).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DSH_VERSIONED_PACKAGES, DSH_OVERRIDE_PACKAGES, EXTRA_DEV_PACKAGES } from "./dsh-packages.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PKG_PATH = join(ROOT, "package.json");
const ORIGINAL = readFileSync(PKG_PATH, "utf8");

const args = process.argv.slice(2);
const versionArg = args.indexOf("--version");
const version = versionArg >= 0 ? args[versionArg + 1] : process.env.DSH_VERSION;
const keep = args.includes("--keep");

if (!version) {
  console.error("用法: node scripts/install-dsh-version.mjs --version <DSH-VERSION> [--keep]");
  process.exit(2);
}

// Alpha lines no longer include dsh-host-apiproxy; the workspace devDependencies
// carry the current supported line and install-dsh-version only swaps it.

// Representative packages spanning entrypoint, bridge targets and transitive
// surface; install success plus overrides are verified across all of them.
const VERIFY_PACKAGES = ["dsh-agent", "dsh-session", "dsh-tool-skill"];

// Unsupported lines are not fatal here (the legacy branches carry their own
// copy of this script), but silence would hide a stale matrix: warn loudly.
if (!Object.hasOwn(EXTRA_DEV_PACKAGES, version)) {
  console.warn(
    `[install-dsh-version] 未登记的支持线: ${version}` +
      `(当前支持线:${Object.keys(EXTRA_DEV_PACKAGES).join(", ")});` +
      " 冻结线请用 legacy 分支;本次只按现有 devDependencies 替换版本。",
  );
}

const pkg = JSON.parse(ORIGINAL);
const devDeps = pkg.devDependencies ?? {};
let changed = 0;
for (const name of DSH_VERSIONED_PACKAGES) {
  const key = `@deepseek-ai/${name}`;
  if (Object.hasOwn(devDeps, key)) {
    devDeps[key] = version;
    changed += 1;
  } else {
    console.warn(`[install-dsh-version] 跳过未声明依赖: ${key}`);
  }
}
for (const name of EXTRA_DEV_PACKAGES[version] ?? []) {
  const key = `@deepseek-ai/${name}`;
  devDeps[key] = version;
  changed += 1;
}
if (changed === 0) {
  console.error("[install-dsh-version] package.json 中没有可替换的 @deepseek-ai/* DSH devDependencies");
  process.exit(2);
}

const overrides = pkg.overrides ?? {};
for (const name of DSH_OVERRIDE_PACKAGES) {
  overrides[`@deepseek-ai/${name}`] = version;
}
pkg.overrides = overrides;

writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
console.log(
  `[install-dsh-version] 临时写入 DSH 版本 ${version} 到 ${changed} 个 devDependencies + ${DSH_OVERRIDE_PACKAGES.length} 个 overrides`,
);

const result = spawnSync("npm", ["install", "--no-package-lock", "--no-audit", "--no-fund"], {
  cwd: ROOT,
  stdio: "inherit",
});

if (!keep) {
  writeFileSync(PKG_PATH, ORIGINAL);
  console.log("[install-dsh-version] 已恢复原始 package.json(注意:node_modules 未还原,仍是目标版本)");
}

if (result.status !== 0) {
  console.error(`[install-dsh-version] npm install 失败 (exit ${result.status})`);
  process.exit(result.status ?? 1);
}

// Verify the exact line was installed across several representative packages,
// not just one, so a partial override failure is caught.
try {
  for (const name of VERIFY_PACKAGES) {
    const pkgJson = JSON.parse(readFileSync(join(ROOT, "node_modules/@deepseek-ai", name, "package.json"), "utf8"));
    const installed = pkgJson.version;
    console.log(`[install-dsh-version] 已安装 @deepseek-ai/${name}@${installed}`);
    if (installed !== version) {
      console.error(`[install-dsh-version] 版本不匹配: @deepseek-ai/${name} 期望 ${version},实际 ${installed}`);
      process.exit(1);
    }
  }
} catch (error) {
  console.error(`[install-dsh-version] 无法读取已安装版本: ${error.message}`);
  process.exit(1);
}
