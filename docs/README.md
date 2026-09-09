# docs — 文档树索引与规则

> 本页是 `docs/` 的**唯一索引**与文档规则页。新增 / 移动 / 退役任何 `docs/**/*.md` 必须同步本页,
> 否则 `node scripts/ci-docs-index.mjs` 在 CI 中阻塞。
> 最后核实:**2026-09-09** · 🔻 本页状态与"易腐烂"标注会随版本漂移,以代码与 CHANGELOG 为准。

---

## 1. 状态词表(五选一,写在每篇文档的状态头与本表里)

| 状态 | 含义 | 典型位置 |
|---|---|---|
| ✅ 活跃 | 描述当前行为 / 正在指导实现;功能变更需同步本文件 | `docs/`、`docs/design/` |
| 🟡 部分被取代 | 仍部分有效,但部分内容已被更新的文档取代(必须写明取代者) | 任意 |
| 🔵 已实现(保留作回执) | 设计/计划已完整落地且不再维护;功能可能仍在,**文档本身**是回执,现状以代码、README、CHANGELOG 为准 | `docs/archive/` |
| ⬜ 历史 | 记录过去的状态与结论,不代表当前行为;仅史料价值 | `docs/archive/` |
| 🗄 已归档 | 已退役:路径被放弃 / 内容被删除或否掉,无现行对应实现(必须写明取代者) | `docs/archive/` |

## 2. 文档索引

> 规则:`docs/**/*.md` 除本页外**每篇一行**;路径为仓库根相对路径;状态词必须来自上表且与文件内状态头一致。

| 文档 | 状态 | 一句话 | 易腐烂标注 |
|---|---|---|---|
| [docs/known-issues.md](./known-issues.md) | ✅ 活跃 | 已确认、尚未修复问题的公开清单;修复后移入 CHANGELOG | 🔻 条目状态随修复变化 |
| [docs/design/IMAGE-LIBRARY-DESIGN.md](./design/IMAGE-LIBRARY-DESIGN.md) | ✅ 活跃 | 图库面板设计(0.4.2 已实现,README 引用的设计参考) | 🔻 阶段清单与验收复选框是实施期内容 |
| [docs/design/IMAGE-LIBRARY-CONTRACT.md](./design/IMAGE-LIBRARY-CONTRACT.md) | ✅ 活跃 | 图库服务端/客户端接口契约(已冻结并落地) | — |
| [docs/design/WEB-CRAWL-DESIGN.md](./design/WEB-CRAWL-DESIGN.md) | ✅ 活跃 | web_crawl 深度抓取设计;核心已上线,P4 延后项仍待评估 | 🔻 测试数、源码行号 |
| [docs/design/upstream-requests.md](./design/upstream-requests.md) | ✅ 活跃 | 向上游提出的三条功能请求(英文,尚未开 issue) | 🔻 DSH 基线版本与行号 |
| [docs/design/upstream-requests.zh.md](./design/upstream-requests.zh.md) | ✅ 活跃 | 上游功能请求中文版(与英文版同源) | 🔻 DSH 基线版本与行号 |
| [docs/archive/README.md](./archive/README.md) | ✅ 活跃 | 归档目录索引:归档清单 + 退役原因总表 | — |
| [docs/archive/IMAGE-LIBRARY-IMPLEMENTATION-PLAN.md](./archive/IMAGE-LIBRARY-IMPLEMENTATION-PLAN.md) | 🔵 已实现(保留作回执) | 图库实施计划(Phase / 并行任务 / 审核关卡);0.4.2 已执行完毕 | — |
| [docs/archive/SESSION-ATTACHMENT-GC.md](./archive/SESSION-ATTACHMENT-GC.md) | 🔵 已实现(保留作回执) | 会话删除时清理附件图片的设计与实现记录 | — |
| [docs/archive/VISION-AGENT.md](./archive/VISION-AGENT.md) | 🔵 已实现(保留作回执) | 视觉子代理"一次性 vs 长期"实测结论与记忆架构 | — |
| [docs/archive/SUBAGENT-BRIDGE.md](./archive/SUBAGENT-BRIDGE.md) | 🔵 已实现(保留作回执) | subagent 工具透明接管 AUX 路由的设计(0.3.0 上线) | — |
| [docs/archive/WORKFLOW-BRIDGE.md](./archive/WORKFLOW-BRIDGE.md) | 🔵 已实现(保留作回执) | workflow `agent()` 子代理同样走 AUX 路由的设计(已上线) | — |
| [docs/archive/PRD.md](./archive/PRD.md) | ⬜ 历史 | v1 需求规格(三任务时代),已被 PROJECT 与 docs/design/ 取代 | 🔻 测试数、里程碑 |
| [docs/archive/UPSTREAM-PR.md](./archive/UPSTREAM-PR.md) | 🗄 已归档 | 两个上游 PR 提案;上游无反馈渠道,该路径已放弃 | 🔻 上游行为 |
| [docs/archive/COMPARISON.md](./archive/COMPARISON.md) | ⬜ 历史 | 与同类视觉插件的对比结论(2026-08-17 快照) | 🔻 对比对象快照 |
| [docs/archive/DESIGN-COMPLIANCE-REVIEW.md](./archive/DESIGN-COMPLIANCE-REVIEW.md) | ⬜ 历史 | web_extract / web_crawl 设计意图符合度审查 | 🔻 源码行号、测试数 |
| [docs/archive/WEB-EXTRACT-REVIEW.md](./archive/WEB-EXTRACT-REVIEW.md) | ⬜ 历史 | web_extract 多轮评审与修复记录 | 🔻 源码行号、测试数 |

## 3. 状态头格式

每篇文档 H1 之后紧跟一个状态头块(机器闸按此解析,不得省略):

```markdown
> 状态:✅ 活跃
> 最后核实:2026-09-09
> 🔻 版本快照:dsh-aux v0.4.5 / DSH 0.1.5-alpha.1(快照易腐烂,以代码与 CHANGELOG 为准)
```

- 状态词必须与索引表一致(五选一)。
- `最后核实` 是"人真的读过并确认过"的日期,不是文件修改时间。
- `🔻` 标注**易腐烂内容**(版本号、行号、测试数、外部快照);带 🔻 的陈述不当作事实源。

## 4. 归档规则(退役不删除)

1. **退役不删除**:内容整体保留,用 `git mv` 移入 `docs/archive/`,保留 git 历史;不重命名文件。
2. **必须加退役头**(`docs/archive/README.md` 自身除外,它是归档索引):

   ```markdown
   > 状态:🔵 已实现(保留作回执)   # 或 ⬜ 历史 / 🗄 已归档
   > 退役原因:功能已随 0.4.2 发布,文档不再维护
   > 取代者:代码 dsh-aux/src/images/** + CHANGELOG 0.4.2
   > 复盘点:图库扩展为资产库时再回看
   > 最后核实:2026-09-09
   ```

3. **同步两处索引**:`docs/README.md`(总索引)与 `docs/archive/README.md`(归档清单与退役原因总表)。
4. **归档时机**:设计已实现且不再维护、被新文档取代、或结论失效。功能仍在线但文档停更 → 🔵 已实现(保留作回执);
   内容本身过期 → ⬜ 历史;路径被放弃 → 🗄 已归档。
5. **复盘点**必须是一个可判定的条件("引入 PSL 时""图库扩展为资产库时"),不写"以后再说"。

## 5. 命名规则(按区域,不重命名旧文件)

| 区域 | 命名 | 说明 |
|---|---|---|
| `docs/README.md` | 固定 | 本页;机器闸硬编码此名 |
| `docs/` 根 | 既有 UPPERCASE / kebab-case | `known-issues.md` 保持 kebab-case;新增专题页用 kebab-case |
| `docs/design/` | 既有 UPPERCASE-DASH 保留;新增用 kebab-case 或与本区域一致 | 旧文件一律不改名(改名会打断外部链接与 git blame) |
| `docs/archive/` | 保留归档前的原名 | 归档只搬家不改名 |

新增文档一律落在 `docs/design/`(设计)或 `docs/archive/`(退役);根目录 md 不再新增。
