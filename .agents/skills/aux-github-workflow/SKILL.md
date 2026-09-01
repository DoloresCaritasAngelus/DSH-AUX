---
name: aux-github-workflow
description: DSH-AUX 仓库 GitHub 管理流程纪律——分支/Conventional Commits/PR/CI/合并/发布;禁止直推 main 与 force-push;token/凭据脱密。
user-invocable: false
---

# aux-github-workflow(GitHub 管理流程)

> 🔻**易腐烂标注**:**分支/PR/合并/发布流程、禁止直推 main、禁止 force-push** 是稳定规则;
> **分支前缀、scope 示例、CI 文件路径、测试文件清单/基线、labels** 是快照,
> 引用前以仓库当前状态与 `TESTING.md` 为准。

## 铁律
1. **所有改动从 `main` 开短生命周期分支**,禁止直接推 `main`。
2. **禁止 force-push 已推送历史**;需要修正时用新提交。
3. 提交信息必须遵循 **Conventional Commits**:
   `<type>(<scope>): <subject>`,破坏性变更用 `!` 或 `BREAKING CHANGE` footer。
4. 每个 PR 对应**一个逻辑变更**;PR 要小、聚焦、可独立 review。
5. **CI 全绿前不得合入**;合入使用 **Squash and merge**,合入后删除分支。
6. 发布必须走:**版本号 + CHANGELOG + tag + GitHub Release**。
7. 改动涉及文档/README/CHANGELOG 时必须同步,禁止只改代码。

## Token / 凭据纪律
1. **token 不写进命令参数、输出、commit、日志、被跟踪文件**。
   - 优先用 `gh auth login`、环境变量、GitHub secret/credential helper;
   - 必须用 REST API/curl 时,把 token 放环境变量或 secret,不在命令行明文出现。
2. 在聊天/日志/终端历史中出现过的 token,视为可能泄露:**用后立即 revoke/轮换**。
3. 推送到 GitHub 前先确认 token 权限足够(`Contents: write` / PR 权限);
   `401 Bad credentials` 表示 token 无效,不要反复重试。
4. 没有 `gh` 时可用 GitHub REST API 开 PR,但响应/输出里不得包含 token;
   推送可用 `https://x-access-token:${TOKEN}@github.com/...`,也必须脱敏输出。

## PR review 后续修复流程
1. review 发现需要修复时,**继续往同一个 PR 分支推新提交**,不要 force-push。
2. 修复提交用 Conventional Commits,例如 `fix(review): ...`。
3. 推送到 PR 分支后 PR 自动更新;无需重新开 PR。
4. 若外部 review 报告结论需要验证,先走 `aux-review-verify` 纪律,不要照单全改。
5. 合入前确认:
   - 本地全量测试通过;
   - 新增/修改测试后 README / TESTING / CHANGELOG / SKILL 基线同步;
   - `git status` 干净。

## 分支推送前状态检查
1. 向远程分支 push **之前**,先确认该分支**未被合入/关闭**;已合入或已关闭的分支禁止再 push。
2. 如果发现需要补充改动,应基于最新 `main` 新建分支,而不是往旧分支追加。
3. 查询状态示例:
   - `git ls-remote origin <branch>` 确认分支仍存在;
   - 或用 GitHub API 检查该分支的关联合入状态。
4. 忘记检查导致旧分支被追加时,不要 force-push 清理;将遗漏的改动 cherry-pick 到新分支,并删除旧远程分支。

## 分支前缀
🔻易腐烂·前缀清单(以仓库实际使用为准):
`feat/` `fix/` `docs/` `refactor/` `test/` `ci/` `chore/` `build/` `perf/` `revert/` `release/`
示例:`feat/skill-report-mode`、`fix/rc9-settings-patch`、`docs/github-workflow`。

## 开始任务前
- [ ] 确认 Issue 是否存在;若没有,先创建 Issue 并写好背景/目标/验收。
- [ ] `git switch main && git pull --ff-only`
- [ ] 从最新 `main` 创建分支:`git switch -c <prefix>/<short-slug>`
- [ ] 远程分支:把特性分支 `git push -u origin <branch>` 即可;单账号/单仓库完全支持,
       PR 就是“从该远程分支 → main”的合入请求。

## 开发中
- [ ] 小步提交,每个提交是一个完整、可回退的变更。
- [ ] 提交信息用 Conventional Commits:
  - `feat(skill): 增加 report 模式`
  - `fix(bridge): 修正 rc.9 锚点检测`
  - `docs(workflow): 补充 GitHub 管理流程`
- [ ] 行为变更补测试;测试基线变化同步 `TESTING.md`。
- [ ] 涉及 README 单一真相时,跑 `npm run gen-package-readme`(在 `dsh-aux/` 下)。
- [ ] 本地全量测试:`node --test tests/*.test.js`(在仓库根目录执行)。

## 提 PR
- [ ] 推送分支到 origin。
- [ ] 打开 PR,标题 = 该 PR 的 Conventional Commit 摘要。
- [ ] 正文使用 PR 模板;若仓库暂无模板,按以下清单填写:
  - 背景 / 目标
  - 改动摘要
  - 测试方式与结果
  - 影响面(补丁/设置/README/测试基线)
  - 关联 Issue:`Closes #<issue>`
- [ ] 需要早期反馈时用 Draft PR。

## 自审清单(提 PR 后、合入前)
- [ ] diff 只包含本 PR 意图内的文件;无意外改动。
- [ ] 本地全量测试通过;CI 全绿。
- [ ] 无本地绝对路径(`/home/...` 等)进入被跟踪文件。
- [ ] README / README.en / CHANGELOG / TESTING 已按需同步。
- [ ] `git status` 干净;无临时文件。
- [ ] 补丁类改动已在 `02-patch-ledger.md` 记账(如适用)。

## 合入
- [ ] 使用 **Squash and merge**(默认)。
- [ ] 合入后删除远程分支;本地也清理:`git branch -d <branch>`。
- [ ] 若该 PR 关联 Issue,确认 Issue 已自动关闭或手动关闭。

## 发布流程
🔻易腐烂·命令与文件路径(以仓库当前结构为准):
1. 从最新 `main` 开 `release/vX.Y.Z`(或直接在 main 上操作,见规划 §6 未决)。
2. 更新 `dsh-aux/package.json` 的 `version`。
3. 更新 `CHANGELOG.md`;按需更新根 README/README.en 的版本与徽章。
4. 跑全量测试,确保基线一致。
5. 提交 `chore(release): vX.Y.Z`。
6. **若开了 release 分支:先按正常 PR 流程合入 `main`,再继续;若直接在 main 上操作,确保 main 已 push。**
7. 在 `main` 的发布提交上打 tag:`git tag vX.Y.Z`;推送:`git push origin vX.Y.Z`。
8. 创建 GitHub Release:
   - `gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."`
   - 或 GitHub Web UI 手工创建;测试版勾选 Pre-release。
9. 发布后确认 Release 页可见、tag 指向正确提交。

## 常见错误
- 直接 `git push origin main` → 违反铁律 1,应改为分支 + PR。
- `git push --force` → 违反铁律 2;用 `--force-with-lease` 也不允许重写已推送历史。
- 提交信息写成自然语言 → 必须改回 Conventional Commits(未推送时可用 amend/rebase 整理)。
- 测试没跑就合入 → CI 会拦;本地也要先跑。
- 发版不改版本号/CHANGELOG → 用户安装更新时无法识别新版本。
- 把 `/home/...` 绝对路径写进被跟踪文档 → 推送前必须脱敏。
- 在命令/输出/日志里暴露 token → 违反凭据纪律;出现后立即 revoke。
- 向已合入/已关闭的旧分支追加提交 → 违反“分支推送前状态检查”;补充内容应基于最新 `main` 新建分支。
