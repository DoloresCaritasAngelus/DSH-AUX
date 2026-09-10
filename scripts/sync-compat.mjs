#!/usr/bin/env node
/**
 * sync-compat — DSH 兼容性与发布数字的同步器(单一真相源 = <repo>/compat.json)。
 *
 * 为什么存在:版本号、测试基线与包版本原本散落在 package.json(13 个 devDependencies +
 * 60 个 overrides)、CI 矩阵、doctor 支持范围、README 徽章与正文、TESTING / PROJECT /
 * PR 模板里;每次升级都要手工对齐,漏一处就产生静默漂移(先例:doctor.mjs 的支持范围停在
 * 0.1.2 线而主支声明早已是 0.1.5;README 徽章停在 576 而基线是 581)。
 *
 * 契约:
 *   - compat.json 是唯一可手改处,其余位置都是它的生成物或引用;
 *   - 每条规则的正则是**带锚点的精确匹配**,锚点失配即报错退出,不静默跳过 ——
 *     文档被改写导致锚点失效时这里第一个报错,而不是让数字悄悄过期;
 *   - --check 只比对不写盘,供 CI 当闸用。
 *
 * 用法:
 *   node scripts/sync-compat.mjs          # 写入所有生成物
 *   node scripts/sync-compat.mjs --check  # 只比对,漂移则退出码 1
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DSH_VERSIONED_PACKAGES, DSH_OVERRIDE_PACKAGES, EXTRA_DEV_PACKAGES } from "./dsh-packages.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CHECK = process.argv.includes("--check");
const compat = JSON.parse(readFileSync(join(ROOT, "compat.json"), "utf8"));

/** shields.io 徽章里 - 要写成 --。 */
const badgeVersion = (v) => v.replace(/-/g, "--");
/**
 * 锚点规则表。replace 返回整个匹配的新文本;捕获组由各规则自己拼回。
 * 一条规则失配 = 文档被改写:报错,而不是跳过。
 */
const RULES = [
  {
    id: "README badge:version",
    files: ["README.md", "README.en.md"],
    find: /(badge\/version-)[0-9A-Za-z.-]+(-blue)/,
    replace: (m) => m[1] + compat.package + m[2],
  },
  {
    id: "README badge:tests",
    files: ["README.md", "README.en.md"],
    find: /(badge\/tests-)\d+(-brightgreen)/,
    replace: (m) => m[1] + compat.tests + m[2],
  },
  {
    id: "README badge:DSH platform",
    files: ["README.md", "README.en.md"],
    find: /(badge\/DSH-)[0-9A-Za-z.-]+(-0078D4)/,
    replace: (m) => m[1] + badgeVersion(compat.dsh) + m[2],
  },
  {
    id: "README(zh) 兼容段:平台",
    files: ["README.md"],
    find: /(- \*\*平台\*\*：DSH )[0-9A-Za-z.-]+(（主支单版本）)/,
    replace: (m) => m[1] + compat.dsh + m[2],
  },
  {
    id: "README(zh) 兼容段:测试数",
    files: ["README.md"],
    find: /(`node --test tests\/\*\.test\.js`（)\d+( 项；文件清单与基线见)/,
    replace: (m) => m[1] + compat.tests + m[2],
  },
  {
    id: "README(en) compat:platform",
    files: ["README.en.md"],
    find: /(- \*\*Platform\*\*: DSH )[0-9A-Za-z.-]+( \(single supported line on the main branch\))/,
    replace: (m) => m[1] + compat.dsh + m[2],
  },
  {
    id: "README(en) compat:test count",
    files: ["README.en.md"],
    find: /(`node --test tests\/\*\.test\.js` \()\d+( tests\); file list and baseline in)/,
    replace: (m) => m[1] + compat.tests + m[2],
  },
  {
    id: "TESTING:兼容矩阵",
    files: ["TESTING.md"],
    find: /(- 当前 DSH 兼容矩阵:`)[^`]+(`)/,
    replace: (m) => m[1] + compat.dsh + m[2],
  },
  {
    id: "TESTING:基线数字",
    files: ["TESTING.md"],
    find: /(基线 \*\*)\d+(\*\*\()\d{4}-\d{2}-\d{2}/,
    replace: (m) => m[1] + compat.tests + m[2] + compat.snapshotDate,
  },
  {
    id: "TESTING:npmrc 示例版本",
    files: ["TESTING.md"],
    find: /(dsh-user-approval@)[0-9A-Za-z.-]+/,
    replace: (m) => m[1] + compat.dsh,
  },
  {
    id: "PROJECT:快照行",
    files: ["PROJECT.md"],
    find: /(> 🔻 快照（)\d{4}-\d{2}-\d{2}(）：包版本 `)[^`]+(` · 主支 DSH `)[^`]+(` · 测试基线 )\d+/,
    replace: (m) => m[1] + compat.snapshotDate + m[2] + compat.package + m[3] + compat.dsh + m[4] + compat.tests,
  },
  {
    id: "PROJECT:当前版本",
    files: ["PROJECT.md"],
    find: /(- 当前版本：`)[^`]+(`（`dsh-aux\/package\.json`）)/,
    replace: (m) => m[1] + compat.package + m[2],
  },
  {
    id: "PROJECT:当前支持",
    files: ["PROJECT.md"],
    find: /(\| 当前支持 \| DSH `)[^`]+(`（主支单版本，CI compat 矩阵同此） \|)/,
    replace: (m) => m[1] + compat.dsh + m[2],
  },
  {
    id: "PROJECT:测试基线",
    files: ["PROJECT.md"],
    find: /(🔻 基线 \*\*)\d+(\*\*（)\d{4}-\d{2}-\d{2}/,
    replace: (m) => m[1] + compat.tests + m[2] + compat.snapshotDate,
  },
  {
    id: "PROJECT:CI 矩阵",
    files: ["PROJECT.md"],
    find: /(compat job：DSH 矩阵 `\[)[^\]]+(\]`)/,
    replace: (m) => m[1] + compat.dsh + m[2],
  },
  {
    id: "CI:compat 矩阵",
    files: [".github/workflows/ci.yml"],
    find: /(dsh-version: \[)[^\]]+(\])/,
    replace: (m) => m[1] + compat.dsh + m[2],
  },
  {
    id: "CI:compat 注释",
    files: [".github/workflows/ci.yml"],
    find: /(# 主支只支持 )[^\s(（]+/,
    replace: (m) => m[1] + compat.dsh,
  },
  {
    id: "PR 模板:支持版本",
    files: [".github/pull_request_template.md"],
    find: /(主支支持 )[0-9A-Za-z.-]+([;；])/,
    replace: (m) => m[1] + compat.dsh + m[2],
  },
  {
    id: "AI.md:支持线",
    files: ["dsh-aux/AI.md"],
    find: /(- \*\*支持线\*\*:DSH `)[^`]+(`\(主支单版本\))/,
    replace: (m) => m[1] + compat.dsh + m[2],
  },
  {
    id: "AI.md:排障版本断言",
    files: ["dsh-aux/AI.md"],
    find: /(检查 DSH 版本 = `)[^`]+(`\(主支单版本\))/,
    replace: (m) => m[1] + compat.dsh + m[2],
  },
  {
    id: "status.js:支持线注释",
    files: ["dsh-aux/src/status.js"],
    find: /(Main branch supports DSH )[0-9A-Za-z.-]+( \(single version\))/,
    replace: (m) => m[1] + compat.dsh + m[2],
  },
];
/** 各支持线必须在 EXTRA_DEV_PACKAGES 登记,否则 devDependency 与 override 版本打架(EOVERRIDE)。 */
if (!Object.hasOwn(EXTRA_DEV_PACKAGES, compat.dsh)) {
  console.error(
    "[sync-compat] compat.json 的 DSH " +
      compat.dsh +
      " 未在 scripts/dsh-packages.mjs 的 EXTRA_DEV_PACKAGES 登记;" +
      "补一条(通常含 dsh-api-session-controller)后再跑。",
  );
  process.exit(2);
}

/** 结构化文件走 JSON 解析,不用正则碰格式。 */
const STRUCTURED = [
  {
    id: "package.json:devDependencies + overrides",
    file: "package.json",
    apply: (text) => {
      const pkg = JSON.parse(text);
      for (const name of [...DSH_VERSIONED_PACKAGES, ...EXTRA_DEV_PACKAGES[compat.dsh]]) {
        const key = "@deepseek-ai/" + name;
        if (!Object.hasOwn(pkg.devDependencies ?? {}, key)) {
          throw new Error("devDependencies 缺少 " + key + " —— 见 scripts/dsh-packages.mjs");
        }
        pkg.devDependencies[key] = compat.dsh;
      }
      for (const name of DSH_OVERRIDE_PACKAGES) {
        const key = "@deepseek-ai/" + name;
        if (!Object.hasOwn(pkg.overrides ?? {}, key)) {
          throw new Error("overrides 缺少 " + key + " —— 补进 scripts/dsh-packages.mjs");
        }
        pkg.overrides[key] = compat.dsh;
      }
      return JSON.stringify(pkg, null, 2) + "\n";
    },
  },
  {
    id: "dsh-aux/package.json:version",
    file: "dsh-aux/package.json",
    apply: (text) => {
      const pkg = JSON.parse(text);
      pkg.version = compat.package;
      return JSON.stringify(pkg, null, 2) + "\n";
    },
  },
];

const drift = [];
const failures = [];

/** 按文件聚合:同一文件的多条规则必须顺序累积,不能各自基于原文替换。 */
const pending = new Map();
const load = (rel) => {
  if (!pending.has(rel)) pending.set(rel, readFileSync(join(ROOT, rel), "utf8"));
  return pending.get(rel);
};

for (const rule of RULES) {
  for (const rel of rule.files) {
    const before = load(rel);
    if (!rule.find.test(before)) {
      failures.push(rel + ": 锚点失配 —— " + rule.id);
      continue;
    }
    const after = before.replace(rule.find, (...args) => rule.replace(args));
    if (after !== before) {
      drift.push(rel + ": " + rule.id);
      pending.set(rel, after);
    }
  }
}

for (const item of STRUCTURED) {
  const before = load(item.file);
  let after;
  try {
    after = item.apply(before);
  } catch (error) {
    failures.push(item.file + ": " + error.message);
    continue;
  }
  if (after !== before) {
    drift.push(item.file + ": " + item.id);
    pending.set(item.file, after);
  }
}

if (failures.length > 0) {
  console.error("[sync-compat] 锚点/结构失配(先修锚点,再谈同步):");
  for (const line of failures) console.error("  x " + line);
  process.exit(2);
}

if (drift.length === 0) {
  console.log("[sync-compat] 全部同步(DSH " + compat.dsh + " · 包 " + compat.package + " · 基线 " + compat.tests + ")");
  process.exit(0);
}

if (CHECK) {
  console.error("[sync-compat] 检测到 " + drift.length + " 处漂移(compat.json 是唯一真相源):");
  for (const line of drift) console.error("  x " + line);
  console.error("[sync-compat] 运行 node scripts/sync-compat.mjs 修正。");
  process.exit(1);
}

for (const [rel, text] of pending) writeFileSync(join(ROOT, rel), text);
console.log(
  "[sync-compat] 已写入 " +
    drift.length +
    " 处(DSH " +
    compat.dsh +
    " · 包 " +
    compat.package +
    " · 基线 " +
    compat.tests +
    "):",
);
for (const line of drift) console.log("  v " + line);
console.log(
  "[sync-compat] 提示:改了文档源后要再生派生视图 —— npm run gen-package-readme 与 " +
    "node scripts/gen-project-ai.mjs(两者都有闸,漏跑会在测试里报红)。",
);
