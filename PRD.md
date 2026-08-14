# PRD: dsh-aux — 辅助模型系统(参考 Hermes Agent,零历史包袱重做)

> 状态: **已交付并端到端验证**(M1 + M2 完成;60 项测试全过;2026-08-14 实测:host 插件激活、/aux 命令可用、三工具注册、vision_analyze 分析真实图片成功、web_extract/compress_text 真实调用成功、配置持久化生效;2026-08-15 新增 /aux vision|test|memory 命令与图片记忆日志、会话删除附件清理(事件驱动 + 冷会话定时对账),配套社区插件 dsh-plugin-session-delete 提供删除入口,已实测删除热会话/冷会话清理链路;配套 image-bridge 补丁解决纯文本模型粘贴图片被拒问题,全链路闭环;实现说明见 README.md)
> 参考: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
> 需求来源: 用户与实现者(本会话)研究 Hermes 源码后的完整设计
> 目标读者: 实现者

---

## 1. 背景

用户希望构建一个**辅助模型系统**,给主 agent 使用:在**不建立子智能体、不做会话协同**的前提下,一些**辅助任务**由独立的辅助 LLM 完成——视觉分析、网页提取/摘要、长文本压缩。参考 Hermes Agent 的辅助模型机制,但 Hermes 是 1 万+ 行 Python 史山(多 provider 认证矩阵、OpenRouter/Nous/Anthropic/Codex 五层 fallback 链、OAuth 刷新、代理环境探测……),我们**没有这些历史包袱**,且 DSH 平台已提供干净得多的基座:

- `ctx.llm.stream()`:统一的 provider 无关 LLM 调用(消息、image block、tools、signal、超时全支持),provider 已在 settings.yaml 配好(火山 Coding Plan / OpenCode Go)
- `ctx.web.fetch()`:统一的网页抓取(HTML/text 解码、状态码、截断)
- `ctx.attachmentStore.readImage()`:持久化图像读取
- `ctx.tools.register(defineTool(...))`:工具注册给主 agent
- `installSettingsSection` + settings namespace:配置面
- 会话事件溯源 + projection:状态持久化与 UI 可观测

**目标(一句话)**:一个 DSH 插件包,提供统一辅助 LLM 路由服务(`ctx.auxLlm`)和三个辅助任务工具(`vision_analyze` / `web_extract` / `compress_text`),每任务可独立配置模型与超时,失败自动降级到主模型,完整管理 UI。

## 2. 目标

1. 统一辅助 LLM 调用入口,任务分派(类比 Hermes `call_llm(task=...)`)
2. 三任务落地:vision(图像分析)、web_extract(网页抓取+摘要)、compress(长文本压缩)
3. 路由策略:每任务独立模型(默认)→ 失败降级主模型(可配置)
4. 健壮性:per-task 超时、并发上限、失败冷却(不健康 provider TTL)、事件记录
5. 完整管理 UI:设置页(每任务配置)+ 会话内调用状态可见

## 3. 非目标

- 不做子智能体、不做会话协同(用户明确排除)
- 不做多 provider 认证矩阵(Hermes 的屎山;DSH 的 LlmRuntime 已解决)
- 不做全自动会话压缩/会话历史改写(只做工具级 `compress_text`,主 agent 主动调用;侵入 agent 循环的风险工作留待后续)
- 不做记忆/技能/多平台网关(Hermes 的其他功能域,不在本系统范围)
- 不改写模型可见输出(压缩结果是新文本,不是对会话历史的篡改)

## 4. 功能设计

### 4.1 统一服务 `ctx.auxLlm`

```ts
interface AuxLlm {
  /** 执行一次辅助 LLM 调用。 */
  call(task: AuxTask, request: AuxLlmRequest): Promise<AuxLlmResult>;
  /** 注册自定义辅助任务(供其他插件扩展)。 */
  registerTask(task: AuxTaskDefinition): void;
  /** 当前各任务的路由状态(给 UI/命令)。 */
  describe(): AuxTaskStatus[];
}

interface AuxLlmRequest {
  messages: Message[];        // DSH 消息(可含 image block)
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  session?: Session;          // 记录事件的会话
  purpose?: string;           // 附加语义标签
}
```

路由解析顺序(per-task,仿 Hermes 但大幅简化):

1. **任务显式配置**:`aux.tasks.<task>.provider + model`(settings 或插件 config)
2. **默认辅助模型**:未配置时用每任务的默认模型路由(见 4.3)
3. **降级主模型**:显式配置或默认辅助模型调用失败(超时/限流/连接/认证/402)→ 用当前会话主模型重试一次
4. **全部失败**:抛出聚合错误(含每一跳的原因)

### 4.2 任务定义

```ts
interface AuxTaskDefinition {
  key: string;                 // "vision" | "web_extract" | "compress"
  label: string;               // UI 显示名
  defaultModel?: () => Route | undefined;   // 默认辅助模型(可读配置)
  fallbackToMain: boolean;     // 失败时是否降级主模型(默认 true)
  timeoutMs: number;           // 默认超时
  maxConcurrency: number;      // 并发上限(默认 2)
  maxInputChars?: number;      // 输入上限保护
}
```

### 4.3 默认辅助模型路由

用户环境有两个 provider,默认辅助模型策略(可被 settings 覆盖):

| 任务 | 默认辅助模型 | 理由 |
|---|---|---|
| vision | `opencode-go / kimi-k2.7-code`(具备视觉能力,按需确认)或显式配置 | 视觉任务需多模态 |
| web_extract | 显式配置或主模型 | 摘要质量优先 |
| compress | 显式配置或主模型 | 压缩质量优先 |

> 实现时以 `agent-default-model` 的当前主模型作为兜底;`aux.tasks.<task>.provider/model` 显式配置优先。默认值可在 settings 页面调整。

### 4.4 三个工具(注册给主 agent)

**1. `vision_analyze` — 图像分析**

```
参数: attachmentId?: string(会话附件) | imagePath?: string(工作区图片文件) | imageUrl?: string
      question?: string(可选,针对图片的问题)
输出: { analysis: string, model: string, provider: string }
```

- 图片来源:附件(经 `attachmentStore.readImage`)、本地路径(读文件+校验媒体类型)、URL(下载+校验)
- 构造含 `image` block 的 user message,调用 `auxLlm.call("vision", ...)`
- 校验图片大小/像素上限(复用 `attachmentStore.imageLimits`)

**2. `web_extract` — 网页提取与摘要**

```
参数: url: string
      question?: string(可选,针对页面的问题)
      maxChars?: number(抓取文本截断上限,默认 8000)
输出: { url, title?, summary, keyPoints?: string[], model, provider }
```

- `ctx.web.fetch({ url })` 抓取 → 提取 text(html kind 需转 markdown/文本,参考 dsh-tool-web 的渲染逻辑)
- 辅助 LLM 摘要(`auxLlm.call("web_extract", ...)`)
- 页面正文过大时先截断再送模型

**3. `compress_text` — 长文本压缩**

```
参数: text: string(要压缩的文本)
      instruction?: string(压缩要求,如"保留所有数字与文件路径")
      targetRatio?: number(目标压缩比,默认 0.2,范围 0.05-0.5)
输出: { compressed: string, originalChars, compressedChars, ratio, model, provider }
```

- 辅助 LLM 压缩,输出带统计信息
- 不改写任何会话历史——纯工具,主 agent 决定如何使用结果

### 4.5 健壮性

| 机制 | 实现 |
|---|---|
| per-task 超时 | `deadline(signal, timeoutMs)`(复用 dsh-timeout) |
| per-task 并发 | 信号量,`maxConcurrency`(默认 2) |
| 失败冷却 | 某 provider+model 连续失败 3 次 → 冷却 60s,期间直接走降级路径 |
| 降级主模型 | 辅助路由失败 → 读会话主模型(`agent/model-selection` 或 `agent-default-model`)重试一次 |
| 输入上限 | `maxInputChars` 保护,超限报错而非盲目截断 |
| 错误分类 | 超时/限流/连接/认证/402/模型不存在,各自处理(402/限流→直接降级,超时→重试一次再降级) |

### 4.6 事件记录与投影(可观测)

- 每次辅助调用写会话事件 `aux/llm-call`:
  ```ts
  { task, provider, model, purpose?, ok, durationMs, errorCode?, fallbackUsed, inputChars?, outputChars? }
  ```
- 注册投影 `aux-status`:最近一次各任务的调用结果快照(供 UI/composer 显示)
- 事件溯源:重启/恢复会话后状态保持,可回放审计

### 4.7 管理 UI(client 插件)

1. **设置页** `settings.section`(id `aux`):每任务 provider/model 下拉(从 `ctx.llm.providers()` 目录读)、timeout、并发数;全局开关"允许降级主模型"
2. **会话状态显示**(composer 或消息区):可选的最近辅助调用指示(任务、模型、耗时、成败)——经 `aux-status` 投影

### 4.8 命令

- `/aux status`:当前各任务路由状态与最近调用
- `/aux model <task> [provider/model]`:查看/设置某任务的模型
- (可选)`/aux test <task>`:跑一次自检调用

## 5. 技术方案(挂载点,已对照 DSH 源码验证)

### 5.1 host 插件(Service)

- `class AuxLlmService extends Service`,`super(ctx, "auxLlm")`,静态注入 `["llm", "tools", "settings", "web", "attachmentStore"]`
- settings namespace:`settingsNamespace("aux")`,schema:
  ```ts
  z.object({
    fallbackToMain: z.boolean().default(true),
    tasks: z.object({
      vision: taskSchema, webExtract: taskSchema, compress: taskSchema
    })
  })
  // taskSchema = { provider?: string, model?: string, timeoutMs?: number, maxConcurrency?: number }
  ```
- `installSettingsSection(ctx, ns, schema, entry, hooks)` 注册配置面(参考 `dsh-agent-default-model`)
- 工具注册:`ctx.tools.register(defineTool({...}))`(参考 `dsh-tool-web`)
- 事件:`session.append("aux/llm-call", data)` + `sessionProjections.register({ key: "aux-status", ... })`(参考 thinking-zh)
- 命令:`commands.register({ name: "aux", ... })`(参考 `/thinking`)

### 5.2 工具执行上下文

`defineTool` 的 `execute(args, exec)`:`exec` 携带 signal 与执行身份;从 `exec` 或其关联取当前会话(需确认 `ToolRunContext` 是否暴露 session;若不暴露,经 `ctx.get("agent")` 的当前 agent 取)。实现时验证。

### 5.3 主模型读取

优先 `agent-default-model` 的 `currentSelection()`(已实现);若会话有显式模型选择,经 `installModelSelection` 的 `ModelSelectionRef` 读当前值(实现时验证)。

### 5.4 client 插件

- `dsh.client` roster 声明(参考 thinking-zh 的 package.json `dsh.client` 块)
- 设置页:`ctx.slots.register("settings.section", {...})`(参考 `dsh-client-ui-settings-general` 的注册与 `settings.describe` 读取)
- 状态:`useProjection("aux-status")`(参考 thinking-zh chip)

### 5.5 测试

`node:test` 零依赖(参考 thinking-zh tests):
- 路由解析:显式配置 > 默认 > 主模型
- 降级:辅助模型失败 → 主模型重试 → 聚合错误
- 并发:信号量上限
- 冷却:连续失败 → 冷却跳过
- 工具:参数校验、输出 schema、错误路径
- 事件:调用记录写会话、投影更新

## 6. 验收标准

1. `/aux status` 显示三任务路由状态;`/aux model compress opencode-go/glm-5.2` 后 `compress_text` 走新模型
2. `vision_analyze` 能分析附件图片/本地图片/URL 图片,返回描述与模型信息
3. `web_extract` 抓取网页并返回摘要;目标 URL 抓取失败时报错并说明
4. `compress_text` 压缩长文本,返回压缩结果与统计;不改写会话历史
5. 辅助模型超时/限流时自动降级主模型,事件记录 `fallbackUsed: true`;主模型也失败时返回聚合错误
6. 设置页可配置每任务模型/超时/并发,立即生效
7. 会话重启后投影状态保持(事件溯源)

## 7. 里程碑

- M1:host 服务 + 路由/降级/并发/冷却 + 三任务工具 + 事件/投影 + 命令
- M2:client 设置页 + 状态显示
- M3(可选):辅助任务扩展点(`registerTask`)示例、`/aux test`

## 8. 交付物

1. `dsh-aux` 插件包(host: src/index.js + index.d.ts;client: src/client.js + client.d.ts;package.json 含 `dsh.client` 声明)
2. profile patch(web profile 追加 insert 行)
3. 测试:路由、降级、并发、工具、事件(≥15 项)
4. README:挂载点、取舍、如何卸载
5. 本 PRD

## 9. 参考代码位置(已核对)

- `agent/auxiliary_client.py`(Hermes,10432 行)— 辅助路由链、健康检查、降级语义(设计参考)
- `agent/context_compressor.py`(Hermes)— 压缩 prompt 构造(语义参考)
- `tools/vision_tools.py`(Hermes)— 视觉任务(语义参考)
- `@deepseek-ai/dsh-llm` — `LlmRuntime.stream()`、`BlockAssembler`、image block、`purpose: 'compaction'|'session-title'`
- `@deepseek-ai/dsh-session-title-llm` — 辅助 LLM 调用完整范式(route 解析 + deadline + assembler + finishError)
- `@deepseek-ai/dsh-agent-default-model` — settings section + Service 范式
- `@deepseek-ai/dsh-tool-web` — defineTool 注册 + ctx.web.fetch
- `@deepseek-ai/dsh-settings` — installSettingsSection / settingsNamespace / ctx.get("settings")?.replace
- thinking-zh(本工作区)— 事件溯源 + 投影 + 命令 + client chip 完整范式
- `@deepseek-ai/dsh-client-ui-settings-general` — client settings.section 注册范式
