/**
 * doctor 版本判定回归:主支支持线以 compat.json 为单一真相源。
 *
 * 这条判定曾长期停在旧的 0.1.2 线,导致 0.1.5 部署恒报「不在主支支持范围」——
 * 一个只会误报、不会漏报的检查,所以必须有测试盯住它跟随 compat.json。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const COMPAT = JSON.parse(readFileSync(join(REPO, "compat.json"), "utf8"));

/** 造一个只够版本判定用的最小部署根。 */
function fakeRoot(version) {
  const dir = mkdtempSync(join(tmpdir(), "aux-doctor-root-"));
  const pkgDir = join(dir, "node_modules/@deepseek-ai/dsh");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version }));
  return dir;
}

/**
 * 最小部署根必然缺 symlink/profile,doctor 会因此记 ERROR 并以退出码 1 结束;
 * 版本类别的判定与退出码无关,所以这里用 spawnSync 取 stdout,不因非零退出而中断。
 */
function doctorVersionLevel(version) {
  const root = fakeRoot(version);
  try {
    const res = spawnSync(process.execPath, [join(REPO, "scripts/doctor.mjs"), "--json", "--dsh-root", root], {
      encoding: "utf8",
      env: { ...process.env, DSH_ROOT: root },
    });
    const out = String(res.stdout ?? "");
    const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    return parsed.results.find((r) => r.category === "version");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("doctor:部署版本等于 compat.json 声明时判定为 OK", () => {
  const entry = doctorVersionLevel(COMPAT.dsh);
  assert.ok(entry, "缺少 version 类别的检查结果");
  assert.equal(entry.level, "OK", JSON.stringify(entry));
  assert.match(entry.message, new RegExp(COMPAT.dsh.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("doctor:部署版本与声明不符时判定为 WARN(且不误报为 ERROR)", () => {
  const entry = doctorVersionLevel("0.0.0-not-a-real-line");
  assert.ok(entry, "缺少 version 类别的检查结果");
  assert.equal(entry.level, "WARN", JSON.stringify(entry));
});
