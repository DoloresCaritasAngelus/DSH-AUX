---
name: aux-test-baseline
description: dsh-aux 测试基线——改前跑全量、新契约带回归断言、测试只调实现不重复逻辑。
user-invocable: false
---

# aux-test-baseline(测试基线)

> 🔻**易腐烂标注**:**规则/程序**是本技能可参照的稳定内容;**数字、枚举、函数名、
> 提交号**是快照,引用前必须重新核验当前状态,不得直接照抄。

## 基线
1. 任何改动前先跑全量:`cd <仓库路径> && node --test tests/*.test.js`
   —— 🔻**易腐烂·快照数字** 基线 **300**(2026-08-22;随新契约增长)。**以跑出的
   `# pass/# fail` 为准,别把 300 当硬事实**。改后必须 0 fail。
2. 若进程因挂起定时器不自动退出(测试类),以 `# pass / # fail` 计数为准。

## 新契约必带回归断言(蓝图 §5#8)
3. 每个"新契约/修复"配一个回归断言的先例:
   - `commands[0].input.hint` 含 status/model → 锁住命令注册契约(A3-4);
   - `tests/readme-sync.test.js` → 锁住 README 单一真相(U1);
   - `/aux history` 简述/全量/空记录 → 锁住溯源视图语义;
   - `tests/skill-bridge.test.js` 的 `buildSkillAuditUserMessage` / `attachSkillBridge`
     → 锁住技能预审的上下文构造与 post-execute 拦截/失败回退。
4. **断言指向语义,不是实现字符串**(避免脆断言);但能用"该在的文案"时用包含式。

## 测试只调实现、不重复逻辑
5. 需要"算一遍"的测试复用生成器/纯函数(如 `isInSync`,`resolveSubagentRoute`),
   **不复制复制逻辑**(先例:`readme-sync.test.js` import 生成器)。
   🔻易腐烂:上面两个**函数名**是快照,以 `src/*.js` 当前导出为准(纯函数抽取
   原则本身稳定)。
6. 纯决策逻辑(路由/子代理/命令视图)抽成可单测的纯函数,别藏在 handler 里。

## 上下文卫生的回归(G5)
7. 「非引导的 AUX 消息注入 = 拒绝」应可测:断言不污染上下文契约(#11)的路径
   (事件 ignorable+非 surface;bootstrap 晋升提醒一次/一行)。

## 常见错误
- 改了契约不加断言 → 回归测试会因他人改动被拦;先例见 §3。
- 测试里手写复制逻辑 → 一改实现两处坏;先例见 §5。


## 测试文档
- 仓库根 `TESTING.md` 是活文档(运行方式/基线/文件清单/约定),改测试时同步更新它。