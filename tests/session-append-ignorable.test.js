/**
 * dsh-session `append` ignorable 补丁(P7)行为回归。
 *
 * 补丁块在部署时才落盘,仓库内没有打好的 dsh-session 可供提取,因此这里直接从
 * `bridge/patched-session-append*.txt` 取出方法片段,用桩件在隔离环境里执行,断言
 * `opts[1].ignorable` 的写入语义对每个版本变体都成立。
 *
 * 同时锁定"变体表两处同步":`bridge/patch-session-ignorable.mjs` 与
 * `bridge/self-heal.mjs` 各自维护一份 append 原块清单,漏改其一会让启动自愈
 * 报"P7 无法自动补"。
 *
 * 运行:cd <仓库路径> && node --test tests/session-append-ignorable.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const BRIDGE = join(REPO, "bridge");

/** 补丁标记:AUX 用它探测写入入口是否已就绪(见 dsh-aux/src/events.js)。 */
const MARK = "dsh-aux ignorable (local patch)";
/** 方法签名;补丁块一律以它开头。 */
const SIGNATURE = "append(type, data, ...opts) {";

const origBlocks = readdirSync(BRIDGE).filter((name) => /^orig-session-append.*\.txt$/.test(name));

/**
 * 用桩件把补丁块编译成可调用的 append。
 *
 * 补丁块是**方法片段**:它以 `const event = deepFreeze({...});` 收尾,不含真正的
 * 返回语句(那些行各版本不同且未被补丁改动)。这里只在片段末尾补一句
 * `return event;`,用来取出补丁构造的信封本身。
 * @returns 可调用的 append,或 null(块不含方法片段)。
 */
function buildAppend(source) {
  const start = source.indexOf(SIGNATURE);
  if (start < 0) return null;
  // 部署文件里方法有配对的右括号;补丁块文件只有片段(不配对),此时取到文件末尾。
  let depth = 0;
  let end = -1;
  for (let i = start + SIGNATURE.length - 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = end < 0 ? source.slice(start + SIGNATURE.length) : source.slice(start + SIGNATURE.length, end);
  const stubs = {
    snapshotJsonValue: (value) => (value === void 0 ? void 0 : structuredClone(value)),
    deepFreeze: (value) => value,
    attachments: new WeakMap(),
    SessionSeq: (value) => value,
    validateSessionEventData: () => {},
    assertSupportedRequestHeader: () => {},
  };
  const names = Object.keys(stubs);
  // 字符串拼接(非模板字符串):方法体自带 ${...} 模板字面量,必须原样保留。
  const factory = new Function(...names, "return function " + SIGNATURE + body + "\nreturn event;\n};");
  return factory(...names.map((name) => stubs[name]));
}

/** append 只读 `this.log.length`(seq 来源)并把 `this` 当作 WeakMap 键。 */
const fakeSession = () => ({ log: [], surfaceManager: { validateNext: () => {} } });

for (const origFile of origBlocks) {
  const patchedFile = origFile.replace(/^orig-/, "patched-");
  const patchedSource = readFileSync(join(BRIDGE, patchedFile), "utf8");

  test(`${patchedFile}: opts[1].ignorable 写入信封`, () => {
    const append = buildAppend(patchedSource);
    assert.ok(append !== null, "应能从补丁块提取 append 方法片段");
    const event = append.call(fakeSession(), "aux/llm-call", { text: "hi" }, void 0, { ignorable: true });
    assert.equal(event.type, "aux/llm-call");
    assert.equal(event.ignorable, true, "ignorable 应写进事件信封");
    assert.equal(event.data.text, "hi");
    assert.equal(typeof event.seq, "number");
  });

  test(`${patchedFile}: 无 opts[1] 时不写 ignorable`, () => {
    const append = buildAppend(patchedSource);
    const withoutOpts = append.call(fakeSession(), "aux/llm-call", { text: "hi" });
    assert.ok(!("ignorable" in withoutOpts), "未传 opts[1] 时不应带 ignorable");
    const withFalse = append.call(fakeSession(), "aux/llm-call", { text: "hi" }, void 0, { ignorable: false });
    assert.ok(!("ignorable" in withFalse), "ignorable=false 不应带标记");
  });

  test(`${patchedFile}: surface 元数据与 ignorable 可共存`, () => {
    const append = buildAppend(patchedSource);
    const event = append.call(
      fakeSession(),
      "aux/llm-call",
      { text: "hi" },
      { surfaceOp: "append" },
      { ignorable: true },
    );
    assert.equal(event.surfaceOp, "append", "surfaceOpts 语义不应被改动");
    assert.equal(event.ignorable, true);
  });

  test(`${patchedFile}: 含 AUX 探测用的补丁标记`, () => {
    assert.ok(patchedSource.includes(MARK), "补丁块必须含探测标记");
  });
}

/** 解析 patch-session-ignorable.mjs 的 APPEND_VARIANTS 登记表 → [orig, patched][]。 */
function p7VariantPairs() {
  const source = readFileSync(join(BRIDGE, "patch-session-ignorable.mjs"), "utf8");
  return [...source.matchAll(/origFile:\s*"([^"]+)",\s*patchedFile:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
}

/** 解析 self-heal.mjs 的 appendVariants 登记表 → [orig, patched][]。 */
function selfHealVariantPairs() {
  const source = readFileSync(join(BRIDGE, "self-heal.mjs"), "utf8");
  return [...source.matchAll(/\[\s*"[^"]+",\s*"(orig-[^"]+)",\s*"(patched-[^"]+)"\s*\]/g)].map((m) => [m[1], m[2]]);
}

test("append 变体表两处同步:orig→patched 必须成对一致(不只锁文件名)", () => {
  const p7Pairs = p7VariantPairs();
  const selfHealPairs = selfHealVariantPairs();
  assert.equal(p7Pairs.length, origBlocks.length, "patch-session-ignorable.mjs 登记表条数应与磁盘 orig 块一致");
  assert.deepEqual(selfHealPairs, p7Pairs, "两处登记表必须逐条 orig→patched 配对一致");
  assert.deepEqual(
    p7Pairs.map(([orig]) => orig).sort(),
    [...origBlocks].sort(),
    "登记表须覆盖磁盘上全部 orig-session-append* 块",
  );
});

test("P7 --rollback 只弹自己写下的备份,不误弹 self-heal 备份", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-p7-rb-"));
  try {
    const dir = join(root, "node_modules/@deepseek-ai/dsh-session/lib");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "index.js");
    const orig = readFileSync(join(BRIDGE, "orig-session-append-0.1.5-block.txt"), "utf8").trim();
    writeFileSync(file, `class Session {\n\t${orig}\n\t}\n}\n`);

    execFileSync(process.execPath, [join(BRIDGE, "patch-session-ignorable.mjs")], {
      cwd: REPO,
      env: { ...process.env, DSH_ROOT: root },
      encoding: "utf8",
    });
    const patched = readFileSync(file, "utf8");
    assert.ok(patched.includes(MARK), "P7 应落盘");

    // 伪造 self-heal 备份(内容 = 已 P7 状态)。名字以 index.js.bak-selfheal- 开头,
    // 字典序排在 index.js.bak-<数字时间戳> 之后 ⇒ 旧的"前缀 + 字典序弹出"会弹它,
    // 回滚后目标仍含 P7 标记(静默无效)。
    writeFileSync(join(dir, "index.js.bak-selfheal-2026-09-09T00-00-00-000Z"), patched);

    execFileSync(process.execPath, [join(BRIDGE, "patch-session-ignorable.mjs"), "--rollback"], {
      cwd: REPO,
      env: { ...process.env, DSH_ROOT: root },
      encoding: "utf8",
    });
    const rolled = readFileSync(file, "utf8");
    assert.ok(!rolled.includes(MARK), "回滚后不得仍含 P7 标记(误弹 self-heal 备份会静默无效)");
    assert.ok(rolled.includes(SIGNATURE), "回滚结果应是 pristine 的 append 原块");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P7 版本不匹配保持退出码 0(install.sh set -e 兼容),信号由文本承载", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-p7-unknown-"));
  try {
    const dir = join(root, "node_modules/@deepseek-ai/dsh-session/lib");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "index.js");
    const before = "export const unknown = true;\n";
    writeFileSync(file, before);

    const res = spawnSync(process.execPath, [join(BRIDGE, "patch-session-ignorable.mjs")], {
      cwd: REPO,
      env: { ...process.env, DSH_ROOT: root },
      encoding: "utf8",
    });
    // install.sh 用 set -e:非零退出会中断整个安装,把"未知版本先跳过"变成"装不上"。
    // 与 apply-patch.mjs 的版本不匹配策略统一为 0,兼容性信号由文本门禁承担。
    assert.equal(res.status, 0, "版本不匹配应保持退出码 0");
    assert.match(res.stdout, /版本不匹配,缺失 append 原块/);
    assert.equal(readFileSync(file, "utf8"), before, "版本不匹配不得改动目标文件");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("端到端:AUX 写 aux/llm-call 经补丁后的 append,信封含 ignorable", async () => {
  const { recordAuxEvent } = await import("../dsh-aux/src/events.js");
  const root = mkdtempSync(join(tmpdir(), "dsh-aux-p7-"));
  try {
    const dir = join(root, "node_modules/@deepseek-ai/dsh-session/lib");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "index.js");
    const orig = readFileSync(join(BRIDGE, "orig-session-append-0.1.5-block.txt"), "utf8").trim();
    // 补丁块是方法片段(以 `const event = deepFreeze({...});` 收尾),这里补上
    // 方法体与类的右括号;不写 export —— 补丁脚本用 `node --check` 校验产物,
    // 裸 .js 按 CommonJS 解析。
    writeFileSync(file, `class Session {\n\t${orig}\n\t}\n}\n`);

    execFileSync(process.execPath, [join(BRIDGE, "patch-session-ignorable.mjs")], {
      cwd: REPO,
      env: { ...process.env, DSH_ROOT: root },
      encoding: "utf8",
    });

    const deployed = readFileSync(file, "utf8");
    assert.ok(deployed.includes(MARK), "补丁应落盘到部署文件");
    const append = buildAppend(deployed);
    assert.ok(append !== null, "补丁后的部署文件应可提取 append 方法片段");

    // 复刻真实 Session.append 的可观测行为:构造信封并记入 this.log。
    const session = {
      log: [],
      append(...args) {
        const event = append.apply(this, args);
        this.log.push(event);
        return event;
      },
    };
    // 预置探测缓存:AUX 的写入门控本身由其它用例覆盖,这里聚焦信封形状。
    const service = { _sessionEventsSupportedCache: true };
    await recordAuxEvent(service, session, { provider: "volcengine-ark", model: "minimax-m3", task: "vision" });

    assert.equal(session.log.length, 1, "AUX 应写入一条事件");
    const envelope = session.log[0];
    assert.equal(envelope.type, "aux/llm-call");
    assert.equal(envelope.ignorable, true, "落盘信封必须含 ignorable");
    assert.equal(envelope.data.provider, "volcengine-ark");
    assert.deepEqual(JSON.parse(JSON.stringify(envelope)), { ...envelope }, "信封必须是可持久化的纯 JSON");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
