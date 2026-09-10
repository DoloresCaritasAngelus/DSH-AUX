/**
 * compat 同步闸回归(变异测试):锁住 scripts/sync-compat.mjs 的三条契约 ——
 * 无漂移时静默通过、有漂移时报错、锚点被改写时报锚点失配而不是静默跳过。
 *
 * 用临时目录复刻需要的文件再跑子进程,避免测试写坏真实仓库。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/** 同步器读写的全部文件,缺一个都会让 --check 报锚点失配。 */
const FIXTURE_FILES = [
  "compat.json",
  "package.json",
  "README.md",
  "README.en.md",
  "TESTING.md",
  "PROJECT.md",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
  "dsh-aux/AI.md",
  "dsh-aux/package.json",
  "dsh-aux/src/status.js",
  "scripts/sync-compat.mjs",
  "scripts/dsh-packages.mjs",
];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aux-compat-"));
  for (const rel of FIXTURE_FILES) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(REPO, rel), dest);
  }
  return dir;
}

/** 跑 --check,返回退出码与合并输出(锚点失配走 stderr,漂移也走 stderr)。 */
function check(dir) {
  try {
    const stdout = execFileSync(process.execPath, [join(dir, "scripts/sync-compat.mjs"), "--check"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status, out: String(error.stdout ?? "") + String(error.stderr ?? "") };
  }
}

function patchJson(file, mutate) {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  mutate(pkg);
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
}

test("compat 闸:当前仓库无漂移时静默通过", () => {
  const r = check(REPO);
  assert.equal(r.code, 0, r.out);
});

test("compat 闸:compat.json 改动未同步时报漂移(退出码 1)", () => {
  const dir = fixture();
  patchJson(join(dir, "compat.json"), (c) => {
    c.tests += 1;
  });
  const r = check(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /README\.md/);
  rmSync(dir, { recursive: true, force: true });
});

test("compat 闸:文档锚点被改写时报锚点失配(退出码 2),不静默跳过", () => {
  const dir = fixture();
  const readme = join(dir, "README.md");
  writeFileSync(readme, readFileSync(readme, "utf8").replace("badge/version-", "badge/ver-"));
  const r = check(dir);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /锚点失配/);
  rmSync(dir, { recursive: true, force: true });
});

test("compat 闸:overrides 缺项报结构失配(退出码 2)", () => {
  const dir = fixture();
  patchJson(join(dir, "package.json"), (pkg) => {
    delete pkg.overrides["@deepseek-ai/dsh-goal"];
  });
  const r = check(dir);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /overrides 缺少/);
  rmSync(dir, { recursive: true, force: true });
});

test("包清单:DSH_OVERRIDE_PACKAGES 与 package.json overrides 双向一致", async () => {
  const { DSH_OVERRIDE_PACKAGES, DSH_VERSIONED_PACKAGES } = await import("../scripts/dsh-packages.mjs");
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.deepEqual(
    Object.keys(pkg.overrides ?? {}).sort(),
    DSH_OVERRIDE_PACKAGES.map((name) => "@deepseek-ai/" + name).sort(),
    "overrides 键集合必须与 DSH_OVERRIDE_PACKAGES 完全一致(多一个少一个都会让某个包静默停旧版)",
  );
  for (const name of DSH_VERSIONED_PACKAGES) {
    assert.ok(Object.hasOwn(pkg.devDependencies, "@deepseek-ai/" + name), "devDependencies 缺 " + name);
  }
});
