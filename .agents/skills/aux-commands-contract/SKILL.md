---
name: aux-commands-contract
description: dsh-aux /aux 命令注册契约——带参命令必须 input.hint,四处文案一致,子命令全集对齐。
user-invocable: false
---

# aux-commands-contract(命令注册契约)

> 🔻**易腐烂标注**:**input.hint 契约、四处一致、返回形态**是稳定规则;**子命令全集
> 枚举、提交号**是快照,新增子命令后用 `src/commands.js` 当前全集为准。

## 硬契约(蓝图 §5#1)
1. **带参命令必须声明 `input: { hint }`**。否则 DSH 客户端 `matchEnter`(官方
   ui-commands)对"无 input 且非裸行"的 `/aux status` 这类整行**落回普通聊天**,
   指令被当消息发给主模型 —— 踩坑实证(🔻易腐烂·提交号 *bd4eb89*,历史事实,
   语义才重要)与回归断言。
2. 裸 `/aux` 与 `/aux <sub>…` 都要能执行;`argsAfter` 会自动处理 token 尾空格。

## 四处文案一致
3. 每个子命令保持一致:
   - `description`(命令菜单/面板可见);
   - `input.hint`(输入占位,列出全部子命令);
   - handler 的用法/错误文本(`用法: /aux …`);
   - README 命令表。
4. 新增/改子命令 → 同步 `input.hint` 与 README 命令表,勿漏。

## 子命令全集(🔻易腐烂·枚举快照,改前先对齐)
`status` · `history [N]` · `history full [N]` · `model <task> [provider/model]` ·
`vision <path> <question...>` · `test <task>` · `memory [n]` · `gc-images [days]`。
**以 `src/commands.js` `handleAuxCommand` 当前分支为准;新增子命令必须同步更新
本枚举、`input.hint`、README 命令表与 `04-glossary`。**

## 返回形态
5. handler 返回 `{ kind: "success"|"error", text }`;错误必须非空字符串。
6. 结果可读性优先(用户强调人类可读):溯源类每行紧凑、带 `#seq`、新→旧。

## 常见错误
- 只加 `sub === "xxx"` 分支却忘了 `input.hint` → 带参整行失效(回归测试会拦)。
- 只改 handler 不改 README 命令表 → 文档债。
