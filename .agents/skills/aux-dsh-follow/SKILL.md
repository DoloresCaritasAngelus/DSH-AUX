---
name: aux-dsh-follow
description: 跟随 DSH 更新——版本检测+动态补丁,升级适配清单,向后兼容与退役判据。
user-invocable: false
---

# aux-dsh-follow(跟随 DSH / 维护债)

> 🔻**易腐烂标注**:**立场/判据/流程步骤**是稳定规则;**补丁编号、测试数、bridge
> 清单、版本号**是快照,引用前以 `02-patch-ledger.md` 与 `/aux status` 实测为准。

## 立场
- DSH 闭源、无 PR 口 → 所有补丁(🔻**易腐烂·编号清单** *P1-P10*,数量随台账增减;
  以 `02-patch-ledger.md` 当前列表为准)是**永久维护债**;接受并管理它。
- 机制:**版本检测 + 动态补丁**——只对缺能力/旧版本打补丁,新版(原生已有)跳过;
  "官方支持了"不等于"停补丁"。
- **退役判据**:落后版本**事实性绝迹**(大量 DSH 用户不再使用不支持该行为的旧版)
  才可停维护;由"没人用了"决定,不由"官方支持了"决定。

## DSH 版本升级适配清单
1. **升级前备份 symlink 清单**:npm 重装会清掉 `node_modules` 里所有**手工 symlink**
   (至少 `@dolorescaritasangelus/dsh-aux`、`@deepseek-ai/dsh-search-tier`、
   `@huanlin/dsh-plugin-session-delete`)——先 `ls -la` 记录,升级后自查/重建。
2. **改 profile 的 package.json(依赖/bundles)必须 `pnpm install`**:只改配置不装
   依赖,会让 DSH 起不来(2026-08-19 事故根因之一)。
3. 记录新 DSH 版本号;对照 `02-patch-ledger.md` 中 (🔻易腐烂·编号清单 *P1-P10*,
   以台账当前为准) 各补丁的 `detect` 锚点。
4. 逐步核对:锚点匹配不中 = 该补丁目标代码已变 → 先读官方新源码,更新检测块/
   补丁块,再继续;**宁可跳过也不硬替换**。
5. 重跑 `install.sh`(幂等;`--dry-run` 可先看)。升级后**必须重打自定义事件白名单**
   (官方 `KNOWN_SESSION_EVENT_TYPES` 是生成式打包产物,每次升级都丢 aux/llm-call)。
6. 跑全量测试(`aux-test-baseline`,🔻易腐烂·快照*270*,以跑出 #pass 为准)与
   `npm run gen-package-readme -- --check`。
7. `/aux status` 逐项确认:(🔻易腐烂·枚举清单 *image-bridge / subagent-bridge /
   workflow-bridge / compaction-bridge / 会话事件记录* —— bridge 种类会增长,
   **以 `/aux status` 当前输出清单为准**)各状态。
8. **向后兼容检查**:对仍需支持的旧版 DSH 验证"缺补丁也能降级不爆炸"
   (ignorable 缺失 → 不写事件;detect 不中 → 跳过;能力不确定 → 兜底/放行)。

## 启动自愈
- `~/dsh/start-dsh.sh` 已在启动前调用 `bridge/self-heal.mjs`(幂等,失败不阻塞):
  symlink 重建 → P1-P6 重打 → P7 append ignorable → P8 白名单(aux/llm-call,
  不负责其它插件事件)→ P9/P10 按 rc 守卫自动跳过。升级后即使忘了手动重打,
  重启 DSH 也会自愈。

## 官方行为变化时
- 先回写 `03-mechanism/*`(官方机制→我们的用法→偏差→未决),再落代码;
- 契约级变化(命令准入/事件日志/设置白名单)同步回蓝图 §5 与 `04-glossary.md`。

## 常见错误
- "官方加了就删补丁" → 错:先确认旧版不再需要(退役判据)。
- 升级后不重跑 install.sh → 补丁静默缺失。
- npm 升级后没自查 symlink → 插件静默缺失(启动自愈已兜底)。
- 升级后不重打白名单 → 旧会话/事件一读 unknown(启动自愈已兜底)。

## rc.7 接口应用决策(🔻易腐烂·随版本演进,2026-08-19)
- 设置动态暴露/设置卡片:**rc.7 采用原生**(settings.describe 已含 aux,live 验证),
  rc.6 保留 P9/P10 补丁;插件代码不变。
- 子代理 Job Panel 字段(job/jobId/jobs):**不采用**(UI 展示,与 AUX 路由无关)。
- 其它 rc.7 接口:不需要不采用。
