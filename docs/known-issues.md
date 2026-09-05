# Known Issues / 已知问题

> 本页公开列出当前已确认、尚未修复的问题,避免重复报告。修复后会移入 CHANGELOG。
> 报告新问题请用 [issue 模板](https://github.com/DoloresCaritasAngelus/DSH-AUX/issues/new/choose)。

## KI-1 · `commandcode/xiaomi/mimo-v2.5` 视觉任务在 `/provider/v1` 通道失败

- **状态**:暂缓,未修复(2026-09-03 确认)
- **影响**:仅影响将 `vision_analyze` 路由到 `commandcode` 提供方的 `xiaomi/mimo-v2.5` 模型;其他任务与其他模型不受影响
- **现象**:带图请求报 `Invalid request parameters (other)` 或 `Stream ended without finish_reason (other)`;纯文本请求正常
- **根因**(排查结论):
  1. 该通道前置 Cloudflare 对非浏览器 User-Agent 有拦截(HTTP 403 / error 1010);
  2. 即使绕过 UA 层,`mimo-v2.5` 在 OpenAI 兼容的 `/provider/v1` 上也拒绝 `image_url` 形态的图片消息——同图换 `Qwen/Qwen3.8-Flash` 或 `MiniMaxAI/MiniMax-M3` 正常,推测该模型要求提供方原生图格式与专用通道。
- **规避**:把 vision 任务临时路由到上述任一其他模型(`/aux model vision <provider/model>`)
- **为什么不"换模型式修复"**:换模型只是绕过;真正修复需要为该提供方实现原生图格式适配(适配层代码级改动,风险与工作量较大),暂缓
- **涉及**:`dsh-aux/src/tools/vision.js`、`dsh-aux/src/index.js`(`_callRoute`)、`dsh-aux/src/route.js`(`classifyFailure` —— `INVALID_REQUEST` 目前归为 `other`,UI 只显示 `(other)`)
