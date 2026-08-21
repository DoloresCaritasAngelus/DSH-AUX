import test from 'node:test'
import assert from 'node:assert/strict'
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
