/**
 * dsh-aux compression prototype tests (zero dependency).
 *
 * Covers:
 *  - heuristic text-type detection
 *  - compression plan resolution (ratio / maxOutputChars / multi-round trigger)
 *  - segment splitting preserves content and respects hard caps
 *  - scenario-specific prompt construction
 *  - end-to-end compressWithPlan with a stubbed aux service (single + multi round)
 *
 * Run: node --test tests/compression.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_MAX_SEGMENTS,
  DEFAULT_SINGLE_CALL_MAX_CHARS,
  TEXT_TYPES,
  TYPE_DEFAULT_RATIOS,
  buildCompressSystemPrompt,
  compressWithPlan,
  detectTextType,
  resolveCompressionPlan,
  segmentText
} from '../dsh-aux/src/compression.js';

test('detectTextType: 识别日志', () => {
  assert.equal(detectTextType('2026-08-16 10:00:00 INFO boot ok\n2026-08-16 10:00:01 ERROR boom'), 'log');
  assert.equal(detectTextType('[2026-08-16T10:00:00Z] WARN timeout 10.0.0.1'), 'log');
});

test('detectTextType: 识别代码', () => {
  const code = 'function add(a, b) {\n  const sum = a + b;\n  return sum;\n}\n';
  assert.equal(detectTextType(code), 'code');
});

test('detectTextType: 识别文档', () => {
  const doc = '# Title\n\nSome prose with details.\n\n- item one\n- item two\n';
  assert.equal(detectTextType(doc), 'doc');
});

test('detectTextType: 未知内容归为 general', () => {
  assert.equal(detectTextType('just some ordinary words without strong signals'), 'general');
});

test('resolveCompressionPlan: 默认按类型给比例', () => {
  const logPlan = resolveCompressionPlan({ text: '2026-08-16 10:00:00 INFO x' });
  assert.equal(logPlan.type, 'log');
  assert.equal(logPlan.ratio, TYPE_DEFAULT_RATIOS.log);
  assert.equal(logPlan.multiRound, false);
});

test('resolveCompressionPlan: maxOutputChars 优先于 targetRatio', () => {
  const plan = resolveCompressionPlan({ text: 'x'.repeat(1000), targetRatio: 0.5, maxOutputChars: 100 });
  assert.equal(plan.ratio, 0.1);
  assert.equal(plan.maxOutputChars, 100);
});

test('resolveCompressionPlan: 超长输入自动多轮并受硬上限约束', () => {
  const longText = 'line\n'.repeat(100000); // ~500k chars
  const plan = resolveCompressionPlan({ text: longText, singleCallMaxChars: 10000, maxSegments: 4 });
  assert.equal(plan.multiRound, true);
  assert.equal(plan.segments, 4);
  assert.equal(plan.roundLimit, DEFAULT_MAX_ROUNDS);
  assert.ok(plan.segments <= DEFAULT_MAX_SEGMENTS);
});

test('segmentText: 短文本不分段', () => {
  assert.deepEqual(segmentText('hello world', 'general', 100), ['hello world']);
});

test('segmentText: 长文本按行分段且内容不丢失', () => {
  const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const segments = segmentText(text, 'log', 200, 10);
  assert.ok(segments.length > 1);
  assert.ok(segments.length <= 10);
  assert.equal(segments.join('\n'), text);
});

test('segmentText: 超长单行硬切不丢内容', () => {
  const line = 'x'.repeat(500);
  const segments = segmentText(line, 'general', 100, 10);
  assert.equal(segments.join(''), line);
});

test('buildCompressSystemPrompt: 场景规则与预算生效', () => {
  const codePrompt = buildCompressSystemPrompt({ type: 'code', ratio: 0.4 });
  assert.match(codePrompt, /CODE/);
  assert.match(codePrompt, /indentation/);
  assert.match(codePrompt, /40%/);
  const logPrompt = buildCompressSystemPrompt({ type: 'log', maxOutputChars: 500, ratio: 0.1 });
  assert.match(logPrompt, /LOG OUTPUT/);
  assert.match(logPrompt, /at most about 500 characters/);
  const mergePrompt = buildCompressSystemPrompt({ type: 'doc', ratio: 0.2, round: 2 });
  assert.match(mergePrompt, /merge round/);
});

test('compressWithPlan: 短文本单轮压缩', async () => {
  const calls = [];
  const service = {
    async call(task, request) {
      calls.push({ task, system: request.system, text: request.messages[0].content[0].text });
      return { text: 'SHORT_COMPRESSED', provider: 'p', model: 'm' };
    }
  };
  const result = await compressWithPlan(service, { text: 'hello world', mode: 'general' }, {});
  assert.equal(result.compressed, 'SHORT_COMPRESSED');
  assert.equal(result.rounds, 1);
  assert.equal(result.segments, 1);
  assert.equal(calls.length, 1);
});

test('compressWithPlan: 超长文本先分段再汇总(两轮)', async () => {
  const calls = [];
  const service = {
    async call(task, request) {
      calls.push({ system: request.system, text: request.messages[0].content[0].text });
      return { text: 'SEG_' + request.inputChars, provider: 'p', model: 'm' };
    }
  };
  const longText = Array.from({ length: 10000 }, (_, i) => `line ${i} with some facts ${i}`).join('\n');
  const result = await compressWithPlan(service, {
    text: longText,
    mode: 'log',
    targetRatio: 0.2,
    maxOutputChars: void 0
  }, {});
  assert.equal(result.rounds, 2);
  assert.ok(result.segments > 1);
  assert.ok(calls.length >= result.segments + 1, '应有分段调用+最终汇总调用');
  assert.equal(result.strategy, 'log');
  assert.equal(result.compressed.startsWith('SEG_'), true);
});
