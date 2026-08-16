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
import { existsSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a patch target from the two supported deployment layouts.
 * Returns the first existing candidate, or the first candidate when neither
 * exists (so callers can still produce a useful "not found" error).
 */
export function deployedFile(symlinkRel, sourceRel) {
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

/** Validate a target before use; on failure print and exit 1. */
export function guardTarget(file, label) {
  try {
    return assertSafeTarget(file);
  } catch (error) {
    console.error(`[${label}] ${error.message}`);
    process.exit(1);
  }
}
