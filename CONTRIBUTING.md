# 贡献指南

欢迎贡献!本仓库是 dsh-aux 辅助模型系统插件。

## 工作流总览

采用 **GitHub Flow + Conventional Commits**:

1. 所有改动从 `main` 开短生命周期分支;
2. 提交信息遵循 Conventional Commits;
3. 通过 Pull Request 合入 `main`;
4. CI 全绿后才能合入;
5. 合入使用 Squash and merge,合并后删除分支;
6. 发布走「版本号 + CHANGELOG + tag + GitHub Release」。

> 单人维护也走 PR:它承担“变更说明 + 检查记录 + 可回滚锚点”三个作用。

## 环境

- Node ≥ 20(测试用 Node 22 验证)
- 开发时插件符号链接进 DSH 部署目录(见 README 安装章节)

## 分支命名

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feat/` | 新功能 | `feat/skill-report-mode` |
| `fix/` | 缺陷修复 | `fix/rc9-settings-patch` |
| `docs/` | 文档 | `docs/github-workflow` |
| `refactor/` | 重构(无行为变化) | `refactor/route-split` |
| `test/` | 测试补充/调整 | `test/ci-all-tests` |
| `ci/` | CI/自动化 | `ci/run-all-tests` |
| `chore/` | 杂项/工具/依赖 | `chore/update-hooks` |
| `build/` | 构建相关 | `build/readme-sync` |
| `perf/` | 性能优化 | `perf/compress-speed` |
| `revert/` | 回滚 | `revert/xxx` |
| `release/` | 版本发布准备 | `release/v0.3.2` |

## 提交规范(Conventional Commits)

```
<type>(<scope>): <subject>

[body]

[footer: BREAKING CHANGE / Closes #issue]
```

- type:`feat` / `fix` / `docs` / `refactor` / `test` / `ci` / `chore` / `build` / `perf` / `revert`
- scope(可选):`bridge` / `skill` / `settings` / `route` / `client` / `install` / `release` / `ci` 等
- 破坏性变更:`feat!:` 或 footer 写 `BREAKING CHANGE: ...`

示例:

```sh
git commit -m "feat(skill): 增加 report 模式与 includeOriginal 参数"
git commit -m "fix(bridge): 修正 rc.9 锚点检测"
git commit -m "docs(workflow): 补充 GitHub 管理流程"
```

## 测试

```sh
cd <仓库路径>
node --test tests/*.test.js
```

测试零依赖、无网络。改动请保持测试全绿。

## 文档同步

- 根 `README.md` / `README.en.md` / `CREDITS.md` 是文档真相；
- 改完根 README / CREDITS 后运行 `cd dsh-aux && npm run gen-package-readme`；
- 行为/命令/设置变化同步 `CHANGELOG.md` 与 `TESTING.md`；
- 专项设计文档放 `docs/design/`,v0.1 时代过程文档在 `docs/archive/`(勿再往根目录堆文档)；
- 补丁类改动同步 `aux-notes/02-patch-ledger.md`(工作区台账,非 git)。

## Pull Request 流程

1. 从最新 `main` 创建分支并推送;
2. 打开 PR,标题 = Conventional Commit 摘要;
3. 使用 PR 模板填写背景/改动/测试/影响面;
4. 自审清单:
   - [ ] diff 只包含本 PR 意图内的文件
   - [ ] 本地全量测试通过
   - [ ] 无本地绝对路径(`/home/...`)
   - [ ] README / README.en / CHANGELOG / TESTING 已同步
   - [ ] `git status` 干净
5. CI 全绿后 Squash and merge;
6. 合并后删除分支。

## 发布流程

1. 从最新 `main` 开 `release/vX.Y.Z`(或直接在 main 上操作);
2. 更新 `dsh-aux/package.json` 版本;
3. 更新 `CHANGELOG.md`,按需更新 README 版本/徽章;
4. 跑全量测试;
5. 提交 `chore(release): vX.Y.Z`;
6. 若开了 release 分支,先合入 main;
7. 打 tag `vX.Y.Z` 并推送;
8. 创建 GitHub Release。

## 禁止事项

- 禁止直接推 `main`;
- 禁止 force-push 已推送历史;
- 禁止跳过测试合入;
- 禁止发版不改版本号/CHANGELOG。

## 结构

- `dsh-aux/` — 插件包(host + client)
- `bridge/` — 可选本地补丁(image-bridge、settings 白名单)
- `tests/` — 测试
- `scripts/` — 维护脚本(doctor、readme/credits 生成等)
- `docs/design/` — 专项设计文档;`docs/archive/` — v0.1 时代过程存档
- 根文档 — README / PROJECT / CHANGELOG / TESTING / CONTRIBUTING / CREDITS
