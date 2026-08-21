/**
 * dsh-aux `/aux` command handling.
 *
 * @module @dolorescaritasangelus/dsh-aux/commands
 */
import { AUX_CALL_EVENT, AUX_DEBUG_EVENT, AUX_SETTINGS_NAMESPACE } from "./config.js";
import { AUX_TASKS, resolvePrimaryRoute } from "./route.js";
import { gcImages } from "./images/gc.js";
import { handleMemoryCommand } from "./images/memory.js";
import { reconcileSessionImages } from "./images/ownership.js";
import { imageBridgeStatus } from "./image-bridge.js";
import { subagentBridgeStatus, workflowBridgeStatus } from "./subagent-bridge.js";
import { isCompactionBridgeInstalled, isCompactionTaskConfigured } from "./compaction-bridge.js";
import { isSkillTaskConfigured, skillBridgeStatus } from "./skill-bridge.js";
import { sessionEventsSupported } from "./events.js";
import { runVision } from "./tools/vision.js";
import { runWebExtract } from "./tools/web-extract.js";
import { runWebCrawl } from "./tools/web-crawl.js";
import { runCompress } from "./tools/compress.js";

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
  if (sub === "history") {
    return await handleHistoryCommand(agent, args.slice(1));
  }
  if (sub === "debug") {
    return await handleDebugCommand(service, agent, args.slice(1));
  }
  if (sub === "status" || sub === "") {
    // Reconcile first so the status view reflects any deleted-session
    // cleanup that happened while the service was not watching.
    await reconcileSessionImages(service);
    const lines = ["辅助模型系统状态:"];
    // Integrated image-bridge status: report it so a fresh install knows
    // whether pasting images into a text-only main model will work.
    const bridge = await imageBridgeStatus();
    if (bridge !== "unknown") {
      const label = {
        v3: "已集成(v3:含图会话可切纯文本模型 + 可强制原生视觉走 AUX)",
        v2: "已集成(v2:UI 保留缩略图;含图会话切换纯文本模型仍受限)",
        v1: "旧版 v1(建议运行 bridge/apply-patch.mjs 升级)",
        partial: "部分安装(建议运行 bridge/apply-patch.mjs 补全)",
        missing: "未安装(纯文本主模型发图会受限;运行仓库 install.sh 一键集成)"
      }[bridge] ?? bridge;
      lines.push("  - image-bridge: " + label);
    }
    lines.push(`  - forceAuxVision: ${service.forceAuxVision ? "开启(原生图片也走 AUX 视觉)" : "关闭"}`);
    lines.push(`  - visionFallbackToMain: ${service.visionFallbackToMain ? "开启(失败回退主模型)" : "关闭(视觉失败直接失败)"}`);
    const subMode = service.subagentMode ?? "native";
    const subBridge = await subagentBridgeStatus();
    const subPatch = subBridge === "installed" ? "补丁已装" : subBridge === "unknown" ? "补丁未知" : "补丁未装(请跑 bridge/apply-patch.mjs)";
    lines.push(`  - subagent-bridge: ${subMode === "native" ? "native(未拦截)" : subMode === "manual" ? "manual(统一 general 模型)" : "vision-aware(按需 vision / general)"}${service.subagentPrepareTools ? " + 注入 AUX 工具兜底" : ""} [${subPatch}]`);
    const wfBridge = await workflowBridgeStatus();
    const wfPatch = wfBridge === "installed" ? "补丁已装" : wfBridge === "unknown" ? "补丁未知" : "补丁未装(请跑 bridge/apply-patch.mjs)";
    lines.push(`  - workflow-bridge: ${service.subagentIncludeWorkflow ? "includeWorkflow(workflow agent() 走 AUX 路由)" : "excluded(workflow 未纳入)"} [${wfPatch}]`);
    const skillPatch = await skillBridgeStatus();
    const skillBridgeLabel = skillPatch === "installed" ? "补丁已装(task 参数可用)" : skillPatch === "unknown" ? "补丁未知" : "补丁未装(请跑 bridge/apply-patch.mjs)";
    lines.push(`  - skill-audit: ${isSkillTaskConfigured(service) ? "已启用(原生 skill 调用先走辅助模型预审)" : "未配置(原生直通)"} [${skillBridgeLabel}]`);
    // Compaction bridge status: when dsh-compaction-basic is present and a
    // dedicated `compaction` AUX route is configured, native session
    // compaction is routed through AUX.
    const compactionBridgeInstalled = isCompactionBridgeInstalled();
    if (compactionBridgeInstalled) {
      lines.push(
        "  - compaction-bridge: " +
          (isCompactionTaskConfigured(service)
            ? "已启用(会话压缩走 AUX 辅助模型)"
            : "已安装(未配置 compaction 任务 → 原生摘要)")
      );
    } else {
      lines.push("  - compaction-bridge: 未安装(dsh-compaction-basic 缺失)");
    }
    // Session-event tracing status: without the dsh-session ignorable
    // patch, aux/llm-call events are not written (safety degradation).
    const eventsSupported = await sessionEventsSupported(service);
    lines.push(
      "  - 会话事件记录: " +
        (eventsSupported ? "已启用(ignorable 补丁已装)" : "已停用(缺 dsh-session ignorable 补丁,运行 bridge/patch-session-ignorable.mjs 或 install.sh 启用)")
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
        const status = call.ok ? "成功" : "失败";
        const fallback = call.fallbackUsed ? " (已降级)" : "";
        const error = call.ok ? "" : ` [${call.errorCode ?? "error"}]`;
        lines.push(
          `  - ${call.task}: ${call.provider}/${call.model} ${status}${fallback}${error} ${call.durationMs}ms`
        );
      }
    }
    // 版本/补丁不匹配的醒目提示:任何集成补丁缺失或部分安装时,在状态顶部
    // 直接建议用户运行 ./update.sh,而不是只靠分散的 [补丁未装] 小字。
    const issues = [];
    if (bridge === "missing" || bridge === "partial") issues.push("image-bridge 未完整安装");
    if (subBridge === "missing") issues.push("subagent-bridge 补丁未装");
    if (wfBridge === "missing") issues.push("workflow-bridge 补丁未装");
    if (skillPatch === "missing") issues.push("skill-audit 补丁未装(task 参数不可用)");
    if (!eventsSupported) issues.push("会话事件记录已停用(缺 dsh-session ignorable 补丁)");
    if (issues.length > 0) {
      lines.splice(1, 0,
        "",
        "⚠️ 检测到 dsh-aux 补丁缺失/版本不匹配,请运行 ./update.sh 或更新 dsh-aux:",
        ...issues.map((issue) => "  - " + issue)
      );
    }
    return { kind: "success", text: lines.join("\n") };
  }
  return {
    kind: "error",
    text: "用法: /aux status — 查看各任务路由与最近调用; /aux history [N] / /aux history full [N] — 简要/全部溯源; /aux model <task> [provider/model] — 查看或设置任务的辅助模型"
  };
}

/**
 * /aux history [N] — 简要溯源:最近 N 次辅助调用(默认 10,按时间新→旧)。
 * /aux history full [N] — 全部溯源:完整事件字段(默认全部事件,可用 N 取
 * 最近 N 条)。数据来自会话里每次 AUX_CALL_EVENT 事件日志(事件溯源)。
 */
export function handleHistoryCommand(agent, args) {
  const full = args[0] === "full";
  const limitArg = full ? args[1] : args[0];
  let limit = full ? Infinity : 10;
  if (limitArg !== void 0) {
    limit = Number(limitArg);
    if (!Number.isInteger(limit) || limit < 0) {
      return { kind: "error", text: "用法: /aux history [N] | /aux history full [N] — N 为非负整数条数" };
    }
  }
  const events = (agent?.session?.events ?? []).filter((event) => event?.type === AUX_CALL_EVENT);
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
      const error = d.ok ? "" : ` [${d.errorCode ?? "error"}]`;
      const fallback = d.fallbackUsed ? " (已降级)" : "";
      return `  #${seq} ${d.task}: ${provider}/${model} ${status}${error}${fallback} ${duration}`;
    }
    const parts = [`#${seq} ${d.task}`, `路由 ${provider}/${model}`, d.ok ? "成功" : "失败", duration];
    if (!d.ok && d.errorCode !== void 0) parts.push(`error=${d.errorCode}`);
    if (d.fallbackUsed) parts.push("已降级");
    if (typeof d.inputChars === "number") parts.push(`输入 ${d.inputChars} chars`);
    if (typeof d.outputChars === "number") parts.push(`输出 ${d.outputChars} chars`);
    if (d.purpose !== void 0) parts.push(`purpose=${d.purpose}`);
    return `  ${parts.join(" | ")}`;
  });
  const chosen = Number.isFinite(limit) ? rows.slice(-limit) : rows;
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
  const chosen = Number.isFinite(limit) ? rows.slice(-limit) : rows;
  return { kind: "success", text: [`AUX debug(${targetLabel},共 ${rows.length} 条,显示最近 ${chosen.length} 条):`, ...chosen.reverse()].join("\n") };
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
