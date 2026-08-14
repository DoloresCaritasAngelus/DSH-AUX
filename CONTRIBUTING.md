# 贡献指南

欢迎贡献!本仓库是 dsh-aux 辅助模型系统插件。

## 环境

- Node ≥ 20(测试用 Node 22 验证)
- 开发时插件符号链接进 DSH 部署目录(见 README 安装章节)

## 测试

```sh
cd tests && node --test aux.test.js       # 路由/降级/工具/生命周期(63 项)
cd tests && node --test bridge.test.js    # image-bridge v2 逻辑(4 项,无 agent-loop 时自动跳过)
```

测试零依赖、无网络。改动请保持测试全绿。

## 结构

- `dsh-aux/` — 插件包(host + client)
- `bridge/` — 可选本地补丁(image-bridge v2、settings 白名单)
- `tests/` — 测试
- 文档 MD — PRD / 设计 / 对比 / 贡献说明

## 提交

- 保持改动聚焦;涉及行为变更请补充测试
- README / AI.md 如有相关变更请同步更新
