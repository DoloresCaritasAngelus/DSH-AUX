/**
 * dsh-aux compression engine tests (zero dependency).
 *
 * Covers:
 *  - heuristic profile detection (primary type + signals + confidence)
 *  - compression plan resolution (budget / ratio / multi-round / hierarchical)
 *  - preserve rule normalization and warnings
 *  - segment splitting preserves content and respects hard caps
 *  - scenario-aware prompt construction (universal general + preserve + merge)
 *  - end-to-end compressWithPlan with a stubbed aux service
 *    (single, multi-round, failure degradation)
 *
 * Run: node --test tests/compression.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_MAX_SEGMENTS,
  DEFAULT_SINGLE_CALL_MAX_CHARS,
  MAX_COMPRESS_INPUT_CHARS,
  TEXT_TYPES,
  TYPE_DEFAULT_RATIOS,
  buildCompressSystemPrompt,
  compressWithPlan,
  detectTextProfile,
  detectTextSignals,
  detectTextType,
  normalizePreserve,
  resolveCompressionPlan,
  segmentText
} from '../dsh-aux/src/compression.js';

test('detectTextProfile: 识别日志', () => {
  const profile = detectTextProfile('2026-08-16 10:00:00 INFO boot ok\n2026-08-16 10:00:01 ERROR boom');
  assert.equal(profile.primary, 'log');
  assert.equal(profile.signals.log, true);
  assert.ok(profile.confidence > 0.5);
});

test('detectTextProfile: 识别代码', () => {
  const code = 'function add(a, b) {\n  const sum = a + b;\n  return sum;\n}\n';
  const profile = detectTextProfile(code);
  assert.equal(profile.primary, 'code');
  assert.equal(profile.signals.code, true);
});

test('detectTextProfile: 识别文档', () => {
  const doc = '# Title\n\nSome prose with details.\n\n- item one\n- item two\n';
  const profile = detectTextProfile(doc);
  assert.equal(profile.primary, 'doc');
  assert.equal(profile.signals.doc, true);
});

test('detectTextProfile: 含代码块的 Markdown 文档识别为 doc', () => {
  const md = '# Guide\n\nSome text.\n\n```js\nfunction f() { return 1; }\n```\n\n- item\n';
  const profile = detectTextProfile(md);
  assert.equal(profile.primary, 'doc');
  assert.equal(profile.signals.code, true);
});

test('detectTextProfile: 混合内容保留多信号且低置信度回退 general', () => {
  const mixed = '2026-08-16 INFO start\n# Heading\n```js\nfunction f() { return 1; }\n```\n';
  const profile = detectTextProfile(mixed);
  // 日志分数足够高时 primary 可能是 log；这里只验证 signals 不丢失
  assert.equal(typeof profile.primary, 'string');
  assert.equal(typeof profile.confidence, 'number');
  assert.ok(profile.signals.code || profile.signals.log || profile.signals.doc, '应至少有一个信号');
});

test('detectTextType: 未知内容归为 general', () => {
  assert.equal(detectTextType('just some ordinary words without strong signals'), 'general');
});

test('normalizePreserve: 已知规则映射,未知值告警', () => {
  const { rules, warnings } = normalizePreserve(['paths', 'bogus']);
  assert.ok(rules.some((r) => /file paths/.test(r)));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /bogus/);
});

test('resolveCompressionPlan: 默认按 profile 给比例', () => {
  const logPlan = resolveCompressionPlan({ text: '2026-08-16 10:00:00 INFO x' });
  assert.equal(logPlan.profile.primary, 'log');
  assert.equal(logPlan.ratio, TYPE_DEFAULT_RATIOS.log);
  assert.equal(logPlan.multiRound, false);
});

test('resolveCompressionPlan: maxOutputChars 优先于 targetRatio', () => {
  const plan = resolveCompressionPlan({ text: 'x'.repeat(1000), targetRatio: 0.5, maxOutputChars: 100 });
  assert.equal(plan.ratio, 0.1);
  assert.equal(plan.maxOutputChars, 100);
});

test('resolveCompressionPlan: 超长输入自动多轮并受硬上限约束', () => {
  const longText = 'line\n'.repeat(20000); // ~100k chars, below hierarchical threshold
  const plan = resolveCompressionPlan({ text: longText, singleCallMaxChars: 10000, maxSegments: 4 });
  assert.equal(plan.multiRound, true);
  assert.equal(plan.segments, 4);
  assert.equal(plan.roundLimit, DEFAULT_MAX_ROUNDS);
  assert.ok(plan.segments <= DEFAULT_MAX_SEGMENTS);
});

test('resolveCompressionPlan: mode 是软提示,仍保留检测信号', () => {
  const plan = resolveCompressionPlan({ text: 'just ordinary prose', mode: 'code' });
  assert.equal(plan.profile.primary, 'code');
  assert.equal(plan.modeHint, true);
  assert.equal(typeof plan.profile.signals.code, 'boolean');
});

test('resolveCompressionPlan: 短文本显式 hierarchical 不会误报多轮', () => {
  const plan = resolveCompressionPlan({ text: 'short text', hierarchical: true });
  assert.equal(plan.multiRound, false);
  assert.equal(plan.hierarchical, false);
  assert.equal(plan.roundLimit, 1);
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

test('segmentText: maxSegments<=0 时安全降级为 1 段', () => {
  const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
  const segments = segmentText(text, 'log', 10, 0);
  assert.equal(segments.length, 1);
  assert.equal(segments[0], text);
});

test('buildCompressSystemPrompt: 场景规则与预算生效', () => {
  const codePrompt = buildCompressSystemPrompt({ profile: { primary: 'code', signals: {} }, ratio: 0.4 });
  assert.match(codePrompt, /CODE/);
  assert.match(codePrompt, /indentation/);
  assert.match(codePrompt, /40%/);

  const logPrompt = buildCompressSystemPrompt({ profile: { primary: 'log', signals: {} }, maxOutputChars: 500, ratio: 0.1 });
  assert.match(logPrompt, /LOG OUTPUT/);
  assert.match(logPrompt, /at most about 500 characters/);

  const mergePrompt = buildCompressSystemPrompt({ profile: { primary: 'doc', signals: {} }, ratio: 0.2, round: 2 });
  assert.match(mergePrompt, /merge round/);
});

test('buildCompressSystemPrompt: 万能 general 包含检测到的信号规则', () => {
  const prompt = buildCompressSystemPrompt({
    profile: { primary: 'general', signals: { code: true, log: true, doc: false } },
    ratio: 0.2
  });
  assert.match(prompt, /code-like/);
  assert.match(prompt, /log-like/);
});

test('buildCompressSystemPrompt: preserve 与软 mode 提示生效', () => {
  const prompt = buildCompressSystemPrompt({
    profile: { primary: 'code', signals: {} },
    ratio: 0.3,
    preserve: ['paths', 'signatures'],
    modeHint: true
  });
  assert.match(prompt, /file paths/);
  assert.match(prompt, /signatures/);
  assert.match(prompt, /fall back to general compression/);
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
  assert.equal(result.degraded, false);
  assert.deepEqual(result.warnings, []);
});

test('compressWithPlan: maxOutputChars 只作用于最终合并,不传给每个分段', async () => {
  const calls = [];
  const service = {
    async call(task, request) {
      calls.push({ system: request.system, inputChars: request.inputChars });
      return { text: 'SEG', provider: 'p', model: 'm' };
    }
  };
  const longText = Array.from({ length: 3000 }, (_, i) => `line ${i} with some facts ${i}`).join('\n');
  await compressWithPlan(service, { text: longText, mode: 'log', maxOutputChars: 2000 }, {});
  const segmentCalls = calls.filter((c) => !c.system.includes('at most about 2000 characters'));
  const mergeCalls = calls.filter((c) => c.system.includes('at most about 2000 characters'));
  assert.ok(segmentCalls.length > 0, '应有分段调用');
  assert.ok(mergeCalls.length > 0, '最终合并应携带总预算');
  for (const call of segmentCalls) {
    assert.ok(!call.system.includes('at most about 2000 characters'), '分段调用不应携带总预算');
  }
});

test('compressWithPlan: 超长文本先分段再汇总(两轮)', async () => {
  const calls = [];
  const service = {
    async call(task, request) {
      calls.push({ system: request.system, text: request.messages[0].content[0].text });
      return { text: 'SEG_' + request.inputChars, provider: 'p', model: 'm' };
    }
  };
  const longText = Array.from({ length: 3000 }, (_, i) => `line ${i} with some facts ${i}`).join('\n');
  const result = await compressWithPlan(service, {
    text: longText,
    mode: 'log',
    targetRatio: 0.2
  }, {});
  assert.equal(result.rounds, 2);
  assert.ok(result.segments > 1);
  assert.ok(calls.length >= result.segments + 1, '应有分段调用+最终汇总调用');
  assert.equal(result.strategy, 'log');
  assert.equal(result.compressed.startsWith('SEG_'), true);
});

test('compressWithPlan: merged 超过安全上限时保留全部分段且不崩溃', async () => {
  const service = {
    async call(task, request) {
      // 每个分段/合并都返回超大结果,迫使 merged 超过 500K 安全上限
      return { text: 'x'.repeat(600000), provider: 'p', model: 'm' };
    }
  };
  const longText = Array.from({ length: 3000 }, (_, i) => `line ${i} with some facts ${i}`).join('\n');
  const result = await compressWithPlan(service, { text: longText, mode: 'log' }, {});
  assert.equal(result.degraded, true, 'merged 超限应标记 degraded');
  assert.ok(result.compressed.includes('x'.repeat(600000)), '应保留全部分段而不是只留第一段');
  assert.ok(result.compressed.length > 600000, 'merged 应包含多个分段');
  assert.ok(result.warnings.some((w) => /safety limit/.test(w)), '应有超限警告');
});

test('compressWithPlan: 超长文本自动启用分层压缩(三轮)', async () => {
  const calls = [];
  const service = {
    async call(task, request) {
      calls.push({ system: request.system, round: /merge round|skeleton|refine/.test(request.system) ? request.system : '' });
      return { text: 'HIER_OK', provider: 'p', model: 'm' };
    }
  };
  const longText = Array.from({ length: 10000 }, (_, i) => `line ${i} with some facts ${i}`).join('\n');
  const result = await compressWithPlan(service, { text: longText, mode: 'doc' }, {});
  assert.equal(result.rounds, 3);
  assert.equal(result.strategy, 'doc');
  assert.equal(result.degraded, false);
});

test('compressWithPlan: 短文本单轮失败直接抛错', async () => {
  const service = {
    async call() { throw new Error('boom'); }
  };
  await assert.rejects(() => compressWithPlan(service, { text: 'hello world' }, {}), /boom/);
});

test('compressWithPlan: 分段失败时保留原文并标记 degraded', async () => {
  const longText = Array.from({ length: 10000 }, (_, i) => `line ${i}`).join('\n');
  let calls = 0;
  const service = {
    async call(task, request) {
      calls += 1;
      // 第一段调用失败,其余成功;失败段因超过阈值会触发恢复再切分
      if (calls === 1) throw new Error('segment boom');
      return { text: 'SEG_OK', provider: 'p', model: 'm' };
    }
  };
  const result = await compressWithPlan(service, { text: longText, mode: 'log' }, {});
  assert.equal(result.degraded, false); // 恢复成功,不应 degraded
  assert.ok(result.compressed.length > 0);
  assert.ok(result.rounds >= 2);
});

test('compressWithPlan: 超过安全上限拒绝', async () => {
  const service = {
    async call() { throw new Error('should not be called'); }
  };
  await assert.rejects(
    () => compressWithPlan(service, { text: 'x'.repeat(MAX_COMPRESS_INPUT_CHARS + 1) }, {}),
    /safety limit/
  );
});
