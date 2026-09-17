# retired — 退役归档区

> 状态:🗄 已归档 · 最后核实:2026-09-17
> 只收 **AUX 不再迭代**的功能:源码、测试与补丁块原样冻结在此,仅作历史留痕。
> **对本项目无参考价值** —— 归档的含义是"此后不再碰这块",不是备用仓库。

## 规则

- 本区文件**不再修改**;不参与构建、安装、自愈与测试(测试只会跑 `tests/*.test.js`)。
- 本区位于 `dsh-aux/` 之外,所以**不进 npm tarball**(`dsh-aux/package.json` 的 `files` 只含 `src` 与几个顶层条目,且 `ci-pack-check.mjs` 有顶层白名单)。
- `.prettierignore` 与 `eslint.config.js` 已排除本区,冻结原文不会被格式化改写。

## 内容

| 目录 | 功能 | 退役于 |
|---|---|---|
| `subagent-bridge/` | 子代理桥接:原生 subagent 路由 + workflow `agent()` 路由 | 2026-09-17 |
