/**
 * apply-patch 步骤块匹配:忽略行首缩进的回归。
 *
 * DSH 会以不同嵌套深度编译同一段代码(0.1.5 的 `using` 绑定多包一层 try,
 * session-controller 准入闸的每一行因此多一个前导 tab),精确缩进匹配会在上游
 * 升级后静默退化为"步骤块未命中"。本测试用最小 fake DSH 根驱动真实
 * `bridge/apply-patch.mjs`,锁定:
 *  - 每行多一个前导 tab 时步骤块仍命中,补丁落盘、门控字符串消失、`node --check` 通过;
 *  - 替换文本首行沿用目标文件原有的缩进(与旧的 `block.trim()` 契约一致);
 *  - 无缩进漂移时行为不变;
 *  - dry-run 与实际应用在漂移场景下结论一致。
 *
 * 运行:cd <仓库路径> && node --test tests/bridge-block-match.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const APPLY = join(REPO, "bridge/apply-patch.mjs");
const ORIG_BLOCK = readFileSync(join(REPO, "bridge/orig-session-controller-prompt-block.txt"), "utf8").trimEnd();

/** 补丁写入后应出现的标记(dsh-aux/src/image-bridge.js 的 v3 判据)。 */
const PATCH_MARK = "dsh-aux image bridge v3 (local patch)";
/** 被移除的准入闸特征串。 */
const GATE_MARK = "MODEL_DOES_NOT_SUPPORT_IMAGES";

/** 建一个只含 session-controller 目标的 fake DSH 根。 */
function fakeRoot(indentShift) {
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-block-"));
  const dir = join(root, "node_modules/@deepseek-ai/dsh-api-session-controller/lib");
  mkdirSync(dir, { recursive: true });
  const block = ORIG_BLOCK.split("\n")
    .map((line) => "\t".repeat(indentShift) + line)
    .join("\n");
  const file = join(dir, "index.js");
  writeFileSync(file, `function outer() {\n${block}\n}\n`);
  return { root, file };
}

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

/** 取补丁标记所在行,用于断言替换文本首行沿用了目标文件的缩进。 */
const markLine = (source) => source.split("\n").find((line) => line.includes(PATCH_MARK)) ?? "";

test("缩进漂移(每行多一个前导 tab)时步骤块仍命中,门控被移除", () => {
  const { root, file } = fakeRoot(1);
  try {
    const out = runApply(root, false);
    assert.match(out.stdout, /已打补丁/, "缩进漂移下应仍能落盘");
    const patched = readFileSync(file, "utf8");
    assert.ok(patched.includes(PATCH_MARK), "应含补丁标记");
    assert.ok(!patched.includes(GATE_MARK), "准入闸应被移除");
    assert.ok(markLine(patched).startsWith("\t".repeat(5)), "替换首行应沿用目标文件缩进(5 tab)");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("无缩进漂移时行为不变(4 tab 落盘)", () => {
  const { root, file } = fakeRoot(0);
  try {
    const out = runApply(root, false);
    assert.match(out.stdout, /已打补丁/);
    const patched = readFileSync(file, "utf8");
    assert.ok(patched.includes(PATCH_MARK));
    assert.ok(!patched.includes(GATE_MARK));
    assert.ok(markLine(patched).startsWith("\t".repeat(4)), "替换首行应沿用目标文件缩进(4 tab)");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dry-run 与真实应用一致:缩进漂移下 dry-run 报可升级且零写盘", () => {
  const { root, file } = fakeRoot(1);
  try {
    const before = readFileSync(file, "utf8");
    const dry = runApply(root, true);
    assert.match(dry.stdout, /可从 original-alpha2 升级/, "漂移场景下 dry-run 应报可升级");
    assert.equal(readFileSync(file, "utf8"), before, "dry-run 不得改动目标文件");
    const real = runApply(root, false);
    assert.match(real.stdout, /已打补丁/, "真实应用应落盘");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
