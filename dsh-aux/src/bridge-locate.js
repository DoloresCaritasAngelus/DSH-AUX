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

const require = createRequire(import.meta.url);

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
  const paths = [];
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
