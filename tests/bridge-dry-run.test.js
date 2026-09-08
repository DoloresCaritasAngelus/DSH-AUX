/**
 * apply-patch `--dry-run` 结论保真回归。
 *
 * 背景:dry-run 曾在校验步骤块之前就返回,把"检测命中但块不匹配"的补丁
 * 报成"可升级"(DSH 0.1.5 的 session-controller 缩进漂移即此情形)。
 *
 * 本测试用最小 fake DSH 根驱动真实的 `bridge/apply-patch.mjs`,断言
 * dry-run 与真实应用对同一目标给出同一结论:
 *  - 步骤块内容不匹配 ⇒ 两者都报"步骤块未命中",且都不改目标文件;
 *  - 块匹配 ⇒ dry-run 报"可从 … 升级",真实应用落盘、标记出现、`node --check` 通过。
 *
 * 运行:cd <仓库路径> && node --test tests/bridge-dry-run.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const APPLY = join(REPO, "bridge/apply-patch.mjs");
const ORIG_BLOCK = readFileSync(join(REPO, "bridge/orig-session-controller-prompt-block.txt"), "utf8").trimEnd();

/** 目标标记:补丁成功写入后应出现(dsh-aux/src/image-bridge.js 的 v3 判据)。 */
const PATCH_MARK = "dsh-aux image bridge v3 (local patch)";

/**
 * 建一个只含 session-controller 目标的 fake DSH 根。
 * @param options.indentShift 每行额外前导 tab 数;1 = DSH 0.1.5 的 using 多包一层 try。
 * @param options.mutate 改写块内一行内容,制造"检测命中但步骤块内容不匹配"。
 */
function fakeRoot({ indentShift = 0, mutate = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-dryrun-"));
  const dir = join(root, "node_modules/@deepseek-ai/dsh-api-session-controller/lib");
  mkdirSync(dir, { recursive: true });
  const source = mutate
    ? ORIG_BLOCK.replace("this.agents.selectionFor(agent).current;", "this.agents.selectionFor(agent);")
    : ORIG_BLOCK;
  const block = source
    .split("\n")
    .map((line) => "\t".repeat(indentShift) + line)
    .join("\n");
  const file = join(dir, "index.js");
  writeFileSync(file, `function outer() {\n${block}\n}\n`);
  return { root, dir, file };
}

/** 跑 apply-patch(不抛异常;返回 stdout 与退出码)。 */
function runApply(root, dryRun) {
  const args = [APPLY, ...(dryRun ? ["--dry-run"] : [])];
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: REPO,
      env: { ...process.env, DSH_ROOT: root },
      encoding: "utf8",
    });
    return { stdout, status: 0 };
  } catch (error) {
    return { stdout: `${error.stdout ?? ""}`, status: error.status };
  }
}

/** 目标目录里的备份文件(证明真实应用确实备份过)。 */
const backups = (dir) => readdirSync(dir).filter((name) => name.startsWith("index.js.bak-"));

test("dry-run:步骤块内容不匹配时不得报可升级,且零写盘", () => {
  const { root, dir, file } = fakeRoot({ mutate: true });
  try {
    const before = readFileSync(file, "utf8");
    const dry = runApply(root, true);
    assert.match(dry.stdout, /步骤块未命中/, "dry-run 必须报步骤块未命中");
    assert.doesNotMatch(dry.stdout, /可从 .* 升级/, "dry-run 不得报可升级");
    assert.equal(readFileSync(file, "utf8"), before, "dry-run 不得改动目标文件");
    assert.deepEqual(backups(dir), [], "dry-run 不得创建备份");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dry-run 与真实应用结论一致:块不匹配时两者都失败且都不写盘", () => {
  const { root, file } = fakeRoot({ mutate: true });
  try {
    const before = readFileSync(file, "utf8");
    const dry = runApply(root, true);
    const real = runApply(root, false);
    assert.match(dry.stdout, /步骤块未命中/);
    assert.match(real.stdout, /步骤块未命中/);
    assert.doesNotMatch(real.stdout, /已打补丁/, "块不匹配时不得落盘");
    assert.equal(readFileSync(file, "utf8"), before, "真实应用失败后目标文件应保持原样");
    assert.equal(dry.status, real.status, "dry-run 与真实应用退出码应一致");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dry-run 与真实应用结论一致:块匹配时 dry-run 零写盘、真实应用落盘并通过语法检查", () => {
  const { root, file } = fakeRoot();
  try {
    const before = readFileSync(file, "utf8");
    const dry = runApply(root, true);
    assert.match(dry.stdout, /可从 original-alpha2 升级/, "dry-run 应报可升级");
    assert.equal(readFileSync(file, "utf8"), before, "dry-run 不得改动目标文件");

    const real = runApply(root, false);
    assert.match(real.stdout, /已打补丁/);
    const after = readFileSync(file, "utf8");
    assert.notEqual(after, before, "真实应用应落盘");
    assert.ok(after.includes(PATCH_MARK), "落盘后应含补丁标记");
    assert.ok(existsSync(file), "目标文件应存在");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("版本不匹配:按设计返回退出码 0,由输出文本承载信号", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-dryrun-unknown-"));
  try {
    const dir = join(root, "node_modules/@deepseek-ai/dsh-api-session-controller/lib");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "index.js");
    // 既不含 detect 特征串,也不含任何已知步骤块 ⇒ 走"版本不匹配"分支。
    writeFileSync(file, "export const unknown = true;\n");
    const before = readFileSync(file, "utf8");

    const dry = runApply(root, true);
    const real = runApply(root, false);
    // install.sh 用 set -e:这里若改成非零退出会把"未知版本先跳过"变成"装不上",
    // 因此退出码固定为 0,兼容性信号由文本门禁(CI/自愈的正则)承担。
    assert.equal(dry.status, 0, "dry-run 版本不匹配应保持退出码 0");
    assert.equal(real.status, 0, "真实应用版本不匹配应保持退出码 0");
    assert.match(dry.stdout, /版本不匹配,未找到已知代码块/);
    assert.match(real.stdout, /版本不匹配,未找到已知代码块/);
    assert.equal(readFileSync(file, "utf8"), before, "未知版本不得改动目标文件");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
