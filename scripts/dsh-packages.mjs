/**
 * DSH 官方包清单(单一真相源:版本切换器与兼容同步器共用一份)。
 *
 * 这些名字必须与 npm 上 `@deepseek-ai/` 下的真实包名一致:名单缺项时 npm 只会让该包停在
 * 别的版本而不报错,因此 sync-compat 对 devDependencies / overrides 的缺项直接报错。
 */

/** 版本随 DSH 发布线走、需要写进 devDependencies 的包。 */
export const DSH_VERSIONED_PACKAGES = [
  "dsh-agent",
  "dsh-agent-loop",
  "dsh-compaction-basic",
  "dsh-llm",
  "dsh-session",
  "dsh-settings",
  "dsh-timeout",
  "dsh-tool-fs",
  "dsh-tool-skill",
  "dsh-tool-subagent",
  "dsh-tool-web",
  "dsh-tools",
  "dsh-workflow-worker-thread",
];

/**
 * 全部需要锁到同一 DSH 版本的包(含传递依赖)。
 * 少列一个,该包就会按自己的 peer 范围解析出别的版本,造成混装。
 */
export const DSH_OVERRIDE_PACKAGES = [
  "dsh-agent",
  "dsh-agent-default-model",
  "dsh-agent-loop",
  "dsh-agent-presets",
  "dsh-api-gateway",
  "dsh-api-remotes",
  "dsh-api-session-controller",
  "dsh-api-settings-controller",
  "dsh-api-workspace-controller",
  "dsh-atomic-write",
  "dsh-attachment",
  "dsh-brand",
  "dsh-client-connection",
  "dsh-code-runtime",
  "dsh-commands",
  "dsh-compaction",
  "dsh-compaction-basic",
  "dsh-cordis-host-runner",
  "dsh-credentials",
  "dsh-file-reference",
  "dsh-goal",
  "dsh-home-paths",
  "dsh-host-directory-picker",
  "dsh-host-plugin-inventory",
  "dsh-host-webserver",
  "dsh-invariants",
  "dsh-jobs",
  "dsh-llm",
  "dsh-message-feedback",
  "dsh-native-command",
  "dsh-output-retention",
  "dsh-scope",
  "dsh-session",
  "dsh-session-persistence",
  "dsh-session-projection",
  "dsh-session-projection-cache",
  "dsh-session-query",
  "dsh-session-reference",
  "dsh-session-title",
  "dsh-settings",
  "dsh-skill",
  "dsh-storage",
  "dsh-storage-domain",
  "dsh-subagent",
  "dsh-system-prompt",
  "dsh-timeout",
  "dsh-token-meter",
  "dsh-tool-fs",
  "dsh-tool-skill",
  "dsh-tool-subagent",
  "dsh-tool-web",
  "dsh-tools",
  "dsh-typert-protocol",
  "dsh-typert-registry",
  "dsh-user-approval",
  "dsh-user-questions",
  "dsh-web",
  "dsh-workflow",
  "dsh-workflow-worker-thread",
  "dsh-workspace",
];

/**
 * 各支持线在 devDependencies 里必须额外出现的包(不在 DSH_VERSIONED_PACKAGES 内的)。
 * 新增一条支持线时若漏登记,`npm install` 会以 EOVERRIDE 失败(devDep 与 override 版本打架)。
 */
export const EXTRA_DEV_PACKAGES = {
  "0.1.5-alpha.1": ["dsh-api-session-controller"],
  "0.1.5-rc.2": ["dsh-api-session-controller"],
};
/**
 * AUX bridge 补丁的宿主包 → DSH 源码仓相对路径(rc.2 树的实测映射)。
 * 供 compat-delta 用 git diff 判断「这次版本变动有没有动到锚点所在的包」。
 * 路径随官方 monorepo 结构变化而变;映射失效时 compat-delta 会报「该版本里没有这个路径」。
 */
export const HOST_PACKAGE_PATHS = {
  "dsh-agent-loop": "packages/core/agent-loop",
  "dsh-api-session-controller": "packages/api/session-controller",
  "dsh-tool-subagent": "packages/subagent/tool-subagent",
  "dsh-workflow-worker-thread": "packages/workflow/workflow-worker-thread",
  "dsh-tool-skill": "packages/skill/tool-skill",
  "dsh-session": "packages/core/session",
  "dsh-session-format-v0-to-v1": "packages/session/session-format-v0-to-v1",
};
