/**
 * session-controller 图片门控:平台开关正确性回归(P0)。
 *
 * 背景:该补丁原先把官方准入闸**整段删除**且不看平台开关 —— 于是把 `imageBridge`
 * 切成 `native` 后,agent-loop 的改写停了,闸却仍是移除态:纯文本主模型不再收到原生
 * 的明确拒绝,图片直接流向 provider。
 *
 * 锁定三件事:
 *  1. 补丁块**保留**官方闸,且其生效条件绑定 `imageBridge !== "native"`;
 *  2. 旧 v3 块留档存在,升级态在补丁器的 states 里排在 skip **之前**
 *     (否则已装旧补丁的部署会被判为「已打补丁」而永不更新);
 *  3. 端到端:以 v3 块为输入的 fake 部署能升到 v4;以 v4 块为输入时幂等跳过。
 *
 * 运行:cd <仓库路径> && node --test tests/bridge-native-gate.test.js
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
const V4_BLOCK = readFileSync(join(REPO, "bridge/patched-session-controller-prompt-block.txt"), "utf8");
const V3_BLOCK = readFileSync(join(REPO, "bridge/patched-session-controller-prompt-v3-block.txt"), "utf8");

const GATE_MARK = "MODEL_DOES_NOT_SUPPORT_IMAGES";
const GATE_CONDITION = 'imageBridge !== "native"';
const V4_MARK = "dsh-aux image bridge v4 (local patch)";

/** 以给定块内容建一个 fake DSH 根(包装成 async,与真实上下文一致)。 */
function fakeRoot(block) {
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-native-gate-"));
  const dir = join(root, "node_modules/@deepseek-ai/dsh-api-session-controller/lib");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "index.js");
  writeFileSync(file, `async function outer() {\n${block}\n}\n`);
  return { root, file };
}

function runApply(root) {
  try {
    const stdout = execFileSync(process.execPath, [APPLY], {
      cwd: REPO,
      env: { ...process.env, DSH_ROOT: root },
      encoding: "utf8",
    });
    return { stdout, status: 0 };
  } catch (error) {
    return { stdout: `${error.stdout ?? ""}`, status: error.status };
  }
}

test("补丁块保留官方准入闸,且生效条件绑定平台开关(切 native 时闸重新生效)", () => {
  assert.ok(V4_BLOCK.includes(GATE_MARK), "必须保留官方拒绝文案");
  assert.ok(V4_BLOCK.includes(GATE_CONDITION), "闸的生效条件必须读 imageBridge 开关");
  assert.ok(V4_BLOCK.includes("hasImage && !auxImageBridge"), "闸必须是条件式的,不能无条件跳过");
  assert.ok(V4_BLOCK.includes(V4_MARK), "块内应带 v4 标记");
});

test("旧 v3 块留档存在,与 v4 块内容不同(升级判据非空操作)", () => {
  assert.ok(V3_BLOCK.includes("text-only models can"), "v3 块应是旧的注释式文本");
  assert.ok(!V3_BLOCK.includes(GATE_MARK), "v3 块确实不含官方闸(这正是要修的缺陷)");
  assert.notEqual(V3_BLOCK.trim(), V4_BLOCK.trim(), "v3/v4 必须是不同文本,否则升级态无法区分");
});

test("升级态排在 skip 之前(否则旧部署会被判为已打补丁而永不更新)", () => {
  const src = readFileSync(APPLY, "utf8");
  const upgradeAt = src.indexOf('name: "gate-v3-upgrade"');
  const skipAt = src.indexOf(`d.includes("${V4_MARK}")`);
  assert.ok(upgradeAt > 0, "补丁器里应有 gate-v3-upgrade 升级态");
  assert.ok(skipAt > 0, "补丁器里应有 v4 的 skip 判据");
  assert.ok(upgradeAt < skipAt, "升级态必须排在 skip 之前");
});

test("端到端:已装旧 v3 补丁的部署能升级到 v4,并恢复官方闸", () => {
  const { root, file } = fakeRoot(V3_BLOCK);
  try {
    const out = runApply(root);
    assert.match(out.stdout, /gate-v3-upgrade/, "应走升级态");
    const after = readFileSync(file, "utf8");
    assert.ok(after.includes(V4_MARK), "升级后应带 v4 标记");
    assert.ok(after.includes(GATE_MARK), "升级后必须恢复官方闸");
    assert.ok(after.includes(GATE_CONDITION), "升级后闸应受开关约束");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("端到端:已是 v4 的部署幂等跳过,不改动文件", () => {
  const { root, file } = fakeRoot(V4_BLOCK);
  try {
    const before = readFileSync(file, "utf8");
    const out = runApply(root);
    assert.doesNotMatch(out.stdout, /gate-v3-upgrade/, "已是 v4 不应再走升级态");
    assert.equal(readFileSync(file, "utf8"), before, "幂等场景不得改动文件");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
