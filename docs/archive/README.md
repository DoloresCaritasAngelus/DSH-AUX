# docs/archive — 归档区索引

> 状态:✅ 活跃
> 最后核实:2026-09-09
> 本目录是**退役文档区**:内容整体保留、不再维护。归档规则见 [../README.md](../README.md) 第 4 节。
> 每篇(本页除外)都必须带退役头:**退役原因 / 取代者 / 复盘点 / 最后核实**。

状态含义(与 [../README.md](../README.md) 状态词表一致):

- 🔵 **已实现(保留作回执)** — 设计/计划已完整落地,功能可能仍在线;文档本身停更,现状以代码、README、CHANGELOG 为准。
- ⬜ **历史** — 记录过去的状态与结论,不代表当前行为;仅史料价值。
- 🗄 **已归档** — 路径被放弃 / 内容被否掉,无现行对应实现。

## 归档清单与退役原因

| 文档 | 状态 | 归档原因 | 取代者 | 复盘点 |
|---|---|---|---|---|
| [IMAGE-LIBRARY-IMPLEMENTATION-PLAN.md](./IMAGE-LIBRARY-IMPLEMENTATION-PLAN.md) | 🔵 已实现(保留作回执) | 计划已随 0.4.2 执行完毕;原状态头"待执行"已腐烂 | 代码 `dsh-aux/src/images/**` + CHANGELOG 0.4.2 | 图库扩展为资产库、或再次需要并行任务编排时 |
| [SESSION-ATTACHMENT-GC.md](./SESSION-ATTACHMENT-GC.md) | 🔵 已实现(保留作回执) | 功能 2026-08-14 落地,文档停更 | 代码 `dsh-aux/src/images/**` + CHANGELOG 0.1.2 | 附件对象库结构或 `session/disposed` 语义变化时 |
| [VISION-AGENT.md](./VISION-AGENT.md) | 🔵 已实现(保留作回执) | 策略已定稿落地;记忆职责移交 image-memory | 代码 `dsh-aux/src/images/memory.js` + 根 README 的 vision 章节 | 视觉子代理策略或记忆方案再次变化时 |
| [SUBAGENT-BRIDGE.md](./SUBAGENT-BRIDGE.md) | 🔵 已实现(保留作回执) | 桥接随 v0.3.0 上线,文档停更 | 代码 `dsh-aux/src/subagent-bridge.js` + 根 README 的子代理章节 | 子代理路由语义再次改动时 |
| [WORKFLOW-BRIDGE.md](./WORKFLOW-BRIDGE.md) | 🔵 已实现(保留作回执) | `aux.subagent.includeWorkflow` 已上线(默认 true) | 代码 `dsh-aux/src/index.js` + `config.js` | workflow 引擎或子代理路由再次改动时 |
| [PRD.md](./PRD.md) | ⬜ 历史 | 三任务时代的 v1 需求规格,缺 web_crawl / 桥接 / 平台化转向 | PROJECT.md + `docs/design/` | 仅史料,不再回看 |
| [UPSTREAM-PR.md](./UPSTREAM-PR.md) | 🗄 已归档 | 上游 DSH 开源(MIT)但不开放 Issues/PR,"提上游合入"路径不存在 | `docs/design/upstream-requests.md`(草稿)+ `bridge/` 补丁台账 | 上游开放 Issue/PR 通道时 |
| [COMPARISON.md](./COMPARISON.md) | ⬜ 历史 | 所比对象与结论停留在 2026-08-17 快照 | 根 README 的能力说明 + CREDITS.md | 再次做同类插件对比时 |
| [DESIGN-COMPLIANCE-REVIEW.md](./DESIGN-COMPLIANCE-REVIEW.md) | ⬜ 历史 | 审计对象是 v0.1 时代设计,后续版本已多次演进 | `docs/design/WEB-CRAWL-DESIGN.md` 的"实施进度"段 + `tests/web-crawl.test.js` | web_crawl 抓取核心再次重构时 |
| [WEB-EXTRACT-REVIEW.md](./WEB-EXTRACT-REVIEW.md) | ⬜ 历史 | 评审已闭环,修复已合入并有测试基线 | `tests/web-extract-fixes.test.js` + CHANGELOG 的 web_extract 修复段 | web_extract 抓取/SSRF 语义再次改动时 |

## 说明

- 归档只搬家、不改名:文件名与归档前一致,便于 `git log --follow` 追溯。
- 归档时间:2026-09-06(文档分层重构,PRD/UPSTREAM-PR/COMPARISON/两份评审/实施计划)、
  2026-09-09(本轮:两份桥接设计、会话附件 GC、视觉子代理策略)。
- 带 🔻 标注的版本号、行号、测试数、外部快照不当作事实源;需要现状请查代码与 CHANGELOG。
