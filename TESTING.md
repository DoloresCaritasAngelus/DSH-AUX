# TESTING — dsh-aux 测试指南

> 面向维护本项目的协作者(人/模型)。**活文档**:测试文件或基线变化时同步更新本表。
> 关联技能:`.agents/skills/aux-test-baseline/SKILL.md`(规则),本文件是清单。

## 运行

```bash
cd <仓库路径>
node --test tests/*.test.js
```

- 🔻**易腐烂·快照数字** 基线 **429**(2026-09-09)。**以跑出的 `# pass/# fail` 为准**,
  别把数字当硬事实;每次增删测试后同步更新本表的"基线"与"文件清单"。
- 若进程因挂起定时器不自动退出(偶发),以 `# pass/# fail` 计数为准。

## CI 辅助脚本

```bash
node scripts/install-dsh-version.mjs --version <DSH-VERSION>  # 临时切换 @deepseek-ai/* 版本(自动恢复 package.json)
node scripts/ci-syntax-check.mjs                              # 全仓 JS/MJS 语法检查
node scripts/ci-fake-dsh.mjs                                  # fake DSH 根 + bridge patch dry-run
node scripts/ci-fake-dsh.mjs --apply                          # fake DSH 根 + 实际补丁 + doctor(CI 专用)
```

- 当前 DSH 兼容矩阵:`0.1.5-alpha.1`(主支单版本)。
- `0.1.2-alpha.2` ~ `0.1.2-rc.1` 已冻结:使用 `legacy/dsh-0.1.2-alpha.2-to-0.1.2-rc.1` 分支 / `v0.4.4-legacy` Release。
- 旧版 DSH（0.1.0-rc.6 ~ 0.1.1-rc.2）请使用 `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2` 分支 / `v0.4.1-legacy` Release。
- 注:本机 `.npmrc` 指向 `registry.npmmirror.com`,该镜像对 0.1.5 线滞后
  (例如缺 `@deepseek-ai/dsh-user-approval@0.1.5-alpha.1`);本地验证请加
  `--registry https://registry.npmjs.org`,CI 默认即官方源。

## 测试文件清单

| 文件 | 覆盖 |
|---|---|
| `tests/aux.test.js` | 服务装配/路由/命令(/aux status、history、model、test、vision…)/事件/GC |
| `tests/bridge.test.js` | image-bridge `bridgeImagesForModel`(纯文本→路径文本、多模态保留、保守转换、透传) |
| `tests/bridge-target.test.js` | bridge 目标路径安全校验(`assertSafeTarget`)+ `DSH_ROOT` fake 部署覆盖(`deployedFile`) |
| `tests/bridge-dry-run.test.js` | `apply-patch --dry-run` 结论保真:块不匹配零写盘、与真实应用结论/退出码一致、块匹配时 dry-run 零写盘 |
| `tests/bridge-block-match.test.js` | 步骤块匹配忽略行首缩进(0.1.5 `using` 多包一层 try):漂移下仍落盘、首行沿用目标缩进、无漂移行为不变 |
| `tests/agent-loop-anchor.test.js` | agent-loop 锚点重切:0.1.5 三步链路(桥接方法/async 化/A3 改写/调用点 await)、A3 冻结形状、幂等、0.1.2 旧链路、旧文本原地升级 |
| `tests/compression.test.js` | `compress_text` 压缩逻辑与 schema |
| `tests/core-review.test.js` | 核心链路评审回归(路由/降级/能力门) |
| `tests/fetch-vision-review.test.js` | 抓取/视觉链路回归 |
| `tests/fs-boundary.test.js` | 文件系统边界(图片/附件路径安全) |
| `tests/images-review.test.js` | 图片归属/回收/记忆 |
| `tests/lifecycle-durability.test.js` | 生命周期持久化损坏恢复/空条目清理/共享引用回收/加载重试 |
| `tests/memory-race.test.js` | 图片记忆并发/竞态 |
| `tests/image-retention.test.js` | 图片固化保留 JSON(原子写/损坏/并发) |
| `tests/image-library.test.js` | 图库聚合/搜索/过滤/孤儿/共享/记忆 |
| `tests/image-actions.test.js` | 单张删除/孤儿回收/ownership 清理/符号链接安全 |
| `tests/image-commands.test.js` | `/aux images` 与 `/aux image` 命令层 |
| `tests/image-locate.test.js` | 图片定位:最近 user/message seq 与 vision_analyze callId/callSeq |
| `tests/session-compat.test.js` | Session API 兼容:旧 `.events` / 新 `snapshotEvents()` 覆盖 bootstrap/history/debug/locate/resolve |
| `tests/image-gc-debt.test.js` | 图片 GC 债(P4):`attachment-refs.json` 旁挂表读写/降级、`imageHostPath` 回收与 mediaType 派生 `.ext`、旁挂缺失回退不拒删、`request-images/` 总量上限 + mtime LRU、`object-path` 单模块命名规则 |
| `tests/image-lifecycle.test.js` | 图片生命周期(P3):`collectImageRefs` 递归工具产物、persistence shim(新 `list/open` + 旧 `listSnapshots/inspect`)、恢复屏障与 fail-closed 全局拒删、`.trash` 回收与清扫、`resolveImageRef` 递归与"已回收"文案 |
| `tests/session-append-ignorable.test.js` | P7 append ignorable:每个变体的信封语义、surface 元数据共存、变体表两处同步、0.1.5 端到端(AUX → 补丁后的 append → `ignorable:true`) |
| `tests/readme-sync.test.js` | 单一真相:包内 README == 根 README 生成快照(防漂移) |
| `tests/skill-bridge.test.js` | 技能预审桥接(skill 路由配置门控/上下文构造/报告拼装/失败回退) |
| `tests/subagent-route.test.js` | subagent 路由判定(native/manual/vision-aware) |
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
node bridge/self-heal.mjs --dry-run            # 应全部"已打/跳过",无"可从…升级"
node bridge/install-start-hook.mjs <start-dsh.sh> <repo> --dry-run
node bridge/apply-patch.mjs --dry-run
node bridge/patch-session-ignorable.mjs --dry-run
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
