# dsh-aux 向上游提出的功能请求

> 提出方:`dsh-aux` 插件(辅助模型路由 + `vision_analyze` / `web_extract` /
> `compress_text` 工具)。
> 基线:DSH **0.1.5-alpha.1**(`5dda764ed3`)。源码行号为该版本的快照。
> 状态:交给维护者的草稿,**尚未**向上游开 issue。

本文档含三条请求,按对插件生态的代价排序。它们都源于同一类缺口:插件今天不得不
**越过公开面**——一条靠本地补丁改写出厂 bundle,一条靠"文档明令禁止"的方式使用
不透明标识。

---

## 请求 1 —— 受支持的"请求投影"缝

### 插件需要做什么

纯文本主模型无法接收 `image` 内容块。当用户往主路由为纯文本的会话里粘贴图片时,
插件**只改写模型请求**,把每个 image block 换成文本锚点:

```
[本条消息第N张/共M张, attachmentId=<sha256:…>。可用 vision_analyze 的 attachmentId 参数查看]
```

让模型知道"有这张图"并能用稳定 id 调用 `vision_analyze`。会话日志与界面保留原图,
只有派生请求变化;该变换是会话日志的纯函数。

### 现有缝为什么不可用

| 候选缝 | 不可用的原因 |
| --- | --- |
| `llm/stream` waterfall | 官方定位是**只读**观察点:loop 构建的请求 "arrives deep-frozen (mutation throws) … so listeners read it, never rewrite it"(`packages/llm/llm/src/index.ts:60-67`);`isAgentLoopRequest` 正是用来识别这类信封的(`packages/llm/llm/src/call-config.ts:76`)。在监听器里绕开 `next()` 重发一次改写请求,违反"请求是日志的纯函数"这一契约。 |
| `agent/pre-step` | 它替换的是**进入日志**的消息(`packages/core/agent/src/runtime-types.ts:330`),界面会显示改写后的文本而不是图片,且投影会被持久化 —— 与"界面保留原图"相反。 |
| `tools/post-execute` | 只能改写单个工具结果,改不到用户粘贴的图片,且发生在日志落盘之后。 |

今天插件打在出厂 agent loop 的模型输入边界上
(`packages/core/agent-loop/src/agent.ts:603` 的 `session.deriveMessages()`,随后
`:610` 的 `markAgentLoopRequest`)。这个补丁每次发版都要重切:锚点已经搬过一次
(`dsh-agent-loop/index.ts buildRequest` → `core/agent-loop/src/agent.ts`),而且改写
必须留在 `deepFreeze` 之前以保持冻结语义。三行语义改动换来的是永久维护债,并让插件
对无关版本变化敏感。

### 建议 API

以下任一形态都可以:

1. **一个 waterfall 事件**,例如 `agent/request-projection`:在
   `session.deriveMessages()` 之后、`markAgentLoopRequest` / `deepFreeze` 之前
   调用,监听器可返回 `{ messages }`(替换列表)或 `undefined`(放行);
2. **一组纯变换注册**,例如 `ctx.agentLoop.requestProjection(transform)`:每个
   变换把派生消息列表映射为新列表,按注册顺序应用。

要求:

- 投影结果仍是会话日志的纯函数(同输入同输出),可重构性不受影响;
- 会话日志、事件与界面不受影响;
- 投影可观测(调试事件或检查钩子,说明哪些变换生效);
- 变换抛错时请求**响亮失败**,而不是静默降级。

### 验收标准

- 插件能在**不打任何出厂包补丁**的前提下,对单次请求替换 `image` 块;
- 未使用该能力时,请求与今天逐字节相同;
- 注册了投影时,持久化日志仍保留原始 image 块。

### 不提供的后果

补丁债保留:每次 DSH 发版都要重切锚点、刷新快照、增加兼容矩阵行;一旦漏切,
会静默退化成"纯文本模型收到一张它读不了的图"。

---

## 请求 2 —— `ctx.attachments` 列举 / 回收 seam

### 插件需要做什么

插件在持久附件之上维护一个图片库(列举、按会话归属、删除无引用对象)。只有同时
具备 (a) 枚举已存在的对象 和 (b) 完整删除单个对象 的能力,删除才是安全的。

### 现有缝为什么不可用

- `AttachmentId` 明确是不透明的:"consumers must neither parse that
  representation nor derive a filesystem path from it"
  (`docs/subsystems/attachment.md:13`)。`imageHostPath(ref)` 是唯一被认可的宿主路径
  查询面(`docs/subsystems/attachment.md:241`,实现
  `packages/attachment/attachment-local/src/index.ts:225`)。
- **没有枚举 API,也没有回收 API**。在 0.1.5-alpha.1 的 `packages/attachment` 里
  grep `deleteAttachment`、`removeAttachment`、`collectAttachments`、
  `pruneAttachments` 全部零命中。
- 文档明确写着服务是 "retention-neutral: resumed and forked sessions may share
  objects, so reference-aware garbage collection is deferred rather than tied to
  one session's deletion"(`docs/subsystems/attachment.md:160`)—— 这恰恰是外部
  消费者无法正确实现的语义。

因此插件目前扫描本地后端的目录树(`<DSH_HOME>/attachments/v1/objects/**`),并从
id 反推对象名 —— 即上面那条契约违例。换后端时图片库会静默地报 0 个对象、永不回收。

### 建议 API

```ts
interface AttachmentService {
  /** 枚举已存对象;分页、可取消。 */
  list(options?: { signal?: AbortSignal; cursor?: string; limit?: number }):
    Promise<{ items: ImageAttachmentRef[]; cursor?: string }>

  /** 删除一个已存对象**及其全部派生产物**。 */
  remove(ref: ImageAttachmentRef, options?: { signal?: AbortSignal }): Promise<boolean>
}
```

- `list` 返回 ref(id + mediaType + bytes + 尺寸就够做归属判断),游标保证大仓库可用;
- `remove` 必须幂等(已不存在返回 `false`);若服务能判断对象仍被活跃会话引用,
  应拒绝或明确报告;
- 如果枚举有意不做,请**改为明确记录本地后端的布局契约**(对象命名、扩展名别名、
  派生缓存),让消费者可以显式依赖,而不是逆向猜测。

### 删除必须同时覆盖对象与其 `.ext` 别名

在本地后端,`objects/<hash>` 与 `objects/<hash>.<ext>` 是**同一 inode 的硬链接**
(链接计数 2)。只删无扩展名对象,字节仍可通过别名访问、并未回收;只删别名同理。
因此任何 `remove`(或文档化布局)都必须覆盖**对象及其全部派生名**,包括按路由派生
的 `request-images/` 变体 —— 后者的 id 是 (ref + policy + encoder) 的内容哈希,
无法从附件 id 推导。

### 验收标准

- 消费者可以在**不解析 `AttachmentId`、不读存储布局**的前提下枚举并回收无引用对象;
- `remove` 之后该 inode 不再有任何硬链接,随后用同一 ref 调 `readImage` 得到既有的
  `ATTACHMENT_NOT_FOUND` 类错误。

### 不提供的后果

插件继续保留一个与布局耦合的扫描器(换后端即静默失效),并继续从不透明 id 反推
路径 —— 正是文档明令消费者不要做的两件事。

---

## 请求 3 —— 插件自有会话事件类型的准入

### dsh-aux 需要做什么

AUX 通过公开 API `session.append(type, data, undefined, { ignorable: true })` 写入四个
隐藏的、`ignorable: true` 的会话事件(`aux/llm-call`、`aux/debug`、
`aux/platform-status`、`aux/image-library`),让状态投影与 `/aux history` 能从会话
日志回放,而不必重新执行命令。

### 为什么现有缝不可用

DSH 0.1.5 的 v0→v1 迁移用冻结清单 `RELEASED_V0_EVENT_DISPOSITIONS` 校验每个历史
事件(类型 + 载荷成员),再由 `assertReleasedEventPayload` 做逐类型语义校验。不在
清单里的类型**连 `ignorable: true` 都拒**;不在 disposition 里的载荷成员按
`has unexpected member` 拒。两者任一命中,整个历史会话都打不开,且源工件保持不变。
`dsh-session` 的 `KNOWN_SESSION_EVENT_TYPES` 无效:v0 路径根本不查它。

官方没有注册缝:`defineReleasedPayloadDisposition` 虽然导出,但只是 frozen 构造器,
清单本身模块私有且被 `Object.freeze`。

### 建议 API

任一即可:

1. **v0 路径尊重 `ignorable`** —— 与 v1 路径一致(`assertReleasedArtifactCoordinates`
   在 `allowLegacySteering` 为 false 时有 `ignorableCurrent` 分支):未知但带
   `ignorable: true` 的事件按 opaque JSON 保留,而不是拒绝整个日志;
2. **插件事件类型的注册面**,例如公开的
   `registerReleasedEventDisposition(type, { required, optional, opaque })`,在迁移前生效;
3. 至少加一道**发布闸**:把每个 tag 写端实际发出的载荷形状与清单做差集,官方自己写的
   形状就不会从读端遗漏。

### 验收标准

- 0.1.2 上写入、含 `aux/*` 事件的会话,在 0.1.5 上无需本地补丁即可打开,且迁移产物里
  这些事件逐字节不变;
- deepseek-harness#5818 报告过的官方形状(`permission/preset` 的 `origin`、
  `assistant/chunk` 的 `finish.replayState`)以及 `thinking/language`、abort cause 的
  `stack` 同样被放行。

### 不提供的后果

每个会写会话事件的插件都得在 `node_modules` 里维护一份官方冻结表的补丁;插件的每个
用户在这些补丁为下一个版本重切之前,都读不到自己的旧会话。
## 可选(低优先)—— 装饰出厂图片画廊

`conversation.message.images` 是 **single** 槽,注册即 "replaces the shipped
gallery",其 owner props 也没有 badge / overlay 钩子。想在官方画廊上加一个小序号
角标的插件,只能重实现缩略图、灯箱、`loadImage` 与对齐。给这些 owner props 增加
`badge` / `overlay` 入口(或把槽改成 chain 形态),就能让第三方**装饰而不是替换**
官方画廊。上面两条请求并不依赖它;记录在此是因为它属于同一类缺口:缺失扩展点
迫使消费者"接管"官方 UI。
