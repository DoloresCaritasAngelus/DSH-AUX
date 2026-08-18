/**
 * dsh-aux `/aux` command handling.
 *
 * @module @dolorescaritasangelus/dsh-aux/commands
 */
import { AUX_CALL_EVENT, AUX_SETTINGS_NAMESPACE } from "./config.js";
import { AUX_TASKS, resolvePrimaryRoute } from "./route.js";
import { gcImages } from "./images/gc.js";
import { handleMemoryCommand } from "./images/memory.js";
import { reconcileSessionImages } from "./images/ownership.js";
import { imageBridgeStatus } from "./image-bridge.js";
import { subagentBridgeStatus, workflowBridgeStatus } from "./subagent-bridge.js";
import { isCompactionBridgeInstalled, isCompactionTaskConfigured } from "./compaction-bridge.js";
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
    return { kind: "success", text: lines.join("\n") };
  }
  return {
    kind: "error",
    text: "用法: /aux status — 查看各任务路由与最近调用; /aux model <task> [provider/model] — 查看或设置任务的辅助模型"
  };
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
