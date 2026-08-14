# Changelog

## 0.1.0(2026-08-15)— 正式版

- 自 0.1.0-rc.6 转正;功能不变,修复归属缓存覆盖 bug、gc-images 符号链接防逃逸
- image-bridge 集成为安装组件(install.sh 一键),/aux status 显示其状态
- 文档完善:README 面向用户重写、AI.md 安装指南、CONTRIBUTIONS.md 致谢

## 0.1.0-rc.6(2026-08-15)— 初始版本

- 统一辅助 LLM 路由服务 `ctx.auxLlm`:任务分派、路由解析(显式配置 > 任务默认 > 主模型)、
  超时(默认 60s)、并发信号量(默认 2)、失败冷却(3 次/60s)、主模型降级、聚合错误 `AuxCallError`
- 三个辅助任务工具:`vision_analyze`(focus-hint 意图感知,question 必填)、
  `web_extract`(HTML 清洗 + 无 web provider 时回退全局 fetch)、`compress_text`
- 事件溯源:每次调用写 `aux/llm-call` 会话事件 + `aux-status` 投影
- `/aux` 命令:status / model / gc-images / vision / test / memory
- client 设置页 + composer 状态 chip(仅列 active 供应商)
- 会话图片生命周期管理:归属记录(session-images.json)+ 事件驱动清理 +
  冷会话定时对账 + 手动 GC;共享引用保留、归档不误删;图片记忆(image-memory.json)
- 图片能力门:发起前查 `resolveModelInfo`,空模态视为未知放行
- 测试:63 项(aux)+ 4 项(bridge 逻辑),node:test 零依赖
- 文档:PRD / README / AI.md(面向 AI 安装代理)/ CONTRIBUTIONS.md / COMPARISON.md /
  SESSION-ATTACHMENT-GC.md / VISION-AGENT.md

### 配套(仓库 bridge/ 目录,独立于插件本体)

- image-bridge v2:纯文本主模型粘贴图片可用且 UI 保留缩略图(两段式:admit 保留
  image block,agent-loop 模型输入边界按模态改写),幂等安装/回滚
- settings 白名单补丁:设置页可写 aux 配置
