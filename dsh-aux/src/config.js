/**
 * dsh-aux configuration surface: settings namespace, schema, projection
 * helpers and task labels. Pure config — no service access.
 *
 * @module @dolorescaritasangelus/dsh-aux/config
 */
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { AUX_TASKS } from "./route.js";

/** Settings namespace carrying the aux configuration section. */
export const AUX_SETTINGS_NAMESPACE = settingsNamespace("aux");
/** Timeout code stamped onto aux deadline timeouts. */
export const AUX_TIMEOUT_CODE = "AUX_TIMEOUT";
/** Session event type recording one auxiliary call. */
export const AUX_CALL_EVENT = "aux/llm-call";
/** Session event type recording debug/content-truth details (ignorable, not in model context). */
export const AUX_DEBUG_EVENT = "aux/debug";
/** Session event type carrying a full platform-status snapshot (ignorable, non-surface). */
export const AUX_PLATFORM_EVENT = "aux/platform-status";
/** Projection key exposing the latest per-task aux call snapshot. */
export const AUX_STATUS_KEY = "aux-status";
/** Projection key exposing the latest platform status snapshot for settings UI. */
export const AUX_PLATFORM_KEY = "aux-platform";
/** Tool names registered by dsh-aux (hidden from the `minimal` preset). */
export const AUX_TOOL_NAMES = Object.freeze(["vision_analyze", "web_extract", "web_crawl", "compress_text"]);
/** Interval (ms) for reconciling the session-to-image ownership map against
 * the live session set. Cold sessions (not attached in memory after a
 * restart) never emit session/disposed when deleted, so the event-driven
 * cleanup alone would leak their images; the periodic pass removes ownership
 * entries whose session no longer exists in memory or persistence. */
export const SESSION_IMAGE_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/** Settings schema: global fallback switch plus one section per task. */
export const AUX_SETTINGS_SCHEMA = z.object({
  fallbackToMain: z.boolean().default(true),
  forceAuxVision: z.boolean().default(false),
  visionFallbackToMain: z.boolean().default(true),
  showStatusChip: z.boolean().default(true),
  tasks: z.object({
    vision: z.object({
      provider: z.string(),
      model: z.string(),
      timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      maxConcurrency: z.number().step(1).min(1),
      reasoningEffort: z.string().min(1)
    }),
    web_extract: z.object({
      provider: z.string(),
      model: z.string(),
      timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      maxConcurrency: z.number().step(1).min(1),
      maxChars: z.number().step(1).min(1),
      reasoningEffort: z.string().min(1)
    }),
    web_crawl: z.object({
      provider: z.string(),
      model: z.string(),
      timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      maxConcurrency: z.number().step(1).min(1),
      maxChars: z.number().step(1).min(1),
      reasoningEffort: z.string().min(1)
    }),
    compress: z.object({
      provider: z.string(),
      model: z.string(),
      timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      maxConcurrency: z.number().step(1).min(1),
      reasoningEffort: z.string().min(1)
    }),
    compaction: z.object({
      provider: z.string(),
      model: z.string(),
      timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      maxConcurrency: z.number().step(1).min(1),
      reasoningEffort: z.string().min(1)
    }),
    skill: z.object({
      provider: z.string(),
      model: z.string(),
      timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      maxConcurrency: z.number().step(1).min(1),
      reasoningEffort: z.string().min(1)
    })
  }),
  subagent: z.object({
    mode: z.union([z.const("native"), z.const("manual"), z.const("vision-aware")]).default("native"),
    includeWorkflow: z.boolean().default(true),
    general: z.object({
      provider: z.string(),
      model: z.string(),
      reasoningEffort: z.string().min(1)
    }),
    vision: z.object({
      provider: z.string(),
      model: z.string(),
      reasoningEffort: z.string().min(1)
    }),
    prepareTools: z.boolean().default(true),
    retryVisionWithAux: z.boolean().default(false),
    visionKeywords: z.array(z.string()).default([])
  }),
  enabled: z.object({
    vision_analyze: z.union([z.const("native"), z.const("aux"), z.const("compat")]).default("aux"),
    web_extract: z.union([z.const("native"), z.const("aux"), z.const("compat")]).default("aux"),
    web_crawl: z.union([z.const("native"), z.const("aux"), z.const("compat")]).default("aux"),
    compress_text: z.union([z.const("native"), z.const("aux"), z.const("compat")]).default("aux"),
    imageBridge: z.union([z.const("native"), z.const("aux"), z.const("compat")]).default("aux"),
    subagentBridge: z.union([z.const("native"), z.const("aux"), z.const("compat")]).default("aux"),
    workflowBridge: z.union([z.const("native"), z.const("aux"), z.const("compat")]).default("aux"),
    compactionBridge: z.union([z.const("native"), z.const("aux"), z.const("compat")]).default("aux"),
    skillAudit: z.union([z.const("native"), z.const("aux"), z.const("compat")]).default("aux")
  }),
  skill: z.object({
    mode: z.union([z.const("native"), z.const("audit"), z.const("report"), z.const("report-ondemand"), z.const("auto")]).default("audit")
  }),
  debug: z.object({
    fullToolTrace: z.boolean().default(false),
    maxDebugEventBytes: z.number().step(1).min(1024).default(65536),
    debugEventsInHistory: z.boolean().default(false),
    redactSecrets: z.boolean().default(true)
  })
});

/**
 * Project a raw settings section into the merged per-task config the service
 * reads. Absent keys stay absent so plugin config values keep governing.
 */
export function projectSettings(settings) {
  const fallbackToMain = settings?.fallbackToMain ?? true;
  const forceAuxVision = settings?.forceAuxVision ?? false;
  const visionFallbackToMain = settings?.visionFallbackToMain ?? true;
  const showStatusChip = settings?.showStatusChip ?? true;
  const tasks = {};
  for (const task of AUX_TASKS) {
    const raw = settings?.tasks?.[task] ?? {};
    tasks[task] = {
      ...(raw.provider !== void 0 ? { provider: raw.provider } : {}),
      ...(raw.model !== void 0 ? { model: raw.model } : {}),
      ...(raw.timeoutMs !== void 0 ? { timeoutMs: raw.timeoutMs } : {}),
      ...(raw.maxConcurrency !== void 0 ? { maxConcurrency: raw.maxConcurrency } : {}),
      ...(raw.reasoningEffort !== void 0 ? { reasoningEffort: raw.reasoningEffort } : {}),
      ...((task === "web_extract" || task === "web_crawl") && raw.maxChars !== void 0 ? { maxChars: raw.maxChars } : {})
    };
  }
  const rawSub = settings?.subagent ?? {};
  const subagent = {
    mode: rawSub.mode ?? "native",
    includeWorkflow: rawSub.includeWorkflow !== false,
    ...(rawSub.general !== void 0 && (rawSub.general.provider !== void 0 || rawSub.general.model !== void 0)
      ? { general: { ...rawSub.general } }
      : {}),
    ...(rawSub.vision !== void 0 && (rawSub.vision.provider !== void 0 || rawSub.vision.model !== void 0)
      ? { vision: { ...rawSub.vision } }
      : {}),
    ...(rawSub.prepareTools !== void 0 ? { prepareTools: rawSub.prepareTools } : {}),
    ...(rawSub.retryVisionWithAux !== void 0 ? { retryVisionWithAux: rawSub.retryVisionWithAux } : {}),
    ...(Array.isArray(rawSub.visionKeywords) ? { visionKeywords: [...rawSub.visionKeywords] } : {})
  };
  const defaultEnabled = {
    vision_analyze: "aux",
    web_extract: "aux",
    web_crawl: "aux",
    compress_text: "aux",
    imageBridge: "aux",
    subagentBridge: "aux",
    workflowBridge: "aux",
    compactionBridge: "aux",
    skillAudit: "aux"
  };
  const rawEnabled = settings?.enabled ?? {};
  const enabled = { ...defaultEnabled, ...rawEnabled };
  const skill = {
    mode: settings?.skill?.mode ?? "audit"
  };
  const rawDebug = settings?.debug ?? {};
  const debug = {
    fullToolTrace: rawDebug.fullToolTrace ?? false,
    maxDebugEventBytes: rawDebug.maxDebugEventBytes ?? 65536,
    debugEventsInHistory: rawDebug.debugEventsInHistory ?? false,
    redactSecrets: rawDebug.redactSecrets ?? true
  };
  return { fallbackToMain, forceAuxVision, visionFallbackToMain, showStatusChip, tasks, subagent, enabled, skill, debug };
}

/**
 * Reject a resolved aux settings section whose task entries pair provider
 * without model (or vice versa). Registered as the settings namespace's
 * validator so a half-configured task is refused where it is entered.
 * @param value - the resolved section, schema-valid by construction.
 */
export function validateAuxSettings(value) {
  for (const task of AUX_TASKS) {
    const entry = value?.tasks?.[task];
    const hasProvider = entry?.provider !== void 0;
    const hasModel = entry?.model !== void 0;
    if (hasProvider !== hasModel) {
      throw new Error(
        `aux settings: tasks.${task} provider and model must be supplied together`
      );
    }
  }
  for (const group of ["general", "vision"]) {
    const entry = value?.subagent?.[group];
    const hasProvider = entry?.provider !== void 0;
    const hasModel = entry?.model !== void 0;
    if (hasProvider !== hasModel) {
      throw new Error(
        `aux settings: subagent.${group} provider and model must be supplied together`
      );
    }
  }
}

/** Task display labels. */
export const TASK_LABELS = Object.freeze({
  vision: "图像分析",
  web_extract: "网页提取",
  web_crawl: "站点抓取",
  compress: "文本压缩",
  compaction: "会话压缩",
  skill: "技能预审"
});
