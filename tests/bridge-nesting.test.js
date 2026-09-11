/**
 * 桥接的嵌套递归:图片可能嵌在 tool-result 里。
 *
 * 背景:`read_image` 的结果块把图片放在 `tool-result` 的 content 内。桥接原先只扫
 * `message.content` 的顶层,于是嵌套图既不被改道(`forceAuxVision` 成本路由失效),
 * 纯文本模型下也拿不到 vision_analyze 指引。
 *
 * 官方把递归明确定为共享不变量 —— `packages/llm/llm/src/content.ts` 的
 * `contentHasImage` 注释写着 "a consumer cannot silently diverge on nesting depth"。
 * 本闸钉住 AUX 侧与之一致。
 *
 * 运行:cd <仓库路径> && node --test tests/bridge-nesting.test.js
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

test("桥接按官方不变量递归判定图片:tool-result 内层也算", () => {
  const b = read("bridge/patched-agent-loop-0.1.5-block.txt");
  assert.match(
    b,
    /const contentHasImage = \(content\) =>[\s\S]{0,200}tool-result[\s\S]{0,80}contentHasImage\(b\.content\)/,
    "判定必须递归进 tool-result",
  );
  assert.match(
    b,
    /const hasImage = Array\.isArray\(messages\) && messages\.some\(\(m\) => contentHasImage\(m\?\.content\)\)/,
    "顶层判定必须走递归函数",
  );
  assert.match(b, /const imageTotal = countImages\(message\.content\)/, "总数必须是递归计数(否则第 N/共 M 张会少算) ");
  assert.match(b, /const rewriteBlocks = async \(blocks\) =>/, "改写必须是可递归的函数");
  assert.match(
    b,
    /next === inner \? block : \{ \.\.\.block, content: next \}/,
    "未改动的内层应保持同一引用(避免无谓复制)",
  );
  assert.doesNotMatch(b, /message\.content\.some\(\(b\) => b\?\.type === "image"\)/, "不得残留只看顶层的判定");
});

test("「仅顶层」版留档且与递归版不同(升级判据非空操作)", () => {
  const topOnly = read("bridge/patched-agent-loop-0.1.5-top-only-block.txt");
  const recursive = read("bridge/patched-agent-loop-0.1.5-block.txt");
  assert.ok(topOnly.includes('message.content.some((b) => b?.type === "image")'), "留档的应是只看顶层的旧版");
  assert.ok(!topOnly.includes("contentHasImage"), "旧版不含递归函数");
  assert.notEqual(topOnly.trim(), recursive.trim(), "两版必须不同,否则升级态无法区分");
});

test("升级态 nesting-upgrade 排在 v3-0.1.5(skip)之前", () => {
  const src = read("bridge/apply-patch.mjs");
  const nestingAt = src.indexOf('name: "nesting-upgrade"');
  const skipAt = src.indexOf('name: "v3-0.1.5"');
  assert.ok(nestingAt > 0, "补丁器应有 nesting-upgrade");
  assert.ok(nestingAt < skipAt, "必须排在 skip 之前:旧 v4 带方法标记,skip 判据认不出它缺递归");
});

test("端到端:已装「仅顶层」版的部署升级为递归版,且幂等", () => {
  const topOnly = read("bridge/patched-agent-loop-0.1.5-top-only-block.txt");
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-nesting-"));
  const dir = join(root, "node_modules/@deepseek-ai/dsh-agent-loop/lib");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "index.js");
  const extra = [
    "const bridgedMessages = await this.bridgeImagesForModel(boundaryMessages, config.provider, config.model, this.loopCtx.llm, signal);",
    "const request = await this.buildRequest(config, preparedCall, tools, startsRequestSeries, signal);",
  ].join("\n");
  writeFileSync(file, `class Loop {\n${topOnly}\n${extra}\nreturn null;\n}\n}\n`);
  const run = () =>
    execFileSync(process.execPath, [APPLY], {
      cwd: REPO,
      env: { ...process.env, DSH_ROOT: root },
      encoding: "utf8",
    });
  try {
    const first = run();
    assert.match(first, /nesting-upgrade/, "应走 nesting-upgrade 升级态");
    const after = readFileSync(file, "utf8");
    assert.ok(after.includes("contentHasImage"), "升级后应含递归判定");
    assert.ok(!after.includes('message.content.some((b) => b?.type === "image")'), "升级后不得残留顶层判定");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    const second = run();
    assert.doesNotMatch(second, /nesting-upgrade/, "二次应用应幂等跳过");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
