---
name: aux-dsh-follow
description: 跟随 DSH 更新——版本检测+动态补丁,升级适配清单,向后兼容与退役判据。
user-invocable: false
---

# aux-dsh-follow(跟随 DSH / 维护债)

> 🔻**易腐烂标注**:**立场/判据/流程步骤**是稳定规则;**补丁编号、测试数、bridge
> 清单、版本号**是快照,引用前以 `02-patch-ledger.md` 与 `/aux status` 实测为准。

## 立场
- DSH 闭源、无 PR 口 → 所有补丁(🔻**易腐烂·编号清单** *P1-P11*,数量随台账增减;
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
3. 记录新 DSH 版本号;对照 `02-patch-ledger.md` 中 (🔻易腐烂·编号清单 *P1-P11*,
   以台账当前为准) 各补丁的 `detect` 锚点。
4. 逐步核对:锚点匹配不中 = 该补丁目标代码已变 → 先读官方新源码,更新检测块/
   补丁块,再继续;**宁可跳过也不硬替换**。
5. 重跑 `install.sh`(幂等;`--dry-run` 可先看)。升级后**必须重打自定义事件白名单**
   (官方 `KNOWN_SESSION_EVENT_TYPES` 是生成式打包产物,每次升级都丢 aux/llm-call)。
6. 跑全量测试(`aux-test-baseline`,🔻易腐烂·快照*319*,以跑出 #pass 为准)与
   `npm run gen-package-readme -- --check`。
7. `/aux status` 逐项确认:(🔻易腐烂·枚举清单 *image-bridge / subagent-bridge /
   workflow-bridge / compaction-bridge / skill-audit / 会话事件记录* —— bridge 种类会增长,
   **以 `/aux status` 当前输出清单为准**)各状态。
8. **向后兼容检查**:对仍需支持的旧版 DSH 验证"缺补丁也能降级不爆炸"
   (ignorable 缺失 → 不写事件;detect 不中 → 跳过;能力不确定 → 兜底/放行)。

## DSH 版本兼容矩阵 / CI 接入
CI 已支持“包级 DSH 版本矩阵”(不跑完整容器),用于提前发现 DSH 升级后
补丁锚点/API 不兼容。

1. 新版本接入流程:
   ```bash
   node scripts/install-dsh-version.mjs --version <V>
   node --test tests/*.test.js
   node scripts/ci-fake-dsh.mjs            # 补丁 dry-run:锚点是否全部命中
   ```
2. 全部通过后才把 `<V>` 加入 `.github/workflows/ci.yml` 的 `compat` matrix,
   并同步 `TESTING.md`、`CHANGELOG.md`。
3. **锚点不匹配 = 暂不进绿门矩阵**:
   - 先读官方新源码,更新 `bridge/*` 检测块/补丁块;
   - 更新后再跑 `ci-fake-dsh.mjs --dry-run`;
   - 在 CI 注释/TESTING/CHANGELOG 记录原因。
4. 当前已知未适配:
   - `0.1.1-rc.2`:`dsh-host-apiproxy` selectModel 代码块已变化,补丁尚未适配,
     所以绿门矩阵停在 `0.1.0-rc.6` / `0.1.0-rc.8` / `0.1.1-rc.1`。
5. 矩阵验证不只测一个包:安装脚本会抽查 `dsh-agent` / `dsh-session` /
   `dsh-host-apiproxy` / `dsh-tool-skill` 的版本一致。

## 启动自愈
- `~/dsh/start-dsh.sh` 已在启动前调用 `bridge/self-heal.mjs`(幂等,失败不阻塞):
  symlink 重建 → P1-P6/P11 重打 → P7 append ignorable → P8 白名单(aux/llm-call,
  不负责其它插件事件)→ P9/P10 按 rc 守卫自动跳过。升级后即使忘了手动重打,
  重启 DSH 也会自愈。
- `install.sh` 会自动把该 hook 幂等写进 `start-dsh.sh`(标记 `dsh-aux self-heal`,
  带备份;`--no-start-hook` 跳过);换机/别人安装后自愈随安装走。

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

## 0.1.1-rc.1 接口应用决策(🔻易腐烂·随版本演进,2026-08-21)
- **session-projection 注册 API 采用双兼容**:`stateOf` 存在 → 新 `stateSchema/wire`;
  不存在 → 旧 `schema/view`。rc.6/7/8 与 0.1.1-rc.1 都保持可用。
- **版本判定更新**:`isRc7OrNewer('0.1.1-rc.1')` 必须为 true(旧实现会误判为 rc.1)。
- **peerDependencies**:DSH 官方 peer 范围改为同时覆盖 0.1.0-rc.6 与 0.1.1-rc.1。
- 其它 0.1.1-rc.1 接口(`session.create reuseWorkspaceBlank`、api-remotes 事件改名、
  client transport hooks):**不采用/不处理**,与 AUX 无关。
