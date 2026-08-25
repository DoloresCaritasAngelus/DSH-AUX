# TESTING — dsh-aux 测试指南

> 面向维护本项目的协作者(人/模型)。**活文档**:测试文件或基线变化时同步更新本表。
> 关联技能:`.agents/skills/aux-test-baseline/SKILL.md`(规则),本文件是清单。

## 运行

```bash
cd <仓库路径>
node --test tests/*.test.js
```

- 🔻**易腐烂·快照数字** 基线 **314**(2026-08-22)。**以跑出的 `# pass/# fail` 为准**,
  别把数字当硬事实;每次增删测试后同步更新本表的"基线"与"文件清单"。
- 若进程因挂起定时器不自动退出(偶发),以 `# pass/# fail` 计数为准。

## 测试文件清单

| 文件 | 覆盖 |
|---|---|
| `tests/aux.test.js` | 服务装配/路由/命令(/aux status、history、model、test、vision…)/事件/GC |
| `tests/bridge.test.js` | image-bridge `bridgeImagesForModel`(纯文本→路径文本、多模态保留、保守转换、透传) |
| `tests/bridge-target.test.js` | bridge 目标路径安全校验(`assertSafeTarget`) |
| `tests/compression.test.js` | `compress_text` 压缩逻辑与 schema |
| `tests/core-review.test.js` | 核心链路评审回归(路由/降级/能力门) |
| `tests/fetch-vision-review.test.js` | 抓取/视觉链路回归 |
| `tests/fs-boundary.test.js` | 文件系统边界(图片/附件路径安全) |
| `tests/images-review.test.js` | 图片归属/回收/记忆 |
| `tests/lifecycle-durability.test.js` | 生命周期持久化损坏恢复/空条目清理/共享引用回收/加载重试 |
| `tests/memory-race.test.js` | 图片记忆并发/竞态 |
| `tests/readme-sync.test.js` | U1:包内 README == 根 README 生成快照(防漂移) |
| `tests/skill-bridge.test.js` | 技能预审桥接(skill 路由配置门控/上下文构造/报告拼装/失败回退) |
| `tests/subagent-route.test.js` | subagent 路由判定(native/manual/vision-aware) |
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
node bridge/patch-settings-dynamic-expose.mjs --dry-run
node bridge/patch-settings-allowlist.mjs --dry-run
./install.sh --dry-run                          # 一键安装流程预览
node scripts/doctor.mjs                         # 部署健康检查(symlink/profile/补丁/白名单/版本)
./update.sh --dry-run                           # GitHub 更新流程预览
```

## 变更时同步

- 新增/删除测试文件 → 更新本表;
- 基线数字变化 → 更新"运行"节的数字;
- 新增契约 → 在"约定"加一行先例;
- 桥接/自愈脚本行为变化 → 更新"bridge / 自愈怎么验"。
