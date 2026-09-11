/**
 * 图片锚点文本:不得声称不可用的视觉工具(契约级 + 端到端)。
 *
 * 背景:桥接在纯文本模型的输入边界把 image block 换成一段锚点文本,原文案无条件写着
 * 「可用 vision_analyze 的 attachmentId 参数查看」。平台开关把该工具切成 `native` 后
 * 工具从模型目录消失,文案却照旧声称可用 —— 模型会去找一个不存在的工具。
 *
 * 现改为向 AUX 询问工具的真实暴露度(`auxLlm.visionToolAvailable()`),并锁定:
 *  1. 块按暴露度分支,两条文案都在;
 *  2. 旧 v3 块留档,且升级态排在 skip 之前(否则旧部署永不更新);
 *  3. AUX 侧的判定委托给既有的 `isToolExposed`(单一真相);
 *  4. 端到端:以 v3 方法块为输入的 fake 部署能升到 v4。
 *
 * 运行:cd <仓库路径> && node --test tests/bridge-anchor-exposure.test.js
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
const read = (rel) => readFileSync(join(REPO, rel), "utf8");

test("锚点块按工具暴露度分支:两条文案都在,且不再无条件声称可用", () => {
  const b = read("bridge/patched-agent-loop-0.1.5-block.txt");
  assert.match(b, /const visionExposed = \(\(\) => \{/, "必须求出暴露度");
  assert.match(b, /aux\?\.visionToolAvailable\?\.\(\) \?\? true/, "向 AUX 询问真实暴露度,旧 AUX 视为可用(保持原文本)");
  assert.match(b, /visionExposed \?/, "锚点文案必须按暴露度二选一");
  assert.match(b, /可用 vision_analyze 的 attachmentId 参数查看/, "可用分支保留原有引导");
  assert.match(b, /当前没有可用的视觉工具/, "不可用分支必须说实话");
});

test("旧 v3 块留档,与 v4 不同(升级判据非空操作)", () => {
  const v3 = read("bridge/patched-agent-loop-0.1.5-v3-block.txt");
  const v4 = read("bridge/patched-agent-loop-0.1.5-block.txt");
  assert.ok(!v3.includes("visionExposed"), "v3 是无条件声称的旧形态");
  assert.ok(v3.includes("可用 vision_analyze 的 attachmentId 参数查看"), "v3 含无条件引导(这正是要修的)");
  assert.notEqual(v3.trim(), v4.trim(), "v3/v4 必须不同,否则升级态无法区分");
});

test("升级态 method-v3-upgrade 排在 v3-0.1.5(skip)之前", () => {
  const src = read("bridge/apply-patch.mjs");
  const upgradeAt = src.indexOf('name: "method-v3-upgrade"');
  const skipAt = src.indexOf('name: "v3-0.1.5"');
  assert.ok(upgradeAt > 0, "补丁器应有 method-v3-upgrade");
  assert.ok(skipAt > 0, "补丁器应有 v3-0.1.5 skip 态");
  assert.ok(upgradeAt < skipAt, "升级态必须排在 skip 之前,否则旧部署会被判为已打补丁");
});

test("AUX 的判定委托给 isToolExposed(单一真相,不另立开关读取)", () => {
  const src = read("dsh-aux/src/index.js");
  assert.match(
    src,
    /visionToolAvailable\(\) \{\s*\n\s*return this\.isToolExposed\("vision_analyze"\);/,
    "应委托给既有判定",
  );
});

test("端到端:已装 v3 方法块的部署能升级到 v4", () => {
  const v3 = read("bridge/patched-agent-loop-0.1.5-v3-block.txt");
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-anchor-exposure-"));
  const dir = join(root, "node_modules/@deepseek-ai/dsh-agent-loop/lib");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "index.js");
  // 该块是**类方法体**(且末尾停在 `async buildRequest(...) {` 的签名处),
  // 因此 fixture 必须用 class 包装并补齐两层收尾花括号 —— 用 function 包装会语法错。
  // extra 是 skip 态要求的两处调用点标记(模拟已打补丁的真实部署)。
  const extra = [
    "const bridgedMessages = await this.bridgeImagesForModel(boundaryMessages, config.provider, config.model, this.loopCtx.llm, signal);",
    "const request = await this.buildRequest(config, preparedCall, tools, startsRequestSeries, signal);",
  ].join("\n");
  writeFileSync(file, `class Loop {\n${v3}\n${extra}\nreturn null;\n}\n}\n`);
  try {
    const stdout = execFileSync(process.execPath, [APPLY], {
      cwd: REPO,
      env: { ...process.env, DSH_ROOT: root },
      encoding: "utf8",
    });
    assert.match(stdout, /method-v3-upgrade/, "应走方法块升级态");
    const after = readFileSync(file, "utf8");
    assert.ok(after.includes("visionToolAvailable"), "升级后应含暴露度判定");
    assert.ok(after.includes("当前没有可用的视觉工具"), "升级后应含不可用分支文案");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
