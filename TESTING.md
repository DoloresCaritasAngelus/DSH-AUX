# TESTING — dsh-aux 测试指南

> 面向维护本项目的协作者(人/模型)。**活文档**:测试文件或基线变化时同步更新本表。
> 关联技能:`.agents/skills/aux-test-baseline/SKILL.md`(测试纪律/程序入口;
> 基线数字与文件清单以本文件为准,技能里不写易腐快照数字)。

## 运行

```bash
cd <仓库路径>
node --test tests/*.test.js
```

- 🔻**易腐烂·快照数字** 基线 **635**(2026-09-11)。**以跑出的 `# pass/# fail` 为准**,
  别把数字当硬事实;每次增删测试后同步更新本表的"基线"与"文件清单"。
- 若进程因挂起定时器不自动退出(偶发),以 `# pass/# fail` 计数为准。
- `tests/bridge.test.js` 的部署包探测是**显式 opt-in**(`BRIDGE_DEPLOYED_SRC=1` 或 `DSH_AGENT_LOOP`);默认不探测 ⇒ 本机与 CI 的 `# tests` 计数一致。

## CI 辅助脚本

```bash
node scripts/install-dsh-version.mjs --version <DSH-VERSION>  # 临时切换 @deepseek-ai/* 版本(只还原 package.json,node_modules 保持切换后的版本)
node scripts/ci-syntax-check.mjs                              # 全仓 JS/MJS 语法检查
node scripts/ci-fake-dsh.mjs                                  # fake DSH 根 + bridge patch dry-run
node scripts/ci-fake-dsh.mjs --apply                          # fake DSH 根 + 实际补丁 + doctor(CI 专用)
node scripts/sync-compat.mjs --check                          # DSH 版本/基线/徽章单一真相源闸(compat.json)
node scripts/compat-delta.mjs --from <tagA> --to <tagB> --src <clone>  # 宿主包锚点位移判定(0 无位移 / 1 需复核 / 2 映射过期)
node scripts/compat-evidence.mjs --dsh-root <root> [--with-tests]      # 生成可粘贴的兼容性证据块
node scripts/pr-body-hygiene.mjs [--pr <n>] [--stdin < draft.md]      # PR 标题/描述脱密闸(与提交信息同一套规则)+ 规模数字基准提示
```

- 当前 DSH 兼容矩阵:`0.1.5-rc.2`(主支单版本)。
- **分支保护的 required checks 用固定名 `compat`**(CI 里的汇总闸),不是矩阵 job 的检查名:
  矩阵 job 的名字必然带版本号(`compat-matrix (0.1.5-rc.2)`),写进保护规则后,换支持线时会
  永远等待一个不再产生的检查、PR 永久停在 blocked。升级支持线只需改 `compat.json`。
- `0.1.2-alpha.2` ~ `0.1.2-rc.1` 已冻结:使用 `legacy/dsh-0.1.2-alpha.2-to-0.1.2-rc.1` 分支 / `v0.4.4-legacy` Release。
- 旧版 DSH（0.1.0-rc.6 ~ 0.1.1-rc.2）请使用 `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2` 分支 / `v0.4.1-legacy` Release。
- 注:本机 `.npmrc` 指向 `registry.npmmirror.com`,该镜像对 0.1.5 线滞后
  (例如缺 `@deepseek-ai/dsh-user-approval@0.1.5-rc.2`);本地验证请加
  `--registry https://registry.npmjs.org`,CI 默认即官方源。

## 测试文件清单

| 文件 | 覆盖 |
|---|---|
| `tests/aux.test.js` | 服务装配/路由/命令(/aux status、history、model、test、vision…)/事件/GC |
| `tests/bridge.test.js` | image-bridge `bridgeImagesForModel`(纯文本→路径文本、多模态保留、保守转换、透传) |
| `tests/bridge-target.test.js` | bridge 目标路径安全校验(`assertSafeTarget`)+ `DSH_ROOT` fake 部署覆盖(`deployedFile`) |
| `tests/bridge-dry-run.test.js` | `apply-patch --dry-run` 结论保真:块不匹配零写盘、与真实应用结论/退出码一致、块匹配时 dry-run 零写盘 |
| `tests/bridge-block-match.test.js` | 步骤块匹配忽略行首缩进(0.1.5 `using` 多包一层 try):漂移下仍落盘、首行沿用目标缩进、无漂移行为不变 |
| `tests/bridge-native-gate.test.js` | session-controller 图片门控的平台开关正确性:闸保留且绑定开关、升级态排在 skip 之前、v3 部署可升级到 v4、v4 幂等跳过 |
| `tests/bridge-switch-constraints.test.js` | 补丁的平台开关约束闸:每个补丁必须让路(读开关短路 / 委托会读开关的服务 / 纯增量 schema),新增补丁必须登记让路方式 |
| `tests/bridge-anchor-exposure.test.js` | 图片锚点不得声称不可用的工具:按 `visionToolAvailable()` 分支、v3 块留档与升级态排序、v3→v4 端到端 |
| `tests/bridge-nesting.test.js` | 桥接按官方不变量递归:tool-result 内层图片也改道、总数递归计数、「仅顶层」留档与升级态排序、端到端升级 + 幂等 |
| `tests/event-payload-json.test.js` | 会话事件载荷必须 JSON 可序列化:嵌套 undefined 清理 + 平台状态快照可序列化(回归:状态面板曾一直读不到) |
| `tests/status-panel.test.js` | 设置页诊断面板:i18n 覆盖率(reason/action/state 字面量都有文案 + 中英键集一致)、严重度分级(note 不计入「需处理」) |
| `tests/agent-loop-anchor.test.js` | agent-loop 锚点重切:0.1.5 三步链路(桥接方法/async 化/A3 改写/调用点 await)、A3 冻结形状、幂等、0.1.2 旧链路、旧文本原地升级 |
| `tests/compression.test.js` | `compress_text` 压缩逻辑与 schema |
| `tests/core-review.test.js` | 核心链路评审回归(路由/降级/能力门) |
| `tests/fetch-vision-review.test.js` | 抓取/视觉链路回归 |
| `tests/fetch-pinning.test.js` | 直连抓取 IP 钉扎(P5.2):SSRF 校验与连接同一次解析、逐跳钉扎、resolver/pin 单测(真 socket 只用本地 server) |
| `tests/fetch-deadline.test.js` | 直连请求的无条件 connect/首字节与空闲 deadline(无代理部署同样生效;`<=0` 关闭;静默丢包必须超时) |
| `tests/fetch-policy.test.js` | 解析 fail-closed(空地址集拒绝)+ `NO_PROXY` 括号 IPv6 归一 + 代理/直连策略边界 |
| `tests/fs-boundary.test.js` | 文件系统边界(图片/附件路径安全) |
| `tests/images-review.test.js` | 图片归属/回收/记忆 |
| `tests/lifecycle-durability.test.js` | 生命周期持久化损坏恢复/空条目清理/共享引用回收/加载重试 |
| `tests/memory-race.test.js` | 图片记忆并发/竞态 |
| `tests/image-retention.test.js` | 图片固化保留 JSON(原子写/损坏/并发) |
| `tests/image-library.test.js` | 图库聚合/搜索/过滤/孤儿/共享/记忆 |
| `tests/image-actions.test.js` | 单张删除/孤儿回收/ownership 清理/符号链接安全 |
| `tests/image-commands.test.js` | `/aux images` 与 `/aux image` 命令层 |
| `tests/image-locate.test.js` | 图片定位:最近 user/message seq 与 vision_analyze callId/callSeq |
| `tests/image-path-media.test.js` | imagePath 魔数嗅探(P5.5/G9):无扩展名按 PNG/JPEG/GIF/WebP 签名判型、声明扩展名与字节不符拒绝、与官方 read_image 对齐 |
| `tests/user-message-image.test.js` | `user/message` 载荷形状归一(P0/A42):`event.data` 即 UserMessage 本体,粘贴图查找/归属/编号回归 |
| `tests/session-compat.test.js` | Session API 兼容:旧 `.events` / 新 `snapshotEvents()` 覆盖 bootstrap/history/debug/locate/resolve |
| `tests/image-gc-debt.test.js` | 图片 GC 债(P4):`attachment-refs.json` 旁挂表读写/降级、`imageHostPath` 回收与 mediaType 派生 `.ext`、旁挂缺失回退不拒删、`request-images/` 总量上限 + mtime LRU、`object-path` 单模块命名规则 |
| `tests/image-lifecycle.test.js` | 图片生命周期(P3):`collectImageRefs` 递归工具产物、persistence shim(新 `list/open` + 旧 `listSnapshots/inspect`)、恢复屏障与 fail-closed 全局拒删、`.trash` 回收与清扫、`resolveImageRef` 递归与"已回收"文案 |
| `tests/session-append-ignorable.test.js` | P7 append ignorable:每个变体的信封语义、surface 元数据共存、变体表两处同步、0.1.5 端到端(AUX → 补丁后的 append → `ignorable:true`) |
| `tests/event-shapes.test.js` | 写端闸:AUX 事件类型/载荷字段必须登记在 `event-shapes.js`(静态扫描全部写入点 + `unknownEventKeys` 判定 + bridge disposition 覆盖) |
| `tests/format-admissions.test.js` | P12/P13 纯函数:补什么/幂等/救援补丁识别/产物 `node --check`/锚点缺失只告警 |
| `tests/readme-sync.test.js` | 单一真相:包内 README == 根 README 生成快照(防漂移) |
| `tests/gen-project-ai.test.js` | PROJECT.AI.md 生成视图:标记块拼装、`--check` 与真实仓库同步、缺标记/多块报错 |
| `tests/compat-sync.test.js` | compat 同步闸:无漂移通过 / 漂移报错 / 锚点失配报错(退出码 2) + 包清单与 package.json 双向一致 |
| `tests/doctor-version.test.js` | doctor 版本判定跟随 compat.json:一致 = OK、不一致 = WARN(不误报 ERROR) |
| `tests/scripts-tracked.test.js` | 仓库脚本可达性:CI/测试引用的 `scripts/*.mjs` 必须已被 git 跟踪(`.gitignore` 白名单漏登记 = 静默失效) |
| `tests/compat-delta.test.js` | 宿主包锚点位移判定:无源码变更(0)/ 有源码变更(1)/ 映射过期与用法错误(2),fixture 用临时 git 仓 |
| `tests/compat-evidence.test.js` | 证据块:无部署根报错(2) + 证据块点名 compat.json 声明版本 |
| `tests/pr-body-hygiene.test.js` | PR 描述脱密闸:规则表单一真相(模式不得在扫描器里复制)+ 泄漏样本命中 + 正当路径不误报 + `--stdin` 退出码 + 提交信息扫描回归 |
| `tests/ci-doc-hygiene.test.js` | 文档脱密闸变异测试:段数不足 / 发布段空正文 / 哨兵缺失 / Unreleased 缺失必须非零退出;另覆盖**无扩展名与符号链接**:符号链接指向本机绝对路径必须命中、相对链接目标不误报、含 NUL 的二进制被跳过 |
| `tests/ci-docs-index.test.js` | 文档树索引闸变异测试:索引缺行 / 状态词非法 / archive 缺退役头 / 状态头与索引不一致 / 索引指向不存在文件 |
| `tests/skill-bridge.test.js` | 技能预审桥接(skill 路由配置门控/上下文构造/报告拼装/失败回退) |
| `tests/subagent-route.test.js` | subagent 路由判定(native/manual/vision-aware) |
| `tests/route-chain.test.js` | 多级降级链(P5.3):`tasks.<task>.models` 有序回退、单数 provider/model 兼容路径、设置投影/校验 |
| `tests/vision-route.test.js` | vision 交付路由(P2):`resolveVisionDelivery` 决策矩阵(白名单/否定模态/forceAuxVision/auto 双条件)、native 零辅助调用、形状含 `mode`、交付失败点名 `visionRoute: 'aux'` |
| `tests/vision-ordinal.test.js` | vision 输出序号(P5.6):消息级/调用级 `imageOrdinal`、`presentationMeta` 同序 ordinals |
| `tests/vision-toolview.test.js` | vision_analyze toolview 卡片(P5.6):keyed `tool.call.toolview` 注册 + 各调用态渲染(假模块加载器 + 最小 React) |
| `tests/vision-batch-mode.test.js` | 多图返回顶层 `mode` 过**编译后** schema(全成功/单元素/部分失败/native)+ 多来源拒绝 + 每批一次 delivery |
| `tests/vision-echo.test.js` | vision_analyze 轨迹回显(输出 schema 锁形/官方 read_image 形状对齐/Session 加载边) |
| `tests/web-crawl.test.js` | web_crawl(robots/范围/hosts/seed/模式/预算) |
| `tests/web-extract-fixes.test.js` | web_extract(编码/反爬/代理/重定向/SSRF/Teredo…) |

> `tests/fetch-page-probe.mjs` 是**开发探针**(非测试),供抓取层手工排查,不进 `*.test.js` 匹配。

## 约定(新契约必带回归)

1. **每个新契约/修复配回归断言**。先例:
   - `commands[0].input.hint` 含 status/model → 锁命令注册契约;
   - `tests/readme-sync.test.js` → 锁 README 单一真相;
   - `/aux history` 简述/全量/空记录 → 锁溯源视图语义。
2. **测试只调实现、不重复逻辑**:需要"算一遍"时复用生成器/纯函数
   (`isInSync`、`resolveSubagentRoute`…),不复制复制逻辑(先例 `readme-sync.test.js`)。
3. **纯决策逻辑抽成可单测纯函数**(路由/子代理/命令视图),别藏在 handler 里。
4. **上下文卫生(G5)可测**:断言"非引导的 AUX 消息注入 = 拒绝"路径
   (事件 ignorable+非 surface;bootstrap 晋升提醒一次/一行)。

## bridge / 自愈怎么验(不写盘)

```bash
cd <仓库路径>
node bridge/self-heal.mjs --dry-run            # 应全部"已打/跳过",无"可从…升级"(能自行解析部署根)
node bridge/install-start-hook.mjs <start-dsh.sh> <repo> --dry-run
DSH_ROOT=<部署根> node bridge/apply-patch.mjs --dry-run
DSH_ROOT=<部署根> node bridge/patch-session-ignorable.mjs --dry-run
# ⚠️ 上面两条**必须**带 DSH_ROOT:不带时相对路径会落到仓库的上一级
# (`unsafe patch target: resolved path is not inside node_modules/@deepseek-ai`),
# 而它**同样返回退出码 0** —— 看起来像"通过",实际什么都没验。self-heal 能自行
# 解析部署根,所以只有这两条需要显式给。
# apply-patch 在"版本不匹配(未找到已知代码块)"时**按设计返回退出码 0**:
# install.sh 用 `set -e`,非零会直接中断安装;该信号由输出文本承载 ——
# ci-fake-dsh.mjs 与 self-heal.mjs 都以正则门禁匹配"版本不匹配/步骤块未命中"。
# rc.6 settings 补丁已退役(bridge/retired/),主支不再 dry-run
./install.sh --dry-run                          # 一键安装流程预览
node scripts/doctor.mjs                         # 部署健康检查(symlink/profile/补丁/白名单/版本)
./update.sh --dry-run                           # GitHub 更新流程预览
```

## 变更时同步

- 新增/删除测试文件 → 更新本表;
- 基线数字变化 → 更新"运行"节的数字;
- CI 辅助脚本行为/DSH 兼容矩阵变化 → 更新"CI 辅助脚本";
- 新增契约 → 在"约定"加一行先例;
- 桥接/自愈脚本行为变化 → 更新"bridge / 自愈怎么验"。
