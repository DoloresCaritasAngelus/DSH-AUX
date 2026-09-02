/**
 * dsh-aux `/aux` command handling.
 *
 * @module @dolorescaritasangelus/dsh-aux/commands
 */
import { AUX_CALL_EVENT, AUX_DEBUG_EVENT, AUX_SETTINGS_NAMESPACE } from "./config.js";
import childProcess from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { AUX_TASKS, resolvePrimaryRoute } from "./route.js";
import { detectDshRoot } from "./bridge-locate.js";
import { gcImages } from "./images/gc.js";
import { handleMemoryCommand } from "./images/memory.js";
import { collectImageLibrary, collectImageLibraryEntries } from "./images/image-library.js";
import { deleteImage, deleteOrphans } from "./images/image-actions.js";
import { loadRetained, setRetained } from "./images/retention.js";
import { publishImageLibrary } from "./projection.js";
import { collectPlatformStatus, publishPlatformStatus } from "./status.js";
import { runVision } from "./tools/vision.js";
import { runWebExtract } from "./tools/web-extract.js";
import { runWebCrawl } from "./tools/web-crawl.js";
import { runCompress } from "./tools/compress.js";

/** Human-readable reason text for a status item/issue. */
function statusReasonText(reason) {
  return {
    "mode-native": "当前为 native",
    "mode-aux": "使用 AUX",
    "mode-compat": "compat 预留",
    "patch-ok": "补丁已装",
    "patch-missing": "补丁未装",
    "patch-partial": "补丁部分安装",
    "patch-v1": "旧版 v1 补丁,建议升级",
    "patch-unknown": "无法检测补丁状态,请运行 install.sh 或确认安装方式",
    "config-missing": "需配置任务模型",
    "dependency-missing": "缺少依赖",
    "skill-mode-native": "SKILL 模式为 native",
    "vision-disabled-image-bridge-enabled": "vision 关闭但 imageBridge 开启"
  }[reason] ?? reason;
}

/** Format one structured platform status item as a human-readable line. */
function formatStatusItem(entry) {
  const stateText = {
    enabled: "已启用",
    disabled: "未使用(原生)",
    unavailable: "不可用",
    fixing: "修复中",
    unknown: "无法检测"
  }[entry.state] ?? entry.state;
  const reason = statusReasonText(entry.reason);
  const mode = entry.mode ?? "aux";
  const patch = entry.patch ? ` [${entry.patch}]` : "";
  const detail = entry.detail ? ` (${entry.detail})` : "";
  return `${entry.key}: ${stateText}(${reason})${detail} [${mode}]${patch}`;
}

/** Parse common option pairs from an args array into a map. */
function parseOptions(args, optionNames) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (optionNames.includes(key)) {
        const value = args[i + 1];
        if (value !== void 0 && !value.startsWith("--")) {
          opts[key] = value;
          i += 1;
        } else {
          opts[key] = true;
        }
      }
    }
  }
  return opts;
}

/** Human text for one image-library entry. */
function formatImageEntry(entry) {
  const status = [];
  if (entry.orphan) status.push("孤儿");
  if (entry.shared) status.push("共享");
  if (entry.retained) status.push("固化");
  if (entry.memories.length > 0) status.push(`记忆×${entry.memories.length}`);
  const refs = entry.ownerSessions.length > 0 ? entry.ownerSessions.join(",") : "无归属";
  return `- ${entry.attachmentId}${entry.fileName ? ` (${entry.fileName})` : ""} [${status.join(" / ") || "正常"}] 引用:${refs}`;
}

/** /aux images — image library list/JSON. */
export async function handleImagesCommand(service, args) {
  const json = args.includes("--json");
  const opts = parseOptions(args, ["filter", "query", "limit", "offset", "session"]);
  const filter = opts.filter === true ? void 0 : String(opts.filter ?? "all");
  const query = opts.query === true ? void 0 : String(opts.query ?? "");
  const limit = opts.limit === true || opts.limit === void 0 ? void 0 : Number(opts.limit);
  const offset = opts.offset === true || opts.offset === void 0 ? 0 : Number(opts.offset);
  const sessionId = opts.session === true ? void 0 : String(opts.session ?? "");

  const entries = await collectImageLibraryEntries(service, {
    filter,
    query: query === "" ? void 0 : query,
    limit,
    offset,
    sessionId: sessionId === "" ? void 0 : sessionId
  });
  const snapshot = await collectImageLibrary(service);

  if (json) {
    return { kind: "success", text: JSON.stringify({ ...snapshot, entries }) };
  }
  const lines = [
    `图片库: 共 ${snapshot.counts.total} 张(共享 ${snapshot.counts.shared}, 孤儿 ${snapshot.counts.orphan}, 固化 ${snapshot.counts.retained}, 有记忆 ${snapshot.counts.withMemory})`,
    ...entries.map(formatImageEntry)
  ];
  return { kind: "success", text: lines.join("\n") };
}

/** /aux image <action> — delete/retain/orphan management. */
export async function handleImageCommand(service, args) {
  const action = args[0] ?? "";
  const json = args.includes("--json");
  const rest = args.slice(1).filter((arg) => arg !== "--json");
  const force = rest.includes("--force");
  const includeRetained = rest.includes("--include-retained");
  const valueArgs = rest.filter((arg) => !arg.startsWith("--"));

  const error = (text, code) => ({ kind: "error", text: code ? `${code}: ${text}` : text });

  try {
    if (action === "delete") {
      const id = valueArgs[0];
      if (id === void 0) return error("用法: /aux image delete <attachmentId> [--force]", "USAGE");
      const result = await deleteImage(service, id, { force });
      if (json) return { kind: "success", text: JSON.stringify(result) };
      return { kind: "success", text: `已删除图片 ${result.deleted}${result.freedBytes ? ` (释放 ${result.freedBytes} bytes)` : ""}` };
    }
    if (action === "gc-orphans" || action === "reclaim") {
      const result = await deleteOrphans(service, { includeRetained });
      if (json) return { kind: "success", text: JSON.stringify(result) };
      return {
        kind: "success",
        text: `孤儿回收完成: 删除 ${result.deleted.length} 张, 跳过 ${result.skipped.length} 张${result.freedBytes ? ` (释放 ${result.freedBytes} bytes)` : ""}`
      };
    }
    if (action === "retain" || action === "unretain") {
      const id = valueArgs[0];
      if (id === void 0) return error(`用法: /aux image ${action} <attachmentId>`, "USAGE");
      const retained = action === "retain";
      const result = await setRetained(id, retained);
      if (json) return { kind: "success", text: JSON.stringify({ ok: true, attachmentId: id, retained: result.retained }) };
      return { kind: "success", text: retained ? `已固化图片 ${id}` : `已取消固化图片 ${id}` };
    }
    if (action === "list" || action === "ls" || action === "") {
      return handleImagesCommand(service, args);
    }
    return error("用法: /aux image delete|gc-orphans|retain|unretain <attachmentId>", "USAGE");
  } catch (err) {
    const code = err?.code || "ERROR";
    return error(err?.message ?? String(err), code);
  } finally {
    // Any successful mutation should refresh the projection.
    if (["delete", "gc-orphans", "reclaim", "retain", "unretain"].includes(action)) {
      publishImageLibrary(service).catch(() => {});
    }
  }
}

/** Handle the /aux command. */
export async function handleAuxCommand(service, agent, rawInput) {
  const args = rawInput.trim().split(/\s+/).filter(Boolean);
  const sub = args[0] ?? "";
  if (sub === "gc-images") {
    const days = args[1] === void 0 ? 30 : Number(args[1]);
    if (!Number.isInteger(days) || days <= 0) {
      return { kind: "error", text: "用法: /aux gc-images [days] — 清理超过 N 天的附件图片(默认 30)" };
    }
    return await gcImages(days);
  }
  if (sub === "model") {
    return await handleModelCommand(service, args.slice(1));
  }
  if (sub === "vision") {
    return await handleVisionCommand(service, agent, args.slice(1));
  }
  if (sub === "test") {
    return await handleTestCommand(service, agent, args.slice(1));
  }
  if (sub === "memory") {
    return await handleMemoryCommand(args.slice(1));
  }
  if (sub === "images") {
    return await handleImagesCommand(service, args.slice(1));
  }
  if (sub === "image") {
    return await handleImageCommand(service, args.slice(1));
  }
  if (sub === "history") {
    return await handleHistoryCommand(service, agent, args.slice(1));
  }
  if (sub === "debug") {
    return await handleDebugCommand(service, agent, args.slice(1));
  }
  if (sub === "patch") {
    return await handlePatchCommand(service, args.includes("--json"));
  }
  if (sub === "status" || sub === "") {
    // 状态命令保持只读:不在这里触发 reconcileSessionImages,避免持久化列表
    // 暂时不可用时状态查看变成删除附件的副作用。
    if (args.includes("--json")) {
      const status = await collectPlatformStatus(service);
      return { kind: "success", text: JSON.stringify(status) };
    }
    const status = await collectPlatformStatus(service);
    const lines = ["辅助模型系统状态:"];
    lines.push(`  🔒 核心保护:${status.core?.count ?? 0} 项已生效(图片生命周期 / 会话图片安全 / 失败冷却 / 事件审计,不可关闭)`);
    if (status.restartRequired === true) {
      lines.push("  ⚠️ 补丁已写入,重启 DSH 后生效");
    }
    lines.push(`  - forceAuxVision: ${service.forceAuxVision ? "开启(原生图片也走 AUX 视觉)" : "关闭"}`);
    lines.push(`  - visionFallbackToMain: ${service.visionFallbackToMain ? "开启(失败回退主模型)" : "关闭(视觉失败直接失败)"}`);
    for (const entry of status.items ?? []) {
      lines.push("  - " + formatStatusItem(entry));
    }
    lines.push(
      "  - 会话事件记录: " +
        (status.eventsSupported ? "已启用(ignorable 补丁已装)" : "已停用(缺 dsh-session ignorable 补丁,运行 bridge/patch-session-ignorable.mjs 或 install.sh 启用)")
    );
    for (const entry of service.describe()) {
      const primary = entry.primary
        ? `${entry.primary.provider}/${entry.primary.model}`
        : "(未配置 → 主模型)";
      lines.push(
        `  - ${entry.label}(${entry.task}): ${primary} | timeout ${entry.timeoutMs}ms | 并发 ${entry.maxConcurrency}`
      );
    }
    const recent = recentCalls(agent);
    if (recent.length > 0) {
      lines.push("");
      lines.push("最近辅助调用:");
      for (const call of recent) {
        const callState = call.ok ? "成功" : "失败";
        const fallback = call.fallbackUsed ? " (已降级)" : "";
        const error = call.ok ? "" : ` [${call.errorCode ?? "error"}]`;
        lines.push(
          `  - ${call.task}: ${call.provider}/${call.model} ${callState}${fallback}${error} ${call.durationMs}ms`
        );
      }
    }
    // 版本/补丁不匹配的醒目提示:任何仍需要打补丁的项,在状态顶部直接建议
    // 用户运行 ./update.sh,而不是只靠分散的小字。
    const patchIssues = (status.issues ?? []).filter((issue) => issue.action === "patch");
    if (patchIssues.length > 0) {
      lines.splice(1, 0,
        "",
        "⚠️ 检测到 dsh-aux 补丁缺失/版本不匹配,请运行 ./update.sh 或更新 dsh-aux:",
        ...patchIssues.map((issue) => `  - ${issue.key}: ${statusReasonText(issue.reason)}`)
      );
    }
    return { kind: "success", text: lines.join("\n") };
  }
  return {
    kind: "error",
    text: "用法: /aux status [--json] — 查看各任务路由与最近调用; /aux history [N] / /aux history full [N] — 简要/全部溯源; /aux debug [N] — 查看内容真相; /aux patch — 重打补丁; /aux model <task> [provider/model] — 查看或设置任务的辅助模型"
  };
}

/**
 * /aux history [N] — 简要溯源:最近 N 次辅助调用(默认 10,按时间新→旧)。
 * /aux history full [N] — 全部溯源:完整事件字段(默认全部事件,可用 N 取
 * 最近 N 条)。数据来自会话里每次 AUX_CALL_EVENT 事件日志(事件溯源)。
 * 当 `aux.debug.debugEventsInHistory` 开启时,AUX_DEBUG_EVENT 也会混入统计。
 */
export function handleHistoryCommand(service, agent, args) {
  const full = args[0] === "full";
  const limitArg = full ? args[1] : args[0];
  let limit = full ? Infinity : 10;
  if (limitArg !== void 0) {
    limit = Number(limitArg);
    if (!Number.isInteger(limit) || limit < 0) {
      return { kind: "error", text: "用法: /aux history [N] | /aux history full [N] — N 为非负整数条数" };
    }
  }
  const includeDebug = service?.debugConfig?.debugEventsInHistory === true;
  const events = (agent?.session?.events ?? []).filter((event) =>
    event?.type === AUX_CALL_EVENT ||
    (includeDebug && event?.type === AUX_DEBUG_EVENT)
  );
  if (events.length === 0) {
    return {
      kind: "success",
      text: `${full ? "全部溯源" : "简要溯源"}:本会话暂无辅助调用记录。\n提示:事件溯源需要 dsh-session ignorable 补丁(见 /aux status 的\u201C会话事件记录\u201D)。`
    };
  }
  const rows = events.map((event, index) => {
    const d = event.data ?? {};
    const seq = event.seq ?? index + 1;
    const provider = d.provider || "(未配置)";
    const model = d.model || "(主模型)";
    const duration = typeof d.durationMs === "number" ? `${d.durationMs}ms` : "-";
    if (!full) {
      const status = d.ok ? "成功" : "失败";
      const error = d.ok ? "" : ` [${d.errorCode ?? (d.error !== void 0 ? "error" : "")}]`;
      const fallback = d.fallbackUsed ? " (已降级)" : "";
      return `  #${seq} ${d.task}: ${provider}/${model} ${status}${error}${fallback} ${duration}`;
    }
    const parts = [`#${seq} ${d.task}`, `路由 ${provider}/${model}`, d.ok ? "成功" : "失败", duration];
    if (!d.ok && d.errorCode !== void 0) parts.push(`error=${d.errorCode}`);
    if (!d.ok && d.error !== void 0) parts.push(`error=${typeof d.error === "string" ? d.error : JSON.stringify(d.error)}`);
    if (d.fallbackUsed) parts.push("已降级");
    if (typeof d.inputChars === "number") parts.push(`输入 ${d.inputChars} chars`);
    if (typeof d.outputChars === "number") parts.push(`输出 ${d.outputChars} chars`);
    if (d.input !== void 0) parts.push(`input=${typeof d.input === "string" ? d.input.slice(0, 200) : JSON.stringify(d.input).slice(0, 200)}`);
    if (d.output !== void 0) parts.push(`output=${typeof d.output === "string" ? d.output.slice(0, 200) : JSON.stringify(d.output).slice(0, 200)}`);
    if (d.purpose !== void 0) parts.push(`purpose=${d.purpose}`);
    return `  ${parts.join(" | ")}`;
  });
  const chosen = Number.isFinite(limit) ? (limit === 0 ? [] : rows.slice(-limit)) : rows;
  const header = full
    ? `全部溯源(共 ${rows.length} 次${Number.isFinite(limit) ? `,显示最近 ${chosen.length} 次` : ""}):`
    : `简要溯源(最近 ${chosen.length} 次,共 ${rows.length} 次);完整信息用 /aux history full:`;
  return { kind: "success", text: [header, ...chosen.reverse()].join("\n") };
}

/**
 * /aux debug [N] — 查看当前会话的 AUX debug/内容真相事件(默认最近 10 条)。
 * 这些事件带 ignorable 标记,不进模型上下文;需要完整工具追踪时先开启
 * aux.debug.fullToolTrace。
 */
/**
 * Resolve a `/aux debug` target to a session id.
 * Supports `@this`/`@current`, exact session id, id prefix, and cwd substring.
 * Returns `{ id, label }` or `{ error }`.
 */
async function resolveDebugTarget(service, raw, currentId) {
  let token = raw;
  if (token.startsWith("@")) token = token.slice(1);
  if (token === "" || token === "this" || token === "current") {
    if (!currentId) return { error: { kind: "error", text: "当前会话无 id,无法解析 @this" } };
    return { id: currentId, label: "当前会话" };
  }
  if (currentId !== void 0 && (token === currentId || currentId.startsWith(token))) {
    return { id: currentId, label: "当前会话" };
  }
  let sp;
  try {
    sp = service.ctx.get("sessionPersistence");
  } catch {
    sp = void 0;
  }
  if (!sp || typeof sp.list !== "function") {
    return { error: { kind: "error", text: "sessionPersistence 不可用,无法解析目标会话" } };
  }
  let headers;
  try {
    headers = await sp.list();
  } catch (error) {
    return { error: { kind: "error", text: "读取会话列表失败: " + (error?.message ?? String(error)) } };
  }
  const exact = headers.find((h) => h.id === token);
  if (exact !== void 0) return { id: exact.id, label: exact.id };
  const idMatches = headers.filter((h) => h.id.startsWith(token));
  if (idMatches.length === 1) return { id: idMatches[0].id, label: idMatches[0].id };
  if (idMatches.length > 1) {
    return { error: { kind: "error", text: `目标不唯一,匹配 ${idMatches.length} 个会话: ${idMatches.map((m) => m.id).join(", ")}` } };
  }
  const cwdMatches = headers.filter((h) => typeof h.cwd === "string" && h.cwd.toLowerCase().includes(token.toLowerCase()));
  if (cwdMatches.length === 1) return { id: cwdMatches[0].id, label: `${cwdMatches[0].id} (${cwdMatches[0].cwd})` };
  if (cwdMatches.length > 1) {
    return { error: { kind: "error", text: `目标不唯一,匹配 ${cwdMatches.length} 个会话: ${cwdMatches.map((m) => m.id).join(", ")}` } };
  }
  return { error: { kind: "error", text: `未找到会话: ${raw}` } };
}

/** Format debug events into human-readable lines. */
function formatDebugEvents(events) {
  return events.map((event, index) => {
    const d = event.data ?? {};
    const seq = event.seq ?? index + 1;
    const parts = [`#${seq} ${d.kind ?? "debug"}`, d.task ?? "", d.ok === true ? "成功" : d.ok === false ? "失败" : ""];
    if (typeof d.provider === "string" && d.provider !== "") parts.push(`路由 ${d.provider}/${d.model ?? ""}`);
    if (typeof d.durationMs === "number") parts.push(`${d.durationMs}ms`);
    if (d.error !== void 0) parts.push(`error=${typeof d.error === "string" ? d.error : JSON.stringify(d.error)}`);
    if (d.purpose !== void 0) parts.push(`purpose=${d.purpose}`);
    if (d.input !== void 0) parts.push(`input=${typeof d.input === "string" ? d.input.slice(0, 200) : JSON.stringify(d.input).slice(0, 200)}`);
    if (d.output !== void 0) parts.push(`output=${typeof d.output === "string" ? d.output.slice(0, 200) : JSON.stringify(d.output).slice(0, 200)}`);
    return `  ${parts.filter(Boolean).join(" | ")}`;
  });
}

/**
 * /aux debug [N] — 查看当前会话 debug 事件。
 * /aux debug <目标> [N] — 查看指定会话(支持 @this / session id / id 前缀 / cwd 片段)。
 */
export async function handleDebugCommand(service, agent, args) {
  let limit = 10;
  let targetArg;
  if (/^\d+$/.test(args[0] ?? "")) {
    limit = Number(args[0]);
    targetArg = args[1];
  } else {
    targetArg = args[0];
    if (args[1] !== void 0) limit = Number(args[1]);
  }
  if (!Number.isInteger(limit) || limit < 0) {
    return { kind: "error", text: "用法: /aux debug [N] | /aux debug <目标> [N] — N 为非负整数条数" };
  }
  const currentId = agent?.session?.id;
  let targetId = currentId;
  let targetLabel = "当前会话";
  if (targetArg !== void 0 && targetArg !== "") {
    const resolved = await resolveDebugTarget(service, targetArg, currentId);
    if (resolved.error !== void 0) return resolved.error;
    targetId = resolved.id;
    targetLabel = resolved.label;
  }
  let events;
  if (targetId === currentId) {
    events = agent?.session?.events ?? [];
  } else {
    let sp;
    try {
      sp = service.ctx.get("sessionPersistence");
    } catch {
      sp = void 0;
    }
    if (!sp || typeof sp.inspect !== "function") {
      return { kind: "error", text: "sessionPersistence 不可用,无法读取目标会话" };
    }
    try {
      const inspection = await sp.inspect(targetId);
      events = inspection?.events ?? [];
    } catch (error) {
      return { kind: "error", text: `读取会话 ${targetLabel} 失败: ${error?.message ?? String(error)}` };
    }
  }
  const debugEvents = events.filter((event) => event?.type === AUX_DEBUG_EVENT);
  if (debugEvents.length === 0) {
    return {
      kind: "success",
      text: `${targetLabel} 暂无 AUX debug 事件。开启 aux.debug.fullToolTrace 后,后续辅助调用会记录内容真相。`
    };
  }
  const rows = formatDebugEvents(debugEvents);
  const chosen = Number.isFinite(limit) ? (limit === 0 ? [] : rows.slice(-limit)) : rows;
  return { kind: "success", text: [`AUX debug(${targetLabel},共 ${rows.length} 条,显示最近 ${chosen.length} 条):`, ...chosen.reverse()].join("\n") };
}

/**
 * /aux patch [--json] — 一键安装当前 DSH 版本 AUX 所需的全部补丁并自愈
 * (symlink / 补丁 / 白名单)。运行 `bridge/apply-patch.mjs` 与
 * `bridge/self-heal.mjs`;失败不致命。
 *
 * `--json` 返回结构化结果供设置页展示每个步骤的成功/失败与错误信息:
 *   { ok, restartRequired, steps: [{ name, ok, output, error? }] }
 */
export async function handlePatchCommand(service, json = false) {
  // commands.js lives at <repo>/dsh-aux/src/commands.js; two URL levels up
  // from the file resolves to the repository root (where bridge/ lives).
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  // 每次调用时再 promisify,便于测试在动态 import 前/后替换 child_process.execFile。
  const execFileAsync = promisify(childProcess.execFile);
  // 一键补丁必须作用于真实 DSH 部署,而不是仓库内可能存在的旧测试 node_modules。
  // detectDshRoot() 优先取 DSH_ROOT / 用户 ~/dsh 等部署根;找不到时退回仓库目录,
  // 让脚本在源码树测试/无部署环境下仍可运行。
  const dshRoot = detectDshRoot() ?? repo;
  const patchCwd = dshRoot;
  const stepDefs = [
    ["apply-patch", [join(repo, "bridge/apply-patch.mjs")]],
    ["self-heal", [join(repo, "bridge/self-heal.mjs")]]
  ];
  const output = [];
  const steps = [];
  for (const [name, args] of stepDefs) {
    const record = { name, ok: false, output: "" };
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, args, {
        cwd: patchCwd,
        env: { ...process.env, DSH_ROOT: dshRoot }
      });
      record.output = `${stdout}${stderr}`;
      record.ok = true;
      output.push(`[${name}]\n${record.output}`);
    } catch (error) {
      record.output = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
      record.error = error?.message ?? String(error);
      output.push(`[${name}] 失败: ${record.error}\n${record.output}`);
    }
    steps.push(record);
  }
  // 补丁脚本可能“退出 0 但仍有补丁缺失/版本不匹配”,所以不能只看子进程退出码。
  // 跑完后用 collectPlatformStatus 做一次真实校验:仍存在 action=patch 的不可用项
  // 或 dsh-session 事件补丁缺失,就视为未成功;restartRequired 也以实际文件状态为准。
  // 先清缓存,确保校验读到的是刚写完的磁盘状态。
  if (service !== void 0) {
    service._sessionEventsSupportedCache = void 0;
  }
  let status;
  let verificationError;
  if (service !== void 0) {
    try {
      status = await collectPlatformStatus(service);
    } catch (error) {
      verificationError = error?.message ?? String(error);
      status = void 0;
    }
  }
  const patchIssues = (status?.issues ?? []).filter((issue) => issue.action === "patch");
  const eventsOk = status?.eventsSupported !== false;
  const stepsOk = steps.every((step) => step.ok);
  const verificationOk = status !== void 0 && patchIssues.length === 0 && eventsOk;
  // 以最终校验为准:脚本步骤可能“退出非 0 但最终状态已修好”,反之亦然。
  const ok = verificationOk;
  const changed = status?.restartRequired === true;
  // 补丁写的是 node_modules 源码文件;当前进程已加载旧模块,必须重启 DSH
  // 新补丁才会真正生效。标记后,`/aux status --json` 会返回 restartRequired。
  if (service !== void 0) {
    service._patchAppliedThisSession = changed;
    // Record when the patch happened so collectPlatformStatus can treat the
    // flag as a bounded hint instead of a permanent restartRequired override
    // (a later rollback/reset should not be masked forever).
    service._patchAppliedThisSessionAt = changed ? Date.now() : void 0;
    // 同进程内打补丁后不写 aux/platform-status 事件:当前加载的 dsh-session
    // 仍是旧代码,无法正确处理 ignorable 标记;等重启后由启动发布再写入。
    if (changed === false) {
      publishPlatformStatus(service).catch(() => {});
    }
  }
  if (json) {
    if (verificationError !== void 0) {
      steps.push({ name: "verify", ok: false, output: "", error: verificationError });
    }
    const remaining = [...patchIssues];
    if (eventsOk === false) {
      remaining.push({ key: "session-events", reason: "patch-missing", action: "patch" });
    }
    return {
      kind: "success",
      text: JSON.stringify({ ok, restartRequired: changed, steps, remaining })
    };
  }
  if (!ok) {
    if (verificationError !== void 0) output.push(`[verify] 失败: ${verificationError}`);
    for (const issue of patchIssues) output.push(`[verify] 仍待处理: ${issue.key} (${statusReasonText(issue.reason)})`);
    if (eventsOk === false) output.push("[verify] 仍待处理: dsh-session ignorable 补丁未生效");
  }
  return { kind: ok ? "success" : "error", text: output.join("\n") };
}

/** Handle the /aux model subcommand: read or write one task's route. */
export async function handleModelCommand(service, args) {
  const task = args[0] ?? "";
  const isBuiltin = AUX_TASKS.includes(task);
  const custom = isBuiltin ? void 0 : service._customTasks?.get(task);
  if (!isBuiltin && custom === void 0) {
    return {
      kind: "error",
      text: `用法: /aux model <task> [provider/model] — task ∈ {${AUX_TASKS.join(", ")}}`
    };
  }
  // Custom tasks are view-only through /aux model; their route is fixed by
  // the registering plugin, not user-configurable.
  if (!isBuiltin && args.length >= 2) {
    return { kind: "error", text: "custom tasks are not configurable via /aux model" };
  }
  const definition = isBuiltin
    ? { task, ...(service._merged[task] ?? {}) }
    : { task, ...custom };
  const primary = resolvePrimaryRoute(definition, service.taskDefaults);
  if (args.length < 2) {
    const current = primary
      ? `${primary.provider}/${primary.model}`
      : "(未配置 → 主模型)";
    return { kind: "success", text: `辅助模型 [${task}]: ${current}` };
  }
  const target = args[1];
  const slash = target.indexOf("/");
  if (slash <= 0 || slash === target.length - 1) {
    return { kind: "error", text: `用法: /aux model ${task} <provider>/<model>` };
  }
  const provider = target.slice(0, slash);
  const model = target.slice(slash + 1);
  if (provider.length === 0 || model.length === 0) {
    return { kind: "error", text: `用法: /aux model ${task} <provider>/<model>` };
  }
  // Write through the host settings seam (bypasses the api-proxy allowlist,
  // which is exactly what the web settings page cannot do today).
  const settings = service.ctx.get("settings");
  if (settings === void 0) {
    return { kind: "error", text: "aux: settings service is not mounted; cannot persist the model choice" };
  }
  const currentSection = service._source?.() ?? {};
  const tasks = { ...(currentSection.tasks ?? {}) };
  tasks[task] = { ...(tasks[task] ?? {}), provider, model };
  try {
    await settings.replace(AUX_SETTINGS_NAMESPACE, { ...currentSection, tasks });
    // Recompute so the status view reflects the change immediately.
    service._recomputeMerged();
    return { kind: "success", text: `辅助模型 [${task}] 已设为 ${provider}/${model},下一请求生效。` };
  } catch (error) {
    return { kind: "error", text: `aux: 写入设置失败: ${error?.message ?? String(error)}` };
  }
}

/** Fold the latest aux call record per task from a session log. */
export function recentCalls(agent) {
  const events = agent?.session?.events ?? [];
  const latest = new Map();
  for (const event of events) {
    if (event.type !== AUX_CALL_EVENT) continue;
    latest.set(event.data.task, event.data);
  }
  return [...latest.values()];
}

/**
 * /aux vision <imagePath> <question...> — analyze one image through the
 * auxiliary vision model, usable by any agent or by a human in the UI.
 */
export async function handleVisionCommand(service, agent, args) {
  const path = args[0] ?? "";
  const question = args.slice(1).join(" ").trim();
  if (path.length === 0 || question.length === 0) {
    return { kind: "error", text: "用法: /aux vision <imagePath> <question...>" };
  }
  const exec = {
    agent,
    signal: new AbortController().signal
  };
  try {
    const value = await runVision(service, { imagePath: path, question }, exec);
    return { kind: "success", text: `[辅助视觉 ${value.model}]
${value.analysis}` };
  } catch (error) {
    return { kind: "error", text: `vision_analyze 失败: ${error?.message ?? String(error)}` };
  }
}

/**
 * /aux test <task> — run one real auxiliary call to verify the task's route
 * works (config, credentials, capability gate, provider).
 */
export async function handleTestCommand(service, agent, args) {
  const task = args[0] ?? "";
  if (!AUX_TASKS.includes(task)) {
    return { kind: "error", text: `用法: /aux test <task> — task ∈ {${AUX_TASKS.join(", ")}}` };
  }
  const startedAt = Date.now();
  try {
    let text;
    if (task === "compress") {
      const value = await runCompress(
        service,
        { text: "2026-08-14 15:00:00 INFO boot ok provider=opencode-go model=deepseek-v4-flash session=s-001 duration=1234ms", instruction: "保留所有时间戳、provider、model 和数字" },
        { agent, signal: new AbortController().signal }
      );
      text = `压缩成功: ${value.originalChars} -> ${value.compressedChars} chars (ratio ${value.ratio})`;
    } else if (task === "web_extract") {
      const value = await runWebExtract(
        service,
        { url: "https://example.com", maxChars: 2000 },
        { agent, signal: new AbortController().signal }
      );
      text = `抓取成功: ${value.url} | 摘要 ${value.summary.slice(0, 80)}...`;
    } else if (task === "web_crawl") {
      const value = await runWebCrawl(
        service,
        { url: "https://example.com", maxPages: 1, maxDepth: 0 },
        { agent, signal: new AbortController().signal }
      );
      text = `站点抓取成功: ${value.fetched} 页 | 摘要 ${value.summary.slice(0, 80)}...`;
    } else if (task === "compaction") {
      const result = await service.call("compaction", {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Test compaction route. Keep this summary short." }],
            id: "aux-compaction-test",
            source: { kind: "plugin", plugin: "dsh-aux" }
          }
        ],
        session: agent?.session,
        agent,
        signal: new AbortController().signal,
        purpose: "compaction"
      });
      text = `会话压缩路由成功: ${result.provider}/${result.model}`;
    } else if (task === "skill") {
      const result = await service.call("skill", {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Test skill audit route. Reply with a short report." }],
            id: "aux-skill-test",
            source: { kind: "plugin", plugin: "dsh-aux" }
          }
        ],
        session: agent?.session,
        agent,
        signal: new AbortController().signal,
        purpose: "skill-audit"
      });
      text = `技能预审路由成功: ${result.provider}/${result.model}`;
    } else {
      return { kind: "error", text: "/aux test vision 请用 /aux vision <imagePath> <question> 验证" };
    }
    const duration = Date.now() - startedAt;
    return { kind: "success", text: `[辅助任务 ${task} 自检通过] ${text} (${duration}ms)` };
  } catch (error) {
    const duration = Date.now() - startedAt;
    return { kind: "error", text: `[辅助任务 ${task} 自检失败] ${error?.message ?? String(error)} (${duration}ms)` };
  }
}
