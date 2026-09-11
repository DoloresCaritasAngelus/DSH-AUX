# DSH-AUX 项目文档（人类友好版）

> 面向人维护者：想快速了解这个项目是什么、长期往哪走、怎么维护、文档在哪。
> AI/自动化代理请读 [PROJECT.AI.md](./PROJECT.AI.md) —— 它由本文件生成
> （`node scripts/gen-project-ai.mjs`），**不要手改**；事实只在本文件维护一份。

> 🔻 快照（2026-09-11）：包版本 `0.4.6` · 主支 DSH `0.1.5-rc.2` · 测试基线 616。
> 版本号、测试数与外部快照易腐烂，以代码、`CHANGELOG.md` 与实跑为准。

## 项目是什么

DSH-AUX 是 DeepSeek Harness（DSH）的辅助模型系统：给主 agent 配一个“副手”，
把看图、读网页、抓站点、压长文这类旁路任务交给独立辅助 LLM，主模型专注对话。

<!-- ai:section id="identity" title="Identity" -->
- 名称：`@dolorescaritasangelus/dsh-aux`（工作区 DSH-AUX）
- 仓库：https://github.com/DoloresCaritasAngelus/DSH-AUX
- 用途：DeepSeek Harness（DSH）的辅助模型系统
- 当前版本：`0.4.6`（`dsh-aux/package.json`）🔻 版本号与徽章随发布单独更新
- Node：>= 20
- 运行时依赖：无 `dependencies`；peerDependencies 为 DSH 官方包 + DSH 客户端环境自带的 `react` / `zod`
<!-- /ai:section -->

## 为什么长期维护

DSH 迭代很快，尤其是 0.1.2-alpha.x 之后：

- 移除 `connection.api`，客户端设置页需要改走 `remote.*` / `sessions`；
- `dsh-host-apiproxy` 在 0.1.2-alpha.3 被移除，图片门控移到 `dsh-api-session-controller`；相关旧补丁已退役到 `bridge/retired/`；
- 0.1.5 起会话读取新增 v0→v1 迁移，冻结词表会拒绝未登记的历史事件（P12/P13 即为此）；
- 部分本地补丁是对官方 DSH 包源码的小改动，官方升级后容易漂移。

因此项目需要持续跟踪 DSH 版本、维护补丁台账、保持设置页可用，并尽量把“必须改原生包”的范围压缩到最小。

## 支持范围与版本策略

<!-- ai:section id="support" title="Supported DSH / version policy" -->
| 项目 | 内容 |
|---|---|
| 当前支持 | DSH `0.1.5-rc.2`（主支单版本，CI compat 矩阵同此） |
| 冻结线 | DSH `0.1.2-alpha.2` ~ `0.1.2-rc.1` → 分支 `legacy/dsh-0.1.2-alpha.2-to-0.1.2-rc.1` / Release `v0.4.4-legacy`；只收安全修复 |
| 更旧线 | DSH `0.1.0-rc.6` ~ `0.1.1-rc.2` → 分支 `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2` / Release `v0.4.1-legacy` |
| 主分支原则 | 只保留 0.1.5 线，保持轻量，不为旧版留兼容代码；legacy 分支不随主支改动 |
| Node | >= 20 |
| 依赖 | 零第三方 `dependencies`；peerDependencies 为 DSH 官方包 + 客户端环境自带的 `react` / `zod` |

🔻 上表为 2026-09-09 快照；DSH 版本线与 Release 名会随发布漂移，以 `.github/workflows/ci.yml` 的 compat 矩阵与 `TESTING.md` 为准。
<!-- /ai:section -->

## 核心概念

<!-- ai:section id="what-it-does" title="What it does" -->
- 任务（task）：`vision_analyze`、`web_extract`、`web_crawl`、`compress_text`，以及桥接任务 `compaction`、`skill`。
- 桥接：原生 `subagent`、`workflow` 的并行 `agent()`、skill 审计、会话压缩、图片输入桥接都透明走 AUX。
- 路由解析：显式配置 > 任务默认 > 会话主模型；每任务可配 provider/model/超时/并发/思考档位。
- 多级降级链：`aux.tasks.<task>.models` 为有序数组（主选 → 备1 → …），失败自动降级主模型，连续失败进入冷却。
- 平台开关：每个工具/桥接可在 `native` / `aux` 间切换，`compat` 预留。
- 可观测：每次调用写 `aux/llm-call` 会话事件；`/aux status --json` 输出结构化状态；设置页“诊断与修复”展示补丁台账。
- 客户端：设置页 `settings.section` id `aux`、对话状态芯片、图片库面板。
<!-- /ai:section -->

## 仓库结构

<!-- ai:section id="repo-layout" title="Repository layout" -->
```text
.
├── dsh-aux/                 # 插件本体（服务端 src + 客户端 bundle + package）
│   ├── src/                 # 核心：路由、工具、桥接、状态、命令、客户端 UI
│   ├── package.json         # 发布包元数据（版本/peerDeps/exports）
│   ├── README.md            # 由根 README 生成的发布快照（勿手改）
│   └── AI.md                # 给 AI 代理的安装/验证指南
├── bridge/                  # 本地补丁、自愈、安装脚本（补丁台账）
├── scripts/                 # CI 门禁、doctor、README/PROJECT 生成器
├── docs/
│   ├── README.md            # 文档树唯一索引与状态词表
│   ├── design/              # 仍有效的专项设计（图库/抓取/上游请求）
│   ├── archive/             # 已退役文档（含退役原因/取代者/复盘点）
│   └── known-issues.md      # 已知问题公开清单
├── tests/                   # node --test 全量测试
├── assets/                  # 吉祥物图片
├── CREDITS.md               # 借鉴来源与致谢
├── PROJECT.md               # 长期项目文档（唯一真相，本文件）
└── PROJECT.AI.md            # 由 PROJECT.md 生成的 AI 视图（勿手改）
```
<!-- /ai:section -->

## 维护原则（重要）

<!-- ai:section id="invariants" title="Key invariants / maintenance rules" -->
1. **减少对原生包的侵犯**：能通过官方扩展点/事件/Service 实现就不改包；必须补丁时尽量小、可识别、可自愈。
2. **补丁要可检测**：每个补丁都要有唯一 marker，让 `bridge-locate` / `imageBridgeStatus` / `patchLedger` 能只读判断状态；`bridge/target.js` 解析真实部署包文件。
3. **设置页必须能诊断**：`collectPlatformStatus()` 返回 `patchLedger`（`{ id, group, pkg, description, state, installed, required, present }`，状态 `installed` / `missing` / `not-applicable` / `unknown`），UI 在“诊断与修复”逐项展示。
4. **一键补丁必须指向真实部署**：`handlePatchCommand()` 先解析 `detectDshRoot()`，再向子脚本传 `DSH_ROOT` + `cwd`；检测到真实部署时不要回退到仓库本地 `node_modules`。
5. **DSH 升级后先跑自愈**：`bridge/self-heal.mjs` 幂等，由 `start-dsh.sh` 调用；失败不阻塞启动，但会在日志/status 中提示。
6. **文档单一真相**：根 `README*` / `CREDITS.md` 是 `dsh-aux/` 内发布副本的源（`gen-package-readme`）；`PROJECT.md` 是 `PROJECT.AI.md` 的源（`gen-project-ai`）。生成物一律勿手改。
7. **分支/PR 纪律**：新工作从 `main` 开短生命周期分支；合入用 Squash；已合入/关闭分支不再 push；不 force-push 已发布历史。
<!-- /ai:section -->

## 补丁体系速览

<!-- ai:section id="bridge-patch" title="Bridge / patch system" -->
| 补丁族 | 作用 | 当前线 |
|---|---|---|
| P1-P6 / P11 | agent-loop / api-session-controller / subagent schema+request / workflow / skill schema | 必需 |
| P7 | session append 支持 ignorable 自定义事件 | 必需 |
| P8 | `aux/llm-call` 白名单 | 必需 |
| P12 | v0→v1 会话迁移放行 AUX 自有 `aux/*` 事件（`dsh-session-format-v0-to-v1` 冻结词表） | 必需 |
| P13 | 同一文件放行官方历史写端形状（`permission/preset.origin`、abort `stack`、`thinking/language`、`finish.replayState`）；上游收编后自退役 | 过渡 |
| 已退役 | host-apiproxy admit/selectModel、rc.6 settings P9/P10、rc.8 老锚点 | 移入 `bridge/retired/`，legacy 分支保留 |

- 退出码：`0` = 已打补丁 / 已是最终态 / 版本不匹配跳过 / `--rollback` 完成（版本不匹配保持 0：`install.sh` 用 `set -e`，非零会把“未知版本先跳过”退化成“装不上”；该信号由输出文本承载，CI/自愈以正则门禁匹配）；`1` = 步骤块失配或替换失败 → 该目标**整体回滚**到应用前状态，不落半补丁。
- 备份命名空间：`apply-patch` 写 `index.js.bak-bridge-<ts>`，`patch-session-ignorable` 写 `index.js.bak-ignorable-<ts>`；`--rollback` 只认自己写下的备份。
- 升级判定用块匹配（`blockPattern`），不用“字符串不存在”负向门；P12/P13 逐项幂等、备份 + `node --check` 门，并识别第三方已打过的同内容补丁。
- 环境开关：`DSH_AUX_NO_OFFICIAL_ADMISSIONS=1` 只保留 P12；`tests/bridge.test.js` 的部署包探测默认关闭，显式 opt-in（`BRIDGE_DEPLOYED_SRC=1` 或 `DSH_AGENT_LOOP`）。
- 明细状态由 `collectPlatformStatus().patchLedger` 输出，UI 有补丁清单表。

🔻 补丁族与目标包随 DSH 版本漂移；以 `bridge/README.md` 与 `dsh-aux/src/status.js` 为准。
<!-- /ai:section -->

## 客户端与设置页

<!-- ai:section id="client-settings" title="Client settings notes" -->
- DSH 0.1.2-alpha.3 起移除 `connection.api`；客户端用 `remote.settings` / `remote.llm` / `remote.session` / `sessions`。
- `dsh-aux/src/client.js` 有 `createAlpha3Api(ctx)` 门面；`inject` 含 remote/session 命名空间。
- 设置页从 `remote.session.modelCatalog()` 读取 provider/model/reasoning。
- 状态投影 `aux-platform` 承载完整平台状态（含 `patchLedger`），经 `ctx.sessions.projections.faceOf("aux-platform")` 读取。
- 客户端只注册 `settings.section`；不要再为 AUX 添加重复的 `settings.plugin.item`。
<!-- /ai:section -->

## 测试与质量门禁

<!-- ai:section id="tests" title="Tests / quality gates" -->
- 全量测试：`node --test tests/*.test.js`；🔻 基线 **616**（2026-09-11 快照，以实跑 `# pass/# fail` 为准，文件清单见 `TESTING.md`）。
- 本机验证清代理环境：`env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy -u NODE_USE_ENV_PROXY NO_PROXY='*' no_proxy='*' node --test tests/*.test.js`。
- CI 门禁（`.github/workflows/ci.yml` test job）：提交信息规范、ESLint（0 error）、Prettier、全量测试、`ci-doc-hygiene`、`ci-docs-index`、`gen-package-readme --check`、`gen-project-ai --check`、`ci-syntax-check`、`ci-pack-check`、`bash -n`、`ci-fake-dsh`。
- compat job：DSH 矩阵 `[0.1.5-rc.2]`；`0.1.2-alpha.2` ~ `0.1.2-rc.1` 冻结在 legacy 分支 / `v0.4.4-legacy` Release。
- 补丁 dry-run（不写盘）：`node bridge/apply-patch.mjs --dry-run`、`node bridge/self-heal.mjs --dry-run`、`node bridge/patch-session-ignorable.mjs --dry-run`。
- `scripts/doctor.mjs` 做部署健康检查（symlink/profile/补丁/白名单/版本），不修改任何文件。
<!-- /ai:section -->

## 常见陷阱

<!-- ai:section id="pitfalls" title="Common pitfalls" -->
- 从仓库 cwd 直接跑 `apply-patch` 且没有 `DSH_ROOT`，可能打到仓库本地旧 devDependencies；先解析部署根。
- `bridge-locate` 的单元测试在仓库模式（无 `DSH_ROOT`）仍会解析仓库 `node_modules`；生产路径以部署根为准。
- 不要手改 `dsh-aux/README*.md`、`dsh-aux/CREDITS.md`（由根文件生成）与 `PROJECT.AI.md`（由 `PROJECT.md` 生成）；改源再跑生成器。
- 不要在文件/命令/日志里存 GitHub token。
- legacy 分支不受主支改动影响；主支不为旧版留兼容代码。
- 不要用 `pnpm dsh --profile web` 这类 TS 源码开发模式启动 DSH：桥接补丁打在已发布的 `lib/` 构建产物上，源码模式会让“已打补丁”不生效。
<!-- /ai:section -->

## 长期方向（仍未做）

<!-- ai:section id="open-work" title="Open work / known debt" -->
- **UI 预禁用删除按钮**：`deletionReady` 目前只经 `/aux status` 的 `imageLifecycle` 暴露，图库投影与客户端未消费该字段，删除按钮不会提前置灰（命令层已 fail-closed，返回可重试的 `DELETION_FROZEN`）。
- **`#34` 解析降次**：单页本地路径同一 URL 会解析 3 次（工具预检 → `fetchPage` 预检 → `fetchWithSsrf` 每跳），本次只在注释里记录原因；真正降次需改 `tools/web-extract.js` / `crawl/fetch-page.js`，seam 侧 post-check 必须保留。🔻 文件与行号随重构漂移。
- **代理 CONNECT 钉扎**：只有直连路径把校验通过的 IP 钉到连接；代理兜底走 CONNECT，由代理解析域名、不参与钉扎（既有设计）。加固需权衡“按域放行的代理会被 IP-CONNECT 破坏”。
- **上游三条请求未提交**：`docs/design/upstream-requests.md`（中文版 `.zh.md`）三条请求仍是草稿，尚未开 issue（上游当前不开放 Issues/PR 渠道）。
- **回归断言补强**：设置页 `auto` 文案与“顶层多来源显式拒绝”两项行为尚无专门断言测试，后续补测或回记维护台账。
<!-- /ai:section -->

## 文档地图

<!-- ai:section id="docs-map" title="Docs map" -->
| 文档 | 读者/用途 |
|---|---|
| [README.md](./README.md) | 用户入口/功能/快速开始（中英） |
| [PROJECT.md](./PROJECT.md) | 人类长期项目总览（本文件，唯一真相） |
| [PROJECT.AI.md](./PROJECT.AI.md) | 由 PROJECT.md 生成的 AI/代理视图 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本历史 |
| [TESTING.md](./TESTING.md) | 测试清单与基线 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 贡献指南 |
| [CREDITS.md](./CREDITS.md) | 借鉴来源与致谢 |
| [docs/README.md](./docs/README.md) | 文档树唯一索引与状态词表（状态 / 易腐烂标注 / 归档规则） |
| [docs/design/](./docs/design/) | 仍有效的专项设计：IMAGE-LIBRARY DESIGN/CONTRACT、WEB-CRAWL-DESIGN、upstream-requests |
| [docs/archive/](./docs/archive/) | 已退役文档（含退役原因 / 取代者 / 复盘点） |
| [docs/known-issues.md](./docs/known-issues.md) | 已知问题公开清单（修复后移入 CHANGELOG） |
| [SECURITY.md](./SECURITY.md) / [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | 安全报告渠道 / 行为准则 |
| [dsh-aux/AI.md](./dsh-aux/AI.md) | AI 安装/验证指南 |
| [bridge/README.md](./bridge/README.md) | 补丁/桥接组件说明 |
<!-- /ai:section -->

## 常见问题

- **Q：为什么主分支不兼容旧 DSH？**
  因为旧版补丁链和设置 API 差异大，混在一起会让代码/CI/文档都很重。旧版用户走 legacy 分支。

- **Q：为什么我们还在改官方包？**
  因为部分能力（会话 ignorable 事件、0.1.5 会话迁移放行、图片输入桥接等）官方当前没有扩展点；我们通过 `bridge/` 集中管理、可自愈、可检测，并持续寻找官方扩展点/替代方案来减少。DSH 官方仓库开源（MIT，[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)），但当前不接受 Issues/PR，无社区反馈渠道。
