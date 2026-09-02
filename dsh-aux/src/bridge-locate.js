/**
 * Shared bridge-patch target locator.
 *
 * All dsh-aux bridge status checks previously hand-rolled relative paths,
 * which broke in non-standard layouts (source-tree with an extra directory,
 * pnpm, custom node_modules locations) and produced confusing `unknown`
 * states. This module centralizes target resolution:
 *
 *   - `require.resolve("@deepseek-ai/" + pkg)` first, which follows Node's
 *     normal module resolution (including pnpm symlinks and hoisted
 *     node_modules);
 *   - `DSH_ROOT` env fallback for symlink deployments where the repository
 *     lives outside the DSH tree;
 *   - relative candidates for symlink deploy and source-tree layouts;
 *   - ancestor `node_modules` search as a robust fallback when Node resolves
 *     the module through a symlink and `import.meta.url` points at the real
 *     repo path instead of the deployed `node_modules` path.
 *
 * @module @dolorescaritasangelus/dsh-aux/bridge-locate
 */
import { existsSync } from "node:fs";
import { readFile as readFileText } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);

/** Repository root containing `dsh-aux/package.json` (two levels up from src). */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Detect the DSH deployment root. Precedence:
 *  1. `DSH_ROOT` environment variable when it points at a deployment;
 *  2. `process.cwd()` when it directly contains `node_modules/@deepseek-ai`;
 *  3. common install locations under the current user's home.
 * Returns `undefined` when no deployment can be found.
 */
export function detectDshRoot() {
  // DSH_ROOT 显式指定时永远优先(CI/fake 部署也走这里)。
  if (process.env.DSH_ROOT) return process.env.DSH_ROOT;

  const home = homedir();
  // 仓库目录内运行时:仓库自身含测试用 node_modules,但它不是真实部署根。
  // 此时先看用户常用的部署根;如果存在才返回,否则返回 undefined 让调用方
  // 回退到仓库相对解析(源码树测试/无真实部署场景)。
  const cwdIsRepo = existsSync(join(process.cwd(), "dsh-aux", "package.json"));
  if (cwdIsRepo) {
    for (const candidate of [join(home, "dsh"), join(home, ".local/share/dsh"), "/opt/dsh"]) {
      try {
        if (existsSync(join(candidate, "node_modules/@deepseek-ai"))) return candidate;
      } catch {
        /* try next candidate */
      }
    }
    return void 0;
  }

  // DSH 服务启动时 cwd 即部署根(通常 ~/dsh);也兼容常见的安装位置。
  for (const candidate of [process.cwd(), join(home, "dsh"), join(home, ".local/share/dsh"), "/opt/dsh"]) {
    try {
      if (existsSync(join(candidate, "node_modules/@deepseek-ai"))) return candidate;
    } catch {
      /* try next candidate */
    }
  }
  return void 0;
}

/** Relative candidates, from shallowest to deepest source-tree layouts. */
function relativeCandidates(pkg) {
  const rels = [
    // symlink deploy: node_modules/@dolorescaritasangelus/dsh-aux/src
    //   -> ../../../@deepseek-ai/... (one level up from node_modules)
    `../../../@deepseek-ai/${pkg}/lib/index.js`,
    // source-tree layouts at various depths:
    //   <root>/dsh work/aux/dsh-aux/src -> ../../../node_modules (3 up)
    //   <root>/dsh work/aux/dsh-aux/src -> ../../../../node_modules (4 up)
    `../../../node_modules/@deepseek-ai/${pkg}/lib/index.js`,
    `../../../../node_modules/@deepseek-ai/${pkg}/lib/index.js`,
    `../../../../../node_modules/@deepseek-ai/${pkg}/lib/index.js`
  ];
  const paths = [];
  for (const rel of rels) {
    try {
      paths.push(fileURLToPath(new URL(rel, import.meta.url)));
    } catch {
      /* malformed candidate; skip */
    }
  }
  return paths;
}

/** DSH_ROOT env candidates, for symlink deployments outside the DSH tree. */
function envCandidates(pkg) {
  const root = process.env.DSH_ROOT;
  if (!root) return [];
  const candidates = [
    join(root, "node_modules/@deepseek-ai", pkg, "lib/index.js"),
    join(root, "@deepseek-ai", pkg, "lib/index.js")
  ];
  return candidates;
}

/**
 * DSH 部署根候选:DSH 启动脚本(start-dsh.sh)总是 cd 到部署根,故进程
 * cwd 即部署根;从它解析命中已打补丁的部署副本。
 */
function deployRootCandidates(pkg) {
  try {
    const req = createRequire(join(process.cwd(), "noop.js"));
    return [req.resolve("@deepseek-ai/" + pkg)];
  } catch {
    return [];
  }
}

/**
 * Search every ancestor of the real module path for a node_modules tree.
 * This covers source-tree/symlink layouts where the repo lives somewhere
 * under the DSH root but Node's import.meta.url has been realpathed out of
 * the symlinked node_modules path.
 */
function ancestorNodeModulesCandidates(pkg) {
  const start = dirname(fileURLToPath(import.meta.url));
  const candidates = [];
  let current = start;
  for (;;) {
    candidates.push(join(current, "node_modules/@deepseek-ai", pkg, "lib/index.js"));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return candidates;
}

/** All candidate paths for one patched package's `lib/index.js`. */
export function packageFileCandidates(pkg) {
  if (!/^[a-z0-9-]+$/.test(pkg)) {
    throw new Error(`bridge-locate: invalid package name "${pkg}"`);
  }
  const detectedRoot = detectDshRoot();
  const cwdIsRepo = existsSync(join(process.cwd(), "dsh-aux", "package.json"));
  // 真实部署权威模式:
  // - DSH 服务/脚本在部署根 cwd 运行时(detectDshRoot 返回该部署根);
  // - 或 CI/fake/显式设置 DSH_ROOT 时。
  // 仓库测试模式(仓库 cwd、无显式 DSH_ROOT)保留原有相对/require.resolve
  // 回退,以便测试使用仓库 node_modules 里的 DSH 官方依赖。
  const rootedAtRealDeployment =
    detectedRoot !== void 0 &&
    detectedRoot !== REPO_ROOT &&
    (process.env.DSH_ROOT !== void 0 || !cwdIsRepo);
  if (rootedAtRealDeployment) {
    return [join(detectedRoot, "node_modules/@deepseek-ai", pkg, "lib/index.js")];
  }

  const paths = [];
  // 部署根优先(DSH 运行时 cwd=部署根,命中已打补丁的部署副本)
  for (const candidate of deployRootCandidates(pkg)) {
    if (!paths.includes(candidate)) paths.push(candidate);
  }
  try {
    // The real packages are scoped (@deepseek-ai/dsh-*). Resolving the bare
    // package main returns its lib/index.js through package.json `main`.
    paths.push(require.resolve("@deepseek-ai/" + pkg));
  } catch {
    /* package may be absent in this deployment */
  }
  for (const candidate of [...envCandidates(pkg), ...relativeCandidates(pkg), ...ancestorNodeModulesCandidates(pkg)]) {
    if (!paths.includes(candidate)) paths.push(candidate);
  }
  return paths;
}

/** Resolve the first existing path for a patched package file, if any. */
export function resolvePackageFile(pkg) {
  for (const candidate of packageFileCandidates(pkg)) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* stat/access failed; try next */
    }
  }
  return void 0;
}

/** Read the first existing patched package file, if any. */
export async function readPackageFile(pkg) {
  for (const candidate of packageFileCandidates(pkg)) {
    try {
      return await readFileText(candidate);
    } catch {
      /* try next candidate */
    }
  }
  return void 0;
}
