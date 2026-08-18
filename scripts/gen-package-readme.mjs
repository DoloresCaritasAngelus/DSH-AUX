#!/usr/bin/env node
/**
 * gen-package-readme — 保持 npm 包 README(dsh-aux/README.md / .en.md)与
 * 唯一真相源(仓库根 README.md / README.en.md)同步。
 *
 * 背景/契约:dsh-aux 是仓库的子目录包,npm 发布取 dsh-aux/README.md。为避免
 * "第二份 README 漂移"(文档债),包内 README 是根 README 的**生成快照**+生成
 * banner;`prepack` 在 `npm pack`/`npm publish` 前自动再生成(U1,蓝图 §5#9,
 * `aux-notes/06-u1-readme-single-source.md`)。
 *
 * 用法:
 *   node scripts/gen-package-readme.mjs          # 写副本
 *   node scripts/gen-package-readme.mjs --check  # 只比对,不一致退出码非 0
 *
 * 导出(供 tests/readme-sync.test.js 复用,避免测试重复实现复制逻辑):
 *   buildPackageReadme(rootText, name) → string
 *   isInSync(rootText, destText, name) → boolean
 *   PAIRS → [{ root, dest, banner }]
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url)); // <repo>/scripts
const ROOT = join(HERE, ".."); // 仓库根
const PKG = join(ROOT, "dsh-aux"); // 包根(发布面)

/** (根 README 文件名, 包内副本, banner 名) —— 中英两对。 */
export const PAIRS = [
  { root: join(ROOT, "README.md"), dest: join(PKG, "README.md"), banner: "README.md" },
  { root: join(ROOT, "README.en.md"), dest: join(PKG, "README.en.md"), banner: "README.en.md" }
];

/** 把根 README 文本变成包内副本:顶部加"生成快照"banner,正文原样。 */
export function buildPackageReadme(rootText, name) {
  const banner = [
    "<!--",
    `  ${name} — generated snapshot of the repo-root <../../${name}> (single source of truth).`,
    "  DO NOT EDIT BY HAND. Regenerate with: npm run gen-package-readme",
    "  (runs automatically on prepack before npm pack/publish).",
    "-->",
    ""
  ].join("\n");
  return banner + rootText;
}

/** 包内副本是否与根 README(经生成器)一致。 */
export function isInSync(rootText, destText, name) {
  return destText === buildPackageReadme(rootText, name);
}

/** 读盘并逐对返回同步态。 */
export async function checkSync() {
  const rows = [];
  for (const p of PAIRS) {
    const rootText = await readFile(p.root, "utf8");
    let destText = null;
    try { destText = await readFile(p.dest, "utf8"); } catch { destText = null; }
    rows.push({ ...p, inSync: destText !== null && isInSync(rootText, destText, p.banner) });
  }
  return rows;
}

/** 从根 README 重写全部副本。 */
export async function sync() {
  for (const p of PAIRS) {
    const rootText = await readFile(p.root, "utf8");
    await writeFile(p.dest, buildPackageReadme(rootText, p.banner), "utf8");
  }
}

async function main() {
  if (process.argv.includes("--check")) {
    const rows = await checkSync();
    let bad = 0;
    for (const r of rows) {
      console.log(`${r.inSync ? "ok  " : "DIFF"} ${r.dest}`);
      if (!r.inSync) bad += 1;
    }
    if (bad > 0) {
      console.error(`\n${bad} 个包内 README 与根不同步。运行: npm run gen-package-readme`);
      process.exit(1);
    }
    console.log("包内 README 与仓库根 README 同步。");
    return;
  }
  await sync();
  console.log("已从仓库根 README 重新生成包内 README。");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
