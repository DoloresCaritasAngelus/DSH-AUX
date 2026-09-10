/**
 * compat-evidence 回归:证据块必须点名声明版本、无部署根时明确失败(退出码 2),
 * 而不是打印一份看起来正常的空证据。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SCRIPT = join(REPO, "scripts/compat-evidence.mjs");
const COMPAT = JSON.parse(readFileSync(join(REPO, "compat.json"), "utf8"));

function evidence(args, env) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status, out: String(error.stdout ?? "") + String(error.stderr ?? "") };
  }
}

/** 只造出探测所需的最小部署根:compat-evidence 靠 dsh 包版本判定一致性。 */
function fakeRoot() {
  const dir = mkdtempSync(join(tmpdir(), "aux-evidence-root-"));
  const pkgDir = join(dir, "node_modules/@deepseek-ai/dsh");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: COMPAT.dsh }));
  return dir;
}

test("compat-evidence:找不到部署根时退出码 2,不产出空证据", () => {
  const home = mkdtempSync(join(tmpdir(), "aux-evidence-home-"));
  const r = evidence([], { HOME: home, DSH_ROOT: "" });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /找不到 DSH 部署根/);
  rmSync(home, { recursive: true, force: true });
});

test("compat-evidence:证据块点名 compat.json 声明的版本与包版本", () => {
  const root = fakeRoot();
  const r = evidence(["--dsh-root", root], {});
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /DSH 兼容性证据/);
  assert.ok(r.out.includes("`" + COMPAT.dsh + "`"), "证据块必须写出声明版本");
  assert.ok(r.out.includes("`" + COMPAT.package + "`"), "证据块必须写出包版本");
  rmSync(root, { recursive: true, force: true });
});
