/**
 * 仓库脚本可达性闸:仓库 `.gitignore` 用白名单管理 `scripts/`(忽略 `scripts/*`,
 * 再逐条 `!` 放行),因此新脚本忘记登记时不会报错,只会**静默不进版本控制** ——
 * CI 与测试都会拉不到它。这里把「被 CI / package.json / 测试引用的脚本必须已被 git 跟踪」钉住。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/** 收集文本里出现的 `scripts/<name>.mjs` 引用。 */
function referencedScripts(text) {
  return [...text.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)].map((m) => m[1]);
}

function trackedScripts() {
  const out = execFileSync("git", ["-C", REPO, "ls-files", "scripts"], { encoding: "utf8" });
  return new Set(
    out
      .split("\n")
      .filter(Boolean)
      .map((p) => p.replace(/^scripts\//, "")),
  );
}

test("CI 与测试引用的 scripts/*.mjs 必须被 git 跟踪(.gitignore 白名单漏登记 = 静默失效)", () => {
  let tracked;
  try {
    tracked = trackedScripts();
  } catch {
    return; // 非 git 工作树(例如 tarball)时跳过
  }

  const sources = [
    readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8"),
    readFileSync(join(REPO, "package.json"), "utf8"),
    readFileSync(join(REPO, "dsh-aux/package.json"), "utf8"),
    ...readdirSync(join(REPO, "tests"))
      .filter((f) => f.endsWith(".test.js"))
      .map((f) => readFileSync(join(REPO, "tests", f), "utf8")),
  ];

  const referenced = [...new Set(sources.flatMap(referencedScripts))].sort();
  assert.ok(referenced.length > 0, "没有解析到任何脚本引用,闸失效");

  const missing = referenced.filter((name) => !tracked.has(name));
  assert.deepEqual(
    missing,
    [],
    "以下脚本被 CI/测试引用但未被 git 跟踪(在 .gitignore 的 scripts/* 白名单里补 !scripts/<name>):" +
      missing.join(", "),
  );
});
