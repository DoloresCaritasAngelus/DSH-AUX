# 退役:多级辅助模型降级链(multi-level fallback chain)

> 状态:🗄 已归档 · 退役于 2026-09-17 · 取代者:单级路由 + 主模型兜底 · 最后核实:2026-09-17

## 退役原因

`aux.tasks.<task>.models` 曾允许一个任务按序配多个 "provider/model"(主选 → 备1 → …),
失败时逐级尝试。实际使用中它有两个问题:

1. **它和同一张卡上的单数 provider/model 下拉争同一件事** —— 链非空时单数失效,而"谁赢了"
   只在 `/aux status` 说,设置页看不出来(一个可写点之外的沉默赢家)。
2. **生产配置里零使用**:六个任务全部只配了单数 provider/model。

裁决(维护者,2026-09-17):**不做多级链**。降级只保留一条路径 —— 辅助路由失败后回退到主模型;
跨多模型的备用由用户在需要时自己改配置,不再由 AUX 提供一条有序链。

## 内容

| 路径 | 原位置 | 原用途 |
|---|---|---|
| `route-chain.js` | `dsh-aux/src/route.js` | 被移除的三个纯函数:`parseRouteSpec` / `assertRouteSpecList` / `resolveRouteChain` |
| `tests/route-chain.test.js` | `tests/` | 上述纯函数的用例(定义了顺序、回落、去重的语义) |

## 复盘点

仅在需要查"当年那条链的语义到底是什么"时对照 —— **不据此恢复**。
