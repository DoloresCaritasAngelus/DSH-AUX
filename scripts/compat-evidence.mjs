#!/usr/bin/env node
/**
 * compat-evidence — 把「这次 DSH 版本适配确实成立」打成一块可粘贴的 markdown。
 *
 * 为什么需要:每次版本适配都要手工跑一串校验(doctor / self-heal dry-run /
 * apply-patch dry-run / P12-P13 词表 / 测试计数)再把结果抄进 PR 与 CHANGELOG,
 * 既慢又容易漏项。这里一次跑完并给出结构化结论。
 *
 * 用法:
 *   node scripts/compat-evidence.mjs [--dsh-root <path>] [--src <DSH 源码 clone>]
 *                                    [--with-tests] [--out <file>]
 *
 * --dsh-root 默认按 doctor.mjs 的探测顺序找部署;--src 给了就附上 compat-delta 结论;
 * --with-tests 会跑一次全量测试(默认跳过,因为耗时)。
 *
 * 退出码:0 证据已生成(与退出码无关地打印一致性判定);2 用法/环境错误。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const compat = JSON.parse(readFileSync(join(REPO, "compat.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(REPO, "dsh-aux/package.json"), "utf8"));

function detectRoot() {
  const explicit = argValue("--dsh-root") ?? process.env.DSH_ROOT;
  if (explicit) return explicit;
  const home = process.env.HOME ?? "";
  return [join(home, "dsh"), join(home, ".local/share/dsh"), "/opt/dsh"].find((c) =>
    existsSync(join(c, "node_modules/@deepseek-ai/dsh")),
  );
}

const root = detectRoot();
if (!root) {
  console.error("[compat-evidence] 找不到 DSH 部署根(用 --dsh-root 指定)");
  process.exit(2);
}

function run(cmd, argv, env) {
  try {
    const stdout = execFileSync(cmd, argv, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status ?? 1, out: String(error.stdout ?? "") + String(error.stderr ?? "") };
  }
}

const strip = (text) => text.split("\n").filter((l) => !/UNDICI-EHPA|trace-warnings/.test(l));
const parseJson = (text) => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

// 1. 部署侧 DSH 版本 vs compat.json 声明
const dshPkg = join(root, "node_modules/@deepseek-ai/dsh/package.json");
const dshVersion = existsSync(dshPkg) ? JSON.parse(readFileSync(dshPkg, "utf8")).version : "(未找到)";

// 2. doctor
const doctor = run(process.execPath, [join(HERE, "doctor.mjs"), "--json"], { DSH_ROOT: root });
let doctorSummary = "(doctor 执行失败)";
try {
  const parsed = parseJson(doctor.out);
  doctorSummary = parsed.errors + " error(s) / " + parsed.warnings + " warning(s)";
} catch {
  /* 保留兜底文案 */
}

// 3. bridge self-heal dry-run
const selfHeal = run(process.execPath, [join(REPO, "bridge/self-heal.mjs"), "--dry-run"], { DSH_ROOT: root });
const healLines = strip(selfHeal.out);
const healWarn = healLines.filter((l) => /WARN|锚点失效|可从.*升级/.test(l));
const healSkip = healLines.filter((l) => /跳过|已就绪|已是/.test(l)).length;
const p12 = healLines.filter((l) => /P12\/P13 已就绪/.test(l)).length;

// 4. apply-patch dry-run(必须带 DSH_ROOT,否则目标会解析到仓库上级)
const applyPatch = run(process.execPath, [join(REPO, "bridge/apply-patch.mjs"), "--dry-run"], { DSH_ROOT: root });
const applyTail = strip(applyPatch.out).filter(Boolean).pop() ?? "(无输出)";

// 5. 可选:compat-delta
const src = argValue("--src") ?? process.env.DSH_SRC;
let deltaLine = null;
if (src) {
  const delta = run(process.execPath, [
    join(HERE, "compat-delta.mjs"),
    "--from",
    argValue("--from") ?? "",
    "--to",
    argValue("--to") ?? "",
    "--src",
    src,
  ]);
  deltaLine =
    strip(delta.out)
      .filter((l) => l.includes("结论:"))
      .pop() ?? "(无结论)";
}

// 6. 可选:全量测试
let testLine = "(未运行;加 --with-tests)";
if (args.includes("--with-tests")) {
  const files = readdirSync(join(REPO, "tests"))
    .filter((f) => f.endsWith(".test.js"))
    .map((f) => join(REPO, "tests", f));
  const tests = run(process.execPath, ["--test", ...files]);
  const pass = /# pass (\d+)/.exec(tests.out)?.[1] ?? "?";
  const fail = /# fail (\d+)/.exec(tests.out)?.[1] ?? "?";
  testLine = pass + " pass / " + fail + " fail";
}

const ok = (cond) => (cond ? "✅" : "❌");
// 本地日期:toISOString 是 UTC,跨零点会把证据日期写早一天。
const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const lines = [
  "### DSH 兼容性证据(compat-evidence," + date + ")",
  "",
  "| 项 | 声明(compat.json) | 实测 | 一致 |",
  "|---|---|---|---|",
  "| DSH 版本 | `" + compat.dsh + "` | `" + dshVersion + "` | " + ok(dshVersion === compat.dsh) + " |",
  "| AUX 包版本 | `" + compat.package + "` | `" + pkg.version + "` | " + ok(pkg.version === compat.package) + " |",
  "| 测试基线 | " +
    compat.tests +
    " | " +
    testLine +
    " | " +
    (testLine.startsWith("(未运行") ? "—" : ok(testLine.startsWith(String(compat.tests) + " pass"))) +
    " |",
  "",
  "- bridge self-heal dry-run:" +
    healSkip +
    " 项「已 patched / 已就绪,跳过」," +
    healWarn.length +
    " 条 WARN/锚点告警 " +
    ok(healWarn.length === 0),
  "- P12/P13 词表:就绪 " + p12 + " 项(rc.2 全量为 8 项 disposition + 5 项 case,日志汇总行另计)",
  "- apply-patch dry-run:" + applyTail + "(退出码 " + applyPatch.code + ") " + ok(applyPatch.code === 0),
  "- doctor:" + doctorSummary + " " + ok(doctorSummary.startsWith("0 error")),
];
if (deltaLine) lines.push("- compat-delta:" + deltaLine);
lines.push(
  "",
  "复现命令:",
  "```bash",
  "node scripts/compat-evidence.mjs --dsh-root " +
    root +
    (src ? " --src <clone> --from <tagA> --to <tagB>" : "") +
    " --with-tests",
  "```",
  "",
);

const markdown = lines.join("\n");
const outFile = argValue("--out");
if (outFile) {
  writeFileSync(outFile, markdown);
  console.log("[compat-evidence] 已写入 " + outFile);
} else {
  console.log(markdown);
}
