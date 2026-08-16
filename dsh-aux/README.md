# dsh-aux — 辅助模型系统(Auxiliary Model System for DSH)

> 受 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 辅助模型机制启发、
> 零历史包袱重做的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(DSH) 插件:
> 统一辅助 LLM 路由服务 + 三个辅助任务工具,给主 agent 使用。
> **不建立子智能体、不做会话协同**——辅助任务(视觉、网页提取、文本压缩)由独立辅助 LLM 完成。

## 特性

- **统一辅助 LLM 路由**(`ctx.auxLlm`):任务分派、路由解析、超时、并发控制、失败冷却、
  主模型降级、聚合错误,全链路事件溯源(会话事件 + `aux-status` 投影,可审计可恢复)。
- **三个辅助任务工具**:
  | 工具 | 作用 |
  |---|---|
  | `vision_analyze` | 图像分析(attachmentId / imagePath / imageUrl),focus-hint 意图感知 |
  | `web_extract` | 网页抓取与摘要(HTML 清洗,可指定问题) |
  | `compress_text` | 长文本压缩(保数字/路径/标识符,目标比例可调) |
- **会话压缩桥接**:新增 `compaction` 辅助任务,配置后原生 DSH 的自动/手动上下文压缩会改走 AUX 辅助模型路由,解决含图会话在纯文本主模型下无法压缩的问题。
- **/aux 命令**:状态查看、模型配置、图片 GC、视觉自检、图片记忆。
- **设置页 + 状态 chip**:DSH Web 设置里按任务配置 provider/model/timeout/并发;
  composer 状态 chip 显示最近一次辅助调用。
- **会话图片生命周期管理**:删除会话时自动清理其无引用图片(事件驱动 + 冷会话对账),
  共享图片保留,归档不误删;图片记忆跨重启可查。
- **零配置可用**:未配置任何任务时,辅助任务自动使用会话主模型;想用专用辅助模型
  在设置页按需配置(下拉只列本机 active 供应商)。

## 安装

要求:DSH ≥ 0.1.0-rc.6,Node ≥ 20。

### 方式一:一键安装(推荐,含 image-bridge 集成组件)

```sh
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX && ./install.sh     # 插件接线 + image-bridge 补丁 + 设置白名单(幂等可重跑)
```

### 方式二:仅插件本体(之后需单独补集成组件)

```sh
dsh plugin --profile web add git+https://github.com/DoloresCaritasAngelus/DSH-AUX.git
# 补 image-bridge(纯文本主模型发图必需):
cd <仓库>/bridge && node apply-patch.mjs
# 补 settings 白名单(设置页可写 aux):
node <仓库>/bridge/patch-settings-allowlist.mjs
```

### 方式二:手动

```sh
ln -s /path/to/dsh-aux <DSH>/node_modules/@dolorescaritasangelus/dsh-aux
# 在 profile 的 cordis.patch.yml 追加:
# - insert:
#     - id: aux
#       name: '@dolorescaritasangelus/dsh-aux'
```

然后重启 DSH。

## 使用

- 直接调用工具:主 agent 会在需要时使用 `vision_analyze` / `web_extract` / `compress_text`。
- 命令行:`/aux status`(路由与最近调用)、`/aux model <task> [provider/model]`(查看/设置)、
  `/aux vision <imagePath> <question...>`(命令行看图)、`/aux test <task>`(自检)、
  `/aux memory [n]`(图片记忆)、`/aux gc-images [days]`(手动回收旧附件)。
- 设置页:Web → 设置 → 辅助模型。

### 编程调用(其他插件)

```js
const result = await ctx.auxLlm.call("compress", {
  messages,      // DSH 消息(可含 image block)
  system,        // 可选 system prompt
  session,       // 记录 aux/llm-call 事件的会话
  signal,        // 取消信号(与 per-task 超时融合)
  purpose        // 语义标签(如 "compaction")
});
// => { text, provider, model }
```

自定义任务:`ctx.auxLlm.registerTask({ key, label, timeoutMs, maxConcurrency })`。

## 配置

每任务:`provider` + `model`(必须成对)、`timeoutMs`(默认 60000)、`maxConcurrency`(默认 2);
全局:`fallbackToMain`(辅助模型失败自动降级主模型,默认开)。

路由解析顺序:显式配置(settings/插件 config)> 未配置 → 会话主模型。
失败冷却:同一 provider+model 连续失败 3 次 → 冷却 60s。

`compaction` 任务:配置 provider/model 后即启用会话压缩桥接——原生
`dsh-compaction-basic` 的摘要调用会通过 `ctx.auxLlm` 执行。建议为含图会话选择
真正支持图片的模型(例如 `volcengine-ark/doubao-seed-2.1-turbo`)。

```sh
/aux model compaction volcengine-ark/doubao-seed-2.1-turbo
```

> 注意：原生 `dsh-compaction-basic` 是**单次全量摘要**，没有分片/渐进能力。
> 对超大输入（实测 shadowed 449K tokens 可单次成功）请调大
> `compaction.timeoutMs`（例如 `300000`），默认 60s 在超大输入时容易超时失败。

> 含图会话压缩时，AUX 会先检查图片附件与路由能力：附件可读且路由支持图片则
> 保留图像信息；附件已被 GC/清理或路由为纯文本时，自动把图片降级为文本占位，
> 避免 `/compact` / 自动压缩因一张不可用的图片整体失败。

## 集成组件与配套

- **image-bridge(集成组件)**:与插件一起安装(install.sh 默认执行)。让**纯文本
  主模型**也能直接粘贴图片发送,且用户消息保留图片缩略图(模型输入边界按模态
  改写为路径文本,多模态模型原生看图)。修改 node_modules 核心包,`npm update`
  后重跑 `bridge/apply-patch.mjs` 即可;`/aux status` 会报告其状态。
- **compaction-bridge(会话压缩协同)**:运行时桥接,不修改 node_modules 文件。
  当 `compaction` 任务配置了专用模型时,`dsh-aux` 会覆写
  `BasicCompactionEngine.prototype.summarize`,让原生压缩的摘要调用走
  `ctx.auxLlm.call("compaction", …)`,从而复用 AUX 的路由/超时/并发/冷却/降级/
  事件记录;未配置时保持原生摘要行为不变。
- **settings 动态暴露**(install.sh 一并应用):设置页读写 aux 配置是插件
  **原生能力**——注册 namespace 时声明 `exposedToWeb`,由 dsh-settings 的
  `listExposed()` 与 api-proxy 动态合并实现(平台 deferred work 的本地实现)。
- **会话删除协同**:DSH 原生无"删除会话"功能,由社区插件
  [dsh-plugin-session-delete](https://github.com/lsz-asd/dsh-plugin-session-delete)
  提供(Web UI 删除按钮 + 风险确认)。两者**零代码依赖、事件级协同**:
  删除插件调用 `sessions.detachEntered()` → 平台广播 `session/disposed` →
  dsh-aux 自动清理该会话的无引用图片(另有 5 分钟对账兜底)。没有它,
  dsh-aux 其余能力完全不受影响。

## 测试

```sh
cd tests && node --test aux.test.js        # 78 项,零依赖
cd tests && node --test bridge.test.js     # 4 项,零依赖(无 agent-loop 环境自动跳过)
```

## 兼容性与依赖

- **平台**:DSH ≥ 0.1.0-rc.6;Node ≥ 20。
- **运行时零第三方依赖**:peerDependencies 全部为 DSH 官方包(DSH 环境自带),
  无 `dependencies`;测试同样零依赖、无网络。

## 许可证与致谢

[MIT License](./LICENSE) © 2026 dsh-aux contributors——自由使用、修改、分发,
保留版权声明即可。

设计受 **Hermes Agent**(辅助模型机制概念)、**agent-vision-toolkit**(focus-hint
意图感知方法论、图内文字策略)、**dsh-vision**(prompt 引导与思考块剥离)、
**deepseek-harness #733**(图片桥接思路)启发,逐条借鉴与差异说明见
[CONTRIBUTIONS.md](./CONTRIBUTIONS.md)。
