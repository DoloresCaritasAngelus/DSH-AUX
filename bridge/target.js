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

/**
 * Read the `version` field of the package owning a patch target
 * (`.../lib/index.js` → sibling `package.json`). Returns null when unavailable.
 */
export function readPackageVersion(targetFile) {
  const pkgPath = join(dirname(targetFile), "..", "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8"));
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Whether an installed package version is on the rc.7+ line (or later), i.e.
 * DSH web settings are exposed dynamically via `settings.describe()` and the
 * rc.6-era allowlist/dynamic-expose patches are no longer applicable.
 * Matches `0.1.0-rc.7`, `0.1.0-rc.8`, … (rc number ≥ 7).
 */
export function isRc7OrNewer(version) {
  if (typeof version !== "string") return false;
  const match = /-[a-z0-9.-]*rc\.([0-9]+)/i.exec(version);
  return match !== null && Number(match[1]) >= 7;
}
