/**
 * dsh-image-bridge v2 逻辑测试(agent-loop 的 bridgeImagesForModel)。
 *
 * 从已安装的 dsh-agent-loop 提取方法体独立运行,验证:
 *  - text-only 模型:image block → 本地路径文本 + vision_analyze 提示
 *  - 多模态模型:image block 原样保留(原生看图)
 *  - 未声明模态(空):保守转换
 *  - 无 image 消息:原样透传;原消息不可变
 *
 * 运行:cd <仓库路径>/tests && node --test bridge.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// 探测本机已安装的 dsh-agent-loop(标准部署或本仓库开发机);均不存在时测试自动跳过。
const AGENT_LOOP_CANDIDATES = [
  process.env.DSH_AGENT_LOOP,
  'node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js',
  '/home/user/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js'
].filter(Boolean);
const AGENT_LOOP = AGENT_LOOP_CANDIDATES.find((p) => existsSync(p));

/** 从 agent-loop 源码提取 bridgeImagesForModel 的可运行函数;缺失时返回 null。 */
async function extractBridge() {
  if (!existsSync(AGENT_LOOP)) return null;
  const src = await readFile(AGENT_LOOP, 'utf8');
  const start = src.indexOf('async bridgeImagesForModel(messages, provider, model, llm, signal) {');
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  const method = src.slice(start, end);
  const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
  return new Function('messages', 'provider', 'model', 'llm', 'signal', 'return (async () => {' + body + '})()');
}

const makeMsg = () => ({
  role: 'user',
  content: [
    { type: 'text', text: '这是什么?' },
    { type: 'image', attachment: { attachmentId: 'sha256:' + 'ab'.repeat(32), mediaType: 'image/png' } }
  ]
});

const textOnlyLlm = { async resolveModelInfo() { return { inputModalities: ['text'] }; } };
const multimodalLlm = { async resolveModelInfo() { return { inputModalities: ['text', 'image'] }; } };
const unknownLlm = { async resolveModelInfo() { return { inputModalities: void 0 }; } };

test('bridgeImagesForModel: text-only 模型把 image block 转为路径文本', async () => {
  const fn = await extractBridge();
  if (fn === null) return test.skip('dsh-agent-loop 未安装或未打补丁');
  const out = await fn([makeMsg()], 'p', 'm', textOnlyLlm, undefined);
  const blocks = out[0].content;
  assert.equal(blocks.filter((b) => b.type === 'image').length, 0, 'image block 应被转换');
  const pathText = blocks.find((b) => b.type === 'text' && b.text.includes('本地路径'));
  assert.ok(pathText, '应生成本地路径文本');
  assert.ok(/.png/.test(pathText.text), '路径应带媒体类型扩展名');
  assert.ok(pathText.text.includes('vision_analyze'), '应含 vision_analyze 提示');
  assert.ok(pathText.text.includes('imagePath'), '应含 imagePath 参数提示');
});

test('bridgeImagesForModel: 多模态模型保留原生 image block', async () => {
  const fn = await extractBridge();
  if (fn === null) return test.skip('dsh-agent-loop 未安装或未打补丁');
  const out = await fn([makeMsg()], 'p', 'm', multimodalLlm, undefined);
  assert.ok(out[0].content.some((b) => b.type === 'image'), 'image block 应保留');
});

test('bridgeImagesForModel: 未声明模态(空)时保守转换', async () => {
  const fn = await extractBridge();
  if (fn === null) return test.skip('dsh-agent-loop 未安装或未打补丁');
  const out = await fn([makeMsg()], 'p', 'm', unknownLlm, undefined);
  assert.equal(out[0].content.filter((b) => b.type === 'image').length, 0);
});

test('bridgeImagesForModel: 无 image 消息原样透传,原消息不可变', async () => {
  const fn = await extractBridge();
  if (fn === null) return test.skip('dsh-agent-loop 未安装或未打补丁');
  const plain = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
  const out = await fn(plain, 'p', 'm', textOnlyLlm, undefined);
  assert.equal(out, plain, '无 image 时不应复制消息');
  const orig = makeMsg();
  await fn([orig], 'p', 'm', textOnlyLlm, undefined);
  assert.ok(orig.content.some((b) => b.type === 'image'), '原消息不应被修改');
});
