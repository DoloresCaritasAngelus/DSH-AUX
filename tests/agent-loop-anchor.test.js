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
const OLD_TEXT_REGION = readFileSync(join(BRIDGE, "orig-agent-loop-anchor-text-block.txt"), "utf8").trimEnd();

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

/** 建"已打补丁但仍是旧路径文本"的 fake 根,用于验证原地升级。 */
function oldTextRoot() {
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-al-old-"));
  const dir = join(root, "node_modules/@deepseek-ai/dsh-agent-loop/lib");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "index.js");
  const lines = [
    "class Agent {",
    "\t/** image-bridge v2 (local patch) forceAuxVision */",
    "\tasync bridgeImagesForModel(messages) {",
    "\t\tconst rewritten = [];",
    "\t\tfor (const message of messages) {",
    "\t\t\tif (!Array.isArray(message?.content)) { rewritten.push(message); continue; }",
    OLD_TEXT_REGION,
    "\t\t\trewritten.push({ ...message, content });",
    "\t\t}",
    "\t\treturn rewritten;",
    "\t}",
    "\tasync request(boundaryMessages) {",
    '\t\treturn { messages: await this.bridgeImagesForModel(boundaryMessages, "p", "m", this.loopCtx.llm, undefined) };',
    "\t}",
    "}",
  ];
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

/** 跑 apply-patch --rollback(不抛异常;返回 stdout 与退出码)。 */
function runRollback(root) {
  try {
    const stdout = execFileSync(process.execPath, [APPLY, "--rollback"], {
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
test("anchor-text 升级判定不被注释里的 attachmentId=< 击穿(块匹配判据)", () => {
  const { root, file } = oldTextRoot();
  try {
    // 旧实现用 `!d.includes("attachmentId=<")` 做负向门:文件里任意位置出现该
    // 字符串(哪怕只是一行注释)都会让升级被跳过,旧路径文本永久留存。
    const withComment = readFileSync(file, "utf8").replace(
      "class Agent {",
      "class Agent {\n\t// note: 新锚点形如 attachmentId=<sha256:…>,此处只是注释",
    );
    assert.notEqual(withComment, readFileSync(file, "utf8"), "fixture 应注入含击穿串的注释");
    writeFileSync(file, withComment);
    assert.ok(withComment.includes("attachmentId=<"), "fixture 应含击穿串");
    assert.ok(withComment.includes("本地路径"), "fixture 仍是旧路径文本");

    const real = runApply(root, false);
    assert.match(real.stdout, /已应用 anchor-text 步骤/, "注释不得阻止 anchor-text 升级");
    const patched = readFileSync(file, "utf8");
    assert.ok(patched.includes("本条消息第"), "应升级为编号 + attachmentId 文本");
    assert.ok(!patched.includes("本地路径"), "旧路径文本应被替换");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("旧路径文本部署:原地升级为 attachmentId 锚点文本", () => {
  const { root, file } = oldTextRoot();
  try {
    const before = readFileSync(file, "utf8");
    assert.ok(before.includes("本地路径"), "fixture 应为旧路径文本");
    assert.ok(!before.includes("attachmentId=<"), "fixture 不应已含新锚点");

    const real = runApply(root, false);
    assert.match(real.stdout, /已应用 anchor-text 步骤/);
    const patched = readFileSync(file, "utf8");
    assert.ok(patched.includes("本条消息第"), "应升级为编号 + attachmentId 文本");
    assert.ok(patched.includes("attachmentId=<"), "应带 attachmentId 锚点");
    assert.ok(!patched.includes("本地路径"), "旧路径文本应消失");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });

    const second = runApply(root, false);
    assert.match(second.stdout, /已是 v3,跳过/, "升级后应被识别为已打补丁");
    assert.equal(readFileSync(file, "utf8"), patched, "二次应用不得再改动");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * 漂移(链中间锚点失配)下的整体回滚断言:文件逐字节不变、退出码 1、日志不撒谎。
 * @param from 原始 fixture
 * @param mutate 注入漂移的替换函数
 */
function assertWholeRollback(mutate, driftLabel) {
  const { root, file } = fakeRoot("0.1.5");
  try {
    const pristine = readFileSync(file, "utf8");
    const drifted = mutate(pristine);
    assert.notEqual(drifted, pristine, `fixture 应注入漂移: ${driftLabel}`);
    writeFileSync(file, drifted);

    const dry = runApply(root, true);
    const real = runApply(root, false);
    for (const [mode, out] of [
      ["dry-run", dry.stdout],
      ["real", real.stdout],
    ]) {
      assert.match(out, /步骤块未命中/, `${mode} 应报告步骤块未命中`);
      assert.match(out, /整体回滚/, `${mode} 应声明整体回滚`);
      assert.doesNotMatch(out, /已打补丁/, `${mode} 失配时不得声称已打补丁`);
      assert.doesNotMatch(out, /可从 .* 升级/, `${mode} 失配时不得声称可升级`);
    }
    assert.equal(dry.status, real.status, "dry-run 与真实应用退出码应一致");
    assert.notEqual(dry.status, 0, "失配应非零退出(install.sh set -e 会显式中止)");
    assert.equal(real.status, 1, "失配应退出码 1");
    assert.doesNotMatch(real.stdout, /完成。请重启 DSH 生效/, "失败时不得报完成");
    assert.equal(readFileSync(file, "utf8"), drifted, "真实应用不得落盘(逐字节保持应用前状态)");

    // 二次 apply 不愈合也不累积:仍失败、文件仍不变。
    const second = runApply(root, false);
    assert.equal(second.status, 1, "二次 apply 仍应失败");
    assert.match(second.stdout, /步骤块未命中/);
    assert.equal(readFileSync(file, "utf8"), drifted, "二次 apply 不得落盘");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("漂移(第 3 步调用点参数):dry/real 同判据,整体回滚且文件逐字节不变", () => {
  assertWholeRollback(
    (src) =>
      src.replace(
        "const request = this.buildRequest(config, preparedCall, assembly.tools, startsRequestSeries, signal);",
        "const request = this.buildRequest(config, preparedCall, assembly.tools2, startsRequestSeries, signal);",
      ),
    "callsite assembly.tools → assembly.tools2",
  );
});

test("漂移(第 2 步 envelope 行):整体回滚,不落半补丁", () => {
  assertWholeRollback(
    (src) => src.replace("\t\t\t...header.config,", "\t\t\t...header.config /* upstream drift */,"),
    "envelope ...header.config",
  );
});

test("apply-patch --rollback 只弹自己的备份,不误弹 self-heal 备份", () => {
  const { root, file } = fakeRoot("0.1.5");
  try {
    const pristine = readFileSync(file, "utf8");
    const real = runApply(root, false);
    assert.match(real.stdout, /已打补丁/, "fixture 应可正常落盘");
    const patched = readFileSync(file, "utf8");
    assert.ok(patched.includes("image-bridge v2 (local patch)"), "落盘后应含补丁标记");

    // 伪造 self-heal 备份:名字以 index.js.bak-selfheal- 开头,字典序排在
    // index.js.bak-<数字时间戳> 之后 ⇒ 旧的"前缀 + 字典序弹出"会优先弹它,
    // 把"已打补丁"状态当成回滚目标(静默无效)。
    writeFileSync(join(dirname(file), "index.js.bak-selfheal-2026-09-09T00-00-00-000Z"), patched);

    const res = runRollback(root);
    assert.equal(res.status, 0, "回滚应正常完成");
    const rolled = readFileSync(file, "utf8");
    assert.ok(!rolled.includes("image-bridge v2 (local patch)"), "回滚后不得仍含补丁标记");
    assert.equal(rolled, pristine, "回滚应逐字节回到 pristine");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
