#!/usr/bin/env node
/**
 * dsh-aux profile bundle 接线 —— 让 AUX 以官方 bundle 机制被 profile 选中。
 *
 * 为什么不再用 profile 补丁注入
 * ----------------------------
 * `cordis.patch.yml` 里那条 `- insert: - id: aux` 能让插件**加载**,但插件
 * 管理器(DSH 0.1.6 起的 Plugins 页)只看得到 bundle:它枚举的名字 = profile
 * 选中的 bundle ∪ profile 依赖 ∪ 安装锚点依赖。patch 注入的行不在其中,于是
 * AUX 不出现在插件页,用户也无法在页面上启用 / 停用 / 卸载它。
 *
 * AUX 包本身早已合规(`package.json` 声明了 `dsh.bundle.patch`),所以只需要
 * 把它选进 profile:
 *   1. `dependencies[<name>] = "file:<repo>/dsh-aux"`
 *   2. `dsh.profile.bundles` 含 `<name>`
 * 并且必须**移除**那条旧的 patch 注入 —— 否则 bundle 层与补丁层各插一行同 id
 * 的 `aux`,成为 loader 重复行。
 *
 * 幂等:重复运行不写第二份;--dry-run 只报告。
 *
 * 用法:
 *   node bridge/profile-bundle.mjs --profile-dir ~/.dsh/profiles/web
 *   node bridge/profile-bundle.mjs --all                  # 扫描 DSH_HOME 下提到本包的 profile
 *   node bridge/profile-bundle.mjs --all --dry-run
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const PACKAGE_DIR = join(REPO, "dsh-aux");
/**
 * The DSH_ROOT the caller set, captured before main() defaults it in place.
 * Callers that pin a deployment root but leave the profile home alone must not
 * have their real profile written to.
 */
export const CALLER_DSH_ROOT = process.env.DSH_ROOT;

function log(message) {
  console.log("[profile-bundle] " + message);
}

/** Keep one pre-edit copy of a profile file, so an install is always reversible. */
function backupFile(file) {
  if (!existsSync(file)) return void 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = file + ".bak-aux-" + stamp;
  copyFileSync(file, bak);
  return bak;
}

/** The installed-package spec a profile records for a local checkout. */
export function bundleSpec(packageDir) {
  return "file:" + packageDir;
}

/** The package this repo ships. */
export function readPackageName(packageDir = PACKAGE_DIR) {
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).name;
}

/**
 * An overlay that keeps no top-level list entry parses as YAML null, and DSH
 * rejects it ("must be a top-level YAML array of loader patch entries"). Keep
 * such a file an explicit empty array instead — comments may stay.
 *
 * @param text - the current cordis.patch.yml text.
 * @returns the normalized text and whether it changed.
 */
export function normalizeEmptyOverlay(text) {
  if (/^-\s/m.test(text)) return { text, changed: false };
  if (/^\[\]\s*$/m.test(text)) return { text, changed: false };
  const head = text.replace(/\s*$/, "");
  return { text: (head === "" ? "" : head + "\n") + "[]\n", changed: true };
}

/**
 * Why DSH would refuse this patch layer, if it would. DSH requires a top-level
 * YAML array of loader patch entries, and a comment-only (or empty) document
 * parses as `null`, which it rejects outright.
 *
 * @param text - the current cordis.patch.yml text.
 * @returns the reason, or undefined when the document is acceptable.
 */
export function overlayProblem(text) {
  const meaningful = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (meaningful.length === 0) return "补丁层只剩注释:YAML 会解析成 null";
  if (meaningful.length === 1 && meaningful[0] === "[]") return void 0;
  if (!meaningful.some((line) => /^-\s/.test(line))) return "补丁层没有顶层列表项";
  return void 0;
}

/**
 * Drop the one top-level patch entry that names the package, together with the
 * comment run that introduces it. Unrelated entries and the header comment stay
 * untouched.
 *
 * @param text - the current cordis.patch.yml text.
 * @param packageName - the package name to look for.
 * @returns the rewritten text and whether anything was removed.
 */
export function stripLegacyPatch(text, packageName) {
  const lines = text.split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (/^-\s/.test(lines[i])) starts.push(i);
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    // One entry runs until the next line that starts at column 0 — the following
    // entry's "-" or its introducing comment. Blank lines inside an entry belong
    // to it; a column-0 comment never does.
    let end = start + 1;
    while (end < lines.length && !/^\S/.test(lines[end])) end += 1;
    const block = lines.slice(start, end).join("\n");
    // Match the entry's own `name:` value exactly. A substring test would also
    // remove an unrelated plugin's entry that merely mentions this package.
    const nameLine = block.match(/^[ \t]+name:[ \t]*(.*)$/m);
    if (nameLine === null) continue;
    const rawName = nameLine[1].trim();
    const quotedName = rawName.match(/^["']([^"']+)["']/);
    if ((quotedName !== null ? quotedName[1] : rawName.split("#")[0].trim()) !== packageName) continue;
    // Take the comment run written directly above the entry — never across a
    // blank line, which is what separates it from the file header or a neighbour.
    let from = start;
    while (from > 0 && /^\s*#/.test(lines[from - 1])) from -= 1;
    const run = lines.slice(from, start).join("\n");
    if (!(run.includes(packageName) || /dsh-aux/i.test(run))) from = start;
    const before = lines.slice(0, from);
    const after = lines.slice(end);
    while (before.length > 0 && before[before.length - 1].trim() === "") before.pop();
    while (after.length > 0 && after[0].trim() === "") after.shift();
    const out = before.length > 0 && after.length > 0 ? [...before, "", ...after] : [...before, ...after];
    const normalized = normalizeEmptyOverlay(out.join("\n"));
    return {
      text: normalized.text,
      removed: true,
      emptied: normalized.changed,
      removedLines: lines.slice(from, end),
    };
  }
  return { text, removed: false, removedLines: [] };
}

/**
 * Last-resort wiring for a deployment that has no profile yet: DSH creates the
 * profile on its own first run, so a fresh install writes the patch entry it has
 * always written, and the next start-up self-heal migrates that to a bundle once
 * the profile manifest exists.
 *
 * @returns whether the entry was written.
 */
export function ensureLegacyPatch(profileDir, packageName) {
  const patchPath = join(profileDir, "cordis.patch.yml");
  const current = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "";
  if (stripLegacyPatch(current, packageName).removed) return false;
  // An explicit empty flow sequence must go first: a block sequence may not
  // follow `[]`, and DSH refuses the document that results.
  const base = current.replace(/^[ \t]*\[\][ \t]*$/gm, "").replace(/\s+$/, "");
  const block =
    '# dsh-aux: auxiliary model system (host plane row)\n- insert:\n    - id: aux\n      name: "' + packageName + '"\n';
  mkdirSync(profileDir, { recursive: true });
  // Keep a blank line before the block so a later strip cannot absorb an
  // unrelated comment run that ends this file.
  writeFileSync(patchPath, (base === "" ? "" : base + "\n\n") + block);
  return true;
}

/**
 * Add the bundle selection and the file: dependency to a parsed profile manifest.
 *
 * @param data - the parsed profile package.json (mutated in place).
 * @param options - package name and the local directory it lives in.
 * @returns whether anything changed and what did.
 */
export function ensureBundleWiring(data, options) {
  const { packageName, packageDir } = options;
  const notes = [];
  const plain = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  // Validate every container BEFORE touching anything: a wrong-typed container
  // would swallow the wiring silently (a key assigned on an array survives until
  // JSON.stringify drops it again), and a report of "problem" must leave the
  // manifest exactly as it was.
  for (const key of ["dependencies", "dsh"]) {
    if (data[key] !== void 0 && !plain(data[key])) return { changed: false, notes, problem: key + " 不是对象" };
  }
  if (data.dsh?.profile !== void 0 && !plain(data.dsh.profile)) {
    return { changed: false, notes, problem: "dsh.profile 不是对象" };
  }
  if (data.dsh?.profile?.bundles !== void 0 && !Array.isArray(data.dsh.profile.bundles)) {
    return { changed: false, notes, problem: "dsh.profile.bundles 不是数组" };
  }
  const spec = bundleSpec(packageDir);
  const dependencyPresent = typeof data.dependencies?.[packageName] === "string";
  const selected = Array.isArray(data.dsh?.profile?.bundles) && data.dsh.profile.bundles.includes(packageName);
  // The plugin manager turns a bundle off by dropping it from `bundles` while
  // keeping the dependency, so that pair is a deliberate "install but disabled".
  // Re-selecting it here would silently undo the user's switch at every start.
  if (dependencyPresent && !selected) return { changed: false, notes, disabled: true };
  if (!dependencyPresent) {
    if (data.dependencies === void 0) data.dependencies = {};
    data.dependencies[packageName] = spec;
    notes.push('dependencies["' + packageName + '"] = "' + spec + '"');
  }
  if (!selected) {
    if (data.dsh === void 0) data.dsh = {};
    if (data.dsh.profile === void 0) data.dsh.profile = {};
    if (data.dsh.profile.bundles === void 0) data.dsh.profile.bundles = [];
    data.dsh.profile.bundles.push(packageName);
    notes.push("dsh.profile.bundles += " + packageName);
  }
  return { changed: notes.length > 0, notes };
}

/**
 * Wire one profile directory to load dsh-aux as a bundle.
 *
 * @param options - profile directory, package identity, and whether to write.
 * @returns a report describing what changed (or would change).
 */
export function planProfileBundle(options) {
  const { profileDir, packageName, packageDir, dryRun = false, legacyFallback = false } = options;
  const manifestPath = join(profileDir, "package.json");
  if (!existsSync(manifestPath)) {
    const report = { profileDir, skipped: "no-manifest" };
    if (legacyFallback) {
      const patchPath = join(profileDir, "cordis.patch.yml");
      const already = existsSync(patchPath) && stripLegacyPatch(readFileSync(patchPath, "utf8"), packageName).removed;
      report.legacyWritten = !already;
      report.dryRun = dryRun;
      if (!already && !dryRun) ensureLegacyPatch(profileDir, packageName);
    }
    return report;
  }
  const original = readFileSync(manifestPath, "utf8");
  let data;
  try {
    data = JSON.parse(original);
  } catch {
    return { profileDir, skipped: "unparsable-manifest" };
  }
  const wiring = ensureBundleWiring(data, { packageName, packageDir });
  if (wiring.problem !== void 0) return { profileDir, problem: wiring.problem };
  if (wiring.disabled === true) return { profileDir, disabled: true };
  const selected = data.dsh.profile.bundles.includes(packageName);
  const next = JSON.stringify(data, null, 2) + "\n";
  const patchPath = join(profileDir, "cordis.patch.yml");
  let patchNext = null;
  let removedLines = [];
  if (selected && existsSync(patchPath)) {
    const current = readFileSync(patchPath, "utf8");
    const stripped = stripLegacyPatch(current, packageName);
    if (stripped.removed) {
      patchNext = stripped.text;
      removedLines = stripped.removedLines;
    } else {
      // Repair an overlay already left entry-less by an earlier run.
      const normalized = normalizeEmptyOverlay(current);
      if (normalized.changed) patchNext = normalized.text;
    }
  }
  const manifestChanged = next !== original;
  const patchChanged = patchNext !== null;
  const backups = [];
  if (!dryRun) {
    if (manifestChanged) {
      const bak = backupFile(manifestPath);
      if (bak !== void 0) backups.push(bak);
      writeFileSync(manifestPath, next);
    }
    if (patchChanged) {
      const bak = backupFile(patchPath);
      if (bak !== void 0) backups.push(bak);
      writeFileSync(patchPath, patchNext);
    }
  }
  return { profileDir, manifestChanged, patchChanged, notes: wiring.notes, removedLines, backups, dryRun };
}

/** Render one plan result as a line for humans. */
export function describePlan(report) {
  if (report.skipped !== undefined) {
    const why = report.profileDir + ": 跳过(" + report.skipped + ")";
    if (report.legacyWritten === true) return why + " —— 已写补丁注入兜底,profile 建好后自愈会迁移成 bundle";
    if (report.legacyWritten === false) return why + " —— 补丁注入兜底已在位";
    return why;
  }
  if (report.disabled === true) {
    return report.profileDir + ": 已在 profile 依赖中但未选中 bundle(= 被停用),保持现状";
  }
  if (report.problem !== void 0) {
    return report.profileDir + ": ⚠️ 未接线 —— " + report.problem + "(请人工核对 profile 清单)";
  }
  const parts = [];
  if (report.manifestChanged) parts.push("profile package.json 已更新");
  if (report.patchChanged) {
    parts.push(
      report.removedLines.length > 0
        ? "已移除 patch 注入 " + report.removedLines.length + " 行"
        : "补丁层已归一为空数组(原来只剩注释,YAML 会解析成 null)",
    );
  }
  if (parts.length === 0) return report.profileDir + ": 已是 bundle 接入,无需改动";
  const backups = report.backups ?? [];
  return report.profileDir + ": " + parts.join(";") + (backups.length > 0 ? "(备份 " + backups.length + " 份)" : "");
}

/** Profile directories under a DSH home that already reference this package. */
export function findWiredProfiles(dshHome, packageName) {
  const root = join(dshHome, "profiles");
  if (!existsSync(root)) return [];
  const found = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    let stat = null;
    try {
      stat = statSync(dir);
    } catch {
      stat = null;
    }
    if (stat === null || !stat.isDirectory()) continue;
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    // Structured, not substring: a profile is ours only when the manifest really
    // depends on the package or selects it as a bundle, or when the patch layer
    // still carries our legacy insert.
    let mentions = false;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      mentions =
        typeof manifest?.dependencies?.[packageName] === "string" ||
        (Array.isArray(manifest?.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.includes(packageName));
    } catch {
      mentions = false;
    }
    if (!mentions && existsSync(join(dir, "cordis.patch.yml"))) {
      try {
        mentions = stripLegacyPatch(readFileSync(join(dir, "cordis.patch.yml"), "utf8"), packageName).removed;
      } catch {
        mentions = false;
      }
    }
    if (mentions) found.push(dir);
  }
  return found.sort();
}

function parseArgs(argv) {
  const options = {
    profileDirs: [],
    all: false,
    dryRun: false,
    legacyFallback: false,
    dshHome: process.env.DSH_HOME || join(process.env.HOME, ".dsh"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile-dir") options.profileDirs.push(argv[++i]);
    else if (arg === "--dsh-home") options.dshHome = argv[++i];
    else if (arg === "--all") options.all = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--legacy-fallback") options.legacyFallback = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("未知参数:" + arg);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help === true) {
    log("用法: --profile-dir <dir> | --all [--dsh-home <dir>] [--dry-run]");
    return;
  }
  const packageName = readPackageName();
  const dirs = options.profileDirs.filter((dir) => dir !== void 0);
  if (options.all) {
    for (const dir of findWiredProfiles(options.dshHome, packageName)) if (!dirs.includes(dir)) dirs.push(dir);
  }
  if (dirs.length === 0) {
    log("没有需要接线的 profile(未指定 --profile-dir,且 DSH_HOME 下没有提到 " + packageName + " 的 profile)");
    return;
  }
  for (const dir of dirs) {
    const report = planProfileBundle({
      profileDir: resolve(dir),
      packageName,
      packageDir: PACKAGE_DIR,
      dryRun: options.dryRun,
      legacyFallback: options.legacyFallback,
    });
    log((options.dryRun ? "[dry-run] " : "") + describePlan(report));
  }
}

const invokedDirectly =
  process.argv[1] !== void 0 && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
