/**
 * dsh-image-bridge v2/v3 逻辑测试(agent-loop 的 bridgeImagesForModel)。
 *
 * 提取源优先取仓库内的补丁块:补丁只在部署时写入官方包,仓库依赖里的
 * dsh-agent-loop 始终是未打补丁的,只从已安装包提取会让这些断言在 CI 里静默
 * skip。已打补丁的部署包(DSH_AGENT_LOOP 或标准部署布局)存在时一并纳入。
 *
 * 验证:
 *  - text-only 模型:image block → 本地路径文本 + vision_analyze 提示
 *  - 多模态模型:image block 原样保留(原生看图)
 *  - 未声明模态(空):保守转换
 *  - 无 image 消息:原样透传;原消息不可变
 *
 * 运行:cd <仓库路径>/tests && node --test bridge.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 补丁块(仓库内始终存在)与已打补丁的部署包,逐个变体各跑一遍。 */
const SOURCES = [
  ["alpha2", join(HERE, "../bridge/patched-agent-loop-alpha2-block.txt")],
  ["0.1.5", join(HERE, "../bridge/patched-agent-loop-0.1.5-block.txt")],
];
const DEPLOYED = [
  process.env.DSH_AGENT_LOOP,
  join(HERE, "../../../node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js"),
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (DEPLOYED !== undefined) SOURCES.push(["deployed", DEPLOYED]);

/** 从给定源码提取 bridgeImagesForModel 的可运行函数;缺失时返回 null。 */
async function extractBridge(file) {
  if (!existsSync(file)) return null;
  const src = await readFile(file, "utf8");
  const start = src.indexOf("async bridgeImagesForModel(messages, provider, model, llm, signal) {");
  if (start < 0) return null;
  let depth = 0,
    end = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  const method = src.slice(start, end);
  const body = method.slice(method.indexOf("{") + 1, method.lastIndexOf("}"));
  return new Function("messages", "provider", "model", "llm", "signal", "return (async () => {" + body + "})()");
}

const makeMsg = () => ({
  role: "user",
  content: [
    { type: "text", text: "这是什么?" },
    { type: "image", attachment: { attachmentId: "sha256:" + "ab".repeat(32), mediaType: "image/png" } },
  ],
});

const textOnlyLlm = {
  async resolveModelInfo() {
    return { inputModalities: ["text"] };
  },
};
const multimodalLlm = {
  async resolveModelInfo() {
    return { inputModalities: ["text", "image"] };
  },
};
const unknownLlm = {
  async resolveModelInfo() {
    return { inputModalities: void 0 };
  },
};

for (const [label, file] of SOURCES) {
  test(`[${label}] bridgeImagesForModel: text-only 模型把 image block 转为 attachmentId 锚点文本`, async () => {
    const fn = await extractBridge(file);
    if (fn === null) return test.skip(`${label}: 提取源不含 bridgeImagesForModel`);
    const out = await fn([makeMsg()], "p", "m", textOnlyLlm, undefined);
    const blocks = out[0].content;
    assert.equal(blocks.filter((b) => b.type === "image").length, 0, "image block 应被转换");
    const anchor = blocks.find((b) => b.type === "text" && b.text.includes("attachmentId=<"));
    assert.ok(anchor, "应生成 attachmentId 锚点文本");
    assert.ok(anchor.text.includes("本条消息第1张/共1张"), "应含本条消息编号锚点");
    assert.ok(anchor.text.includes("attachmentId=<sha256:" + "ab".repeat(32) + ">"), "应带完整 attachmentId");
    assert.ok(anchor.text.includes("vision_analyze"), "应含 vision_analyze 提示");
    assert.ok(anchor.text.includes("attachmentId 参数"), "应提示用 attachmentId 参数查看");
    assert.ok(!anchor.text.includes("本地路径"), "不应再依赖本地路径(硬链接失败/扩展名判型不再影响投递)");
  });

  test(`[${label}] bridgeImagesForModel: 编号按消息内出现顺序,逐消息重置`, async () => {
    const fn = await extractBridge(file);
    if (fn === null) return test.skip(`${label}: 提取源不含 bridgeImagesForModel`);
    const img = (byte, mediaType) => ({
      type: "image",
      attachment: { attachmentId: "sha256:" + byte.repeat(32), mediaType },
    });
    const multi = { role: "user", content: [img("11", "image/png"), img("22", "image/jpeg")] };
    const single = { role: "user", content: [img("33", "image/webp")] };
    const out = await fn([multi, single], "p", "m", textOnlyLlm, undefined);
    const labels = out.map((message) =>
      message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("|"),
    );
    assert.match(labels[0], /本条消息第1张\/共2张/);
    assert.match(labels[0], /本条消息第2张\/共2张/);
    assert.match(labels[1], /本条消息第1张\/共1张/, "编号应按消息重置");
    assert.ok(labels[0].indexOf("第1张") < labels[0].indexOf("第2张"), "编号应按出现顺序");
    assert.ok(labels[0].includes("sha256:" + "11".repeat(32)), "第 1 张应带自己的 attachmentId");
    assert.ok(labels[0].includes("sha256:" + "22".repeat(32)), "第 2 张应带自己的 attachmentId");
  });

  test(`[${label}] bridgeImagesForModel: 多模态模型保留原生 image block`, async () => {
    const fn = await extractBridge(file);
    if (fn === null) return test.skip(`${label}: 提取源不含 bridgeImagesForModel`);
    const out = await fn([makeMsg()], "p", "m", multimodalLlm, undefined);
    assert.ok(
      out[0].content.some((b) => b.type === "image"),
      "image block 应保留",
    );
  });

  test(`[${label}] bridgeImagesForModel: 未声明模态(空)时保守转换`, async () => {
    const fn = await extractBridge(file);
    if (fn === null) return test.skip(`${label}: 提取源不含 bridgeImagesForModel`);
    const out = await fn([makeMsg()], "p", "m", unknownLlm, undefined);
    assert.equal(out[0].content.filter((b) => b.type === "image").length, 0);
  });

  test(`[${label}] bridgeImagesForModel: 无 image 消息原样透传,原消息不可变`, async () => {
    const fn = await extractBridge(file);
    if (fn === null) return test.skip(`${label}: 提取源不含 bridgeImagesForModel`);
    const plain = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    const out = await fn(plain, "p", "m", textOnlyLlm, undefined);
    assert.equal(out, plain, "无 image 时不应复制消息");
    const orig = makeMsg();
    await fn([orig], "p", "m", textOnlyLlm, undefined);
    assert.ok(
      orig.content.some((b) => b.type === "image"),
      "原消息不应被修改",
    );
  });
}
