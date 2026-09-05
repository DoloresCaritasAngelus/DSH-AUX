---
name: aux-patch-discipline
description: dsh-aux 对 DSH 官方包补丁的纪律——只走 bridge/、幂等可回滚、升级后重装、改必记账(A2)。
user-invocable: false
---

# aux-patch-discipline(补丁纪律)

> 🔻**易腐烂标注**:**只走 bridge/、幂等、校验不中跳过、重跑 install.sh** 是稳定规则;
> **脚本清单、bridge 状态枚举、补丁编号**是快照,引用前以 `bridge/` 目录与
> `/aux status` 实测为准。

## 铁律
1. **改官方 lib 只走 `bridge/`**,绝不手改 `node_modules/**/*.js`。
   🔻易腐烂·脚本清单(以 `bridge/` 目录实测为准,新增补丁脚本会变化):
   - image-bridge / subagent / workflow / skill-audit:`bridge/apply-patch.mjs`
   - 会话事件:`bridge/patch-session-ignorable.mjs`
   - 设置暴露:`bridge/patch-settings-dynamic-expose.mjs` + `patch-settings-allowlist.mjs`
2. 一切修改经 `install.sh` 一键装配;单个补丁支持 `--dry-run`(只查不写)、
   `--rollback`(回滚到最近备份)。
3. **校验不中 = 跳过不破坏**:`detect` 锚点不匹配说明版本变了,宁可不打也不硬替换。
4. `npm update` / 重装 DSH 后补丁全部丢失 → 必须重跑 `install.sh` 并验证。
5. 每次改动或重装后:**跑全量测试 + `/aux status` 逐项确认**各 bridge 状态
   (🔻易腐烂·枚举清单 —— *image-bridge / subagent-bridge / workflow-bridge /
   compaction-bridge / skill-audit / 会话事件记录*,以 `/aux status` 当前输出为准,种类会增长)。

## CI 防漂移 / 多版本验证
- 补丁/锚点改动后先跑 `node scripts/ci-fake-dsh.mjs`(dry-run)与全量测试。
- 多版本兼容矩阵由 `scripts/install-dsh-version.mjs` 切换 `@deepseek-ai/*` 版本;
  版本接入规则见 `aux-dsh-follow`。
- 只有所有目标 DSH 版本都 dry-run 通过,才把新版本加入 CI 绿门矩阵。
- 当前 `0.1.1-rc.2` 的 selectModel 锚点不匹配,暂不进矩阵。

## 记账
- 新补丁 / 补丁目标变化 → 更新补丁台账 `aux-notes/02-patch-ledger.md`（维护者本地 gitignore 文件，不随仓库分发；记录位置/为何/无它会怎样/退役判据）。
- 说明理由时用"版本检测+动态补丁"叙词:只对缺能力/旧版本打,旧版本事实绝迹才
  可退役（补丁=永久维护债：版本检测+动态补丁，退役以旧版绝迹为准）,**不说**"官方支持了就停"。

## 常见错误
- 手改 node_modules 后 `npm update` 被静默覆盖 → 一律回 bridge/。
- 新 DSH 版本下旧锚点不中 → 先核对补丁台账↔官方源码,再改检测块。
