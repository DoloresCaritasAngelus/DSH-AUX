#!/usr/bin/env node
/**
 * CI helper: run `node --check` over every JS/MJS source file in the
 * workspace (excluding node_modules and generated artifacts).
 *
 * Usage:
 *   node scripts/ci-syntax-check.mjs
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIRS = ["dsh-aux/src", "bridge", "scripts", "tests"];

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (stat.isFile() && (extname(full) === ".js" || extname(full) === ".mjs")) {
      files.push(full);
    }
  }
}

for (const dir of DIRS) {
  const abs = join(ROOT, dir);
  if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) walk(abs);
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    console.log(`OK  ${relative(ROOT, file)}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${relative(ROOT, file)}\n${error.stderr?.toString() ?? error.message}`);
  }
}

if (failed > 0) {
  console.error(`\n语法检查: ${failed}/${files.length} 个文件失败`);
  process.exit(1);
}
console.log(`\n语法检查 OK (${files.length} 个文件)`);