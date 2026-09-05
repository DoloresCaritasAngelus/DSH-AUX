# 安全政策 / Security Policy

## 报告漏洞

请使用 GitHub 的**私密漏洞报告**(仓库 Security 标签页 → Report a vulnerability),不要用公开 issue 报告未披露的安全问题。

报告请尽量包含:

- 影响的 AUX 版本与 DSH 版本;
- 复现步骤或最小复现;
- 影响面评估(数据泄露 / SSRF / 提示注入 / 补丁绕过等)。

## 范围

- `dsh-aux/src/`(插件本体,含客户端设置页脚本)与 `bridge/`(本地补丁、自愈脚本);
- AUX 自带的 SSRF 防护(fetch 工具)、提示注入缓解、会话图片生命周期清理属于安全相关功能,欢迎负责任披露;
- DSH 官方包本身的问题不属于本仓库范围(上游为开源项目但不接受 Issues/PR,无代为转报的渠道;官方仓库:[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness))。

## 支持版本

- `main` 分支的最新 Release;
- `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2` 分支的最新 Release(仅安全修复)。

## 处理

单人维护,目标 **7 天内**响应;确认后尽快修复并发布补丁版本(`vX.Y.Z-fix.N`),并在 CHANGELOG 披露(涉及敏感细节的披露会做脱敏)。
