#!/usr/bin/env node
/**
 * gen-client-message-images — inline `dsh-aux/src/client/message-images.js` into
 * the shipped browser bundle `dsh-aux/src/client.js`.
 *
 * A client package has exactly one bundle entry (`exports["./client"]`) and the
 * bundle is a classic script (`window.__ModuleLoader__.load({ factory })`), so a
 * sibling source file cannot be imported at runtime. The module is therefore the
 * single source of truth and this generator copies it verbatim between markers.
 *
 * The generator also ENFORCES the module contract: no imports, no require —
 * official client APIs and owner props only.
 *
 * Usage:
 *   node scripts/gen-client-message-images.mjs          # rewrite the block
 *   node scripts/gen-client-message-images.mjs --check  # fail on drift (CI)
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MODULE_PATH = join(REPO, "dsh-aux/src/client/message-images.js");
export const BUNDLE_PATH = join(REPO, "dsh-aux/src/client.js");
export const BLOCK_START =
  "    /* @generated:message-images:start (source: dsh-aux/src/client/message-images.js; run node scripts/gen-client-message-images.mjs) */";
export const BLOCK_END = "    /* @generated:message-images:end */";

/** Remove block and line comments so only statements are inspected. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Assert the module is dependency-free: no import statements, no require calls.
 * @param source module text.
 */
export function assertDependencyFree(source) {
  const bare = stripComments(source);
  const offenders = [];
  if (/^\s*import\b/m.test(bare)) offenders.push("import statement");
  if (/\brequire\s*\(/.test(bare)) offenders.push("require() call");
  if (/\bimport\s*\(/.test(bare)) offenders.push("dynamic import()");
  if (offenders.length > 0) {
    throw new Error(
      "message-images.js must stay dependency-free (official client APIs only); found: " + offenders.join(", "),
    );
  }
}

/** Render the raw bundle block for one module source (indented for the factory). */
export function renderBlock(source) {
  assertDependencyFree(source);
  const body = source
    .replace(/^export /gm, "")
    .trimEnd()
    .split("\n")
    .map((line) => (line.trim().length === 0 ? "" : "    " + line))
    .join("\n");
  return BLOCK_START + "\n" + body + "\n" + BLOCK_END;
}

/**
 * The exact bundle text the generator would commit: the block inserted, then
 * the whole bundle formatted by the repo's Prettier. Formatting here (instead
 * of copying the module verbatim) keeps the format gate green without excluding
 * the bundle from formatting: the factory indentation is Prettier's, not ours.
 * @param bundle current bundle text.
 * @param source module text.
 * @returns formatted bundle text.
 */
export async function renderBundle(bundle, source) {
  const block = renderBlock(source);
  const existing = currentBlock(bundle);
  const replaced = existing === void 0 ? bundle.replace(BLOCK_START, block) : bundle.replace(existing, block);
  // The API does not load config files; resolve the repo's Prettier options so
  // the output matches the CLI's format gate byte for byte.
  const options = (await prettier.resolveConfig(BUNDLE_PATH)) ?? {};
  return await prettier.format(replaced, { ...options, filepath: BUNDLE_PATH });
}

/** Extract the current block from a bundle text, or undefined when absent. */
export function currentBlock(bundle) {
  const start = bundle.indexOf(BLOCK_START);
  if (start < 0) return void 0;
  const end = bundle.indexOf(BLOCK_END, start);
  if (end < 0) return void 0;
  return bundle.slice(start, end + BLOCK_END.length);
}

/** Whether the bundle already carries the formatted block for this source. */
export async function isInSync(bundle, source) {
  return (await renderBundle(bundle, source)) === bundle;
}

async function main() {
  const check = process.argv.includes("--check");
  const source = await readFile(MODULE_PATH, "utf8");
  const bundle = await readFile(BUNDLE_PATH, "utf8");
  if (currentBlock(bundle) === void 0) {
    console.error("message-images: bundle 中未找到生成块标记,请先插入标记再生成。");
    process.exit(1);
  }
  const rendered = await renderBundle(bundle, source);
  if (rendered === bundle) {
    console.log("message-images: 生成块已同步。");
    return;
  }
  if (check) {
    console.error("message-images: 生成块与源文件不同步。\n先跑 node scripts/gen-client-message-images.mjs 再提交。");
    process.exit(1);
  }
  await writeFile(BUNDLE_PATH, rendered, "utf8");
  console.log("message-images: 已把 src/client/message-images.js 内联进 client.js。");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
