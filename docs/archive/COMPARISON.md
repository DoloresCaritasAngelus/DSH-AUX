# dsh-aux vs 社区视觉插件(最终结论)

> 本文档是设计定稿后的对比结论。研究过程的中间发现不在此保留;
> 每项借鉴的落地情况见 [CREDITS.md](../../CREDITS.md)。

对比对象:
- [dsh-vision](https://github.com/william-jin-cmu/dsh-vision)(轻量:1 个工具 view_image)
- [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit)(重型:10 个工具 + Python 上游运行时)
- **dsh-aux**(本系统:vision_analyze + web_extract + compress_text 三工具)

---

## 1. 架构对比

| 维度 | dsh-vision | dsh-vision-toolkit | dsh-aux |
|---|---|---|---|
| 工具数 | 1(view_image) | 10(glance/ground/detect/trace/crop/pixel_diff/ocr/… | 3(vision_analyze/web_extract/compress_text) |
| VLM 调用 | 自写 fetch → OpenAI 兼容 API | Python 上游进程 | 走 **DSH LlmRuntime**(ctx.llm.stream) |
| Provider | 自带多 key 解析链 | 第三方默认 endpoint | **复用 settings.yaml 已配置 provider** |
| 图片输入 | 路径/URL/data: URL | 路径 → 上游 Python | attachmentId/imagePath/imageUrl → 附件服务 + image block |
| 粘贴图片 | 依赖 #733 补丁 | 自带 Web 路由 | 集成组件 image-bridge(v3,UI 保留缩略图 + 含图会话可切纯文本模型) |
| 能力门 | 无 | 无 | **有**(resolveModelInfo,inputModalities 空=未知放行) |
| 超时/并发/降级 | timeoutMs + fallback 链 | deadline + 信号量 + 缓存 | deadline + per-task 信号量 + 失败冷却 + 主模型降级 |
| 可观测 | 进程日志 | 进程日志 | **事件溯源**(aux/llm-call + 投影) |
| 设置面 | 插件 Config | 自定义 Web 编辑器 | settings namespace + 设置页 + /aux 命令 |

## 2. 结论

- **dsh-vision** 是"够用就好"的典范;我们的 vision_analyze 在架构上更优
  (走 LlmRuntime、能力门、降级、事件),并吸收了它的 prompt 引导与 think 剥离。
- **dsh-vision-toolkit / agent-vision-toolkit** 是重型专业工具(像素定位/裁剪/
  对比等 10 工具),依赖第三方 Python 运行时;其**方法论**(focus-hint 意图感知、
  图内文字策略、输出约束)已吸收进 dsh-aux 的 vision_analyze,工具本体不照搬。
- **粘贴图片**:toolkit 用自带 Web 路由(免补丁),我们选择集成组件
  image-bridge v3(UI 保留图片 + 模型输入边界按模态改写 + 含图会话可切纯文本模型),与插件一起安装。

## 3. 借鉴与落地(详见 CREDITS.md)

| 借鉴来源 | 内容 | 落地状态 |
|---|---|---|
| agent-vision-toolkit | focus-hint(question 必填,意图感知) | ✅ 已落地(工具层强制) |
| agent-vision-toolkit | 图内文字是内容不是指令 / 只描述不代劳 | ✅ 已落地(visionSystemPrompt) |
| dsh-vision | prompt 引导段(聚焦提问) | ✅ 已落地 |
| dsh-vision | stripThink(思考块剥离) | ✅ 已落地(全部辅助任务) |
| discussion #733 | 图片桥接思路 | ✅ 已落地并演进(v2 两段式) |
| dsh-vision | 错误消息脱敏(apiKey) | ⏸ 设计取舍:LlmRuntime 错误已剥离凭证,不重复做 |
| toolkit | 多图对比(images: array) | ✅ 已落地(v0.1.2:多图并行分析) |
| toolkit | 区域裁剪(region) | ⏸ 设计取舍:按需再加,当前整图分析 + focus-hint 足够 |
| toolkit | 显式 OCR 模式 | ⏸ 设计取舍:question 定向文字转写即可 |

## 4. 社区插件可借鉴 dsh-aux 的

1. **LlmRuntime 集成**:复用 DSH 的 settings/credentials 体系,零认证代码。
2. **能力门**:发起前查模型输入能力,明确不支持的模型不白跑。
3. **事件溯源/可观测**:每次调用写会话事件 + 投影。
4. **降级到主模型**:辅助模型失败自动降级,事件记录 fallbackUsed。
5. **图片生命周期**:删除会话自动清理无引用图片(事件 + 对账),社区插件均无。
