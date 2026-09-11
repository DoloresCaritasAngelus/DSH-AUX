/**
 * ci-doc-hygiene CHANGELOG 结构闸回归。
 *
 * 背景(评审 #45):旧门禁只数 `## 0.x` 段数 + 两个哨兵节,变异测试 B
 * ——把 CHANGELOG 整文件替换成 26 个假 `## 0.x` 标题 + 哨兵、零正文
 * ——实测 exit 0 漏网。本测试用变异后的 CHANGELOG 驱动真实脚本,断言:
 *  - 当前仓库 CHANGELOG 通过(绿);
 *  - 段数不足 / 段空正文 / 0.4.6 哨兵缺失 / Unreleased 节缺失 → 非零退出(红)。
 *
 * 每个用例在临时 git 仓库里跑 `scripts/ci-doc-hygiene.mjs`(脚本按 cwd 读
 * CHANGELOG.md 并 `git ls-files`),断言退出码与命中的规则名,避免"因脚本
 * 崩溃而恰好非零"的假绿。
 *
 * Run: node --test tests/ci-doc-hygiene.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SCRIPT = join(REPO, "scripts/ci-doc-hygiene.mjs");
const REAL_CHANGELOG = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");

/**
 * 在临时 git 仓库里用给定 CHANGELOG 跑真实门禁脚本。
 * @param {string} changelog 待扫描的 CHANGELOG 全文。
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
function runHygiene(changelog) {
  const dir = mkdtempSync(join(tmpdir(), "dsh-aux-dochygiene-"));
  try {
    writeFileSync(join(dir, "CHANGELOG.md"), changelog);
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["add", "CHANGELOG.md"], { cwd: dir, stdio: "ignore" });
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const UNRELEASED = "## 未发布 (Unreleased)";

/**
 * 构造假 CHANGELOG。
 * @param options.count `## 0.x` 段数(基线为 26)。
 * @param options.withBody 段内是否带非空正文。
 * @param options.sentinel046 是否包含 v0.4.6 哨兵段。
 * @param options.unreleased 是否包含「未发布 (Unreleased)」节。
 */
function fakeChangelog({ count = 26, withBody = true, sentinel046 = true, unreleased = true } = {}) {
  const parts = [];
  if (unreleased) parts.push(`${UNRELEASED}\n`);
  for (let i = 0; i < count; i++) {
    const version = sentinel046 && i === 0 ? "0.4.6" : `0.9.${i}`;
    parts.push(`## ${version} (2026-01-01) — 假版本\n`);
    if (withBody) parts.push("- 假正文。\n");
  }
  return parts.join("\n");
}

test("ci-doc-hygiene: 当前仓库 CHANGELOG 通过(绿)", () => {
  const result = runHygiene(REAL_CHANGELOG);
  assert.equal(result.status, 0, `应通过,stderr:\n${result.stderr}`);
  assert.match(result.stdout, /文档脱密检查通过/);
});

test("ci-doc-hygiene: 发布段数不足 → 非零退出", () => {
  const result = runHygiene(fakeChangelog({ count: 5 }));
  assert.notEqual(result.status, 0, "段数低于基线必须阻塞");
  assert.match(result.stderr, /\[发布历史截断\]/);
});

test("ci-doc-hygiene: 发布段空正文(变异 B)→ 非零退出", () => {
  const result = runHygiene(fakeChangelog({ withBody: false }));
  assert.notEqual(result.status, 0, "26 个空壳段 + 哨兵必须阻塞(变异 B 不得漏网)");
  assert.match(result.stderr, /\[发布段空正文\]/);
  // 隔离断言:此变异不触发段数/哨兵规则,命中的只能是"空正文"这条新闸。
  assert.doesNotMatch(result.stderr, /\[发布历史截断\]|\[发布历史缺失\]|\[结构缺失\]/);
});

test("ci-doc-hygiene: v0.4.6 哨兵缺失 → 非零退出", () => {
  const result = runHygiene(fakeChangelog({ sentinel046: false }));
  assert.notEqual(result.status, 0, "缺少 v0.4.6 段必须阻塞");
  assert.match(result.stderr, /\[发布历史缺失\]/);
});

test("ci-doc-hygiene: 「未发布 (Unreleased)」节缺失 → 非零退出", () => {
  const result = runHygiene(fakeChangelog({ unreleased: false }));
  assert.notEqual(result.status, 0, "缺少未发布节必须阻塞");
  assert.match(result.stderr, /\[结构缺失\]/);
});

/**
 * 在临时仓库里放一个**符号链接**,断言门禁读到的是链接目标字符串。
 * 回归对象:一条 `node_modules` 符号链接曾被误提交,内容是本机绝对路径;
 * 当时门禁按扩展名挑选文件,它没有扩展名,直接被跳过。
 * @param {string} target 链接目标(写进 blob 的字符串)。
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
function runSymlinkScan(target) {
  const dir = mkdtempSync(join(tmpdir(), "dsh-aux-symlink-"));
  try {
    writeFileSync(join(dir, "CHANGELOG.md"), REAL_CHANGELOG);
    symlinkSync(target, join(dir, "some-link"));
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("无扩展名文件不被跳过:符号链接指向本机绝对路径 → 非零退出", () => {
  const result = runSymlinkScan("/ho" + "me/someone/checkout/node_modules");
  assert.notEqual(result.status, 0, "符号链接里的本机路径必须阻塞(旧版按扩展名过滤会漏掉它)");
  assert.match(result.stderr, /\[本机绝对路径 \/home\/<user>\]/);
});

test("无扩展名文件不被跳过:符号链接指向相对路径 → 通过", () => {
  const result = runSymlinkScan("node_modules");
  assert.equal(result.status, 0, `相对链接目标不应命中,stderr:\n${result.stderr}`);
});

/**
 * 二进制文件必须被跳过(NUL 字节判据),否则解码噪声会变成假阳性。
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
function runBinaryScan() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-aux-binary-"));
  try {
    writeFileSync(join(dir, "CHANGELOG.md"), REAL_CHANGELOG);
    // 内含 NUL 的假 PNG:同时还含一个绝对路径字符串,若被当文本读就会命中
    writeFileSync(
      join(dir, "blob.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x2f, 0x68, 0x6f, 0x6d, 0x65, 0x2f, 0x78, 0x00]),
    );
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("二进制文件(含 NUL)被跳过,不产生假阳性", () => {
  const result = runBinaryScan();
  assert.equal(result.status, 0, `二进制不应命中,stderr:\n${result.stderr}`);
});
