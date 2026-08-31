#!/usr/bin/env node
/**
 * CI helper: temporarily install a chosen DSH package version into the
 * workspace node_modules, then restore the original package.json.
 *
 * DSH-AUX is not published to npm; this script only swaps the local
 * `@deepseek-ai/*` devDependencies used by the test suite so we can run the
 * same tests against multiple DSH package lines (0.1.0-rc.6, 0.1.0-rc.8,
 * 0.1.1-rc.2, ...) in GitHub Actions without a full containerized DSH.
 *
 * Usage:
 *   node scripts/install-dsh-version.mjs --version 0.1.0-rc.8
 *   node scripts/install-dsh-version.mjs --version 0.1.0-rc.6 --keep
 *
 * --keep keeps the modified package.json (useful when debugging CI locally).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// DSH packages that share the same rc/version line.  `@deepseek-ai/cordis`
// and `@deepseek-ai/schemastery` are independent stable packages, so they are
// intentionally not rewritten.
const DSH_VERSIONED_PACKAGES = [
  "dsh-agent",
  "dsh-agent-loop",
  "dsh-compaction-basic",
  "dsh-host-apiproxy",
  "dsh-llm",
  "dsh-session",
  "dsh-settings",
  "dsh-timeout",
  "dsh-tool-skill",
  "dsh-tool-subagent",
  "dsh-tool-web",
  "dsh-tools",
  "dsh-workflow-worker-thread"
];

// All @deepseek-ai/dsh-* packages share the DSH release line. Forcing them all
// (including transitive packages such as dsh-system-prompt) to the same version
// prevents npm from resolving a newer DSH transitive package that conflicts
// with an older pinned line during a compatibility-matrix install.
const DSH_OVERRIDE_PACKAGES = [
  "dsh-agent",
  "dsh-agent-default-model",
  "dsh-agent-loop",
  "dsh-agent-presets",
  "dsh-api-gateway",
  "dsh-api-remotes",
  "dsh-atomic-write",
  "dsh-attachment",
  "dsh-brand",
  "dsh-client-connection",
  "dsh-code-runtime",
  "dsh-commands",
  "dsh-compaction",
  "dsh-compaction-basic",
  "dsh-cordis-host-runner",
  "dsh-credentials",
  "dsh-file-reference",
  "dsh-goal",
  "dsh-home-paths",
  "dsh-host-apiproxy",
  "dsh-host-directory-picker",
  "dsh-host-plugin-inventory",
  "dsh-host-webserver",
  "dsh-invariants",
  "dsh-jobs",
  "dsh-llm",
  "dsh-message-feedback",
  "dsh-native-command",
  "dsh-output-retention",
  "dsh-scope",
  "dsh-session",
  "dsh-session-persistence",
  "dsh-session-projection",
  "dsh-session-projection-cache",
  "dsh-session-query",
  "dsh-session-reference",
  "dsh-session-title",
  "dsh-settings",
  "dsh-skill",
  "dsh-storage",
  "dsh-storage-domain",
  "dsh-subagent",
  "dsh-system-prompt",
  "dsh-timeout",
  "dsh-token-meter",
  "dsh-tool-skill",
  "dsh-tool-subagent",
  "dsh-tool-web",
  "dsh-tools",
  "dsh-typert-protocol",
  "dsh-typert-registry",
  "dsh-user-approval",
  "dsh-user-questions",
  "dsh-web",
  "dsh-workflow",
  "dsh-workflow-worker-thread",
  "dsh-workspace"
];

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
console.log(`[install-dsh-version] 临时写入 DSH 版本 ${version} 到 ${changed} 个 devDependencies + ${DSH_OVERRIDE_PACKAGES.length} 个 overrides`);

const result = spawnSync("npm", ["install", "--no-package-lock", "--no-audit", "--no-fund"], {
  cwd: ROOT,
  stdio: "inherit"
});

if (!keep) {
  writeFileSync(PKG_PATH, ORIGINAL);
  console.log("[install-dsh-version] 已恢复原始 package.json");
}

if (result.status !== 0) {
  console.error(`[install-dsh-version] npm install 失败 (exit ${result.status})`);
  process.exit(result.status ?? 1);
}

// Verify the exact line was installed for at least one representative package.
try {
  const installed = JSON.parse(
    readFileSync(join(ROOT, "node_modules/@deepseek-ai/dsh-agent/package.json"), "utf8")
  ).version;
  console.log(`[install-dsh-version] 已安装 @deepseek-ai/dsh-agent@${installed}`);
  if (installed !== version) {
    console.error(`[install-dsh-version] 版本不匹配: 期望 ${version},实际 ${installed}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`[install-dsh-version] 无法读取已安装版本: ${error.message}`);
  process.exit(1);
}