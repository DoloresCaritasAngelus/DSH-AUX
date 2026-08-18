---
name: aux-doc-conventions
description: dsh-aux 文档纪律——README 单一真相(生成副本)、改必同步、证据即出处、术语对齐官方、文档脱密。
user-invocable: false
---

# aux-doc-conventions(文档纪律)

> 🔻**易腐烂标注**:**单一真相/改必同步/证据即出处/术语对齐/脱密**是稳定规则;
> 引用用的**官方路径与行号**是快照(随官方仓库演进会变,以"机制语义"为准)。

## 单一真相
1. **根 `README.md`(+ `README.en.md`)是唯一文档真相**;`dsh-aux/README.*` 是
   **生成快照**,不手改。改完根 README 后跑 `npm run gen-package-readme`
   (或靠 prepack 自动),并用 `tests/readme-sync.test.js` 守住同步。
2. **禁止产生第二份 README 真相**;任何"包内专用说明"先问能否并入根 README。

## 改必同步
3. 功能/行为/命令/设置变化 → 同步:根 README + README.en.md + CHANGELOG +
   命令表(`/aux` 表)。CHANGELOG 记版本条目,不落细节在 README 之外。
4. 中英两对**成对维护**(README.md ↔ README.en.md),不许只有一侧。

## 证据即出处
5. 文档结论带出处:`官方仓库路径:行`(如 `packages/client/ui-commands/src/client/service.ts`
   的 matchEnter —— 🔻**易腐烂·引用路径/行号**:官方仓库演进会变,结论依赖"判定表
   语义"而非行号)或 `本地路径:行`;无法出处的标 `⚠️未核实`。
6. 官方机制结论以官方源码/JSDoc 为准(DSH 自文档化很强,代码即文档)。

## 术语对齐官方
7. 官方存在的概念用官方词(single source of truth / session log / surface /
   projection / trajectory / ignorable);**官方没有的词不注册**(如"真相流"已弃用)。
8. 高频混用词:溯源=数据(日志)、投影=服务端视图、轨迹=客户端展示,严禁混用。

## 脱密
9. 文档**不写对会话另一方(人)的归属式提法**(某"确认/对齐/定夺"等);内部决策
   改中性表述("已决策(日期)")。
10. 涉及"用户"处只保留产品终端用户/仓库治理沿用术语。

## 命令三处一致
11. 任何 `/aux` 命令:`description`(命令菜单)、`input.hint`、handler 错误/用法文案、
    README 命令表——四处一致。
