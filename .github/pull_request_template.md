<!--
PR 标题 = Conventional Commits 摘要,如 feat(skill): 增加 report 模式。
一个 PR = 一个逻辑变更;未完成的工作请开 Draft PR。
自审清单必须逐项真实执行——勾不了的项目写明原因,不做空勾。
-->

## 一句话摘要

<!-- 用一行说清这个 PR 做了什么、为什么。十年后翻历史的人只看这一行。 -->

## 背景 / 目标

<!-- 为什么需要?解决什么问题?可链接 Issue(Closes #123)或设计文档(docs/design/…)。 -->

## 改动摘要

<!-- 主要改了什么(文件/模块级)。附带改动规模:git diff --stat main...HEAD 的合计行。 -->

## 兼容性与风险

<!-- 本仓库最大的持续风险是 DSH 版本漂移,此项不可省略;纯文档改动可写"不影响"。 -->

- **影响 / 验证过的 DSH 版本**:<!-- 如 0.1.2-alpha.2 ~ rc.1;CI compat 矩阵覆盖之外的说明原因 -->
- **用户升级动作**:<!-- 无 / 重启 DSH / 重打补丁(install.sh 或设置页一键补丁) -->
- **回滚方式**:<!-- 出问题时怎么办:revert commit / 关闭对应平台开关 / 退役补丁 -->

## 测试与验证

- [ ] `node --test tests/*.test.js` 全量通过
- [ ] `npm run lint` 无 error;`npm run format:check` 通过
- [ ] CI 全绿(合入前提,开 PR 后勾选)

结果:<!-- 粘贴关键输出,如 "# pass 370 / # fail 0";补丁改动附 apply-patch --dry-run 结论 -->
截图:<!-- 设置页 / 命令输出 / UI 改动,把截图直接拖进来 -->

## 影响面

- [ ] 补丁(bridge)——维护者已同步补丁台账 aux-notes/02-patch-ledger.md(本地 gitignore,不随仓库分发;外部贡献者跳过)
- [ ] 设置页 / 配置
- [ ] README / README.en / CHANGELOG / TESTING
- [ ] 测试基线(TESTING.md)
- [ ] 文档放置:新文档进 docs/design/ 或 docs/archive/,根目录 md 不新增

## 自审清单

- [ ] diff 只包含本 PR 意图内的文件
- [ ] 无本地绝对路径（`/home/...` 等），无 token / 凭据痕迹，无内部会话痕迹（私有文档引用、归属式提法）
- [ ] 包内副本已按需重新生成(`cd dsh-aux && npm run gen-package-readme`)
- [ ] `git status` 干净;无临时文件

## 关联 Issue

<!-- 如有关联 Issue,写 Closes #<issue>;合入后自动关闭。 -->
