/**
 * Shared bridge-patch target locator.
 *
 * All dsh-aux bridge status checks previously hand-rolled relative paths,
 * which broke in non-standard layouts (source-tree with an extra directory,
 * pnpm, custom node_modules locations) and produced confusing `unknown`
 * states. This module centralizes target resolution:
 *
 *   - relative candidates for symlink deploy and source-tree layouts;
 *   - `require.resolve(pkg + "/lib/index.js")` as the robust fallback,
 *     which follows Node's normal module resolution (including pnpm
 *     symlinks and hoisted node_modules).
 *
 * @module @dolorescaritasangelus/dsh-aux/bridge-locate
 */
import { existsSync } from "node:fs";
import { readFile as readFileText } from "node:fs/promises";
import { createRequire } from "node:module";
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

/** All candidate paths for one patched package's `lib/index.js`. */
export function packageFileCandidates(pkg) {
  const paths = relativeCandidates(pkg);
  try {
    paths.push(require.resolve(pkg + "/lib/index.js"));
  } catch {
    /* package may be absent in this deployment */
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
