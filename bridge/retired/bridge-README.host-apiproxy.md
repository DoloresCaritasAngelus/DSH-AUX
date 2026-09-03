# dsh-image-bridge v2 + v3(dsh-aux 集成组件)

> **集成组件**:安装 dsh-aux 时随 `install.sh` 一并应用(非可选);仅装插件
> 本体的,单独运行本目录脚本补上。`/aux status` 会报告其状态。

让纯文本对话模型(deepseek-v4-flash 等)也能**直接粘贴图片发送**的 DSH 本地补丁,
同时**用户在 UI 里能看到自己发的图片缩略图**(v2 关键改进),并且在含图片的
会话中**可以自由切换到纯文本模型**,支持**强制原生多模态主模型也走 AUX 视觉
辅助模型**(v3 关键改进)。

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

v3 修复**模型切换**:旧版 DSH 在 `selectModel` 里会检查"如果会话中已有图片,
新模型必须声明 image 输入能力",导致无法从多模态模型切到纯文本模型。
但 v2 的输入边界桥接已经能处理纯文本模型,所以这个门控不再必要:

```
含图片会话 → 切换模型
  ├─ 旧行为:新模型 inputModalities 不含 image → 拒绝切换 ❌
  └─ v3:不检查图片能力,直接切换 ✅
       后续发送消息时由 agent-loop 对纯文本模型自动改写图片为路径文本 + vision_analyze
```

> 不要用"给纯文本模型强行标记 image 能力"来绕过旧门控:那样会让 v2 桥接
> 误以为模型原生支持图片,把 image block 原样发给真实不支持的模型,导致
> 供应商返回 `429 invalid_request_error`。v3 直接把门控去掉,让桥接按真实
> 模态工作。

> `0.1.1-rc.2+` 官方已原生移除 selectModel 的图片门控,DSH-AUX 不再打
> selectModel 补丁,`apply-patch` 会识别为 `native-rc2` 并跳过。

v3 还支持**强制原生视觉走 AUX**(设置页 `forceAuxVision` 开关):当主模型
声明了 `image` 能力、但你想让它把图片都交给更便宜/更合适的 AUX 视觉辅助
模型时,开启后 bridge 对**多模态主模型**也改写为 `vision_analyze`:

```
forceAuxVision = false(默认)
  多模态主模型 → 原生看图
  -------
forceAuxVision = true
  多模态主模型 → image block 也改写 → vision_analyze → AUX 视觉辅助模型
  (纯文本主模型行为不变,始终走 vision_analyze)
```

## 技能预审桥接 (skill-audit)

dsh-aux 还接管原生 `skill` 工具的结果,让主模型在真正执行 SKILL.md 之前先拿到
一份辅助模型预审报告。设计见 `SUBAGENT-BRIDGE.md` 同级的技能预审设计(仓库内
未单独成文时以 `dsh-aux/src/skill-bridge.js` 为准)。

- **不劫持 catalog**:原生 `dsh-tool-skill` 仍注册,主模型照常看到可用技能列表。
- **拦截点**:官方 `tools/post-execute` 扩展点,不改原生 execute。
- **唯一 patch**:`dsh-tool-skill` 的 schema 增加可选 `task` 参数,让主模型能把
  当前任务/意图显式写给辅助模型;未传时从会话 `deriveMessages()` 隐式取上下文。
- **启用条件**:设置页或 `/aux model skill <provider>/<model>` 配置了 `skill`
  辅助模型后才拦截;未配置时 native 直通。
- **返回形态**:主模型同时看到原始 SKILL.md + `<aux_skill_audit>` 预审报告,
  可对照原文辩证审视。
- **失败降级**:辅助调用失败时返回原生 SKILL.md,不阻塞主模型。

## 前置

1. DSH 0.1.0-rc.6 及以上(已验证 rc.6 / rc.7 / rc.8 / 0.1.1-rc.1 / 0.1.1-rc.2 /
   `0.1.2-alpha.2`;`@deepseek-ai/dsh-host-apiproxy`、`@deepseek-ai/dsh-agent-loop`
   同版本;alpha.2 的 host-apiproxy npm 仍为 rc.2)
2. dsh-aux 已挂载(提供 `vision_analyze` 工具;默认辅助模型 `opencode-go/kimi-k2.7-code` 已实测支持图像)

## 安装 / 升级

```bash
cd <本仓库路径>/bridge
node apply-patch.mjs        # 自动识别状态:原始 → 已补丁 / 中间态 → 最终态 / 已补丁 → 跳过
                            # 目标:
                            #   dsh-host-apiproxy(admit + selectModel;rc.2+ selectModel 原生跳过)
                            #   dsh-api-session-controller(prompt 图片门控,0.1.2-alpha.x)
                            #   dsh-agent-loop(buildRequest + forceAuxVision)
                            #   dsh-tool-subagent(schema + request)
                            #   dsh-workflow-worker-thread(startChild)
                            #   dsh-tool-skill(schema: 可选 task 参数)
# 重启 DSH 生效(改的是 node_modules 内文件,必须重启)
```

## 其他命令

```bash
node apply-patch.mjs --dry-run     # 只检查,不修改
node apply-patch.mjs --rollback    # 回滚到最近一次备份(各目标各自回滚)
```

## 技术要点

- **桥接链路**:
  1. `dsh-host-apiproxy` admit():image block 原样进消息(UI 显示),仅为附件对象
     补建带扩展名的硬链接;
  2. `dsh-agent-loop` buildRequest():`bridgeImagesForModel` 在模型输入边界按
     模型模态改写——`llm.resolveModelInfo(provider, model)` 的 `inputModalities`
     非空且含 `image` 时默认不动;除非 dsh-aux `forceAuxVision` 开启,则
     一律改写为路径文本;否则(含未声明/空)改写为路径文本;
  3. `dsh-host-apiproxy` selectModel():允许在含图片会话中切换到纯文本模型,
     移除旧的"图片会话必须选图像模型"门控。
- **硬链接而非符号链接**:附件对象无扩展名,补丁在其旁创建 `<sha256>.png/.jpg/…`
  硬链接(符号链接会被视觉工具的 realpath() 穿透回无扩展名路径)。
- **多模态模型默认不受影响**:配了 `defaultInput: [text, image]` 的模型(如
  volcengine-ark/doubao-seed-2.0-lite)原生看图,不会降级为工具视觉;
  仅当设置页 `forceAuxVision` 开启时才强制改为 AUX 视觉。
- **旧消息兼容**:v1 时代已改写为文本的历史消息保持不变;新消息走 v2。
- **只删门控不改链路**:非图片消息走原路径;图片消息保留 image block,
  `serializeImageAdmission` 流程不变。
- 补丁文件:
  - `orig-block.txt` / `patched-block.txt`(api-proxy 原始/替换块)
  - `v1-block.txt`(v1 已打状态识别块,用于升级)
  - `orig-agent-loop-block.txt` / `patched-agent-loop-block.txt`(agent-loop 方法定义)
  - `orig-select-model-block.txt` / `patched-select-model-block.txt`(api-proxy selectModel 门控)
  - `orig-skill-tool-block.txt` / `patched-skill-tool-block.txt`(skill 工具 schema 可选 task 参数)
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
