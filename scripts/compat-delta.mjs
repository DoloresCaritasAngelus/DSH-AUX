#!/usr/bin/env node
/**
 * compat-delta — 回答一个问题:这次 DSH 版本变动,动了 AUX 补丁的宿主包没有?
 *
 * 为什么需要:bridge/ 的补丁锚定 DSH 源码文本,升级 DSH 后第一件事不是跑测试,
 * 而是看宿主包源码有没有结构变更。只有 package.json / README / 文档变动时,锚点
 * 必然存活;出现源码变更才需要逐个复核(先例:0.1.5-rc.1 → rc.2 全是版本号替换,
 * 而 alpha.1 → rc.2 有 session-controller 的 reveal 动作与 core/session 的两个新事件)。
 *
 * 用 git diff 直接给结论,替代「装一遍再跑 dry-run 试错」。
 *
 * 用法:
 *   node scripts/compat-delta.mjs --from <tagA> --to <tagB> --src <DSH 源码 clone>
 *   DSH_SRC=<clone> node scripts/compat-delta.mjs --from <tagA> --to <tagB>
 *   node scripts/compat-delta.mjs --from <tagA> --to <tagB> --src <clone> --json
 *
 * 退出码:
 *   0  宿主包只有非源码变更(锚点不可能位移)
 *   1  有宿主包出现源码变更 ⇒ 需人工复核对应补丁锚点
 *   2  用法错误 / clone 不是 git 仓库 / 找不到 tag
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { HOST_PACKAGE_PATHS } from "./dsh-packages.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const FROM = argValue("--from");
const TO = argValue("--to");
const SRC = argValue("--src") ?? process.env.DSH_SRC;
const JSON_OUT = args.includes("--json");

if (!FROM || !TO || !SRC) {
  console.error("用法: node scripts/compat-delta.mjs --from <tagA> --to <tagB> --src <DSH 源码 clone> [--json]");
  console.error("clone 也可用环境变量 DSH_SRC 指定。");
  process.exit(2);
}

/** 非源码变更:这些文件的改动不会让补丁锚点失配。 */
const NON_CODE = /(^|\/)(package\.json|README[^/]*|[^/]*\.i18n\.yaml|[^/]*\.md|tsconfig[^/]*\.json)$/;

function git(argv) {
  return execFileSync("git", ["-C", SRC, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

if (!existsSync(SRC)) {
  console.error("[compat-delta] 源码目录不存在: " + SRC);
  process.exit(2);
}

try {
  git(["rev-parse", "--git-dir"]);
} catch {
  console.error("[compat-delta] 不是 git 仓库: " + SRC);
  process.exit(2);
}

for (const tag of [FROM, TO]) {
  try {
    git(["rev-parse", "--verify", "--quiet", tag + "^{commit}"]);
  } catch {
    console.error("[compat-delta] 找不到 tag: " + tag + " (先 git fetch <remote> --tags)");
    process.exit(2);
  }
}

const results = [];
for (const [pkg, path] of Object.entries(HOST_PACKAGE_PATHS)) {
  let files = [];
  let missing = false;
  try {
    // 路径在两个 tag 里都得存在,否则说明官方 monorepo 结构变了,映射表要更新。
    git(["cat-file", "-e", FROM + ":" + path]);
    git(["cat-file", "-e", TO + ":" + path]);
    files = git(["diff", "--name-only", FROM, TO, "--", path]).split("\n").filter(Boolean);
  } catch {
    missing = true;
  }
  const code = files.filter((f) => !NON_CODE.test(f));
  const other = files.filter((f) => NON_CODE.test(f));
  results.push({ pkg, path, missing, code, other });
}

const changed = results.filter((r) => r.code.length > 0);
const missing = results.filter((r) => r.missing);

if (JSON_OUT) {
  console.log(JSON.stringify({ from: FROM, to: TO, src: SRC, anchorRisk: changed.length > 0, results }, null, 2));
} else {
  console.log("[compat-delta] " + FROM + " -> " + TO + "  (src: " + SRC + ")");
  for (const r of results) {
    if (r.missing) {
      console.log("  ? " + r.pkg.padEnd(32) + "该版本里没有这个路径: " + r.path);
      continue;
    }
    const label = r.code.length > 0 ? "源码变更" : "仅非源码";
    console.log(
      "  " +
        (r.code.length > 0 ? "!" : "=") +
        " " +
        r.pkg.padEnd(32) +
        label +
        "  (源码 " +
        r.code.length +
        " / 其他 " +
        r.other.length +
        ")",
    );
    for (const f of r.code) console.log("      · " + f);
  }
  console.log("");
  if (missing.length > 0) {
    console.log(
      "[compat-delta] 结论: " +
        missing.length +
        " 个宿主包在这两个版本里找不到路径 ⇒" +
        " scripts/dsh-packages.mjs 的 HOST_PACKAGE_PATHS 映射已过期,先修映射,本次判定不成立。",
    );
  } else if (changed.length === 0) {
    console.log("[compat-delta] 结论:宿主包无源码变更 ⇒ bridge 补丁锚点不可能位移,无需改补丁代码。");
  } else {
    console.log(
      "[compat-delta] 结论: " +
        changed.length +
        " 个宿主包有源码变更 ⇒ 逐个复核补丁锚点" +
        "(bridge/*.txt 与 tests/*anchor*.test.js),再决定是否重切。",
    );
  }
}

// 映射过期时不能给「锚点安全」的结论(会让使用者误信),因此单列退出码 2。
process.exit(missing.length > 0 ? 2 : changed.length > 0 ? 1 : 0);
