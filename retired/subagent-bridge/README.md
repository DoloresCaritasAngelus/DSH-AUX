# 退役:子代理桥接(subagent bridge)

> 状态:🗄 已归档 · 退役于 2026-09-17 · 取代者:官方 DSH 原生能力 · 最后核实:2026-09-17

## 退役原因

官方 DSH 在子代理 / agent team 方向持续推进:`0.1.5-rc.2` 已自带
`dsh-subagent`、`dsh-tool-subagent`、`dsh-client-ui-subagent`、`dsh-workflow` 等一族包,
原生 subagent 工具已支持用 `provider` / `model` / `reasoning_effort` 选择子代理模型。

AUX 的桥接只是给官方 subagent 工具与 workflow `agent()` 加了一层路由改写:注入一个
`requires_vision` 参数,并在请求期用 `auxLlm.subagentRoute()` 覆盖 `agentOptions` / `toolFilter`。
属重复能力,且维护成本随每个 DSH 版本上涨(三个锚点补丁要跟着宿主文件重切)。

退役前生产已把 `aux.enabled.subagentBridge` / `workflowBridge` 置为 `native`,
而服务端在该值下直接短路为 `{ settled: false }` —— 桥接实际已是惰性。
**因此本次退役不改变运行时行为**,移走的是代码、补丁与维护面。

## 内容

| 路径 | 原位置 | 原用途 |
|---|---|---|
| `src/subagent-route.js` | `dsh-aux/src/` | 子代理路由纯函数(模式解析 / 视觉需求判定 / 工具注入) |
| `src/subagent-bridge.js` | `dsh-aux/src/` | 子代理与 workflow 桥接状态检测 |
| `tests/subagent-route.test.js` | `tests/` | 上述纯函数的用例 |
| `bridge/*.txt` | `bridge/` | 三个补丁的原始/补丁块(原 `apply-patch.mjs` 的 3/4/5 号 target) |

> 原 `tests/subagent-route.test.js` 里还夹着一条 `/aux patch --json` 用例,与子代理无关,
> 退役时已拆出为 `tests/patch-command.test.js` 留在主支。

## 复盘点

官方子代理路由语义再次改动时,可回来对照当时 AUX 是怎么接的 —— **仅作对照,不据此恢复**。
