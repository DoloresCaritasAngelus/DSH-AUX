#!/usr/bin/env node
/**
 * Shared target resolution + safety validation for dsh-aux bridge patch
 * installers.
 *
 * The patch scripts intentionally do not hardcode user absolute paths: they
 * resolve relative to this bridge directory (symlink deploy or source-tree
 * deploy). Before any read/write/rollback, `assertSafeTarget` verifies the
 * resolved path is actually inside a `node_modules/@deepseek-ai/...` package
 * and points at a `lib/index.js` file, so a misconfigured/symlinked layout
 * cannot redirect writes to an arbitrary path.
 *
 * @module dsh-aux-bridge-target
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * When DSH_ROOT is set (CI/fake-deployment smoke), bridge scripts resolve
 * targets directly under that deployment root instead of relying on the
 * repository's physical depth relative to a real DSH install.
 * Both legacy relative forms ("../../../@deepseek-ai/..." and
 * "../../../node_modules/@deepseek-ai/...") map to
 * "$DSH_ROOT/node_modules/@deepseek-ai/...".
 */
function dshRootCandidate(rel) {
  const root = process.env.DSH_ROOT;
  if (!root) return null;
  const withoutDots = rel.replace(/^(?:\.\.\/)+/, "");
  const withoutNodeModules = withoutDots.replace(/^node_modules\//, "");
  return join(root, "node_modules", withoutNodeModules);
}

/**
 * Resolve a patch target from the two supported deployment layouts.
 * Returns the first existing candidate, or the first candidate when neither
 * exists (so callers can still produce a useful "not found" error).
 * When DSH_ROOT is set, targets are resolved under that fake/real DSH root.
 */
export function deployedFile(symlinkRel, sourceRel) {
  if (process.env.DSH_ROOT) {
    const override = dshRootCandidate(symlinkRel) ?? dshRootCandidate(sourceRel);
    if (override) return override;
  }
  const candidates = [
    join(HERE, symlinkRel),
    join(HERE, sourceRel)
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

/**
 * Reject a patch target that is not inside node_modules/@deepseek-ai/... and
 * does not point at a lib/index.js file.
 * @param file absolute path to validate
 * @returns the same path (for chaining)
 */
export function assertSafeTarget(file) {
  const normalized = normalize(file);
  const parts = normalized.split(sep);
  const nmIndex = parts.lastIndexOf("node_modules");
  if (nmIndex < 0 || parts[nmIndex + 1] !== "@deepseek-ai") {
    throw new Error(
      `unsafe patch target: resolved path is not inside node_modules/@deepseek-ai (${file})`
    );
  }
  if (!normalized.endsWith(`${sep}lib${sep}index.js`)) {
    throw new Error(
      `unsafe patch target: expected .../lib/index.js (${file})`
    );
  }
  return file;
}

/**
 * Reject any target inside a @deepseek-ai package's `lib/` directory that is
 * not a `.js` file. This is used by self-heal for known-event-types.js as
 * well as lib/index.js.
 * @param file absolute path to validate
 * @returns the same path (for chaining)
 */
export function assertSafePackageFile(file) {
  const normalized = normalize(file);
  const parts = normalized.split(sep);
  const nmIndex = parts.lastIndexOf("node_modules");
  if (nmIndex < 0 || parts[nmIndex + 1] !== "@deepseek-ai") {
    throw new Error(
      `unsafe patch target: resolved path is not inside node_modules/@deepseek-ai (${file})`
    );
  }
  const libIndex = parts.indexOf("lib", nmIndex + 3);
  if (libIndex < 0 || !normalized.endsWith(".js")) {
    throw new Error(
      `unsafe patch target: expected .../lib/*.js (${file})`
    );
  }
  return file;
}

/** Validate a target before use; on failure print and exit 1. */
export function guardTarget(file, label) {
  try {
    return assertSafeTarget(file);
  } catch (error) {
    console.error(`[${label}] ${error.message}`);
    process.exit(1);
  }
}

/** Validate a package lib file (including lib/types/*.js) before use. */
export function guardPackageFile(file, label) {
  try {
    return assertSafePackageFile(file);
  } catch (error) {
    console.error(`[${label}] ${error.message}`);
    process.exit(1);
  }
}
