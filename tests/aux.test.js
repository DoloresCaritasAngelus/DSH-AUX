/**
 * dsh-aux 测试(node:test,零依赖)。
 *
 * 覆盖 PRD §6 可离线验证的部分:
 *  - 配置校验: 未知键 / provider+model 配对 / timeout/并发校验
 *  - 路由解析: 显式配置 > 任务默认 > 主模型(未配置时 undefined)
 *  - 错误分类: 超时/限流/认证/402/连接/模型不存在/中止/其他
 *  - 冷却: 连续失败阈值 → 冷却 TTL → 恢复;成功重置
 *  - 信号量: 并发上限、FIFO 释放
 *  - prompt 构造: 压缩/网页/视觉的 system+user 消息
 *  - Service 装配: ctx.auxLlm 注册、三工具注册、事件折叠投影、/aux 命令
 *
 * 运行: cd <仓库路径>/tests && node --test aux.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import AuxLlmService, {
  AUX_CALL_EVENT,
  AUX_SETTINGS_NAMESPACE,
  AUX_STATUS_KEY,
  AUX_TIMEOUT_CODE,
  AuxCallError,
  registerAuxTask,
  validateAuxSettings
} from '../dsh-aux/src/index.js';
import {
  AUX_TASKS,
  COOLDOWN_FAILURE_THRESHOLD,
  COOLDOWN_TTL_MS,
  DEFAULT_TASK_CONCURRENCY,
  DEFAULT_TASK_TIMEOUT_MS,
  AsyncSemaphore,
  FailureCooldown,
  classifyFailure,
  mergeTaskConfig,
  resolveConfig,
  resolvePrimaryRoute,
  route,
  shouldFallback,
  taskConcurrency,
  taskTimeoutMs
} from '../dsh-aux/src/route.js';
import {
  clampTargetRatio,
  compressSystemPrompt,
  compressUserMessage,
  htmlToText,
  stripThinkBlocks,
  webExtractSystemPrompt,
  webExtractUserMessage,
  visionSystemPrompt
} from '../dsh-aux/src/prompt.js';

/** 让微任务/宏任务队列排空,等 ctx.inject 子 fiber 落地。 */
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

// ── route.js 纯逻辑 ──────────────────────────────────────────────────────

test('resolveConfig: 空配置合法,未知键抛错', () => {
  assert.deepEqual(resolveConfig({}), { tasks: { vision: {}, web_extract: {}, compress: {} } });
  assert.throws(() => resolveConfig({ nope: 1 }), /unknown key\(s\) nope/);
  assert.throws(() => resolveConfig({ tasks: { vision: { extra: 1 } } }), /unknown key\(s\) extra/);
});

test('resolveConfig: provider 与 model 必须成对', () => {
  assert.throws(() => resolveConfig({ tasks: { vision: { provider: 'opencode-go' } } }), /provider and model must be supplied together/);
  const resolved = resolveConfig({ tasks: { vision: { provider: 'opencode-go', model: 'glm-5.2' } } });
  assert.equal(resolved.tasks.vision.provider, 'opencode-go');
  assert.equal(resolved.tasks.vision.model, 'glm-5.2');
});

test('resolveConfig: timeoutMs/maxConcurrency 必须为正整数', () => {
  assert.throws(() => resolveConfig({ tasks: { vision: { timeoutMs: 0 } } }), /positive integer/);
  assert.throws(() => resolveConfig({ tasks: { vision: { maxConcurrency: -1 } } }), /positive integer/);
  const resolved = resolveConfig({ tasks: { vision: { timeoutMs: 9000, maxConcurrency: 3 } } });
  assert.equal(resolved.tasks.vision.timeoutMs, 9000);
});

test('mergeTaskConfig: settings 覆盖插件配置,缺省继承', () => {
  const merged = mergeTaskConfig(
    { provider: 'opencode-go', model: 'glm-5.2', timeoutMs: 30_000 },
    { model: 'kimi-k2.7-code', maxConcurrency: 4 }
  );
  assert.equal(merged.provider, 'opencode-go');
  assert.equal(merged.model, 'kimi-k2.7-code');
  assert.equal(merged.timeoutMs, 30_000);
  assert.equal(merged.maxConcurrency, 4);
});

test('taskTimeoutMs / taskConcurrency: 缺省值生效', () => {
  assert.equal(taskTimeoutMs({}), DEFAULT_TASK_TIMEOUT_MS);
  assert.equal(taskTimeoutMs({ timeoutMs: 5000 }), 5000);
  assert.equal(taskConcurrency({}), DEFAULT_TASK_CONCURRENCY);
  assert.equal(taskConcurrency({ maxConcurrency: 7 }), 7);
});

test('resolvePrimaryRoute: 显式配置 > 任务默认 > undefined', () => {
  const defaults = { vision: route('opencode-go', 'kimi-k2.7-code') };
  assert.deepEqual(
    resolvePrimaryRoute({ provider: 'x', model: 'y' }, defaults),
    route('x', 'y')
  );
  assert.deepEqual(
    resolvePrimaryRoute({ task: 'vision' }, defaults),
    route('opencode-go', 'kimi-k2.7-code')
  );
  assert.equal(resolvePrimaryRoute({ task: 'compress' }, defaults), void 0);
});

test('classifyFailure: 各类错误正确归类', () => {
  assert.equal(classifyFailure({ message: 'request timed out' }), 'timeout');
  assert.equal(classifyFailure({ status: 429, message: 'rate limited' }), 'rate-limit');
  assert.equal(classifyFailure({ status: 401, message: 'unauthorized' }), 'auth');
  assert.equal(classifyFailure({ status: 402, message: 'insufficient balance' }), 'payment');
  assert.equal(classifyFailure({ status: 404, message: 'model xyz not found' }), 'model-not-found');
  assert.equal(classifyFailure({ message: 'fetch failed: ECONNREFUSED' }), 'connection');
  assert.equal(classifyFailure({ code: 'UNSUPPORTED_CONTENT', message: 'does not support image input' }), 'content');
  assert.equal(classifyFailure({ message: 'something odd' }), 'other');
  const controller = new AbortController();
  controller.abort();
  assert.equal(classifyFailure({ message: 'timeout' }, controller.signal), 'aborted');
});

test('shouldFallback: aborted 不降级,其余都降级', () => {
  assert.equal(shouldFallback('aborted'), false);
  assert.equal(shouldFallback('timeout'), true);
  assert.equal(shouldFallback('rate-limit'), true);
  assert.equal(shouldFallback('payment'), true);
});

test('FailureCooldown: 连续失败达到阈值进入冷却,冷却中跳过,TTL 后恢复', () => {
  const cooldown = new FailureCooldown({ threshold: 3, ttlMs: 1000 });
  const t0 = 1_000_000;
  assert.equal(cooldown.isCoolingDown('p', 'm', t0), false);
  assert.equal(cooldown.recordFailure('p', 'm', t0), false);
  assert.equal(cooldown.recordFailure('p', 'm', t0 + 1), false);
  assert.equal(cooldown.recordFailure('p', 'm', t0 + 2), true); // 第 3 次进入冷却(until = t0+2+1000)
  assert.equal(cooldown.isCoolingDown('p', 'm', t0 + 3), true);
  assert.equal(cooldown.isCoolingDown('p', 'm', t0 + 1002), false); // TTL 后恢复
});

test('FailureCooldown: 成功重置失败计数', () => {
  const cooldown = new FailureCooldown({ threshold: 3, ttlMs: 1000 });
  cooldown.recordFailure('p', 'm', 0);
  cooldown.recordSuccess('p', 'm');
  assert.equal(cooldown.recordFailure('p', 'm', 1), false);
  assert.equal(cooldown.recordFailure('p', 'm', 2), false);
  assert.equal(cooldown.isCoolingDown('p', 'm', 3), false);
});

test('AsyncSemaphore: 并发上限与 FIFO 释放', async () => {
  const semaphore = new AsyncSemaphore(2);
  const r1 = await semaphore.acquire();
  const r2 = await semaphore.acquire();
  let thirdAcquired = false;
  const third = semaphore.acquire().then(() => { thirdAcquired = true; });
  await settle();
  assert.equal(thirdAcquired, false);
  r1();
  await third;
  assert.equal(thirdAcquired, true);
  r2();
});

// ── prompt.js ────────────────────────────────────────────────────────────

test('clampTargetRatio: 边界钳制与缺省', () => {
  assert.equal(clampTargetRatio(void 0), 0.2);
  assert.equal(clampTargetRatio(0.01), 0.05);
  assert.equal(clampTargetRatio(0.9), 0.5);
  assert.equal(clampTargetRatio(0.3), 0.3);
});

test('compressSystemPrompt: 包含目标比例', () => {
  const prompt = compressSystemPrompt(0.2);
  assert.match(prompt, /20%/);
});

test('compressUserMessage: 含可选 instruction', () => {
  const withInstr = compressUserMessage('TEXT', 'keep all paths');
  assert.match(withInstr, /keep all paths/);
  const without = compressUserMessage('TEXT', '');
  assert.ok(!without.includes('Additional compression'));
});

test('webExtractUserMessage: 含 URL 与 question', () => {
  const msg = webExtractUserMessage('BODY', 'https://example.com', 'what is it?');
  assert.ok(msg.includes('https://example.com'));
  assert.ok(msg.includes('what is it?'));
  assert.ok(msg.includes('BODY'));
});

test('visionSystemPrompt: 存在', () => {
  assert.ok(visionSystemPrompt().length > 0);
  assert.ok(webExtractSystemPrompt().length > 0);
});

test('stripThinkBlocks: 剥离内联 think 块,保留正文', () => {
  assert.equal(stripThinkBlocks('答案<think>内部推理</think>内容'), '答案内容');
  assert.equal(stripThinkBlocks('<think>只有推理</think>'), '');
  assert.equal(stripThinkBlocks('纯文本'), '纯文本');
  assert.equal(stripThinkBlocks(''), '');
});

test('htmlToText: 移除标签与脚本块,保留文本', () => {
  const html = '<html><head><title>忽略</title></head><body><script>var x = 1;</script><h1>标题</h1><p>正文内容 with <b>bold</b> and <a href="https://example.com">链接</a></p><style>.x{color:red}</style></body></html>';
  const text = htmlToText(html);
  assert.ok(!text.includes('<'));
  assert.ok(!text.includes('var x'));
  assert.ok(!text.includes('.x{color'));
  assert.ok(text.includes('标题'));
  assert.ok(text.includes('正文内容'));
  assert.ok(text.includes('bold'));
  assert.ok(text.includes('链接'));
  assert.ok(!text.includes('忽略'));
});

test('htmlToText: 解码常见实体', () => {
  assert.equal(htmlToText('<p>a &amp; b &lt; c &gt; d &quot;e&quot; &nbsp; f</p>'), 'a & b < c > d "e" f');
});

test('htmlToText: 空输入与纯文本', () => {
  assert.equal(htmlToText(''), '');
  assert.equal(htmlToText('   '), '');
  assert.equal(htmlToText('plain text only'), 'plain text only');
});

test('htmlToText: 保留数字与 URL 文字', () => {
  const html = '<p>价格 <span>42</span> 元,官网 https://example.com/path?a=1&amp;b=2</p>';
  const text = htmlToText(html);
  assert.ok(text.includes('42'));
  assert.ok(text.includes('https://example.com/path?a=1&b=2'));
});

// ── Service 装配 ─────────────────────────────────────────────────────────

/** 装配真实 cordis Context + 桩服务,挂载 AuxLlmService。 */
async function makeHarness(config) {
  // 隔离:每次把 DSH_HOME 指向独立临时目录(测试进程可能继承真实
  // DSH_HOME,如 dsh web 环境里跑 node --test),防止 vision/记忆测试的
  // 归属写入与图片记忆落到真实 ~/.dsh。需要真实路径的测试(如
  // gc-images、对账)在 makeHarness 之后自行覆盖 DSH_HOME。
  const tmpHome = '/tmp/aux-harness-' + process.pid + '-' + Math.random().toString(36).slice(2);
  await fsPromises.mkdir(tmpHome + '/attachments/v1', { recursive: true });
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmpHome;
  const ctx = new Context();
  const tools = [];
  const projections = [];
  const commands = [];
  const appended = [];
  const streams = [];
  await ctx.plugin({
    name: 'aux-stubs',
    apply(stubCtx) {
      stubCtx.provide('tools', { register(def) { tools.push(def); return () => {}; } });
      stubCtx.provide('settings', {});
      stubCtx.provide('web', {
        async fetch(request) {
          if (request.url.includes('missing')) throw new Error('fetch failed: ENOTFOUND');
          if (request.url.includes('error')) return { url: request.url, statusCode: 500, body: { kind: 'text', content: '' }, truncated: false };
          if (request.url.includes('htmlpage')) return { url: request.url, statusCode: 200, body: { kind: 'html', content: '<html><body><script>var x=1;</script><h1>HTML 页面标题</h1><p>正文 with <b>bold</b> and number 42</p></body></html>' }, truncated: false };
          return { url: request.url, statusCode: 200, body: { kind: 'text', content: 'PAGE CONTENT here with facts and numbers 42' }, truncated: false };
        }
      });
      stubCtx.provide('llm', {
        modelCapabilities: new Map([['kimi-k2.7-code', ['text', 'image']], ['deepseek-v4-flash', ['text']], ['glm-5.2', ['text', 'image']]]),
        async resolveModelInfo(provider, model, signal) {
          const modalities = this.modelCapabilities.get(model);
          if (modalities === void 0) return { provider, model, inputModalities: void 0 };
          return { provider, model, inputModalities: modalities };
        },
        stream(options) {
          streams.push(options);
          return (async function* () {
            yield { type: 'block-start', index: 0, blockType: 'text' };
            yield { type: 'text-delta', index: 0, text: 'OUTPUT_TEXT' };
            yield { type: 'block-end', index: 0, block: { type: 'text', text: 'OUTPUT_TEXT' } };
            yield { type: 'finish', reason: { kind: 'stop' } };
          })();
        }
      });
      stubCtx.provide('agentDefaultModel', {
        currentSelection() { return { provider: 'opencode-go', model: 'deepseek-v4-flash' }; }
      });
      stubCtx.provide('fs', {
        async resolve(path, opts) { return { targetKey: path, displayPath: path, processPath: () => path, fileUrl: () => 'file://' + path }; },
        async stat(target) { return { type: 'file', size: 1 }; },
        async readBytes(target, signal, byteCap) { return new Uint8Array([1, 2, 3]); }
      });
      stubCtx.provide('sessionProjections', {
        register(definition) { projections.push(definition); return () => {}; }
      });
      stubCtx.provide('commands', {
        register(definition) { commands.push(definition); return () => {}; }
      });
      stubCtx.provide('attachments', {
        imageLimits: { maxImageBytes: 10_000_000, maxMessageImageBytes: 10_000_000, maxImagesPerMessage: 5, maxImagePixels: 50_000_000, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
        async validateImage() {},
        async saveImage(input) { return { attachmentId: 'att-' + input.mediaType, mediaType: input.mediaType, bytes: input.data.length, width: 10, height: 10, name: input.name }; },
        async readImage(ref) { return { ref, data: new Uint8Array(ref.bytes) }; }
      });
    }
  });
  const fiber = ctx.plugin(AuxLlmService, config ?? {});
  await fiber;
  await settle();
  return { ctx, fiber, tools, projections, commands, appended, streams };
}

function makeSession() {
  const events = [];
  const session = {
    id: 'sess-1',
    events,
    append(type, data) { events.push({ type, data }); },
    requestHeader() { return { config: { provider: 'opencode-go', model: 'deepseek-v4-flash' } }; }
  };
  return session;
}

test('装配: ctx.auxLlm 可用,三工具注册,投影与命令注册', async () => {
  const { ctx, tools, projections, commands } = await makeHarness();
  assert.ok(ctx.auxLlm instanceof AuxLlmService);
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['compress_text', 'vision_analyze', 'web_extract']);
  assert.equal(projections.length, 1);
  assert.equal(projections[0].key, AUX_STATUS_KEY);
  assert.deepEqual(projections[0].init(), { tasks: {} });
  assert.deepEqual(projections[0].view(projections[0].init()), { tasks: {} });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, 'aux');
});

test('投影: aux/llm-call 事件折叠为每任务最近记录', async () => {
  const { projections } = await makeHarness();
  const projection = projections[0];
  const state = projection.apply(projection.apply(projection.init(), {
    type: AUX_CALL_EVENT,
    data: { task: 'vision', provider: 'p', model: 'm', ok: true, durationMs: 10 }
  }), {
    type: AUX_CALL_EVENT,
    data: { task: 'compress', provider: 'p2', model: 'm2', ok: false, durationMs: 20 }
  });
  assert.equal(state.tasks.vision.ok, true);
  assert.equal(state.tasks.compress.ok, false);
  assert.equal(state.tasks.vision.model, 'm');
});

test('call: 未配置任务用默认辅助模型,成功返回文本与路由', async () => {
  const { ctx, streams } = await makeHarness();
  const session = makeSession();
  const result = await ctx.auxLlm.call('compress', {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }], id: 'm1', source: { kind: 'plugin', plugin: 'test' } }],
    session,
    inputChars: 5
  });
  assert.equal(result.text, 'OUTPUT_TEXT');
  assert.equal(result.provider, 'opencode-go');
  assert.equal(result.model, 'deepseek-v4-flash');
  assert.equal(streams.length, 1);
  // 事件已记录
  const events = session.events.filter((e) => e.type === AUX_CALL_EVENT);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.ok, true);
  assert.equal(events[0].data.fallbackUsed, false);
});

test('call: 显式配置走配置模型', async () => {
  const { ctx, streams } = await makeHarness({
    tasks: { compress: { provider: 'volcengine-ark', model: 'glm-5.2' } }
  });
  const result = await ctx.auxLlm.call('compress', { messages: [], session: makeSession() });
  assert.equal(result.provider, 'volcengine-ark');
  assert.equal(result.model, 'glm-5.2');
  assert.equal(streams[0].provider, 'volcengine-ark');
});

test('call: 未知任务抛错', async () => {
  const { ctx } = await makeHarness();
  await assert.rejects(() => ctx.auxLlm.call('nope', { messages: [] }), /unknown task "nope"/);
});

test('call: 无路由且无主模型时抛错', async () => {
  const ctx = new Context();
  await ctx.plugin({
    name: 'min-stubs',
    apply(stubCtx) {
      stubCtx.provide('tools', { register() { return () => {}; } });
      stubCtx.provide('settings', {});
      stubCtx.provide('web', { async fetch() { throw new Error('no'); } });
      stubCtx.provide('fs', { async resolve(p) { return { displayPath: p }; }, async stat() { return { type: 'file' }; }, async readBytes() { return new Uint8Array(0); } });
      stubCtx.provide('attachments', { imageLimits: { maxImageBytes: 1000, maxMessageImageBytes: 1000, maxImagesPerMessage: 1, maxImagePixels: 1000, mediaTypes: ['image/png'] }, async validateImage() {}, async saveImage(i) { return { attachmentId: 'a', mediaType: i.mediaType, bytes: 0, width: 1, height: 1 }; }, async readImage(r) { return { ref: r, data: new Uint8Array(0) }; } });
      stubCtx.provide('llm', {
        stream() { throw new Error('no'); }
      });
    }
  });
  await ctx.plugin(AuxLlmService, {});
  await settle();
  // 无路由的自定义任务:无默认模型、无主模型 → 抛错
  ctx.auxLlm.registerTask({ key: 'bare' });
  await assert.rejects(
    () => ctx.auxLlm.call('bare', { messages: [] }),
    /no route configured and no main model available/
  );
});

test('AuxCallError: 聚合所有尝试', async () => {
  const ctx = new Context();
  const calls = [];
  await ctx.plugin({
    name: 'fail-stubs',
    apply(stubCtx) {
      stubCtx.provide('tools', { register() { return () => {}; } });
      stubCtx.provide('settings', {});
      stubCtx.provide('web', { async fetch() { throw new Error('no'); } });
      stubCtx.provide('fs', { async resolve(p) { return { displayPath: p }; }, async stat() { return { type: 'file' }; }, async readBytes() { return new Uint8Array(0); } });
      stubCtx.provide('attachments', { imageLimits: { maxImageBytes: 1000, maxMessageImageBytes: 1000, maxImagesPerMessage: 1, maxImagePixels: 1000, mediaTypes: ['image/png'] }, async validateImage() {}, async saveImage(i) { return { attachmentId: 'a', mediaType: i.mediaType, bytes: 0, width: 1, height: 1 }; }, async readImage(r) { return { ref: r, data: new Uint8Array(0) }; } });
      stubCtx.provide('llm', {
        stream() {
          calls.push(1);
          throw Object.assign(new Error('boom'), { code: 'TIMEOUT', status: 408 });
        }
      });
      stubCtx.provide('agentDefaultModel', {
        currentSelection() { return { provider: 'opencode-go', model: 'deepseek-v4-flash' }; }
      });
    }
  });
  await ctx.plugin(AuxLlmService, {});
  await settle();
  await assert.rejects(
    () => ctx.auxLlm.call('compress', { messages: [], session: makeSession() }),
    (error) => {
      assert.ok(error instanceof AuxCallError);
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0].kind, 'timeout');
      return true;
    }
  );
  // 只尝试了默认路由;主模型被冷却? 不——失败一次后直接尝试主模型
  // 这里默认辅助模型 = opencode-go/deepseek-v4-flash(与主模型相同),所以只有一跳
  assert.equal(calls.length, 1);
});

test('registerAuxTask: 注册自定义任务后 call 可用', async () => {
  const { ctx } = await makeHarness();
  registerAuxTask(ctx, { key: 'custom', provider: 'opencode-go', model: 'glm-5.2' });
  const result = await ctx.auxLlm.call('custom', { messages: [] });
  assert.equal(result.provider, 'opencode-go');
  assert.equal(result.model, 'glm-5.2');
});

function imageMessage() {
  return [{
    role: 'user',
    content: [
      { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 10, width: 5, height: 5 } },
      { type: 'text', text: 'what is this?' }
    ],
    id: 'm-img',
    source: { kind: 'plugin', plugin: 'test' }
  }];
}

test('能力门: 显式配置的模型不支持图像 → 拒绝并降级主模型', async () => {
  const { ctx, streams } = await makeHarness({
    tasks: { vision: { provider: 'opencode-go', model: 'deepseek-v4-flash' } }
  });
  // deepseek-v4-flash 声明 text-only;主模型也是 deepseek-v4-flash(同样 text-only)
  // → 两个候选都被能力门拒绝 → AuxCallError 含 content 分类
  await assert.rejects(
    () => ctx.auxLlm.call('vision', { messages: imageMessage(), session: makeSession() }),
    (error) => {
      assert.ok(error instanceof AuxCallError);
      assert.ok(error.attempts.length >= 1);
      assert.ok(error.attempts.every((a) => a.kind === 'content'));
      return true;
    }
  );
  assert.equal(streams.length, 0); // 没有真正发起任何 LLM 流
});

test('能力门: 支持图像的模型直接通过', async () => {
  const { ctx, streams } = await makeHarness({
    tasks: { vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' } }
  });
  const result = await ctx.auxLlm.call('vision', { messages: imageMessage(), session: makeSession() });
  assert.equal(result.model, 'kimi-k2.7-code');
  assert.equal(streams.length, 1);
});

test('能力门: 未知能力(无 resolveModelInfo 答案)放行', async () => {
  const { ctx, streams } = await makeHarness({
    tasks: { vision: { provider: 'volcengine-ark', model: 'unknown-model-x' } }
  });
  const result = await ctx.auxLlm.call('vision', { messages: imageMessage(), session: makeSession() });
  assert.equal(result.model, 'unknown-model-x');
  assert.equal(streams.length, 1);
});

test('能力门: 空模态列表(适配器未声明能力)视为未知放行', async () => {
  // deepseek-v4-flash 在 harness 里声明 ['text'](明确不支持);
  // 新增场景:适配器对未声明能力的模型返回空数组 [] → 应放行
  const ctx = new Context();
  const streams = [];
  await ctx.plugin({
    name: 'empty-modality-stubs',
    apply(stubCtx) {
      stubCtx.provide('tools', { register() { return () => {}; } });
      stubCtx.provide('settings', {});
      stubCtx.provide('web', { async fetch() { throw new Error('no'); } });
      stubCtx.provide('fs', { async resolve(p) { return { displayPath: p }; }, async stat() { return { type: 'file' }; }, async readBytes() { return new Uint8Array(0); } });
      stubCtx.provide('attachments', { imageLimits: { maxImageBytes: 1000, maxMessageImageBytes: 1000, maxImagesPerMessage: 1, maxImagePixels: 1000, mediaTypes: ['image/png'] }, async validateImage() {}, async saveImage(i) { return { attachmentId: 'a', mediaType: i.mediaType, bytes: 0, width: 1, height: 1 }; }, async readImage(r) { return { ref: r, data: new Uint8Array(0) }; } });
      stubCtx.provide('llm', {
        async resolveModelInfo(provider, model) { return { provider, model, inputModalities: [] }; },
        stream(options) {
          streams.push(options);
          return (async function* () {
            yield { type: 'block-start', index: 0, blockType: 'text' };
            yield { type: 'text-delta', index: 0, text: 'OK' };
            yield { type: 'block-end', index: 0, block: { type: 'text', text: 'OK' } };
            yield { type: 'finish', reason: { kind: 'stop' } };
          })();
        }
      });
    }
  });
  await ctx.plugin(AuxLlmService, { tasks: { vision: { provider: 'volcengine-ark', model: 'doubao-seed-2.0-lite' } } });
  await settle();
  const result = await ctx.auxLlm.call('vision', { messages: imageMessage(), session: makeSession() });
  assert.equal(result.model, 'doubao-seed-2.0-lite');
  assert.equal(streams.length, 1);
});

test('validateAuxSettings: 拒绝 provider/model 半配置', () => {
  assert.throws(
    () => validateAuxSettings({ tasks: { vision: { provider: 'opencode-go' } } }),
    /provider and model must be supplied together/
  );
  assert.throws(
    () => validateAuxSettings({ tasks: { compress: { model: 'glm-5.2' } } }),
    /provider and model must be supplied together/
  );
  // 成对或全空合法
  validateAuxSettings({});
  validateAuxSettings({ tasks: { vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' } } });
  validateAuxSettings({ fallbackToMain: false });
});

test('vision_analyze 工具: 本地图片路径经 attachments 服务分析', async () => {
  const { ctx, tools, streams } = await makeHarness({
    tasks: { vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' } }
  });
  const tool = tools.find((t) => t.name === 'vision_analyze');
  assert.ok(tool, 'vision_analyze 应已注册');
  const exec = {
    signal: new AbortController().signal,
    agent: { session: makeSession(), options: { provider: 'opencode-go', model: 'deepseek-v4-flash' } }
  };
  // 显式配置 vision 辅助模型(分享场景:配置了就走配置)
  const value = await tool.execute({ imagePath: '/tmp/test-image.png', question: '这是什么?' }, exec);
  assert.equal(typeof value.analysis, 'string');
  assert.equal(value.analysis, 'OUTPUT_TEXT');
  assert.equal(value.provider, 'opencode-go');
  assert.equal(value.model, 'kimi-k2.7-code'); // 显式配置的辅助模型
  // 送进 LLM 的消息必须含 image block
  const messages = streams[0].messages;
  const hasImage = messages[0].content.some((b) => b.type === 'image');
  assert.ok(hasImage, '消息应包含 image block');
});

test('vision_analyze 工具: 无 question(focus hint)时拒绝', async () => {
  const { ctx, tools, streams } = await makeHarness({
    tasks: { vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' } }
  });
  const tool = tools.find((t) => t.name === 'vision_analyze');
  const exec = {
    signal: new AbortController().signal,
    agent: { session: makeSession(), options: { provider: 'opencode-go', model: 'deepseek-v4-flash' } }
  };
  await assert.rejects(
    () => tool.execute({ imagePath: '/tmp/test-image.png' }, exec),
    /question|required/i
  );
  assert.equal(streams.length, 0, '不应发起 LLM 调用');
});

test('/aux status 命令: 输出各任务路由', async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'status' });
  assert.equal(out.kind, 'success');
  assert.match(out.text, /辅助模型系统状态/);
  for (const task of AUX_TASKS) assert.match(out.text, new RegExp(task));
  // 未显式配置时显示"(未配置 → 主模型)"——零硬编码默认值,分享友好
  assert.ok(out.text.includes('(未配置 → 主模型)'), '未配置任务应指向主模型');
});

test('/aux model 命令: 查看任务模型', async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'model compress' });
  assert.equal(out.kind, 'success');
  assert.ok(out.text.includes('辅助模型 [compress]'));
  assert.ok(out.text.includes('(未配置 → 主模型)'));
});

test('/aux model 命令: 未知任务报错', async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'model nope' });
  assert.equal(out.kind, 'error');
  assert.ok(out.text.includes('task'));
});

test('/aux model 命令: 非法格式报错', async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'model compress not-a-route' });
  assert.equal(out.kind, 'error');
  assert.ok(out.text.includes('provider'));
});

test('/aux status 命令: 显示最近调用(事件溯源)', async () => {
  const { commands, ctx } = await makeHarness();
  const handler = commands[0].handler;
  const session = makeSession();
  // 模拟一次成功与一次失败的辅助调用事件
  session.append(AUX_CALL_EVENT, { task: 'compress', provider: 'opencode-go', model: 'deepseek-v4-flash', ok: true, durationMs: 1234, fallbackUsed: false });
  session.append(AUX_CALL_EVENT, { task: 'vision', provider: 'opencode-go', model: 'kimi-k2.7-code', ok: false, durationMs: 56, errorCode: 'timeout', fallbackUsed: true });
  const agent = { session };
  const out = await handler({ agent, rawInput: 'status' });
  assert.equal(out.kind, 'success');
  assert.ok(out.text.includes('最近辅助调用'));
  assert.ok(out.text.includes('compress: opencode-go/deepseek-v4-flash 成功 1234ms'));
  assert.ok(out.text.includes('vision: opencode-go/kimi-k2.7-code 失败 (已降级) [timeout] 56ms'));
});

test('web_extract 工具: HTML 页面经清洗后送辅助模型,输出符合 schema', async () => {
  const { ctx, tools, streams } = await makeHarness();
  const tool = tools.find((t) => t.name === 'web_extract');
  assert.ok(tool);
  const exec = { signal: new AbortController().signal, agent: { session: makeSession(), options: { provider: 'opencode-go', model: 'deepseek-v4-flash' } } };
  const value = await tool.execute({ url: 'https://example.com/htmlpage', maxChars: 8000 }, exec);
  assert.equal(value.url, 'https://example.com/htmlpage');
  assert.equal(typeof value.summary, 'string');
  assert.ok(Array.isArray(value.keyPoints));
  assert.equal(value.provider, 'opencode-go');
  assert.equal(value.model, 'deepseek-v4-flash');
  // 送进 LLM 的消息必须不含 HTML 标签
  const messages = streams[0].messages;
  const userText = messages[0].content.find((b) => b.type === 'text').text;
  assert.ok(!userText.includes('<html>'));
  assert.ok(!userText.includes('<script>'));
  assert.ok(userText.includes('HTML 页面标题'));
  assert.ok(userText.includes('bold'));
  assert.ok(userText.includes('42'));
});

test('会话删除清理: 删除无引用附件,保留共享附件', async () => {
  const tmp = '/tmp/aux-sess-gc-' + process.pid;
  const objects = tmp + '/attachments/v1/objects/ab';
  await fsPromises.mkdir(objects, { recursive: true });
  const hashA = 'ab' + 'a'.repeat(62); // sha256:ab...a (64 hex)
  const hashB = 'ab' + 'b'.repeat(62);
  const fileA = objects + '/' + hashA;
  const fileB = objects + '/' + hashB;
  await fsPromises.writeFile(fileA, 'A');
  await fsPromises.writeFile(fileB, 'B');
  // 映射:会话 S1 拥有 A+B;会话 S2 也拥有 B(共享)
  const mapPath = tmp + '/attachments/v1/session-images.json';
  await fsPromises.writeFile(mapPath, JSON.stringify({
    'sess-1': ['sha256:' + hashA, 'sha256:' + hashB],
    'sess-2': ['sha256:' + hashB]
  }));
  const { ctx } = await makeHarness(); // 先建 harness(makeHarness 会设临时 DSH_HOME)
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    // 直接调用清理逻辑:删除会话 1 → A 无引用应删,B 被会话 2 引用应保留
    await ctx.auxLlm._cleanupSessionImages('sess-1');
    const remaining = await fsPromises.readdir(objects);
    assert.ok(!remaining.includes(hashA), '无引用的 A 应被删除');
    assert.ok(remaining.includes(hashB), '共享的 B 应保留');
    // 映射中会话 1 条目已移除,会话 2 保留
    const map = JSON.parse(await fsPromises.readFile(mapPath, 'utf8'));
    assert.equal(map['sess-1'], void 0);
    assert.ok(Array.isArray(map['sess-2']));
    // 再删除会话 2 → B 也应删
    await ctx.auxLlm._cleanupSessionImages('sess-2');
    const after = await fsPromises.readdir(objects);
    assert.ok(!after.includes(hashB), '最后引用的 B 应被删除');
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('/aux gc-images: 删除超过天数的附件并报告', async () => {
  // 临时 DSH_HOME 模拟附件目录
  const tmp = '/tmp/aux-gc-test-' + process.pid;
  const objects = tmp + '/attachments/v1/objects/ab';
  await fsPromises.mkdir(objects, { recursive: true });
  const oldFile = objects + '/oldhash';
  const newFile = objects + '/newhash';
  await fsPromises.writeFile(oldFile, 'x');
  await fsPromises.writeFile(newFile, 'y');
  const oldTime = Date.now() - 40 * 24 * 60 * 60 * 1000; // 40 days ago
  await fsPromises.utimes(oldFile, new Date(oldTime), new Date(oldTime));
  const { commands } = await makeHarness(); // 先建 harness(makeHarness 会设临时 DSH_HOME)
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const handler = commands[0].handler;
    const out = await handler({ agent: void 0, rawInput: 'gc-images 30' });
    assert.equal(out.kind, 'success');
    assert.ok(out.text.includes('删除 1 个'), '应删除 1 个旧文件: ' + out.text);
    // 新文件保留
    const remaining = await fsPromises.readdir(objects);
    assert.ok(remaining.includes('newhash'));
    assert.ok(!remaining.includes('oldhash'));
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('web_extract 工具: 抓取失败(HTTP 500)时报错', async () => {
  const { ctx, tools } = await makeHarness();
  const tool = tools.find((t) => t.name === 'web_extract');
  const exec = { signal: new AbortController().signal, agent: { session: makeSession(), options: { provider: 'opencode-go', model: 'deepseek-v4-flash' } } };
  await assert.rejects(() => tool.execute({ url: 'https://example.com/error' }, exec), /HTTP 500/);
});

test('web_extract 工具: 无 web provider 时回退全局 fetch 并清洗 HTML', async () => {
  // 独立 harness:web 服务抛"no usable web provider"
  const ctx = new Context();
  const streams = [];
  await ctx.plugin({
    name: 'no-web-provider-stubs',
    apply(stubCtx) {
      stubCtx.provide('tools', { register() { return () => {}; } });
      stubCtx.provide('settings', {});
      stubCtx.provide('web', {
        async fetch() { throw new Error('no usable web provider is registered'); }
      });
      stubCtx.provide('fs', { async resolve(p) { return { displayPath: p }; }, async stat() { return { type: 'file' }; }, async readBytes() { return new Uint8Array(0); } });
      stubCtx.provide('attachments', { imageLimits: { maxImageBytes: 1000, maxMessageImageBytes: 1000, maxImagesPerMessage: 1, maxImagePixels: 1000, mediaTypes: ['image/png'] }, async validateImage() {}, async saveImage(i) { return { attachmentId: 'a', mediaType: i.mediaType, bytes: 0, width: 1, height: 1 }; }, async readImage(r) { return { ref: r, data: new Uint8Array(0) }; } });
      stubCtx.provide('llm', {
        stream(options) {
          streams.push(options);
          return (async function* () {
            yield { type: 'block-start', index: 0, blockType: 'text' };
            yield { type: 'text-delta', index: 0, text: 'SUMMARY: 页面要点 42' };
            yield { type: 'block-end', index: 0, block: { type: 'text', text: 'SUMMARY: 页面要点 42' } };
            yield { type: 'finish', reason: { kind: 'stop' } };
          })();
        }
      });
    }
  });
  const fiber = ctx.plugin(AuxLlmService, {});
  await fiber;
  await settle();
  // 打桩全局 fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => ({
    ok: true,
    status: 200,
    url: String(url),
    headers: { get: () => 'text/html' },
    text: async () => '<html><body><h1>回退页面</h1><p>内容 with <b>bold</b> 42</p><script>var x=1</script></body></html>'
  });
  try {
    const svc = ctx.auxLlm;
    const exec = { signal: new AbortController().signal, agent: { session: makeSession(), options: { provider: 'opencode-go', model: 'deepseek-v4-flash' } } };
    const value = await svc._runWebExtract({ url: 'https://example.com/fallback', maxChars: 8000 }, exec);
    assert.equal(value.url, 'https://example.com/fallback');
    assert.ok(value.summary.includes('SUMMARY'));
    assert.equal(value.provider, 'opencode-go');
    assert.equal(value.model, 'deepseek-v4-flash');
    // 送进 LLM 的文本必须经 htmlToText 清洗
    const messages = streams[0].messages;
    const userText = messages[0].content.find((b) => b.type === 'text').text;
    assert.ok(!userText.includes('<html>'));
    assert.ok(!userText.includes('var x'));
    assert.ok(userText.includes('回退页面'));
    assert.ok(userText.includes('bold'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('/aux vision 命令: 分析本地图片并返回结果', async () => {
  // 主模型 text-only,显式配置支持图片的 vision 路由
  const { commands } = await makeHarness({
    tasks: { vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' } }
  });
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'vision /tmp/screenshot.png 这是什么颜色?' });
  assert.equal(out.kind, 'success');
  assert.ok(out.text.includes('[辅助视觉 kimi-k2.7-code]'), '应显示模型名: ' + out.text);
  assert.ok(out.text.includes('OUTPUT_TEXT'), '应包含辅助模型的分析文本: ' + out.text);
});

test('/aux vision 命令: 路由模型不支持图片时被能力门控拒绝', async () => {
  // 未配置 vision 路由 → 回退主模型 deepseek-v4-flash(text-only)→ 拒绝
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'vision /tmp/screenshot.png 这是什么颜色?' });
  assert.equal(out.kind, 'error');
  assert.ok(out.text.includes('vision_analyze 失败'), out.text);
  assert.ok(out.text.includes('does not declare image input'), out.text);
});

test('/aux vision 命令: 缺少路径或问题时报用法错误', async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const noArgs = await handler({ agent: void 0, rawInput: 'vision' });
  assert.equal(noArgs.kind, 'error');
  assert.ok(noArgs.text.includes('/aux vision <imagePath> <question...>'));
  const noQuestion = await handler({ agent: void 0, rawInput: 'vision /tmp/x.png' });
  assert.equal(noQuestion.kind, 'error');
  assert.ok(noQuestion.text.includes('/aux vision <imagePath> <question...>'));
});

test('/aux vision 命令: 非图片扩展名报错', async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'vision /tmp/doc.txt 内容是什么?' });
  assert.equal(out.kind, 'error');
  assert.ok(out.text.includes('vision_analyze 失败'), '应回显失败: ' + out.text);
  assert.ok(out.text.includes('.png/.jpg/.jpeg/.webp/.gif'));
});

test('/aux test compress: 自检通过并报告压缩比例', async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'test compress' });
  assert.equal(out.kind, 'success');
  assert.ok(out.text.includes('自检通过'), out.text);
  assert.ok(out.text.includes('压缩成功'), out.text);
});

test('/aux test web_extract: 自检通过并报告摘要', async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'test web_extract' });
  assert.equal(out.kind, 'success');
  assert.ok(out.text.includes('自检通过'), out.text);
  assert.ok(out.text.includes('抓取成功'), out.text);
});

test('/aux test vision: 提示改用 /aux vision 验证', async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'test vision' });
  assert.equal(out.kind, 'error');
  assert.ok(out.text.includes('/aux vision <imagePath> <question>'));
});

test('/aux test 未知任务: 报错并列出可用任务', async () => {
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const out = await handler({ agent: void 0, rawInput: 'test nope' });
  assert.equal(out.kind, 'error');
  assert.ok(out.text.includes('task'));
});

test('/aux memory: 空日志提示未分析过图片', async () => {
  const tmp = '/tmp/aux-memory-empty-' + process.pid;
  await fsPromises.mkdir(tmp + '/attachments/v1', { recursive: true });
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const { commands } = await makeHarness();
    const handler = commands[0].handler;
    const out = await handler({ agent: void 0, rawInput: 'memory' });
    assert.equal(out.kind, 'success');
    assert.ok(out.text.includes('图片记忆为空'));
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('/aux memory: 列出最近图片分析记录,支持条数限制', async () => {
  const tmp = '/tmp/aux-memory-' + process.pid;
  const v1 = tmp + '/attachments/v1';
  await fsPromises.mkdir(v1, { recursive: true });
  const journal = {
    entries: [
      { sessionId: 's1', attachmentId: 'sha256:' + 'a'.repeat(64), question: '第一张图是什么?', summary: '一张截图', at: Date.now() - 1000 },
      { sessionId: 's2', attachmentId: 'sha256:' + 'b'.repeat(64), question: '第二张图什么颜色?', summary: '蓝色', at: Date.now() }
    ]
  };
  await fsPromises.writeFile(v1 + '/image-memory.json', JSON.stringify(journal));
  const { commands } = await makeHarness(); // 先建 harness(makeHarness 会设临时 DSH_HOME)
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const handler = commands[0].handler;
    const out = await handler({ agent: void 0, rawInput: 'memory' });
    assert.equal(out.kind, 'success');
    assert.ok(out.text.includes('最近图片分析记忆'), out.text);
    assert.ok(out.text.includes('第二张图什么颜色?'), '最新条目在前: ' + out.text);
    assert.ok(out.text.includes('第一张图是什么?'), out.text);
    // 限制条数:只看最新 1 条
    const limited = await handler({ agent: void 0, rawInput: 'memory 1' });
    assert.equal(limited.kind, 'success');
    assert.ok(limited.text.includes('第二张图什么颜色?'));
    assert.ok(!limited.text.includes('第一张图是什么?'));
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('/aux memory: 记录路径越界(无 DSH_HOME)时报错', async () => {
  // 先建 harness(makeHarness 会设 DSH_HOME),再在命令执行前清掉
  const { commands } = await makeHarness();
  const handler = commands[0].handler;
  const prevHome = process.env.DSH_HOME;
  delete process.env.DSH_HOME;
  const prevUserHome = process.env.HOME;
  delete process.env.HOME;
  try {
    const out = await handler({ agent: void 0, rawInput: 'memory' });
    assert.equal(out.kind, 'error');
    assert.ok(out.text.includes('DSH_HOME'));
  } finally {
    if (prevHome === void 0) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
    if (prevUserHome === void 0) delete process.env.HOME; else process.env.HOME = prevUserHome;
  }
});


test('对账: 已不存在的会话(冷删除)图片被清理,现存会话保留', async () => {
  const tmp = '/tmp/aux-reconcile-' + process.pid;
  const objects = tmp + '/attachments/v1/objects/ab';
  await fsPromises.mkdir(objects, { recursive: true });
  const hashX = 'ab' + 'c'.repeat(62);
  const hashY = 'ab' + 'd'.repeat(62);
  await fsPromises.writeFile(objects + '/' + hashX, 'X');
  await fsPromises.writeFile(objects + '/' + hashY, 'Y');
  const mapPath = tmp + '/attachments/v1/session-images.json';
  await fsPromises.writeFile(mapPath, JSON.stringify({
    'sess-dead': ['sha256:' + hashX],
    'sess-live': ['sha256:' + hashY]
  }));
  const { ctx } = await makeHarness(); // 先建 harness(makeHarness 会设临时 DSH_HOME)
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    // 增强 stub:内存中只有 sess-live(模拟现存会话),sessionPersistence 返回空
    ctx.provide('sessions', {
      list() { return [{ id: 'sess-live' }]; }
    });
    ctx.provide('sessionPersistence', {
      async listSnapshots() { return [{ header: { id: 'sess-live' } }]; }
    });
    await ctx.auxLlm._reconcileSessionImages();
    const remaining = await fsPromises.readdir(objects);
    assert.ok(!remaining.includes(hashX), '已删除会话的图片应被清理');
    assert.ok(remaining.includes(hashY), '现存会话的图片应保留');
    const map = JSON.parse(await fsPromises.readFile(mapPath, 'utf8'));
    assert.equal(map['sess-dead'], void 0, '映射中死会话条目应移除');
    assert.ok(Array.isArray(map['sess-live']));
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('对账: 空映射快速返回,不触碰文件系统', async () => {
  const tmp = '/tmp/aux-reconcile-empty-' + process.pid;
  await fsPromises.mkdir(tmp + '/attachments/v1', { recursive: true });
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const { ctx } = await makeHarness();
    // 无 session-images.json → 空映射
    await ctx.auxLlm._reconcileSessionImages(); // 不应抛错
    const map = JSON.parse(await fsPromises.readFile(tmp + '/attachments/v1/session-images.json').catch(() => '{}'));
    assert.ok(map);
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('对账: 归档会话不误删(仍在持久化列表)', async () => {
  const tmp = '/tmp/aux-reconcile-archive-' + process.pid;
  const objects = tmp + '/attachments/v1/objects/ab';
  await fsPromises.mkdir(objects, { recursive: true });
  const hashA = 'ab' + 'a'.repeat(62);
  await fsPromises.writeFile(objects + '/' + hashA, 'A');
  await fsPromises.writeFile(tmp + '/attachments/v1/session-images.json', JSON.stringify({
    'sess-archived': ['sha256:' + hashA]
  }));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const { ctx } = await makeHarness();
    ctx.provide('sessionPersistence', {
      async listSnapshots() { return [{ header: { id: 'sess-archived' } }]; }
    });
    await ctx.auxLlm._reconcileSessionImages();
    const remaining = await fsPromises.readdir(objects);
    assert.ok(remaining.includes(hashA), '归档(持久化)会话的图片应保留');
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});


test('归属缓存: 重启后(内存空)新增归属不覆盖磁盘旧记录', async () => {
  const tmp = '/tmp/aux-cache-seed-' + process.pid;
  await fsPromises.mkdir(tmp + '/attachments/v1', { recursive: true });
  // 磁盘上已有旧会话的归属记录(模拟上次进程写入)
  await fsPromises.writeFile(tmp + '/attachments/v1/session-images.json', JSON.stringify({
    'sess-old': ['sha256:' + 'ab' + 'a'.repeat(62)]
  }));
  const { ctx } = await makeHarness(); // 先建 harness(makeHarness 会设临时 DSH_HOME)
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    // 新进程:内存缓存为空,新增一个归属(触发 debounce 写盘)
    await ctx.auxLlm._recordAttachmentOwnership('sess-new', 'att-image/png');
    await new Promise((r) => setTimeout(r, 50)); // 等 debounce
    const map = JSON.parse(await fsPromises.readFile(tmp + '/attachments/v1/session-images.json', 'utf8'));
    assert.ok(Array.isArray(map['sess-old']), '磁盘旧记录必须保留: ' + JSON.stringify(map));
    assert.ok(Array.isArray(map['sess-new']), '新记录应写入: ' + JSON.stringify(map));
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});

test('归属缓存: 清理会话后内存缓存同步删除,写盘不复活', async () => {
  const tmp = '/tmp/aux-cache-clean-' + process.pid;
  const objects = tmp + '/attachments/v1/objects/ab';
  await fsPromises.mkdir(objects, { recursive: true });
  const hashA = 'ab' + 'e'.repeat(62);
  await fsPromises.writeFile(objects + '/' + hashA, 'A');
  await fsPromises.writeFile(tmp + '/attachments/v1/session-images.json', JSON.stringify({
    'sess-1': ['sha256:' + hashA]
  }));
  const { ctx } = await makeHarness();
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    // 先让内存缓存种入磁盘记录
    await ctx.auxLlm._ensureSessionImagesLoaded();
    // 模拟删除会话触发的清理
    await ctx.auxLlm._cleanupSessionImages('sess-1');
    // 再触发一次写盘(内存缓存若残留 sess-1 会复活)
    await ctx.auxLlm._recordAttachmentOwnership('sess-2', 'att-image/png');
    await new Promise((r) => setTimeout(r, 50));
    const map = JSON.parse(await fsPromises.readFile(tmp + '/attachments/v1/session-images.json', 'utf8'));
    assert.equal(map['sess-1'], void 0, '清理后写盘不得复活 sess-1: ' + JSON.stringify(map));
    assert.ok(Array.isArray(map['sess-2']));
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});


test('/aux gc-images: 跳过符号链接,绝不跟随到外部目录', async () => {
  const tmp = '/tmp/aux-gc-symlink-' + process.pid;
  const objects = tmp + '/attachments/v1/objects';
  await fsPromises.mkdir(objects + '/ab', { recursive: true });
  // 外部"受害"文件(模拟 WSL 外用户图片)
  const victimDir = tmp + '/victim';
  await fsPromises.mkdir(victimDir, { recursive: true });
  const victim = victimDir + '/precious.jpg';
  await fsPromises.writeFile(victim, 'precious');
  const oldTime = Date.now() - 40 * 24 * 60 * 60 * 1000;
  await fsPromises.utimes(victim, new Date(oldTime), new Date(oldTime));
  // objects 下的符号链接:目录链接 + 文件链接
  await fsPromises.symlink(victimDir, objects + '/evil-dir', 'dir');
  await fsPromises.symlink(victim, objects + '/ab/evil-file.jpg', 'file');
  const { commands } = await makeHarness(); // 先建 harness(makeHarness 会设临时 DSH_HOME)
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    const handler = commands[0].handler;
    const out = await handler({ agent: void 0, rawInput: 'gc-images 30' });
    assert.equal(out.kind, 'success', out.text);
    // 受害文件必须原封不动
    const still = await fsPromises.readFile(victim, 'utf8');
    assert.equal(still, 'precious', '符号链接指向的外部文件不得被删除');
    // 符号链接本身也应保留(未扫描)
    await fsPromises.lstat(objects + '/evil-dir');
    await fsPromises.lstat(objects + '/ab/evil-file.jpg');
  } finally {
    process.env.DSH_HOME = prevHome;
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
});


test('image-bridge 状态: 源码树运行(无核心包)时返回 unknown', async () => {
  const { ctx } = await makeHarness();
  // 测试环境从源码树加载,../dsh-host-apiproxy 不存在 → unknown
  const status = await ctx.auxLlm._imageBridgeStatus();
  assert.equal(status, 'unknown');
});


test('vision_analyze 工具: images 数组并行分析多图,输出 analyses', async () => {
  const { ctx, tools, streams } = await makeHarness({
    tasks: { vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' } }
  });
  const tool = tools.find((t) => t.name === 'vision_analyze');
  const exec = {
    signal: new AbortController().signal,
    agent: { session: makeSession(), options: { provider: 'opencode-go', model: 'deepseek-v4-flash' } }
  };
  const value = await tool.execute({
    images: [
      { imagePath: '/tmp/a.png' },
      { imagePath: '/tmp/b.png' },
      { imagePath: '/tmp/c.png' }
    ],
    question: '每张图的主色调是什么?'
  }, exec);
  assert.ok(Array.isArray(value.analyses), '多图应返回 analyses 数组');
  assert.equal(value.analyses.length, 3);
  for (const a of value.analyses) {
    assert.equal(a.analysis, 'OUTPUT_TEXT');
    assert.equal(a.provider, 'opencode-go');
    assert.equal(a.model, 'kimi-k2.7-code');
  }
  assert.equal(streams.length, 3, '应发起 3 次辅助调用');
});

test('vision_analyze 工具: images 与单图参数互斥,条目必须恰有一个来源', async () => {
  const { ctx, tools } = await makeHarness({
    tasks: { vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' } }
  });
  const tool = tools.find((t) => t.name === 'vision_analyze');
  const exec = { signal: new AbortController().signal, agent: { session: makeSession() } };
  await assert.rejects(
    () => tool.execute({ images: [{ imagePath: '/tmp/a.png' }], imagePath: '/tmp/b.png', question: 'q' }, exec),
    /either the images array or a single image source/
  );
  await assert.rejects(
    () => tool.execute({ images: [{ imagePath: '/tmp/a.png', imageUrl: 'https://x/y.png' }], question: 'q' }, exec),
    /exactly one of attachmentId, imagePath, or imageUrl/
  );
  await assert.rejects(
    () => tool.execute({ images: [{ nope: 1 }], question: 'q' }, exec),
    /exactly one of/
  );
});

test('vision_analyze 工具: 多图时 question 仍必填', async () => {
  const { ctx, tools, streams } = await makeHarness({
    tasks: { vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' } }
  });
  const tool = tools.find((t) => t.name === 'vision_analyze');
  const exec = { signal: new AbortController().signal, agent: { session: makeSession() } };
  await assert.rejects(
    () => tool.execute({ images: [{ imagePath: '/tmp/a.png' }] }, exec),
    /question/i // schema 层或执行层都会因缺 question 拒绝
  );
  assert.equal(streams.length, 0, '不应发起辅助调用');
});

