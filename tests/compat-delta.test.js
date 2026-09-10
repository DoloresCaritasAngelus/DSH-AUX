/**
 * compat-delta 回归:锁住四条判定路径 —— 无源码变更(0)、有源码变更(1)、
 * 映射过期与用法错误(2)。用临时 git 仓库做 fixture,不依赖真实 DSH clone。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { HOST_PACKAGE_PATHS } from "../scripts/dsh-packages.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SCRIPT = join(REPO, "scripts/compat-delta.mjs");

/**
 * 造最小 DSH 源码假仓:full=true 时铺满映射表里的全部宿主包路径(等价真实 monorepo),
 * full=false 时只铺一个 —— 用于模拟官方目录结构变化导致映射过期。
 * v1 基线 / v2 只动 package.json / v3 动了 index.ts。
 */
function makeSourceRepo({ full = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aux-delta-src-"));
  const paths = full ? Object.values(HOST_PACKAGE_PATHS) : ["packages/core/agent-loop"];
  for (const rel of paths) {
    mkdirSync(join(dir, rel), { recursive: true });
    writeFileSync(join(dir, rel, "package.json"), "{}\n");
  }
  const main = join(dir, paths[0]);
  writeFileSync(join(main, "index.ts"), "export const a = 1;\n");
  const run = (...argv) =>
    execFileSync("git", ["-C", dir, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run("init", "-q");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "test");
  run("add", "-A");
  run("commit", "-q", "-m", "one");
  run("tag", "v1");
  writeFileSync(join(main, "package.json"), '{ "version": "2" }\n');
  run("add", "-A");
  run("commit", "-q", "-m", "two");
  run("tag", "v2");
  writeFileSync(join(main, "index.ts"), "export const a = 2;\n");
  run("add", "-A");
  run("commit", "-q", "-m", "three");
  run("tag", "v3");
  return dir;
}

function delta(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status, out: String(error.stdout ?? "") + String(error.stderr ?? "") };
  }
}

/** --json 模式下 node 警告可能混进输出,取第一个 { 到最后一个 } 之间的正文。 */
function parseJson(out) {
  return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
}

test("compat-delta:全部宿主包只有非源码变更时退出码 0 并判定锚点不可能位移", () => {
  const src = makeSourceRepo();
  const r = delta(["--from", "v1", "--to", "v2", "--src", src]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /锚点不可能位移/);
  assert.doesNotMatch(r.out, /映射已过期/);
  rmSync(src, { recursive: true, force: true });
});

test("compat-delta:源码变更时退出码 1 并列出变更文件", () => {
  const src = makeSourceRepo();
  const r = delta(["--from", "v1", "--to", "v3", "--src", src]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /index\.ts/);
  assert.match(r.out, /逐个复核补丁锚点/);
  rmSync(src, { recursive: true, force: true });
});

test("compat-delta:映射过期(宿主包路径不存在)时退出码 2,不给锚点安全结论", () => {
  const src = makeSourceRepo({ full: false });
  const r = delta(["--from", "v1", "--to", "v2", "--src", src]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /映射已过期/);
  assert.doesNotMatch(r.out, /锚点不可能位移/);
  rmSync(src, { recursive: true, force: true });
});

test("compat-delta:--json 输出的 anchorRisk 与退出码一致", () => {
  const src = makeSourceRepo();
  const clean = delta(["--from", "v1", "--to", "v2", "--src", src, "--json"]);
  assert.equal(parseJson(clean.out).anchorRisk, false);
  const dirty = delta(["--from", "v1", "--to", "v3", "--src", src, "--json"]);
  assert.equal(dirty.code, 1);
  assert.equal(parseJson(dirty.out).anchorRisk, true);
  rmSync(src, { recursive: true, force: true });
});

test("compat-delta:找不到 tag 或不是 git 仓库时退出码 2", () => {
  const src = makeSourceRepo();
  assert.equal(delta(["--from", "v9", "--to", "v2", "--src", src]).code, 2);
  const plain = mkdtempSync(join(tmpdir(), "aux-delta-plain-"));
  assert.equal(delta(["--from", "v1", "--to", "v2", "--src", plain]).code, 2);
  rmSync(src, { recursive: true, force: true });
  rmSync(plain, { recursive: true, force: true });
});

test("compat-delta:缺参数时用法错误(退出码 2)", () => {
  const r = delta(["--from", "v1"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /用法/);
});
