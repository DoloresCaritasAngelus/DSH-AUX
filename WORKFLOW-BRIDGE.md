# Workflow 子代理桥接 (Workflow Bridge) 设计稿

> 状态:方案待审。承接 `SUBAGENT-BRIDGE.md`(mono subagent 工具透明接管),
> 把同一套 AUX 子代理路由扩展到 **`workflow` 引擎 `agent()` 批量扇出的子代理**。

## 1. 背景

- 原生 `subagent` 工具的桥接补丁已落在 `dsh-tool-subagent`(见
  `SUBAGENT-BRIDGE.md`),只对 **`subagent` 工具**生效。
- `workflow` 工具走的是另一条链路:`dsh-tool-workflow` → `dsh-workflow`
  → `dsh-workflow-worker-thread` 的 `startChild()`,它 `ctx.subagents.start()`
  创建子代理,不经过 `subagent` 工具的 execute,因此目前不受 AUX 子代理路由影响。
- 目标:让 `workflow` 里 `agent()` 创建的一批并行子代理,也按
  `aux.subagent` 配置路由到 AUX 辅助模型(native / manual / vision-aware)。

## 2. 设置

复用现有 `aux.subagent`,新增一个开关:

```yaml
aux:
  subagent:
    includeWorkflow: true   # workflow 引擎 agent() 的子代理也走 AUX 路由(默认 true)
```

- `mode: native` → workflow 子代理完全走原默认路由。
- `includeWorkflow: false` → 即使 mode ≠ native,workflow 子代理也不拦截
  (仅 `subagent` 工具生效)。
- 其余 `general/vision/prepareTools/visionKeywords` 语义与
  `SUBAGENT-BRIDGE.md` 完全一致。

## 3. 优先级(防止覆盖显式意图)

对每个 `workflow.agent(prompt, opts)` 请求:

```
1. opts.provider/model(脚本/阶段显式指定)→ 直接采用,AUX 不覆盖
2. 否则 → ctx.auxLlm.subagentRoute({ prompt, ... })
   - native / includeWorkflow=false / 未配置 → 不注入
   - manual → general
   - vision-aware → 命中视觉 → vision,否则 general
3. 都没有 → 走引擎默认(父/默认模型)
```

> 显式 `opts.provider/model` 是脚本作者的明确意图,永远优先;AUX 只兜底。

## 4. 桥接点与实现

桥接目标文件:`@deepseek-ai/dsh-workflow-worker-thread/lib/index.js`
方法:`WorkerRun.startChild(callId, request)`

现有代码:

```js
run = await this.subagents.start(this.provider, {
  prompt: [{ type: "text", text: request.prompt }],
  parent: this.parent,
  signal: this.controller.signal,
  ...request.schema !== void 0 ? { outputSchema: request.schema } : {},
  ...request.provider !== void 0 || request.model !== void 0 ? { agentOptions: {
    ...request.provider !== void 0 ? { provider: request.provider } : {},
    ...request.model !== void 0 ? { model: request.model } : {}
  } } : {}
});
```

补丁后(伪码):

```js
const explicit = request.provider !== void 0 || request.model !== void 0;
const auxRoute = explicit ? {} : (() => {
  try {
    const aux = this.ctx?.get?.("auxLlm");
    return aux?.subagentRoute ? aux.subagentRoute({
      prompt: request.prompt,
      requiresVision: request.requires_vision,
      existingAllow: void 0,
      existingDeny: void 0
    }) : {};
  } catch { return {}; }
})();
run = await this.subagents.start(this.provider, {
  prompt: [{ type: "text", text: request.prompt }],
  parent: this.parent,
  signal: this.controller.signal,
  ...request.schema !== void 0 ? { outputSchema: request.schema } : {},
  ...(!explicit && (auxRoute.agentOptions !== void 0)) ? { agentOptions: auxRoute.agentOptions } : {},
  ...(!explicit && (request.provider !== void 0 || request.model !== void 0)) ? { agentOptions: {
    ...request.provider !== void 0 ? { provider: request.provider } : {},
    ...request.model !== void 0 ? { model: request.model } : {}
  } } : {},
  ...(!explicit && auxRoute.toolFilter !== void 0) ? { toolFilter: auxRoute.toolFilter } : {}
});
```

要点:
- **显式 override 存在时不查 AUX**(避免脚本意图被覆盖)。
- **复用 `resolveSubagentRoute`** -> `ctx.auxLlm.subagentRoute`,与 `subagent`
  工具同一套纯函数,行为一致。
- `request.requires_vision` 是可选的(v1 走 prompt 启发式即可,若 worker 协议
  后续能透传再启用显式参数)。
- `toolFilter`:与 subagent 工具修复一致 —— **无既有 allow 时不构造白名单**,
  避免过滤掉 bash/read 破坏 Anchored/Standard bootstrap;AUX 工具全局已注册,
  子代理目录保持开放。
- `includeWorkflow=false` 或 `mode=native` 时 `subagentRoute` 返回
  `{settled:false}` → 完全原生。

## 5. 补丁与交付物

1. `WORKFLOW-BRIDGE.md`(本设计稿)
2. 配置:`config.js` 的 `subagent.includeWorkflow`(schema + projectSettings)
3. 服务:`ctx.auxLlm.subagentRoute` 已存在,无需新增;新增
   `ctx.auxLlm.subagentRoute` 内部读取 `_subagentSettings.includeWorkflow !== false`
4. 纯函数:`resolveSubagentRoute` 增加 `includeWorkflow` 判断(或由服务层判断)
5. 桥接补丁:
   - `bridge/orig-workflow-startchild-block.txt` / `patched-workflow-startchild-block.txt`
   - `bridge/apply-patch.mjs` 新增 `dsh-workflow-worker-thread` 目标
6. `/aux status` 增加 `workflow-bridge: installed/missing`(复用
   `subagentBridgeStatus` 类似检测)
7. 测试:
   - 纯函数:`includeWorkflow=false` → 不路由;显式 override 优先
   - 补丁:`apply-patch.mjs --dry-run` 识别 workflow 目标
   - 运行期:一个 `workflow` 里 2 个 `agent()` 子代理,确认各自走
     general/vision(需要重启后手动或集成验证)

## 6. 风险

- worker thread 里 `this.ctx` 是否可用需验证;若不可用,改为由 host 端在
  `startChild` 之前把 `auxLlm` 实例传入 WorkerRun(构造时快照)。
- `request.requires_vision` 透传依赖 worker↔host RPC 协议扩展(未来),
  v1 仅用 prompt 启发式,保守落 general。
- 与 `subagent` 工具补丁共用同一套 `resolveSubagentRoute`,降低行为分歧风险。

## 7. 验收

1. `subagent.mode=manual, includeWorkflow=true` + 重启后:
   - `subagent` 工具子代理 → general 模型
   - `workflow` `agent()` 子代理 → 同样 general 模型
2. `includeWorkflow=false` → workflow 子代理仍走默认
3. 显式 `agent(prompt,{provider,model})` → 覆盖 AUX,仍用显式模型
4. 全部测试通过,`/aux status` 显示两个桥接状态。
