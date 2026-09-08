/**
 * agent-loop 图像桥接锚点重切(DSH 0.1.5-alpha.1)回归。
 *
 * 0.1.5 把 `buildRequest` 改成同步五参方法并换了注释,旧锚点块不再命中;同时
 * 同步方法无法 `await` 桥接。本测试用最小 fake DSH 根驱动真实
 * `bridge/apply-patch.mjs`,锁定:
 *  - 0.1.5 链路三步落盘(插入桥接方法 + async 化 → A3 改写 → 调用点 await);
 *  - 冻结循环保持不动,桥接在冻结之后,且只有真的改写时才 deepFreeze 产物;
 *  - 0.1.2-alpha.2~rc.1 的旧链路行为不变。
 *
 * 运行:cd <仓库路径> && node --test tests/agent-loop-anchor.test.js
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
const BRIDGE = join(REPO, "bridge");
const APPLY = join(BRIDGE, "apply-patch.mjs");

const ORIG_015 = readFileSync(join(BRIDGE, "orig-agent-loop-0.1.5-block.txt"), "utf8").trimEnd();
const ORIG_ALPHA2 = readFileSync(join(BRIDGE, "orig-agent-loop-alpha2-block.txt"), "utf8").trimEnd();

/** 0.1.5 形状的 buildRequest 尾部(冻结循环之后)。 */
const TAIL_015 = [
  "\t\tconst boundaryMessages = session.deriveMessages();",
  "\t\tfor (const message of boundaryMessages) {",
  "\t\t\tif (this.frozenMessages.has(message)) continue;",
  "\t\t\tdeepFreeze(message);",
  "\t\t\tthis.frozenMessages.add(message);",
  "\t\t}",
  "\t\tObject.freeze(boundaryMessages);",
  "\t\treturn markAgentLoopRequest(Object.freeze({",
  "\t\t\t...header.config,",
  "\t\t\tmessages: boundaryMessages,",
  "\t\t\tsessionId: this.session.id,",
  "\t\t\tsignal",
  "\t\t}));",
  "\t}",
].join("\n");

/** 0.1.2 形状的尾部(不含 frozenMessages 循环)。 */
const TAIL_ALPHA2 = [
  "\t\tObject.freeze(boundaryMessages);",
  "\t\treturn markAgentLoopRequest(Object.freeze({",
  "\t\t\t...header.config,",
  "\t\t\tmessages: boundaryMessages,",
  "\t\t\tsessionId: this.session.id,",
  "\t\t\tsignal",
  "\t\t}));",
  "\t}",
].join("\n");

/**
 * 建只含 agent-loop 目标的 fake DSH 根。
 * @param variant "0.1.5" 用同步五参签名 + 调用点; "alpha2" 用 8 参 async 签名。
 */
function fakeRoot(variant) {
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-al-"));
  const dir = join(root, "node_modules/@deepseek-ai/dsh-agent-loop/lib");
  mkdirSync(dir, { recursive: true });
  const call =
    "\t\tconst request = this.buildRequest(config, preparedCall, assembly.tools, startsRequestSeries, signal);";
  const lines =
    variant === "0.1.5"
      ? ["class Agent {", "\tasync step() {", call, "\t\treturn request;", "\t}", ORIG_015, TAIL_015, "}"]
      : ["class Agent {", ORIG_ALPHA2, TAIL_ALPHA2, "}"];
  const file = join(dir, "index.js");
  writeFileSync(file, lines.join("\n") + "\n");
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

test("0.1.5:三步落盘(桥接方法 + async 化 / A3 改写 / 调用点 await)", () => {
  const { root, file } = fakeRoot("0.1.5");
  try {
    const before = readFileSync(file, "utf8");
    const dry = runApply(root, true);
    assert.match(dry.stdout, /可从 original-0\.1\.5 升级\(3 步\)/, "dry-run 应报告 3 步链路");
    assert.equal(readFileSync(file, "utf8"), before, "dry-run 不得写盘");

    const real = runApply(root, false);
    assert.match(real.stdout, /已打补丁\(3 步\)/);
    const patched = readFileSync(file, "utf8");
    assert.ok(
      patched.includes("async bridgeImagesForModel(messages, provider, model, llm, signal) {"),
      "应插入桥接方法",
    );
    assert.ok(
      patched.includes("async buildRequest(config, preparedCall, tools, startsRequestSeries, signal) {"),
      "签名应 async 化",
    );
    assert.ok(patched.includes("const request = await this.buildRequest("), "调用点应 await");
    assert.ok(patched.includes("messages: bridgedMessages,"), "请求应使用桥接结果");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("0.1.5:A3 —— 冻结循环不动,桥接在冻结之后,仅在改写时 deepFreeze 产物", () => {
  const { root, file } = fakeRoot("0.1.5");
  try {
    runApply(root, false);
    const patched = readFileSync(file, "utf8");
    assert.ok(
      patched.includes("\t\t\tthis.frozenMessages.add(message);\n\t\t}\n\t\tObject.freeze(boundaryMessages);"),
      "冻结循环与 Object.freeze 应保持原样",
    );
    assert.ok(
      patched.includes(
        "Object.freeze(boundaryMessages);\n\t\tconst bridgedMessages = await this.bridgeImagesForModel(boundaryMessages, config.provider, config.model, this.loopCtx.llm, signal);\n\t\tif (bridgedMessages !== boundaryMessages) deepFreeze(bridgedMessages);",
      ),
      "桥接应发生在冻结之后,且按需冻结产物",
    );
    assert.ok(!patched.includes("frozenMessages.add(bridgedMessages)"), "桥接副本不得进 frozenMessages");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("0.1.5:幂等 —— 二次应用跳过", () => {
  const { root, file } = fakeRoot("0.1.5");
  try {
    runApply(root, false);
    const once = readFileSync(file, "utf8");
    const second = runApply(root, false);
    assert.match(second.stdout, /已是 v3-0\.1\.5,跳过/);
    assert.equal(readFileSync(file, "utf8"), once, "二次应用不得改动文件");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("0.1.2-alpha.2~rc.1:旧链路行为不变", () => {
  const { root, file } = fakeRoot("alpha2");
  try {
    const real = runApply(root, false);
    assert.match(real.stdout, /已打补丁\(2 步\)/);
    const patched = readFileSync(file, "utf8");
    assert.ok(
      patched.includes(
        "async buildRequest(turn, step, tools, system, boundaryMessages, startsRequestSeries, surfaceGeneration, signal) {",
      ),
      "旧签名应保留",
    );
    assert.ok(
      patched.includes(
        "messages: await this.bridgeImagesForModel(boundaryMessages, config.provider, config.model, this.loopCtx.llm, signal),",
      ),
      "旧链路仍内联 await 桥接",
    );
    assert.ok(!patched.includes("bridgedMessages"), "旧链路不得引入 0.1.5 变量");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
