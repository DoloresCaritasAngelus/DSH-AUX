#!/usr/bin/env node
/**
 * dsh-aux settings-allowlist patch
 *
 * dsh-host-apiproxy WEB_SETTINGS_NAMESPACES whitelist only exposes a few
 * namespaces to web clients; aux (and the official agent-default-model) is
 * missing, so the settings page cannot read aux config and settings.mutate
 * is refused with settings-not-exposed.
 *
 * This patch appends "aux" to the whitelist array.
 *
 * Usage:
 *   node patch-settings-allowlist.mjs            # apply
 *   node patch-settings-allowlist.mjs --dry-run  # check only
 *   node patch-settings-allowlist.mjs --rollback # roll back
 */
import { readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const TARGET = "/home/user/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js";
const MARK = "dsh-aux settings allowlist (local patch)";

const ORIG = `const WEB_SETTINGS_NAMESPACES = [
	"agent-loop",
	"shell",
	"locale",
	"permission",
	"ui-conversation",
	"ui-theme",
	"web-search-deepseek"
];`;

const PATCHED = `const WEB_SETTINGS_NAMESPACES = [
	"agent-loop",
	"shell",
	"locale",
	"permission",
	"ui-conversation",
	"ui-theme",
	"web-search-deepseek",
	"aux" // ${MARK}
];`;

function log(msg) { console.log(`[dsh-aux-allowlist] ${msg}`); }

function syntaxCheck(file) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    log("syntax check passed");
  } catch (error) {
    log(`syntax check failed: ${error.stderr?.toString() ?? error.message}`);
    process.exitCode = 1;
  }
}

const dryRun = process.argv.includes("--dry-run");
const rollbackMode = process.argv.includes("--rollback");

if (rollbackMode) {
  const dir = dirname(TARGET);
  const baks = (await readdir(dir)).filter((f) => f.startsWith("index.js.bak-"));
  baks.sort().reverse();
  if (baks.length === 0) { log("no backup to roll back"); process.exit(1); }
  const bak = join(dir, baks[0]);
  await copyFile(bak, TARGET);
  log(`rolled back: ${TARGET} <- ${baks[0]}`);
  syntaxCheck(TARGET);
  process.exit(0);
}

if (!existsSync(TARGET)) { log("dsh-host-apiproxy not found: " + TARGET); process.exit(1); }
const data = await readFile(TARGET, "utf8");
if (data.includes(MARK)) { log("already patched, skip"); process.exit(0); }
if (!data.includes(ORIG)) { log("whitelist block does not match (version changed?), skip, no modification"); process.exit(1); }
if (dryRun) { log("[dry-run] can patch"); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const bak = join(dirname(TARGET), `index.js.bak-${stamp}`);
await copyFile(TARGET, bak);
log(`backup: ${bak}`);
await writeFile(TARGET, data.replace(ORIG, PATCHED));
log("patched: aux added to WEB_SETTINGS_NAMESPACES");
syntaxCheck(TARGET);
log("done. Restart DSH to take effect.");
