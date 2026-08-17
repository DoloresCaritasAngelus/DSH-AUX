# 子代理辅助模型桥接 (Subagent Bridge) 设计稿

> 状态:设计定稿,进入实现。(单作者审核并执行,过程中修正。)

## 1. 目标

透明接管 DSH 原生 `subagent` 工具:主模型**看到的、调用的仍然是 `subagent`**,
桥接层在工具执行时按 AUX 配置注入 `agentOptions.provider/model` 和
`toolFilter`,让子代理走 AUX 路由的辅助模型。

- **不新增独立工具**(不做 `aux_subagent`),避免工具面更重。
- **不改系统提示词**(照顾 V4F 对系统提示词的过拟合,以及极简 / Anchored
  Standard 首轮锚定)。
- 子代理仍是 DSH 原生子代理(foreground / background / continuable 全部保留)。

## 2. 设置 schema

```yaml
aux:
  subagent:
    mode: native        # native | manual | vision-aware
    general:            # 一般任务子代理
      provider: opencode-go
      model: glm-5.2
    vision:             # 需要视觉能力的子代理
      provider: opencode-go
      model: kimi-k2.7-code
    prepareTools: true  # 给子代理注入 AUX 工具集作兜底 (vision_analyze 等)
    retryVisionWithAux: false  # 实验性:子代理整体失败后是否二次派发到 AUX 视觉路线
```

- `mode: native(默认)`:不拦截,子代理用原生默认/主模型行为。
- `mode: manual`:所有子代理统一用 `general` 指定模型。
- `mode: vision-aware`:`requires_vision` 判定为“需要视觉”时用 `vision`,
  否则用 `general`。
- 如 `mode != native` 但对应配置缺失(如 vision-aware 却未配 `vision`),
  该子代理按 `native` 处理并记录 warning。

## 3. 判定:任务是否需要视觉能力

不是“任务带不带图”,而是“任务是否要用到视觉能力”。桥接后的 `subagent`
工具新增一个可选参数:

```jsonc
{
  "requires_vision": {
    "type": "string",
    "enum": ["auto", "true", "false"],
    "description": "Whether this delegated task needs vision capability. 'auto' lets the bridge detect; default 'auto'."
  }
}
```

- `true` → 明确要视觉
- `false` → 明确不要
- `auto`(默认)→ 启发式:`prompt` 里命中视觉关键词(`图片`/`图像`/`截图`/
  `看图`/`describe`/`image`/`vision`/`attachmentId`/`imagePath`/`imageUrl`/
  `vision_analyze` 等)记为“要视觉”;不确定时**默认落到 general**,
  避免过度使用昂贵视觉子代理模型。

纯函数(`src/subagent-route.js`):

```ts
resolveSubagentRoute(settings, { requiresVision, prompt, existingAllow })
  -> { agentOptions?: { provider, model }, toolFilter?: { allow?: string[], deny?: string[] }, settled: boolean }
```

- `settled: false` 表示走 native(不注入任何东西)。
- `toolFilter.allow` 是**白名单**:只有当原请求**已有** allow 时,才会把 AUX
  工具名并进去(`prepareTools=true` 时),保证子代理有 `vision_analyze` 等兜底;
  **若原本没有 allow,则不产生 toolFilter**,让子代理工具目录保持开放(AUX
  工具全局已注册,无需白名单)。这避免无中生有的 allow 过滤掉 bash/read 而
  破坏 Anchored / Standard bootstrap。
- `toolFilter.deny` 原样保留。

## 4. 子代理内部兜底链

`prepareTools` 打开后,被路由的子代理工具集里始终包含 AUX 三件套
(`vision_analyze` / `web_extract` / `compress_text`)。于是子代理内部形成:

```
需要视觉的子代理 (mode=vision-aware → vision 模型)
  ├─ 优先用子代理模型自己原生视觉看图
  ├─ 失败 / 拒绝 / 没产出 → 调用 vision_analyze
  │     └─ vision_analyze → AUX 视觉辅助模型 (兜底)
  └─ manual 子代理 (可能无视觉)
        └─ 直接 vision_analyze 看图 (兜底)
```

不需要给子代理注入提示词:工具描述自解释,模型通过工具目录即可发现
`vision_analyze`。

### 可选上层兜底 (实验性,默认关)

`retryVisionWithAux: true` 时,若子代理整体以视觉相关失败结束,父层把同一
任务重新派发到 AUX 视觉路线(一个小型视觉子代理)。默认关闭,避免多一跳。

> 当前版本 `retryVisionWithAux` 仅作为保留配置字段(schema 已留),**尚未
> 接线、未暴露到设置页**,在后续版本实现。

## 5. 桥接实现 (native subagent 透明接管)

补丁目标:`@deepseek-ai/dsh-tool-subagent`,分两处:

1. **工具 schema**:新增 `requires_vision` 可选参数。
2. **execute 请求组装**:构造 `request` 前读取 `ctx.get("auxLlm")` 的
   `subagentRoute()`,返回 `{ agentOptions, toolFilter }`,与原生
   `config.agentOptions` / `config.toolFilter` 合并:

```
auxRoute = ctx.get("auxLlm")?.subagentRoute?.({
  prompt: args.prompt,
  requiresVision: args.requires_vision,
  existingAllow: config.toolFilter?.allow
}) ?? {}

agentOptions = auxRoute.agentOptions ?? config.agentOptions
toolFilter   = auxRoute.toolFilter   ?? config.toolFilter
```

`mode=native` 或 AUX 未挂载时 `subagentRoute` 返回空对象 → 完全原生行为。

foreground / background / continuable 三条路径都复用同一 `request`,因此
一次补丁全部覆盖。

## 6. 文件清单

- `src/subagent-route.js` — 纯函数 + 视觉关键词判定
- `src/config.js` — schema 增加 `subagent` 段
- `src/index.js` — AUX 服务暴露 `subagentRoute()` 方法
- `src/client.js` — 设置页新增子代理桥接区块
- `src/commands.js` — `/aux status` 显示子代理桥接状态
- `bridge/orig-subagent-tool-block.txt` / `bridge/patched-subagent-tool-block.txt`
  — 原/新 `dsh-tool-subagent` 代码块
- `bridge/apply-patch.mjs` — 新增 `dsh-tool-subagent` 目标
- `tests/subagent-route.test.js` — 纯函数单测
- `tests/aux.test.js` — 服务方法 / 设置 schema / 默认值回归

## 7. 测试清单

1. `resolveSubagentRoute`:
   - native → settled=false
   - manual → 用 general
   - vision-aware + requires_vision=true → vision
   - vision-aware + requires_vision=false → general
   - vision-aware + auto + 关键词 → vision
   - vision-aware + auto + 无关键词 → general
   - vision-aware 未配 vision → settled=false(native 兜底)
2. `subagentRoute()` 服务方法:与纯函数一致,AUX 未配置段 → native。
3. 设置 schema:`mode` 枚举校验、provider+model 成对校验。
4. `/aux status` 显示 `subagent-bridge: native/manual/vision-aware`。
5. 桥接补丁:`apply-patch.mjs --dry-run` 识别原状态、升级状态正确。

## 8. 兼容与风险

- `userId`(系统提示词零改动):主模型仍然只看到 `subagent`,无感知。
- 极简 / Anchored Standard:无首轮注入,不影响锚定。
- 兼容性风险:补丁依赖 `dsh-tool-subagent` 当前实现,版本升级后脚本若
  匹配失败会跳过且不破坏文件。
- 判定风险:启发式可能误判;`requires_vision` 显式参数可覆盖,默认保守
  落 general。
