/**
 * ESLint 平面配置(flat config)。
 * 范围:仓库内一等 JS(dsh-aux/src、bridge、scripts、tests)。
 * - eslint:recommended 兜底(未用变量、未定义引用、危险模式);
 * - Node 全局 + ESM;零第三方运行时依赖原则不受影响(本配置仅 devDependency)。
 * @type {import("eslint").Linter.Config[]}
 */
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", "bridge/retired/", "**/*.txt", "assets/"],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // 测试里以 t/assert 参数出现的占位与刻意留空的 catch 较多,降为提醒级,
      // 不阻塞 CI;真正的问题类型(recommended 其余规则)仍是 error。
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    // dsh-aux/src/client.js 是注入 DSH Web 的设置页脚本,跑在浏览器而非 Node。
    files: ["dsh-aux/src/client.js"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // client.js 内含 react-hooks/exhaustive-deps 的 eslint-disable 指令
      // (沿袭上游 DSH 代码习惯);未安装该插件,注册规则名为 off 使指令合法。
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
