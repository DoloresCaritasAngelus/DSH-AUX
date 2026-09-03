#!/usr/bin/env node
/**
 * dsh-aux doctor — GitHub 安装用户的一键健康检查。
 *
 * 检查:
 *   1. DSH 部署根是否可探测;
 *   2. dsh-aux symlink 是否在;
 *   3. web profile 是否注册 aux;
 *   4. P1-P8/P11 bridge 补丁是否都已打(通过 apply-patch --dry-run 判断);
 *   5. P7 session ignorable 是否已打;
 *   6. P8 aux/llm-call 白名单是否在;
 *   7. start-dsh.sh 自愈 hook 是否在;
 *   8. DSH 版本是否在支持范围(0.1.2-alpha.2 ~ 0.1.2-rc.1)。
 *
 * 用法:
 *   node scripts/doctor.mjs
 *   node scripts/doctor.mjs --dsh-root /path/to/dsh --profile web
 *   node scripts/doctor.mjs --json
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const DRY_RUN = process.argv.includes("--dry-run"); // alias for no mutation
const JSON_OUT = process.argv.includes("--json");

const args = process.argv.slice(2);
function argValue(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : void 0;
}
const DSH_ROOT = process.env.DSH_ROOT || argValue("--dsh-root") || "";
const PROFILE = argValue("--profile") || "web";

const results = [];
function record(level, category, message) {
  results.push({ level, category, message });
  if (!JSON_OUT) console.log(`${level === "ERROR" ? "❌" : level === "WARN" ? "⚠️" : "✅"} [${category}] ${message}`);
}

function detectRoot() {
  if (DSH_ROOT) return DSH_ROOT;
  const home = process.env.HOME;
  const candidates = [join(home, "dsh"), join(home, ".local/share/dsh"), "/opt/dsh"];
  return candidates.find((c) => existsSync(join(c, "node_modules/@deepseek-ai/dsh")));
}

function readVersion(pkgPath) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version;
  } catch {
    return null;
  }
}

function main() {
  const root = detectRoot();
  if (root) process.env.DSH_ROOT = root; // 子脚本 apply-patch 需要 DSH_ROOT 解析目标
  if (!root) {
    record("ERROR", "dsh-root", "未找到 DSH 部署根(可用 --dsh-root 指定)");
  } else {
    record("OK", "dsh-root", root);
  }

  if (root) {
    // 1. dsh-aux symlink
    const auxTarget = join(root, "node_modules/@dolorescaritasangelus/dsh-aux");
    if (!existsSync(auxTarget)) {
      record("ERROR", "symlink", `dsh-aux symlink 缺失: ${auxTarget}`);
    } else {
      let ok = false;
      try {
        ok = realpathSync(auxTarget) === realpathSync(join(REPO, "dsh-aux"));
      } catch {
        ok = false;
      }
      record(ok ? "OK" : "WARN", "symlink", ok ? "dsh-aux symlink 指向当前仓库" : `dsh-aux symlink 存在但指向异常: ${auxTarget}`);
    }

    // 2. profile patch
    const patchFile = join(process.env.HOME, ".dsh/profiles", PROFILE, "cordis.patch.yml");
    if (!existsSync(patchFile)) {
      record("ERROR", "profile", `profile 补丁文件缺失: ${patchFile}`);
    } else {
      const patch = readFileSync(patchFile, "utf8");
      record(patch.includes("id: aux") ? "OK" : "ERROR", "profile", patch.includes("id: aux") ? `profile ${PROFILE} 已注册 aux` : `profile ${PROFILE} 未注册 aux`);
    }

    // 3. bridge patches dry-run
    const applyPatch = join(REPO, "bridge/apply-patch.mjs");
    if (existsSync(applyPatch)) {
      try {
        const out = execFileSync(process.execPath, [applyPatch, "--dry-run"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        });
        if (/(版本不匹配|未找到已知代码块|可从 .* 升级)/.test(out)) {
          record("ERROR", "patches", "存在未打的 bridge 补丁或版本不匹配(见上方 apply-patch 输出)");
        } else {
          record("OK", "patches", "P1-P8/P11 补丁均已打或已跳过");
        }
        if (!JSON_OUT) {
          for (const line of out.split("\n")) {
            const t = line.trim();
            if (t && !t.startsWith("(node:")) console.log(`    ${t}`);
          }
        }
      } catch (error) {
        record("ERROR", "patches", `apply-patch --dry-run 失败: ${error?.message ?? error}`);
      }
    } else {
      record("ERROR", "patches", `未找到 ${applyPatch}`);
    }

    // 4. P7 session ignorable
    const sessionFile = join(root, "node_modules/@deepseek-ai/dsh-session/lib/index.js");
    if (existsSync(sessionFile)) {
      const src = readFileSync(sessionFile, "utf8");
      record(src.includes("dsh-aux ignorable (local patch)") || src.includes("opts[1]?.ignorable") ? "OK" : "ERROR", "p7", src.includes("dsh-aux ignorable (local patch)") || src.includes("opts[1]?.ignorable") ? "P7 session ignorable 已打" : "P7 session ignorable 未打");
    } else {
      record("ERROR", "p7", `dsh-session 缺失: ${sessionFile}`);
    }

    // 5. P8 whitelist
    const whitelistFiles = [
      join(root, "node_modules/@deepseek-ai/dsh-session/lib/index.js"),
      join(root, "node_modules/@deepseek-ai/dsh-session/lib/types/known-event-types.js")
    ];
    for (const file of whitelistFiles) {
      if (!existsSync(file)) { record("ERROR", "p8", `白名单文件缺失: ${file}`); continue; }
      const src = readFileSync(file, "utf8");
      const hasAux = src.includes('"aux/llm-call"') || src.includes("'aux/llm-call'");
      record(hasAux ? "OK" : "ERROR", "p8", hasAux ? `${file.split("/node_modules/")[1]} 含 aux/llm-call` : `${file.split("/node_modules/")[1]} 缺 aux/llm-call`);
    }

    // 6. start hook
    const startSh = join(root, "start-dsh.sh");
    if (!existsSync(startSh)) {
      record("WARN", "start-hook", `未找到 start-dsh.sh: ${startSh}`);
    } else {
      const src = readFileSync(startSh, "utf8");
      record(src.includes("dsh-aux self-heal") ? "OK" : "WARN", "start-hook", src.includes("dsh-aux self-heal") ? "启动自愈 hook 已写入" : "启动自愈 hook 未写入(更新 DSH 后可能丢补丁)");
    }

    // 7. DSH version compatibility
    const dshVersion = readVersion(join(root, "node_modules/@deepseek-ai/dsh/package.json"));
    if (!dshVersion) {
      record("WARN", "version", "无法读取 @deepseek-ai/dsh 版本");
    } else if (["0.1.2-alpha.2", "0.1.2-alpha.3", "0.1.2-alpha.4", "0.1.2-alpha.5", "0.1.2-rc.1"].includes(dshVersion)) {
      record("OK", "version", `DSH ${dshVersion} 在支持范围(0.1.2-alpha.2 ~ 0.1.2-rc.1)`);
    } else {
      record("WARN", "version", `DSH ${dshVersion} 不在主支支持范围;旧版请使用 legacy 分支`);
    }
  }

  const errors = results.filter((r) => r.level === "ERROR").length;
  const warnings = results.filter((r) => r.level === "WARN").length;
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: errors === 0, errors, warnings, results }, null, 2));
  } else {
    console.log(`\n结果: ${errors === 0 ? "OK" : "有 ERROR"} — ${errors} error(s), ${warnings} warning(s)`);
  }
  process.exit(errors === 0 ? 0 : 1);
}

main();
