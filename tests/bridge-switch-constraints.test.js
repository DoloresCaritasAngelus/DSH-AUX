/**
 * 补丁的平台开关约束闸(契约级)。
 *
 * 背景:`bridges/` 的补丁会把 AUX 的行为塞进官方组件。每个补丁都必须回答一个问题 ——
 * **平台开关切回 `native` 时,它是否让路?** 答错的代价已经出现过一次:
 * session-controller 的图片准入闸被无条件删除,切 `native` 后闸仍处移除态,纯文本主模型
 * 不再收到原生拒绝(见 `tests/bridge-native-gate.test.js` 与 CHANGELOG 0.4.6 修复段)。
 *
 * 本闸把「让路」这件事对**每个补丁**钉成断言,新增补丁必须在此登记其让路方式。
 * 三种合法让路形态:
 *  1. **读开关并短路**(behavior patch:改写、门控);
 *  2. **把判定委托给会读开关的 AUX 服务**(如 `auxLlm.subagentRoute`,native 时返回 settled:false);
 *  3. **纯增量 schema**(只加可选参数,不改变既有行为)—— 允许无条件,但必须证明「原有行一行未少」。
 *
 * 运行:cd <仓库路径> && node --test tests/bridge-switch-constraints.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const block = (name) => readFileSync(join(REPO, "bridge", name), "utf8");
const source = (rel) => readFileSync(join(REPO, rel), "utf8");

test("agent-loop(图像改写):读 imageBridge 开关,native 时不改写", () => {
  const b = block("patched-agent-loop-0.1.5-block.txt");
  assert.match(b, /_enabled\?\.imageBridge === "native"/, "必须读平台开关");
  assert.match(
    b,
    /if \(aux\?._enabled\?\.imageBridge === "native"\) return messages;/,
    "native 时必须原样返回消息(不改写)",
  );
});

test("session-controller(图片准入闸):条件生效,native 时官方闸重新生效", () => {
  const b = block("patched-session-controller-prompt-block.txt");
  assert.match(b, /imageBridge !== "native"/, "闸的生效条件必须绑定开关");
  assert.match(b, /MODEL_DOES_NOT_SUPPORT_IMAGES/, "官方拒绝必须保留");
});

test("subagent request(注入路由):委托给会读开关的 subagentRoute", () => {
  const b = block("patched-subagent-request-alpha2-block.txt");
  assert.match(b, /subagentRoute/, "必须经 AUX 服务判定,而不是自行决定是否注入");
  const aux = source("dsh-aux/src/index.js");
  assert.match(
    aux,
    /subagentBridge === "native"\)\s*\{\s*\n\s*return \{ settled: false \};/,
    "AUX 侧 native 必须短路为 settled:false(补丁安全的根据)",
  );
});

test("workflow startChild:受 includeWorkflow/workflowBridge 门控", () => {
  const b = block("patched-workflow-startchild-block.txt");
  assert.match(b, /includeWorkflow/, "必须读门控");
  assert.match(b, /auxRoute = \(!explicit && includeWorkflow\)/, "门控关闭时不得注入路由");
});

test("schema 补丁(subagent):纯增量 —— 原有行一行未少", () => {
  const orig = block("orig-subagent-schema-alpha2-block.txt")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const patched = new Set(
    block("patched-subagent-schema-alpha2-block.txt")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const missing = orig.filter((l) => !patched.has(l));
  assert.deepEqual(missing, [], "纯增量补丁不得删除原有行(否则就不再是「无条件也安全」)");
  assert.ok(patched.has("requires_vision: {"), "应含新增的可选参数");
});

test("schema 补丁(skill):只增可选参数,既有参数与必填约束不受影响", () => {
  const b = block("patched-skill-tool-block.txt");
  assert.match(b, /name: \{/, "既有 name 参数必须保留");
  assert.match(b, /task: \{/, "应含新增的 task 可选参数");
  assert.doesNotMatch(b, /required:\s*\[[^\]]*"task"/, "task 必须是可选,不得进入 required");
});
