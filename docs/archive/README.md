# docs/archive — 过程文档存档

> 本目录存放 v0.1 时代(2026-08 上旬)的过程性文档:早期设计规格、评审记录、
> 已失效的上游提案。它们记录了项目当时的意图与决策过程,有史料价值,
> 但**描述的行为可能已与当前版本不符**——现状以根 [README](../../README.md)、
> [PROJECT.md](../../PROJECT.md) 与 `docs/design/` 内的活跃设计文档为准。

| 文档 | 冻结时状态 | 归档原因 |
|---|---|---|
| [PRD.md](./PRD.md) | v1 需求规格(三任务时代) | 缺 web_crawl / 桥接 / 平台化转向,被 PROJECT.md 与 docs/design/ 取代 |
| [UPSTREAM-PR.md](./UPSTREAM-PR.md) | 两个待提交上游的提案 | 上游 DSH 包闭源、无反馈渠道,"提上游合入"路径不存在;补丁策略改为台账制(bridge/ 补丁 + 退役区) |
| [COMPARISON.md](./COMPARISON.md) | 与同类插件的做法对比 | 所比对象与结论停留在 2026-08-17 快照 |
| [DESIGN-COMPLIANCE-REVIEW.md](./DESIGN-COMPLIANCE-REVIEW.md) | 设计意图符合度审计 | 审计对象是 v0.1 时代设计,后续版本已多次演进 |
| [WEB-EXTRACT-REVIEW.md](./WEB-EXTRACT-REVIEW.md) | web_extract 多轮评审 | 评审已闭环,修复已合入并有测试基线(tests/web-extract-fixes.test.js) |

> 归档时间:2026-09-06(文档分层重构)。这些文件自 2026-08-18 起未再更新。
