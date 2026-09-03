# dsh-aux bridge 补丁(DSH 0.1.2 线)

> **主分支只支持 DSH `0.1.2-alpha.2` ~ `0.1.2-rc.1`**。
> 旧版(rc.6 ~ 0.1.1-rc.2)的 host-apiproxy / settings 补丁已退役到
> [bridge/retired/](./retired/README.md)，legacy 分支仍完整保留。
> 安装 dsh-aux 时随 `install.sh` 一并应用（非可选）；仅装插件本体的，单独运行本目录脚本补上。

## 解决的问题

让纯文本对话模型也能接收用户粘贴的图片，同时让用户在 UI 里看到自己发的图片缩略图：

- DSH alpha 架构中，图片能力门控在 `dsh-api-session-controller`；
- `dsh-agent-loop` 负责模型输入边界，可把 image block 改写为 `vision_analyze` 路径文本；
- 多模态模型默认原生看图，`forceAuxVision` 开启后强制走 AUX 视觉。

## 补丁清单（当前主支）

| 目标包 | 作用 |
|---|---|
| `dsh-agent-loop` | 模型输入边界桥接：非图像模型/强制 AUX 时改写 image block |
| `dsh-api-session-controller` | 移除“不支持图片输入的模型不能接收图片”的门控 |
| `dsh-tool-subagent` | schema 增加 `requires_vision`；request 读取 `ctx.auxLlm.subagentRoute` |
| `dsh-workflow-worker-thread` | workflow `agent()` 子代理也走 AUX 路由 |
| `dsh-tool-skill` | schema 增加可选 `task` 参数供预审桥接 |
| `dsh-session` | P7 ignorable 写入口 + P8 `aux/llm-call` 白名单 |

## 安装 / 升级

```bash
cd <本仓库路径>/bridge
node apply-patch.mjs        # 自动识别状态:原始 → 已补丁 / 中间态 → 最终态 / 已补丁 → 跳过
# 目标:
#   dsh-agent-loop
#   dsh-api-session-controller
#   dsh-tool-subagent(schema + request)
#   dsh-workflow-worker-thread
#   dsh-tool-skill(schema)
```

> 自愈：`node bridge/self-heal.mjs` 会重打 P1-P6/P11 + P7/P8，并在 DSH 启动脚本中幂等执行。

## 退役补丁

- `dsh-host-apiproxy` admit / selectModel
- rc.6 settings 动态暴露 P9/P10
- rc.8 专用 agent-loop / subagent 原始块

这些文件移入 `bridge/retired/`，不在主支参与安装/检测；未来需要时可直接从 legacy 分支或 retired 目录参考/复用。

## 技术要点

- **桥接链路**：
  1. `dsh-api-session-controller` 允许含图会话选择纯文本模型；
  2. `dsh-agent-loop` 在模型输入边界按模态改写：多模态原生保留，纯文本/`forceAuxVision` 改写为 `vision_analyze`。
- **硬链接而非符号链接**：附件对象无扩展名，补丁在其旁创建 `<sha256>.png/.jpg/…` 硬链接。
- **补丁文件**：
  - `orig-agent-loop-alpha2-block.txt` / `patched-agent-loop-alpha2-block.txt`
  - `orig-session-controller-prompt-block.txt` / `patched-session-controller-prompt-block.txt`
  - `orig-subagent-schema-alpha2-block.txt` / `patched-subagent-schema-alpha2-block.txt`
  - `orig-subagent-request-alpha2-block.txt` / `patched-subagent-request-alpha2-block.txt`
  - `orig-workflow-startchild-block.txt` / `patched-workflow-startchild-block.txt`
  - `orig-skill-tool-block.txt` / `patched-skill-tool-block.txt`
  - session P7/P8 块
- 校验不匹配则跳过不打，绝不破坏文件。

## 卸载

```bash
cd <本仓库路径>/bridge
node apply-patch.mjs --rollback
# 重启 DSH
```

## 注意

- 修改的是 `node_modules` 内文件，**dsh 更新或重装后补丁会丢失**，需要重新 apply。
- 本目录包含 DeepSeek Harness 的原始代码摘录（用于补丁匹配），DeepSeek Harness 以 MIT License 发布；声明与许可证全文见 [NOTICE](./NOTICE)。
