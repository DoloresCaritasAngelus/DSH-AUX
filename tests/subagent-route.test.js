import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  detectNeedsVision,
  resolveSubagentRoute,
  AUX_SUBAGENT_TOOL_NAMES
} from '../dsh-aux/src/subagent-route.js'

const nativeSettings = { mode: 'native' }
const manualSettings = {
  mode: 'manual',
  general: { provider: 'opencode-go', model: 'glm-5.2' },
  vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' }
}
const visionAwareSettings = {
  mode: 'vision-aware',
  general: { provider: 'opencode-go', model: 'glm-5.2' },
  vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' }
}

test('native 模式:settled=false,不注入任何路由', () => {
  const r = resolveSubagentRoute(nativeSettings, { prompt: '看图并总结' })
  assert.equal(r.settled, false)
  assert.equal(r.agentOptions, void 0)
})

test('manual 模式:统一使用 general', () => {
  const r = resolveSubagentRoute(manualSettings, { prompt: '写个脚本' })
  assert.equal(r.settled, true)
  assert.deepEqual(r.agentOptions, { provider: 'opencode-go', model: 'glm-5.2' })
})

test('manual 模式: general.reasoningEffort 透传到 agentOptions', () => {
  const r = resolveSubagentRoute(
    { mode: 'manual', general: { provider: 'opencode-go', model: 'glm-5.2', reasoningEffort: 'high' }, vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' } },
    { prompt: '写个脚本' }
  )
  assert.equal(r.settled, true)
  assert.deepEqual(r.agentOptions, { provider: 'opencode-go', model: 'glm-5.2', reasoningEffort: 'high' })
})

test('vision-aware + 显式 true → vision', () => {
  const r = resolveSubagentRoute(visionAwareSettings, { prompt: '随便', requiresVision: true })
  assert.equal(r.settled, true)
  assert.deepEqual(r.agentOptions, { provider: 'opencode-go', model: 'kimi-k2.7-code' })
})

test('vision-aware + vision.reasoningEffort 透传到 agentOptions', () => {
  const r = resolveSubagentRoute(
    { mode: 'vision-aware', general: { provider: 'opencode-go', model: 'glm-5.2' }, vision: { provider: 'opencode-go', model: 'kimi-k2.7-code', reasoningEffort: 'high' } },
    { prompt: '随便', requiresVision: true }
  )
  assert.equal(r.settled, true)
  assert.deepEqual(r.agentOptions, { provider: 'opencode-go', model: 'kimi-k2.7-code', reasoningEffort: 'high' })
})

test('vision-aware + 显式 false → general', () => {
  const r = resolveSubagentRoute(visionAwareSettings, { prompt: '看图用文字描述', requiresVision: false })
  assert.equal(r.settled, true)
  assert.deepEqual(r.agentOptions, { provider: 'opencode-go', model: 'glm-5.2' })
})

test('vision-aware + auto + 关键词 → vision', () => {
  const r = resolveSubagentRoute(visionAwareSettings, { prompt: '请描述这张图片 imagePath=/tmp/a.png', requiresVision: 'auto' })
  assert.equal(r.settled, true)
  assert.deepEqual(r.agentOptions, { provider: 'opencode-go', model: 'kimi-k2.7-code' })
})

test('vision-aware + auto + 无关键词 → general', () => {
  const r = resolveSubagentRoute(visionAwareSettings, { prompt: '写一段 Python 冒泡排序', requiresVision: 'auto' })
  assert.equal(r.settled, true)
  assert.deepEqual(r.agentOptions, { provider: 'opencode-go', model: 'glm-5.2' })
})

test('vision-aware 未配置 vision → native 兜底', () => {
  const r = resolveSubagentRoute({ mode: 'vision-aware', general: { provider: 'p', model: 'm' } }, { prompt: '看图', requiresVision: true })
  assert.equal(r.settled, false)
})

test('prepareTools 默认注入 AUX 工具到 allow', () => {
  const r = resolveSubagentRoute(manualSettings, { prompt: 'x', existingAllow: ['bash'] })
  assert.deepEqual([...r.toolFilter.allow].sort(), [...new Set(['bash', ...AUX_SUBAGENT_TOOL_NAMES])].sort())
  assert.equal(r.toolFilter.deny, void 0)
})

test('prepareTools=false 不注入 AUX 工具', () => {
  const r = resolveSubagentRoute({ ...manualSettings, prepareTools: false }, { prompt: 'x', existingAllow: ['bash'] })
  assert.deepEqual(r.toolFilter.allow, ['bash'])
})

test('existingDeny 保留', () => {
  const r = resolveSubagentRoute(manualSettings, { prompt: 'x', existingDeny: ['evil_tool'] })
  assert.deepEqual(r.toolFilter.deny, ['evil_tool'])
})

test('detectNeedsVision 关键词与大小写不敏感', () => {
  assert.equal(detectNeedsVision('ImagePath 识别'), true)
  assert.equal(detectNeedsVision('写代码'), false)
  assert.equal(detectNeedsVision('', ['image']), false)
})

test('未知 mode → settled=false (native 兜底)', () => {
  const r = resolveSubagentRoute({ mode: 'foo', general: { provider: 'p', model: 'm' } }, { prompt: 'x' })
  assert.equal(r.settled, false)
})

test('manual 缺少 general → settled=false', () => {
  const r = resolveSubagentRoute({ mode: 'manual' }, { prompt: 'x' })
  assert.equal(r.settled, false)
})

test('vision-aware 缺少 general(且不需要视觉)→ settled=false', () => {
  const r = resolveSubagentRoute({ mode: 'vision-aware', vision: { provider: 'v', model: 'vm' } }, { prompt: '写代码', requiresVision: 'auto' })
  assert.equal(r.settled, false)
})

test('vision-aware 自定义 visionKeywords 生效', () => {
  const r = resolveSubagentRoute(
    { mode: 'vision-aware', vision: { provider: 'opencode-go', model: 'kimi-k2.7-code' }, general: { provider: 'opencode-go', model: 'glm-5.2' }, visionKeywords: ['看图', 'screenshot'] },
    { prompt: 'screenshot 分析这个画面', requiresVision: 'auto' }
  )
  assert.equal(r.needsVision, true)
  assert.deepEqual(r.agentOptions, { provider: 'opencode-go', model: 'kimi-k2.7-code' })
})

test('manual 模式下显式 requiresVision 不改变目标(general)', () => {
  const r = resolveSubagentRoute(manualSettings, { prompt: '看图', requiresVision: true })
  assert.equal(r.settled, true)
  assert.deepEqual(r.agentOptions, { provider: 'opencode-go', model: 'glm-5.2' })
  assert.equal(r.needsVision, false)
})

test('prepareTools=false 且无 existingAllow/Deny → 不产生 toolFilter', () => {
  const r = resolveSubagentRoute({ ...manualSettings, prepareTools: false }, { prompt: 'x' })
  assert.equal(r.toolFilter, void 0)
  assert.equal(r.settled, true)
})

test('prepareTools=true 但无 existingAllow → 不产生 toolFilter(不限制子代理工具目录)', () => {
  // toolFilter.allow 是白名单,若我们无中生有加 allow 会过滤掉 bash/read,
  // 破坏 Anchored/Standard bootstrap。无既有 allow 时必须保持目录开放。
  const r = resolveSubagentRoute(manualSettings, { prompt: 'x' })
  assert.equal(r.settled, true)
  assert.equal(r.toolFilter, void 0)
})

test('返回对象带 needsVision 字段(命中为 true)', () => {
  const r = resolveSubagentRoute(visionAwareSettings, { prompt: '描述图片', requiresVision: 'auto' })
  assert.equal(r.needsVision, true)
})

test('includeWorkflow 不进入纯函数(仅 workflow 调用点门控,保护 subagent 工具路径)', () => {
  const r = resolveSubagentRoute({ ...manualSettings, includeWorkflow: false }, { prompt: 'x' })
  assert.equal(r.settled, true)
  assert.deepEqual(r.agentOptions, { provider: 'opencode-go', model: 'glm-5.2' })
})

test('/aux patch --json: handlePatchCommand 返回结构化步骤(stub execFileAsync)', async () => {
  // handlePatchCommand 在每次调用时才 promisify(childProcess.execFile),
  // 因此无论 commands.js 是否已被其他测试文件导入,这里替换 cp.execFile 都能生效。
  // 这比“先删测试掩盖问题”更稳:保留对真实 JSON 结构的回归覆盖。
  const require = createRequire(import.meta.url)
  const cp = require('node:child_process')
  const originalExecFile = cp.execFile
  const calls = []
  cp.execFile = (file, args, options, callback) => {
    calls.push({ file, args, options })
    if (args[0] === 'bridge/apply-patch.mjs') {
      callback(null, { stdout: 'apply output\n', stderr: '' })
    } else if (args[0] === 'bridge/self-heal.mjs') {
      callback(null, { stdout: 'self-heal output\n', stderr: '' })
    } else {
      callback(new Error('unexpected script: ' + args[0]))
    }
  }
  try {
    const { handlePatchCommand } = await import('../dsh-aux/src/commands.js')
    const result = await handlePatchCommand(void 0, true)
    assert.equal(result.kind, 'success')
    const data = JSON.parse(result.text)
    assert.equal(typeof data.ok, 'boolean')
    assert.equal(data.restartRequired, false)
    assert.ok(Array.isArray(data.steps), '应返回 steps 数组')
    assert.equal(data.steps.length, 2)
    assert.deepEqual(data.steps.map((s) => s.name), ['apply-patch', 'self-heal'])
    assert.ok(data.steps.every((s) => s.ok === true && typeof s.output === 'string'))
    assert.deepEqual(data.remaining, [])
    assert.equal(calls.length, 2)
    assert.ok(calls.every((c) => c.args[0].endsWith('.mjs')))
    // handlePatchCommand 应把真实 DSH 根传给子进程,避免误打仓库内旧测试依赖。
    assert.ok(calls.every((c) => c.options && c.options.cwd && typeof c.options.cwd === 'string'))
    assert.ok(calls.every((c) => c.options && c.options.env && typeof c.options.env.DSH_ROOT === 'string'))
  } finally {
    cp.execFile = originalExecFile
  }
})
