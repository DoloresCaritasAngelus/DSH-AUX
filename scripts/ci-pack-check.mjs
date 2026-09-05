#!/usr/bin/env node
/**
 * ci-pack-check — npm 发布内容断言。
 *
 * `npm pack --dry-run --json` 解析发布文件清单:
 *   - 必含:包元数据、双语 README 快照、CREDITS/AI/LICENSE、cordis.patch.yml、核心 src;
 *   - 顶层只允许白名单条目(防止未来杂物混入发布包);
 *   - 禁止:私有工作区目录、node_modules、lockfile、日志、tgz。
 *
 * files 字段改错、漏文件、杂物混入,当场红。零第三方依赖。
 */
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (m) => {
  console.error(`❌ ${m}`);
  process.exit(1);
};

const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: join(REPO, "dsh-aux"),
  encoding: "utf8",
  shell: true,
});
if (r.status !== 0) fail(`npm pack --dry-run 失败:\n${r.stderr}`);
let data;
try {
  // npm pack 的 stdout 会混入 prepack 脚本(README 生成器)的输出,
  // JSON 数组从第一个 "[" 开始,此前内容一律忽略。
  const start = r.stdout.indexOf("[");
  if (start === -1) throw new Error("输出中未找到 JSON 数组");
  data = JSON.parse(r.stdout.slice(start));
} catch (error) {
  fail(`npm pack --json 输出无法解析: ${error.message}\n${r.stdout.slice(0, 500)}`);
}
const info = Array.isArray(data) ? data[0] : data;
const files = info.files.map((f) => f.path);

// 顶层白名单:src/** 之外,包根只允许这些条目
const TOP_ALLOW = new Set([
  "package.json",
  "README.md",
  "README.en.md",
  "CREDITS.md",
  "AI.md",
  "LICENSE",
  "cordis.patch.yml",
  "src",
]);
// 必含文件
const REQUIRED = [
  "package.json",
  "README.md",
  "README.en.md",
  "CREDITS.md",
  "AI.md",
  "LICENSE",
  "cordis.patch.yml",
  "src/index.js",
  "src/client.js",
];
// 禁止模式
const FORBIDDEN = [
  /^aux-notes\//,
  /^\.local/,
  /^node_modules\//,
  /package-lock\.json$/,
  /\.log$/,
  /\.tgz$/,
  /^\.vision-agent/,
];

const missing = REQUIRED.filter((f) => !files.includes(f));
const bad = files.filter((p) => FORBIDDEN.some((re) => re.test(p)));
const top = new Set(files.map((p) => p.split("/")[0]));
const stray = [...top].filter((t) => !TOP_ALLOW.has(t));

let ok = true;
if (missing.length) {
  console.error(`❌ 发布包缺少必需文件: ${missing.join(", ")}`);
  ok = false;
}
if (stray.length) {
  console.error(`❌ 发布包含白名单外顶层条目: ${stray.join(", ")}`);
  ok = false;
}
if (bad.length) {
  console.error(`❌ 发布包含禁止内容: ${bad.join(", ")}`);
  ok = false;
}
if (!ok) {
  console.error(`\n当前清单(${files.length} 个文件):`);
  console.error(files.join("\n"));
  process.exit(1);
}
console.log(`pack-check 通过(${files.length} 个文件,与 files 字段预期一致)。`);
