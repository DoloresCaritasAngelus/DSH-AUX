# dsh-image-bridge v2(dsh-aux 集成组件)

> **集成组件**:安装 dsh-aux 时随 `install.sh` 一并应用(非可选);仅装插件
> 本体的,单独运行本目录脚本补上。`/aux status` 会报告其状态。

让纯文本对话模型(deepseek-v4-flash 等)也能**直接粘贴图片发送**的 DSH 本地补丁,
同时**用户在 UI 里能看到自己发的图片缩略图**(v2 关键改进)。

参考 [deepseek-harness discussion #733](https://github.com/deepseek-ai/deepseek-harness/discussions/733) 的
dsh-image-bridge 方案,适配本环境的 **dsh-aux `vision_analyze`** 工具。

## 解决的问题

DSH 默认要求"能发图 = 当前对话模型支持视觉"。纯文本模型粘贴图片报:
`MODEL_DOES_NOT_SUPPORT_IMAGES`(dsh-host-apiproxy 的 admit() 在消息进 agent 前拒绝)。

v1 补丁把图片消息改写为文本路径——模型能看图了,但**用户消息里只剩一段
"[用户上传了一张图片,本地路径: …]"文本,UI 不显示图片**,用户无法快速确认自己发了什么。

v2 把"改写"从**消息持久化层**移到**模型输入边界**:

```
粘贴图片 + 文字指令 → 发送
  ├─ user/message 原样保留 image block → UI 渲染缩略图 ✅
  ├─ 图片落盘(附件对象 + 带扩展名的硬链接)
  ├─ agent-loop buildRequest:模型输入边界处,
  │    ├─ 模型 inputModalities 含 image(多模态,如 doubao)→ 原样传图
  │    └─ 否则(纯文本模型)→ image block 改写为
  │        "[用户上传了一张图片,本地路径: …。请用 vision_analyze 工具(imagePath 参数)查看…]"
  ├─ 纯文本模型调用 vision_analyze(dsh-aux 辅助模型路由)
  └─ 辅助视觉模型看图返回文字 → 对话继续
```

**用户视角:图片缩略图照常显示;纯文本模型仍能"看到"图片(经辅助视觉模型)。**

## 前置

1. DSH 0.1.0-rc.6(`@deepseek-ai/dsh-host-apiproxy`、`@deepseek-ai/dsh-agent-loop` 同版本)
2. dsh-aux 已挂载(提供 `vision_analyze` 工具;默认辅助模型 `opencode-go/kimi-k2.7-code` 已实测支持图像)

## 安装 / 升级

```bash
cd <本仓库路径>/bridge
node apply-patch.mjs        # 自动识别状态:原始 → v2 / v1 → v2 / 已是 v2 → 跳过
                            # 两个目标:dsh-host-apiproxy(admit)与 dsh-agent-loop(buildRequest)
# 重启 DSH 生效(改的是 node_modules 内文件,必须重启)
```

## 其他命令

```bash
node apply-patch.mjs --dry-run     # 只检查,不修改
node apply-patch.mjs --rollback    # 回滚到最近一次备份(两个目标各自回滚)
```

## 技术要点

- **两段式桥接**:
  1. `dsh-host-apiproxy` admit():image block 原样进消息(UI 显示),仅为附件对象
     补建带扩展名的硬链接;
  2. `dsh-agent-loop` buildRequest():`bridgeImagesForModel` 在模型输入边界按
     模型模态改写——`llm.resolveModelInfo(provider, model)` 的 `inputModalities`
     非空且含 `image` 则不动;否则(含未声明/空)改写为路径文本。
- **硬链接而非符号链接**:附件对象无扩展名,补丁在其旁创建 `<sha256>.png/.jpg/…`
  硬链接(符号链接会被视觉工具的 realpath() 穿透回无扩展名路径)。
- **多模态模型不受影响**:配了 `defaultInput: [text, image]` 的模型(如
  volcengine-ark/doubao-seed-2.0-lite)原生看图,不会降级为工具视觉。
- **旧消息兼容**:v1 时代已改写为文本的历史消息保持不变;新消息走 v2。
- **只删门控不改链路**:非图片消息走原路径;图片消息保留 image block,
  `serializeImageAdmission` 流程不变。
- 补丁文件:
  - `orig-block.txt` / `patched-block.txt`(api-proxy 原始/替换块)
  - `v1-block.txt`(v1 已打状态识别块,用于升级)
  - `orig-agent-loop-block.txt` / `patched-agent-loop-block.txt`(agent-loop 方法定义)
  - 校验不匹配则跳过不打,绝不破坏文件。

## 卸载

```bash
cd <本仓库路径>/bridge
node apply-patch.mjs --rollback
# 重启 DSH
```

## 注意

- 修改的是 `node_modules` 内文件,**dsh 更新或重装后补丁会丢失**,需要重新 apply。
- 若 DSH 升级导致代码块不匹配,脚本会跳过并提示,不会破坏新版本文件。
- 本目录包含 DeepSeek Harness 的原始代码摘录(用于补丁匹配),DeepSeek Harness
  以 MIT License 发布;声明与许可证全文见 [NOTICE](./NOTICE)。
