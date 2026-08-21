/**
 * dsh-aux skill pre-audit bridge tests.
 *
 * @module tests/skill-bridge
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILL_AUDIT_CONTEXT_MESSAGES,
  SKILL_AUDIT_MAX_MESSAGE_CHARS,
  SKILL_AUDIT_MAX_TOTAL_CHARS,
  attachSkillBridge,
  buildSkillAuditUserMessage,
  estimateSkillAuditInputChars,
  formatAuditContext,
  formatAuditMessage,
  isSkillTaskConfigured,
  renderRawSkillForAudit,
  skillAuditSystemPrompt
} from '../dsh-aux/src/skill-bridge.js';

test('skillAuditSystemPrompt: 要求区分工程规范与易腐烂断言', () => {
  const prompt = skillAuditSystemPrompt();
  assert.match(prompt, /适用性评估/);
  assert.match(prompt, /如何应用/);
  assert.match(prompt, /已知坑\/旧断言标注/);
  assert.match(prompt, /🔻易腐烂/);
  assert.match(prompt, /工程规范/);
  assert.match(prompt, /置信度/);
});

test('isSkillTaskConfigured: 仅在显式 provider+model 时启用', () => {
  assert.equal(isSkillTaskConfigured({ _merged: { skill: {} } }), false);
  assert.equal(isSkillTaskConfigured({ _merged: { skill: { provider: 'p' } } }), false);
  assert.equal(isSkillTaskConfigured({ _merged: { skill: { provider: 'p', model: 'm' } } }), true);
  assert.equal(isSkillTaskConfigured({ _merged: {} }), false);
  assert.equal(isSkillTaskConfigured(undefined), false);
});

test('formatAuditMessage: 提取 text/reasoning/tool-call 为紧凑文本', () => {
  const message = {
    role: 'assistant',
    content: [
      { type: 'text', text: 'I will load the skill.' },
      { type: 'reasoning', text: 'because auth is needed' },
      { type: 'tool-call', name: 'skill', arguments: { name: 'auth-flow' } }
    ]
  };
  const text = formatAuditMessage(message);
  assert.match(text, /^assistant: I will load the skill\./);
  assert.match(text, /\[reasoning\] because auth is needed/);
  assert.match(text, /\[tool-call: skill \{"name":"auth-flow"\}\]/);
});

test('formatAuditContext: 只取最近 N 条,并做字符截断', () => {
  const messages = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: [{ type: 'text', text: `message ${i} ` + 'x'.repeat(50) }]
  }));
  const context = formatAuditContext(messages, 5, 30, 200);
  const lines = context.split('\n');
  assert.ok(lines.length <= 5, '应最多保留 5 条');
  assert.ok(context.length <= 200, '总字符应受 total cap 限制');
});

test('formatAuditContext: 默认常量合理', () => {
  assert.equal(SKILL_AUDIT_CONTEXT_MESSAGES, 8);
  assert.equal(SKILL_AUDIT_MAX_MESSAGE_CHARS, 2000);
  assert.equal(SKILL_AUDIT_MAX_TOTAL_CHARS, 12000);
});

test('renderRawSkillForAudit: 保留 skill 内容与资源提示', () => {
  const skill = {
    name: 'auth-flow',
    provider: 'filesystem',
    resourceBase: { kind: 'directory', path: '/tmp/skills/auth-flow' },
    content: '# Auth Flow\n\nUse OAuth.'
  };
  const text = renderRawSkillForAudit(skill);
  assert.match(text, /<skill_content name="auth-flow">/);
  assert.match(text, /Base directory for this skill: \/tmp\/skills\/auth-flow/);
  assert.match(text, /# Auth Flow/);
});

test('buildSkillAuditUserMessage: 显式 task + 会话上下文 + SKILL 都进入消息', () => {
  const skill = { name: 'auth-flow', provider: 'filesystem', content: '# Auth Flow' };
  const contextMessages = [
    { role: 'user', content: [{ type: 'text', text: 'please add login' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'I will use auth-flow' }] }
  ];
  const message = buildSkillAuditUserMessage({ skill, task: 'implement login', contextMessages });
  const text = message.content.map((block) => block.text).join('\n');
  assert.match(text, /MAIN AGENT TASK \(explicit\):\nimplement login/);
  assert.match(text, /RECENT CONVERSATION CONTEXT:/);
  assert.match(text, /please add login/);
  assert.match(text, /SKILL TO AUDIT:/);
  assert.match(text, /# Auth Flow/);
});

test('estimateSkillAuditInputChars: 统计 text block 字符数', () => {
  const messages = [
    { content: [{ type: 'text', text: 'abc' }, { type: 'text', text: 'def' }] },
    { content: [{ type: 'text', text: 'gh' }] }
  ];
  assert.equal(estimateSkillAuditInputChars(messages), 8);
});

function makeHarness(overrides = {}) {
  const events = [];
  const service = {
    ctx: {
      on(event, handler, options) {
        events.push({ event, handler, options });
      },
      logger: { warn() {} }
    },
    _merged: { skill: overrides.configured === false ? {} : { provider: 'opencode-go', model: 'glm-5.2' } },
    _enabled: overrides.enabled ?? { skillAudit: 'aux' },
    skillMode: overrides.skillMode ?? 'audit',
    async call(task, request) {
      calls.push({ task, request });
      if (overrides.failCall) throw new Error('aux failed');
      return { text: 'AUDIT_REPORT', provider: 'opencode-go', model: 'glm-5.2' };
    }
  };
  const calls = [];
  attachSkillBridge(service);
  const registration = events.find((e) => e.event === 'tools/post-execute');
  assert.ok(registration, '应注册 tools/post-execute');
  return { service, calls, handler: registration.handler, options: registration.options };
}

function skillResult() {
  return {
    isError: false,
    value: {
      name: 'auth-flow',
      provider: 'filesystem',
      resourceBase: { kind: 'directory', path: '/tmp/skills/auth-flow' },
      content: '# Auth Flow\n\nUse OAuth.'
    }
  };
}

function skillExec(overrides = {}) {
  return {
    name: overrides.name ?? 'skill',
    parent: overrides.parent,
    arguments: overrides.arguments ?? { name: 'auth-flow', task: 'implement login' },
    signal: new AbortController().signal,
    agent: {
      session: {
        deriveMessages() {
          return [
            { role: 'user', content: [{ type: 'text', text: 'please add login' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'I will use auth-flow' }] }
          ];
        }
      }
    }
  };
}

test('attachSkillBridge: 未配置 skill 路由时 native 直通', async () => {
  const { handler } = makeHarness({ configured: false });
  const decision = await handler(skillExec(), skillResult(), async () => ({ kind: 'accept' }));
  assert.deepEqual(decision, { kind: 'accept' });
});

test('attachSkillBridge: 非 skill 工具或子代理调用不拦截', async () => {
  const { handler, calls } = makeHarness();
  const other = await handler({ ...skillExec(), name: 'read' }, skillResult(), async () => ({ kind: 'accept' }));
  assert.deepEqual(other, { kind: 'accept' });
  assert.equal(calls.length, 0);
  const sub = await handler({ ...skillExec(), parent: { id: 'sub' } }, skillResult(), async () => ({ kind: 'accept' }));
  assert.deepEqual(sub, { kind: 'accept' });
  assert.equal(calls.length, 0);
});

test('attachSkillBridge: 配置后生成审计报告并保留原始 SKILL', async () => {
  const { handler, calls } = makeHarness();
  const decision = await handler(skillExec(), skillResult(), async () => ({ kind: 'accept' }));
  assert.equal(decision.kind, 'accept');
  assert.ok(Array.isArray(decision.content));
  const text = decision.content.map((b) => b.text).join('\n');
  assert.match(text, /# Auth Flow/);
  assert.match(text, /AUDIT_REPORT/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].task, 'skill');
  assert.equal(calls[0].request.purpose, 'skill-audit');
  const msgText = calls[0].request.messages[0].content.map((b) => b.text).join('\n');
  assert.match(msgText, /MAIN AGENT TASK \(explicit\):\nimplement login/);
  assert.match(msgText, /please add login/);
});

test('attachSkillBridge: 辅助调用失败时回退原生结果', async () => {
  const { handler, calls } = makeHarness({ failCall: true });
  const decision = await handler(skillExec(), skillResult(), async () => ({ kind: 'accept' }));
  assert.deepEqual(decision, { kind: 'accept' });
  assert.equal(calls.length, 1);
});

test('attachSkillBridge: 已失败的工具结果不拦截', async () => {
  const { handler, calls } = makeHarness();
  const decision = await handler(skillExec(), { ...skillResult(), isError: true }, async () => ({ kind: 'accept' }));
  assert.deepEqual(decision, { kind: 'accept' });
  assert.equal(calls.length, 0);
});

test('attachSkillBridge: skillAudit=native 或 skillMode=native 时直通', async () => {
  for (const overrides of [
    { enabled: { skillAudit: 'native' }, skillMode: 'audit' },
    { enabled: { skillAudit: 'aux' }, skillMode: 'native' }
  ]) {
    const { handler, calls } = makeHarness(overrides);
    const decision = await handler(skillExec(), skillResult(), async () => ({ kind: 'accept' }));
    assert.deepEqual(decision, { kind: 'accept' });
    assert.equal(calls.length, 0);
  }
});

test('attachSkillBridge: report 模式只返回报告并带原文提示', async () => {
  const { handler, calls } = makeHarness({ skillMode: 'report' });
  const decision = await handler(skillExec(), skillResult(), async () => ({ kind: 'accept' }));
  const text = decision.content.map((b) => b.text).join('\n');
  assert.match(text, /AUDIT_REPORT/);
  assert.match(text, /includeOriginal: true/);
  assert.ok(!text.includes('# Auth Flow'), 'report 模式不应包含原始 SKILL');
  assert.equal(calls.length, 1);
});

test('attachSkillBridge: report-ondemand 默认只返回报告,includeOriginal 返回原文', async () => {
  const { handler } = makeHarness({ skillMode: 'report-ondemand' });
  const reportDecision = await handler(skillExec(), skillResult(), async () => ({ kind: 'accept' }));
  const reportText = reportDecision.content.map((b) => b.text).join('\n');
  assert.match(reportText, /AUDIT_REPORT/);
  assert.ok(!reportText.includes('# Auth Flow'), '默认不应包含原始 SKILL');

  const originalDecision = await handler(skillExec({ arguments: { name: 'auth-flow', task: 'x', includeOriginal: true } }), skillResult(), async () => ({ kind: 'accept' }));
  const originalText = originalDecision.content.map((b) => b.text).join('\n');
  assert.match(originalText, /# Auth Flow/);
  assert.ok(!originalText.includes('AUDIT_REPORT'), 'includeOriginal 应只返回原文');
});
