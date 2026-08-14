# dsh-aux — 辅助模型系统

参考 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 的辅助模型机制、零历史包袱重做的 DSH 插件:统一辅助 LLM 路由服务 + 三个辅助任务工具,给主 agent 使用。**不建立子智能体、不做会话协同**——辅助任务(视觉、网页提取、文本压缩)由独立的辅助 LLM 完成。

按 `PRD.md`(v1)交付:**M1(host 服务 + 路由/降级/并发/冷却 + 三工具 + 事件/投影 + 命令)与 M2(client 设置页 + 状态 chip)均已完成并挂载**。

> **配套补丁(可选)**:`aux/bridge/` 是 dsh-image-bridge v2 本地补丁(参考 [discussion #733](https://github.com/deepseek-ai/deepseek-harness/discussions/733)),让纯文本主模型也能**直接粘贴图片发送**,且**用户消息保留图片缩略图**:admit 原样保留 image block(UI 显示),agent-loop 在模型输入边界按模型模态改写为路径文本(多模态模型原生看图),模型自动调 `vision_analyze`。见 bridge/README.md。

## 交付物

```
dsh work/aux/
├── PRD.md                       # 需求规格(定稿)
├── dsh-aux/                     # host+client 插件包(已 symlink 进部署 node_modules)
│   ├── package.json             # @dolorescaritasangelus/dsh-aux,ESM,exports + dsh.client 声明
│   └── src/
│       ├── index.js             # host 插件:AuxLlmService + 三工具 + 投影 + 命令
│       ├── index.d.ts           # host 类型(事件/投影/Context 增强)
│       ├── route.js             # 路由核心:配置校验、路由解析、错误分类、冷却、信号量(纯逻辑)
│       ├── prompt.js            # 三任务的 prompt 构造(纯逻辑)
│       ├── client.js            # client 插件:设置页 + composer 状态 chip
│       └── client.d.ts          # client 类型
├── tests/
│   ├── aux.test.js              # node:test 测试,零依赖(60 项)
│   └── bridge.test.js           # image-bridge v2 逻辑测试(4 项)
├── CONTRIBUTIONS.md             # 贡献与借鉴说明(credits)
├── COMPARISON.md                # 与社区视觉插件对比
└── README.md                    # 本说明
```

## 安装(给其他用户)

标准方式(推荐,包已声明 `dsh.bundle.patch`):

```sh
dsh plugin --profile <profile> add file:/path/to/dsh-aux   # 或 npm 包名
```

或手动(本机现状,符号链接 + 补丁层):

```sh
ln -s /path/to/dsh-aux /home/user/dsh/node_modules/@dolorescaritasangelus/dsh-aux
ln -s /path/to/dsh-aux ~/.dsh/profiles/web/node_modules/@dolorescaritasangelus/dsh-aux
# ~/.dsh/profiles/web/cordis.patch.yml 追加:
# - insert:
#     - id: aux
#       name: '@dolorescaritasangelus/dsh-aux'
```

> **零配置即可用**:未配置任何任务时,辅助任务自动使用会话主模型;想用专用
> 辅助模型,设置页(或 `/aux model <task> provider/model`)按需配置。
> 可选增强(不影响核心能力):`aux/bridge/` 的 image-bridge v2 补丁
> (纯文本主模型粘贴图片)与 settings 白名单补丁(设置页可写 aux)。

## 功能

### 统一服务 `ctx.auxLlm`

```js
const result = await ctx.auxLlm.call("compress", {
  messages,        // DSH 消息(可含 image block)
  system,          // 可选 system prompt
  session,         // 记录 aux/llm-call 事件的会话
  signal,          // 取消信号(与 per-task 超时融合)
  purpose          // 语义标签(如 "compaction")
});
// => { text, provider, model }
```

路由解析顺序(per-task):
1. 显式配置(`aux.tasks.<task>.provider/model`,settings 或插件 config)——设置页下拉动态感知:只列本机 **active(已配置)** 供应商,模型跟随所选供应商,零硬编码
2. 未配置 → 直接用会话主模型(**无硬编码默认辅助模型**,任何机器零配置可用,分享友好)
3. 辅助模型失败自动降级到会话主模型(可关:`aux.fallbackToMain`)
4. 全部失败 → `AuxCallError`(含每一跳原因)

健壮性:
- per-task 超时(默认 60s,`deadline` + `AUX_TIMEOUT`)
- per-task 并发信号量(默认 2)
- 失败冷却:同一 provider+model 连续失败 3 次 → 冷却 60s,期间直接跳过
- 错误分类:aborted/timeout/rate-limit/auth/payment/model-not-found/connection/content/other
- 每次调用写会话事件 `aux/llm-call`,投影 `aux-status` 暴露最近各任务记录(重启保持,事件溯源)

### 三个工具

| 工具 | 参数 | 输出 |
|---|---|---|
| `vision_analyze` | attachmentId 或 imagePath 或 imageUrl + 可选 question | analysis, provider, model |
| `web_extract` | url + 可选 question/maxChars(默认 8000) | url, summary, keyPoints, provider, model |
| `compress_text` | text + 可选 instruction/targetRatio(0.05-0.5,默认 0.2) | compressed, 统计, provider, model |

### 命令

- `/aux status` — 各任务当前路由与并发/超时配置,以及会话内最近各任务辅助调用(事件溯源)
- `/aux model <task>` — 查看某任务的辅助模型
- `/aux model <task> <provider>/<model>` — 设置某任务的辅助模型(host 侧直写 settings,下一请求生效)
- `/aux gc-images [days]` — 清理超过 N 天(默认 30)的粘贴图片附件。**手动触发,非定时**:附件被历史会话引用,自动删有破坏回放的风险;content-addressed 存储同一图只存一份,增长比想象慢,需要时手动回收即可
- `/aux vision <imagePath> <question...>` — 命令行等效于 `vision_analyze` 工具:分析本地图片并回答问题(模型输出 + 所用辅助模型)
- `/aux test <task>` — 跑一次真实辅助调用的自检(compress/web_extract;vision 请用 `/aux vision` 验证)
- `/aux memory [n]` — 列出最近 n 条(默认 10,上限 50)图片分析记忆:每次 vision_analyze 成功后在 `~/.dsh/attachments/v1/image-memory.json` 追加一条有界(200 条)日志(sessionId/attachmentId/问题/摘要/时间),重启后主会话仍可回忆看过什么
- **会话删除自动清理**(双通道,与手动 GC 并存):用户删除主会话(非归档)时,该会话产生/引用的图片若**无其他会话引用**则自动删除;共享图片保留。两条通道:**① 事件驱动**——热会话删除触发 `session/disposed` 立即清理(进程退出多会话同时 dispose 跳过);**② 定时对账(每 5 分钟)**——冷会话(重启后未挂载)被删除时不触发任何事件,对账定期比对 `session-images.json` 与现存会话(内存 + 持久化),清理已不存在会话的无引用图片;`/aux status` 也会先对账,可立即看到结果。归属记录在 `~/.dsh/attachments/v1/session-images.json`(设计见 SESSION-ATTACHMENT-GC.md)

### 管理 UI

- 设置页「辅助模型」(settings.section id `aux`):每任务 provider/model/timeout/并发 + 全局 fallback 开关
- composer 状态 chip:最近一次辅助调用(任务、模型、耗时、成败)

> **平台限制已解除**:api-proxy 的 `WEB_SETTINGS_NAMESPACES` 白名单原本不暴露 `aux`(设置页读不到配置),已通过 `aux/bridge/patch-settings-allowlist.mjs` 本地补丁把 `"aux"` 加进白名单(同 image-bridge 的补丁机制:备份/回滚/语法校验)。**设置页现在可读写 aux 配置**;provider/model 是下拉选择——**provider 只列 active(已填写 API key 的)供应商**(数据源 `llm.providers` 过滤 `active: true`,不会出现几十个未配置的目录项),model 跟随所选供应商(数据源 `llm.models`)。`/aux model` 命令仍是命令行等效通道。

## 挂载点(全部对照现成参考验证过)

| 机制 | 实现 | 参考 |
|---|---|---|
| 辅助 LLM 调用 | `ctx.llm.stream()` + `BlockAssembler` + `deadline` + `finishError` | `dsh-session-title-llm` 完整范式 |
| 设置 | `installSettingsSection(ctx, ns("aux"), schema, entry, hooks)` | `dsh-agent-default-model` |
| 工具 | `ctx.tools.register(defineTool(...))` + output schema + render | `dsh-tool-web` / `dsh-tool-fs` |
| 会话事件 + 投影 | `session.append("aux/llm-call", …)` + `sessionProjections.register` | thinking-zh |
| 命令 | `commands.register({ name: "aux", … })` | thinking-zh `/thinking` |
| 图像 | `ctx.attachmentStore.saveImage/readImage` + image block | `dsh-tool-fs` read_image |
| 网页 | `ctx.web.fetch()` | `dsh-tool-web` |
| client 设置页 | `ctx.slots.register("settings.section", …)` + `connection.api.settings.describe/mutate` | `dsh-client-ui-settings-models` |

## 关键取舍

1. **无多 provider 认证矩阵**(Hermes 的核心屎山):DSH 的 `LlmRuntime` 已统一 provider 接入,aux 只做路由与降级语义。
2. **工具级压缩,不动会话循环**:`compress_text` 是纯工具,主 agent 主动调用;不做 Hermes 那种 50% 阈值自动改写会话历史(侵入 loop,风险高,留给后续)。
3. **事件溯源可观测**:每次辅助调用写会话事件,可从会话日志回放审计——Hermes 只有进程日志。
4. **降级语义更简单**:只有一层(辅助路由 → 主模型),不做 Hermes 的五层 provider 链(OpenRouter → Nous → Anthropic → …)——你的环境 provider 由 settings.yaml 管,主模型即兜底。
5. **Service 用普通字段而非 `#` 私有字段**:cordis 用 Proxy 包装 Service 实例,私有字段在 Proxy 上不可读(踩坑记录)。
6. **vision 图片经附件服务**:与 read_image 同一生命周期,复用 `imageLimits` 校验。
7. **图像能力门**:带 image block 的请求在发起前先 `resolveModelInfo` 查候选模型的 `inputModalities`;**非空且不含 image 的列表**才判为"明确不支持"(归类 content → 自动降级主模型);**空列表(适配器未声明能力,如 llm-pi-ai 对自定义 provider 的默认)视为未知放行**——否则豆包这类未声明 input 的视觉模型会被误拒。⚠️ llm-pi-ai 对自定义 provider 的模型默认 `DEFAULT_INPUT = ["text"]`,每个模型 `input` 未声明时继承路由的 `defaultInput`;本部署已在 `~/.dsh/settings.yaml` 给 volcengine-ark 配了**路由级** `defaultInput: [text, image]`(用户偏好:一处配置管整个路由,纯文本模型发图由端点拒绝兜底,豆包等视觉模型正常),保存后热生效无需重启。
8. **HTML 清洗**:web_extract 对 `kind: html` 的抓取结果先做轻量 HTML→文本清洗(去 script/style/标签、解码实体)再送辅助模型,避免页面标记污染摘要输入;纯文本 body 原样通过。
9. **vision 工具在 attachments 注入作用域注册**:镜像 dsh-tool-fs read_image——`ctx.inject(["attachments"])` 里注册 vision_analyze 并把 imageCtx 存实例字段,否则子代理/隔离作用域下 `ctx.get("attachments")` 解析不到,本地/URL 图片全挂(真实踩坑,子代理实测发现)。服务名是 `attachments`(不是 attachmentStore);`static inject` 需含 `fs`。

## 如何验证 / 生效

- 测试:`cd <仓库路径>/tests && node --test aux.test.js && node --test bridge.test.js`(67 项全过:路由/降级/并发/冷却/能力门/HTML 清洗/工具/事件/命令/vision 附件回归/空模态放行/附件 GC/会话删除清理/冷会话对账/归属缓存回归/符号链接防逃逸/aux vision/test/memory + bridge v2 逻辑 4 项)
- 已离线验证:loader 解析 `@dolorescaritasangelus/dsh-aux` 得到 `AuxLlmService`(inject = llm/tools/settings/web/fs);patch 文件 YAML 解析为预期的两个 insert;client bundle 语法与格式通过
- **重启 dsh web 后生效**:`/aux status` 应可用;设置页「辅助模型」出现;三工具注册进工具列表
- 启动失败先看日志:`~/dsh/dsh-web.log`

## 如何卸载

1. 从 `~/.dsh/profiles/web/cordis.patch.yml` 删除 `aux` 的 `insert` 块(含注释)
2. 删除两个符号链接:`rm /home/user/dsh/node_modules/@dolorescaritasangelus/dsh-aux ~/.dsh/profiles/web/node_modules/@dolorescaritasangelus/dsh-aux`
3. 重启 `dsh web`;源码目录可整体删除

## 已知坑(本次踩过,已修复)

- **cordis Proxy 与私有字段**:Service 方法里访问 `this.#field` 在 proxy 调用时报 `Cannot read private member`——全部改用普通字段(`this._field`)。
- **`async stream()` 桩**:LlmRuntime.stream 是**同步方法返回 AsyncIterable**;测试桩写成 `async stream()`(返回 Promise)会报 "not async iterable"。
- **`\u0000` 写入**:route.js 里写 `"\u0000"` 作为冷却键分隔符时,写入层把转义解码成真 NUL 字节,文件被判为二进制——需写 `"\\u0000"`(源码字面量)。
- **write 工具转义**:模板字符串里的 `\\/` 等要按目标文件的实际内容写(测试文件里的 URL 正则踩过)。

## 待办(未实现)

- 自动会话压缩(PRD 明确排除,后续单独评估)
- 压缩/摘要质量的 per-task prompt 调优
- skill/playbook 文档:vision 用法指南(restore-ui/OCR 等场景)、相机使用指南
