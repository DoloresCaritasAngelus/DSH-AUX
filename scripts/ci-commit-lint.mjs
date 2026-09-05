#!/usr/bin/env node
/**
 * ci-commit-lint — 提交主题必须符合 Conventional Commits(仓库自有规范)。
 *
 * 范围:origin/main..HEAD 的全部提交(PR 场景);main push 场景为空集,直接通过。
 * 豁免:GitHub 生成的 Merge 提交、Revert 提交。
 * 依赖:CI 的 test job 使用 fetch-depth: 0;本地运行需先 git fetch。
 * 零第三方依赖。
 */
import { execSync } from "node:child_process";

const RE = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([\w./-]+\))?!?: \S.{0,200}$/;

let subjects;
try {
  subjects = execSync("git log --format=%s origin/main..HEAD", { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
} catch (error) {
  console.error(`❌ 无法读取 origin/main..HEAD(是否已 fetch?): ${error.message}`);
  process.exit(1);
}

const bad = subjects.filter((s) => !RE.test(s) && !/^Merge /i.test(s) && !/^Revert "/.test(s));

if (bad.length > 0) {
  console.error(`❌ ${bad.length} 个提交不符合 Conventional Commits(规范见 CONTRIBUTING.md):`);
  for (const s of bad) console.error(`  - ${s}`);
  process.exit(1);
}
console.log(`commit-lint 通过(${subjects.length} 个提交)。`);
