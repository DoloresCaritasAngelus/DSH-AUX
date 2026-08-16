/**
 * dsh-aux: auxiliary model system for DSH.
 *
 * A unified auxiliary-LLM routing service (`ctx.auxLlm`) plus three
 * model-facing tools (`vision_analyze`, `web_extract`, `compress_text`).
 * Each task resolves its own route — explicit config, then a task default,
 * then the session's main model as automatic fallback — with per-task
 * timeout, concurrency cap, failure cooldown, and logged session events so
 * every auxiliary call is observable and replayable.
 *
 * A `compaction` task is also provided as a bridge: when configured, native
 * `dsh-compaction-basic` summarization is routed through `ctx.auxLlm`.
 *
 * @module @dolorescaritasangelus/dsh-aux
 */
import { readdir, readFile as readFileText, rename as renameFile, stat as statFile, unlink as unlinkFile, writeFile as writeFileText } from "node:fs/promises";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { z as zodz } from "zod";
import { BlockAssembler, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm";
import { deadline, MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { settingsNamespace, installSettingsSection } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  AUX_TASKS,
  DEFAULT_TASK_CONCURRENCY,
  DEFAULT_TASK_TIMEOUT_MS,
  DEFAULT_MAX_INPUT_CHARS,
  AsyncSemaphore,
  FailureCooldown,
  classifyFailure,
  mergeTaskConfig,
  resolveConfig,
  resolvePrimaryRoute,
  route,
  shouldFallback,
  taskConcurrency,
  taskTimeoutMs
} from "./route.js";
import {
  AUX_TOOLS_GUIDE,
  clampTargetRatio,
  compressSystemPrompt,
  compressUserMessage,
  htmlToText,
  stripThinkBlocks,
  webExtractSystemPrompt,
  webExtractUserMessage,
  visionSystemPrompt
} from "./prompt.js";
import {
  isCompactionBridgeInstalled,
  isCompactionTaskConfigured
} from "./compaction-bridge.js";

/** Settings namespace carrying the aux configuration section. */
export const AUX_SETTINGS_NAMESPACE = settingsNamespace("aux");
/** Timeout code stamped onto aux deadline timeouts. */
export const AUX_TIMEOUT_CODE = "AUX_TIMEOUT";
/** Session event type recording one auxiliary call. */
export const AUX_CALL_EVENT = "aux/llm-call";
/** Projection key exposing the latest per-task aux call snapshot. */
export const AUX_STATUS_KEY = "aux-status";
/** Tool names registered by dsh-aux (hidden from the `minimal` preset). */
const AUX_TOOL_NAMES = Object.freeze(["vision_analyze", "web_extract", "compress_text"]);
/** Interval (ms) for reconciling the session-to-image ownership map against
 * the live session set. Cold sessions (not attached in memory after a
 * restart) never emit session/disposed when deleted, so the event-driven
 * cleanup alone would leak their images; the periodic pass removes ownership
 * entries whose session no longer exists in memory or persistence. */
const SESSION_IMAGE_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/** Settings schema: global fallback switch plus one section per task. */
const AUX_SETTINGS_SCHEMA = z.object({
  fallbackToMain: z.boolean().default(true),
  showStatusChip: z.boolean().default(true),
  tasks: z.object({
    vision: z.object({
      provider: z.string(),
      model: z.string(),
      timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      maxConcurrency: z.number().step(1).min(1)
    }),
    web_extract: z.object({
      provider: z.string(),
      model: z.string(),
      timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      maxConcurrency: z.number().step(1).min(1)
    }),
    compress: z.object({
      provider: z.string(),
      model: z.string(),
      timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      maxConcurrency: z.number().step(1).min(1)
    }),
    compaction: z.object({
      provider: z.string(),
      model: z.string(),
      timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
      maxConcurrency: z.number().step(1).min(1)
    })
  })
});

/**
 * Project a raw settings section into the merged per-task config the service
 * reads. Absent keys stay absent so plugin config values keep governing.
 */
function projectSettings(settings) {
  const fallbackToMain = settings?.fallbackToMain ?? true;
  const showStatusChip = settings?.showStatusChip ?? true;
  const tasks = {};
  for (const task of AUX_TASKS) {
    const raw = settings?.tasks?.[task] ?? {};
    tasks[task] = {
      ...(raw.provider !== void 0 ? { provider: raw.provider } : {}),
      ...(raw.model !== void 0 ? { model: raw.model } : {}),
      ...(raw.timeoutMs !== void 0 ? { timeoutMs: raw.timeoutMs } : {}),
      ...(raw.maxConcurrency !== void 0 ? { maxConcurrency: raw.maxConcurrency } : {})
    };
  }
  return { fallbackToMain, showStatusChip, tasks };
}

/**
 * Translate terminal finish reasons into an auxiliary-call failure.
 * @returns undefined on a clean stop, else an Error carrying the failure facts.
 */
function finishError(finish) {
  switch (finish.kind) {
    case "stop": return void 0;
    case "max-tokens": return new Error("aux: output reached maxTokens");
    case "tool-calls": return new Error("aux: model unexpectedly requested a tool");
    case "error":
    case "aborted": {
      const error = new Error(finish.failure.message);
      error.code = finish.failure.code;
      error.status = finish.failure.status;
      error.failure = finish.failure;
      return error;
    }
    default: return new Error("aux: unsupported finish reason " + String(finish.kind));
  }
}

/** One auxiliary call outcome. */
export class AuxCallError extends Error {
  constructor(task, attempts) {
    const lines = attempts.map(
      (a) => `  - ${a.provider}/${a.model}: ${a.error?.message ?? String(a.error)} (${a.kind})`
    );
    super(`aux task "${task}" failed after ${attempts.length} attempt(s):\n${lines.join("\n")}`);
    this.name = "AuxCallError";
    this.task = task;
    this.attempts = attempts;
  }
}

/**
 * `ctx.auxLlm`: the unified auxiliary-model router. Owns task definitions,
 * per-task semaphores, the failure cooldown table, and the settings section;
 * every call is logged as an `aux/llm-call` session event and reflected in
 * the `aux-status` projection.
 */
export class AuxLlmService extends Service {
  static inject = ["llm", "tools", "settings", "web", "fs", "systemPrompt"];
  static Config = z.object({
    tasks: z.object({
      vision: z.object({
        provider: z.string(),
        model: z.string(),
        timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
        maxConcurrency: z.number().step(1).min(1)
      }),
      web_extract: z.object({
        provider: z.string(),
        model: z.string(),
        timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
        maxConcurrency: z.number().step(1).min(1)
      }),
      compress: z.object({
        provider: z.string(),
        model: z.string(),
        timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
        maxConcurrency: z.number().step(1).min(1)
      }),
      compaction: z.object({
        provider: z.string(),
        model: z.string(),
        timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
        maxConcurrency: z.number().step(1).min(1)
      })
    })
  });

  /** Default auxiliary routes per task (explicit-config-independent). */
  taskDefaults;
  /** Plugin-config task entries (settings-independent layer). */
  pluginTasks;
  /** Live settings source (settings layer wins; falls back to plugin config). */
  _source;
  /** Per-task merged config, recomputed on settings change. */
  _merged;
  /** Per-task semaphores keyed by task key. */
  _semaphores;
  /** Failure cooldown keyed by provider+model. */
  _cooldown;
  /** Registered custom auxiliary tasks (extension point). */
  _customTasks;
  /** The attachments-injected context (vision tool registration scope). */
  _imageCtx;
  /** sessionId -> Set(attachmentId) ownership map for disposal cleanup. */
  _sessionImages;
  /** Dirty flag for debounced ownership-map persistence. */
  _sessionImagesDirty;
  /** In-flight disposal burst (process shutdown detection). */
  _disposalBurst;

  constructor(ctx, config = {}) {
    super(ctx, "auxLlm");
    const resolved = resolveConfig(config);
    // No hardcoded default auxiliary routes: on another machine (no
    // opencode-go / volcengine-ark), an unconfigured task resolves straight
    // to the session's main model — zero-config and shareable. Users who want
    // a dedicated auxiliary model configure it per task (settings page or
    // /aux model), which then takes precedence.
    this.taskDefaults = {};
    this.pluginTasks = resolved.tasks;
    this._semaphores = new Map();
    this._cooldown = new FailureCooldown();
    this._customTasks = new Map();
    this._projectionCtx = void 0;
    this._auxStatusProjectionDispose = void 0;
    this._recomputeMerged();
    // Main-agent guidance: tell the chat model the auxiliary tools exist and
    // are executed by a separate auxiliary LLM, so it uses vision_analyze
    // directly instead of spawning a sub-agent for image analysis. An empty
    // guideText disables the section (escape hatch).
    this.guideText = resolved.guideText;
    // Sessions that already received the once-per-session pre-step reminder
    // for Bootstrap presets (Minimal / Anchored Standard). The system-prompt
    // section is suppressed by those presets' complete persona, so the AUX
    // guidance is injected as a step message after promotion instead.
    this._auxGuideInjectedSessions = new Set();
    if (this.guideText !== "") {
      ctx.systemPrompt.section({
        name: "aux:tools-guide",
        order: 110,
        text: (context) => this._auxToolsGuide(context)
      });
    }
    installSettingsSection(ctx, AUX_SETTINGS_NAMESPACE, AUX_SETTINGS_SCHEMA, projectSettings({}), {
      setSource: (current) => {
        this._source = current;
        this._recomputeMerged();
        this._syncAuxStatusProjection();
      },
      onChange: () => {
        this._recomputeMerged();
        this._syncAuxStatusProjection();
      },
      validate: validateAuxSettings,
      // The settings page is a first-class capability of this plugin:
      // declare the namespace exposed to the Web configuration client
      // (requires the dynamic-expose patch on dsh-settings + api-proxy,
      // see bridge/patch-settings-dynamic-expose.mjs).
      exposedToWeb: true
    });
    this._registerTools();
    this._sessionImages = new Map();
    this._sessionImagesLoaded = false;
    this._sessionImagesDirty = false;
    // Serialize image-memory journal writes: the journal is a read-modify-
    // write file, and multi-image analysis runs records in parallel — a
    // concurrent race would drop entries (last writer wins).
    this._memoryQueue = Promise.resolve();
    // Delete-triggered attachment GC: when a session is disposed (user
    // deletes it — archive does NOT dispose), remove images this session
    // owned that no other session still references. Multi-session disposal
    // (process shutdown) is skipped wholesale to avoid mass deletion.
    ctx.on("session/disposed", (session) => {
      this._onSessionDisposed(session);
    });
    // Cold-session fallback: a session deleted while NOT attached (e.g. after
    // a restart it was never resumed) is removed by the deleter without any
    // session/disposed event. Reconcile the ownership map periodically so its
    // unreferenced images still get cleaned up.
    ctx.effect(() => {
      const timer = setInterval(() => {
        this._reconcileSessionImages().catch(() => {
          /* best-effort: reconciliation must never crash the service */
        });
      }, SESSION_IMAGE_RECONCILE_INTERVAL_MS);
      return () => clearInterval(timer);
    });
    ctx.inject(["sessionProjections"], (projectionCtx) => {
      this._projectionCtx = projectionCtx;
      this._syncAuxStatusProjection();
    });
    ctx.inject(["commands"], (commandCtx) => {
      commandCtx.commands.register({
        name: "aux",
        description: "辅助模型系统: /aux status — 查看各任务路由与最近调用",
        handler: ({ agent, rawInput }) => this._handleCommand(agent, rawInput)
      });
    });
    // Minimal preset must keep its exact two-tool surface during the bootstrap
    // phase (before the first durable tool/call) to preserve V4F/V4P
    // post-training behavior. dsh-aux tools are registered globally, so remove
    // them from the assembled catalog while the session is still unpromoted.
    // After the first tool/call the catalog opens like Anchored Standard, so
    // the filter stops applying.
    ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
      const assembled = await next();
      if (!this._isMinimalPreset(context?.agent)) return assembled;
      if (this._isAuxGuidePromoted(context?.agent)) return assembled;
      if (!Array.isArray(assembled.tools)) return assembled;
      const filtered = assembled.tools.filter((tool) => !AUX_TOOL_NAMES.includes(tool.name));
      return filtered.length === assembled.tools.length ? assembled : { ...assembled, tools: filtered };
    });
    // Minimal / Anchored Standard presets use a complete persona, which
    // suppresses the aux:tools-guide system-prompt section entirely. Inject a
    // compact reminder as a pre-step message ONLY after the session has
    // produced a durable tool call (promotion): the model then knows AUX tools
    // were not available on the first round, and that image analysis should go
    // through vision_analyze directly instead of spawning a sub-agent. The
    // first round is deliberately left completely untouched — those presets
    // anchor V4F/V4P on the exact Minimal tool pair and system prompt, so any
    // first-round injection would break their post-training fit.
    ctx.on("agent/pre-step", async ({ agent }, next) => {
      const decision = await next();
      if (!this._shouldUsePreStepAuxGuide(agent)) return decision;
      if (!this._isAuxGuidePromoted(agent)) return decision;
      if (decision.kind === "reject" || !Array.isArray(decision.messages)) return decision;
      const sessionId = agent?.session?.id;
      if (sessionId === void 0 || this._auxGuideInjectedSessions.has(sessionId)) return decision;
      this._auxGuideInjectedSessions.add(sessionId);
      const reminder = createUserMessage({
        content: [{ type: "text", text: this._auxPreStepReminderText(agent) }],
        source: { kind: "aux-guide" }
      });
      return { ...decision, messages: [...decision.messages, reminder] };
    });
  }

  /** Recomputed merged task config from the live settings source. */
  _recomputeMerged() {
    const settings = this._source?.() ?? { fallbackToMain: true, showStatusChip: true, tasks: {} };
    const merged = {};
    for (const task of AUX_TASKS) {
      merged[task] = mergeTaskConfig(
        this.pluginTasks[task] ?? {},
        settings.tasks?.[task] ?? {}
      );
    }
    this._merged = merged;
    this.fallbackToMain = settings.fallbackToMain ?? true;
    this.showStatusChip = settings.showStatusChip ?? true;
  }

  /**
   * Register or unregister the `aux-status` projection according to the
   * `showStatusChip` setting. The projection is the Web-visible surface for
   * the composer chip; when the user disables the chip, we stop exposing it
   * to third-party plugins entirely. The `/aux status` command reads session
   * events directly and is not affected.
   */
  _syncAuxStatusProjection() {
    if (this._projectionCtx === void 0) return;
    const enabled = this.showStatusChip !== false;
    if (enabled && this._auxStatusProjectionDispose === void 0) {
      this._auxStatusProjectionDispose = this._projectionCtx.sessionProjections.register({
        key: AUX_STATUS_KEY,
        schema: zodz.object({
          tasks: zodz.record(zodz.object({
            task: zodz.string(),
            ok: zodz.boolean(),
            fallbackUsed: zodz.boolean(),
            durationMs: zodz.number()
          }))
        }),
        init: () => ({ tasks: {} }),
        apply: (state, event) => {
          if (event.type === AUX_CALL_EVENT) {
            const data = event.data;
            // Privacy minimization: only expose what the UI chip needs.
            // provider/model, errorCode, inputChars/outputChars stay in the
            // session event log (for /aux status and audit) but are NOT
            // published through the projection to Web/third-party readers.
            const tasks = {
              ...state.tasks,
              [data.task]: {
                task: data.task,
                ok: data.ok === true,
                fallbackUsed: data.fallbackUsed === true,
                durationMs: data.durationMs
              }
            };
            return { tasks };
          }
          return state;
        },
        view: (state) => state,
        stateVersion: 1
      });
    } else if (!enabled && this._auxStatusProjectionDispose !== void 0) {
      this._auxStatusProjectionDispose();
      this._auxStatusProjectionDispose = void 0;
    }
  }

  /**
   * Dynamic system-prompt guide for the current agent.
   *
   * For ordinary presets (standard, unknown) the full AUX tool guide is
   * injected through the `aux:tools-guide` section. For Bootstrap presets
   * (Minimal / Anchored Standard) the section is suppressed by their complete
   * persona anyway, so return an empty string here and let the pre-step
   * reminder carry the guidance after promotion.
   */
  _auxToolsGuide(context) {
    if (this.guideText !== void 0 && this.guideText !== "") return this.guideText;
    if (this._isBootstrapPreset(context?.agent)) return "";
    return AUX_TOOLS_GUIDE;
  }

  /** Whether this agent runs the `minimal` preset. */
  _isMinimalPreset(agent) {
    return agent?.session?.header?.agentPreset === "minimal";
  }

  /** Whether this agent runs a Minimal-like / Anchored Standard preset. */
  _isBootstrapPreset(agent) {
    const preset = agent?.session?.header?.agentPreset;
    return typeof preset === "string" && (
      preset === "minimal" ||
      preset === "anchored-standard" ||
      preset === "zero-anchored-standard" ||
      preset === "whoami-standard"
    );
  }

  /** Whether this agent runs an Anchored Standard family preset. */
  _isAnchoredPreset(agent) {
    const preset = agent?.session?.header?.agentPreset;
    return preset === "anchored-standard" ||
      preset === "zero-anchored-standard" ||
      preset === "whoami-standard";
  }

  /** Whether the pre-step reminder channel should be used at all. */
  _shouldUsePreStepAuxGuide(agent) {
    // Minimal and Anchored Standard both open the catalog after the first
    // durable tool/call, so both receive the post-promotion AUX reminder.
    if (!this._isBootstrapPreset(agent)) return false;
    // A user-supplied guideText remains the user's explicit choice; do not
    // silently duplicate it through the pre-step channel.
    return this.guideText === void 0 || this.guideText === "";
  }

  /**
   * Promotion gate for the pre-step reminder. The installed Anchored Standard
   * preset promotes on the first durable `tool/call`; requiring a tool call is
   * also safe for newer resident-directory variants because it means the model
   * has actually started using tools and the catalog has been expanded.
   */
  _isAuxGuidePromoted(agent) {
    return Array.isArray(agent?.session?.events) &&
      agent.session.events.some((event) => event.type === "tool/call");
  }

  /** Mode-aware reminder text injected once after Bootstrap promotion. */
  _auxPreStepReminderText(agent) {
    const preset = agent?.session?.header?.agentPreset;
    if (preset === "minimal") {
      return "辅助模型提示(dsh-aux):当前是极简模式。首轮 AUX 工具不可用;后续轮次中,需要查看/分析图片或 GIF 时,请直接使用 vision_analyze 工具,不要为此创建子代理。";
    }
    return "辅助模型提示(dsh-aux):当前是 Anchored Standard。首轮 AUX 工具不可用;晋升后工具目录已开放,需要查看/分析图片或 GIF 时,请直接使用 vision_analyze 工具,不要为此创建子代理。";
  }

  /** Settings schema snapshot for UIs. */
  static get settingsSchema() {
    return AUX_SETTINGS_SCHEMA;
  }

  /**
   * Run one auxiliary LLM call. Route resolution per task: explicit config,
   * then task default, then the session's main model as automatic fallback
   * (configurable). Failures are classified; retryable classes fall back to
   * the main model once; a route in cooldown is skipped.
   *
   * @param task the auxiliary task key.
   * @param request messages, optional system/temperature/maxTokens/signal,
   *   the owning session (for event logging), and an optional purpose tag.
   * @returns the assembled text and the route that produced it.
   */
  async call(task, request) {
    const definition = this._customTasks.get(task) ?? this._taskDefinition(task);
    if (definition === void 0) {
      throw new Error(`aux: unknown task "${task}"`);
    }
    const semaphore = this._semaphoreFor(task, taskConcurrency(definition));
    const release = await semaphore.acquire();
    const startedAt = Date.now();
    const attempts = [];
    try {
      const mainRoute = await this._mainRoute(request);
      const primary = resolvePrimaryRoute(definition, this.taskDefaults);
      const candidates = [];
      if (primary !== void 0) candidates.push(primary);
      if (
        this.fallbackToMain &&
        mainRoute !== void 0 &&
        !(primary !== void 0 && primary.provider === mainRoute.provider && primary.model === mainRoute.model)
      ) {
        candidates.push(mainRoute);
      }
      if (candidates.length === 0) {
        throw new Error(`aux task "${task}": no route configured and no main model available`);
      }
      let lastError;
      for (const candidate of candidates) {
        if (request.signal?.aborted) {
          const error = new Error("aux: call aborted");
          error.failure = { code: "ABORTED", message: "aux: call aborted" };
          throw error;
        }
        if (this._cooldown.isCoolingDown(candidate.provider, candidate.model)) {
          attempts.push({ ...candidate, kind: "cooldown", error: new Error("route in cooldown") });
          continue;
        }
        try {
          const output = await this._callRoute(task, definition, candidate, request);
          this._cooldown.recordSuccess(candidate.provider, candidate.model);
          await this._recordEvent(request.session, {
            task,
            provider: candidate.provider,
            model: candidate.model,
            ok: true,
            durationMs: Date.now() - startedAt,
            fallbackUsed: attempts.length > 0,
            inputChars: request.inputChars,
            outputChars: output.length,
            purpose: request.purpose
          });
          return { text: output, provider: candidate.provider, model: candidate.model };
        } catch (error) {
          const kind = classifyFailure(error, request.signal);
          attempts.push({ ...candidate, kind, error });
          lastError = error;
          if (kind === "aborted") break;
          const entered = this._cooldown.recordFailure(candidate.provider, candidate.model);
          if (entered) attempts[attempts.length - 1].enteredCooldown = true;
        }
      }
      await this._recordEvent(request.session, {
        task,
        provider: attempts[0]?.provider ?? "",
        model: attempts[0]?.model ?? "",
        ok: false,
        durationMs: Date.now() - startedAt,
        errorCode: attempts.map((a) => a.kind).join(","),
        fallbackUsed: attempts.length > 1,
        purpose: request.purpose
      });
      throw new AuxCallError(task, attempts);
    } finally {
      release();
    }
  }

  /**
   * Register a custom auxiliary task (extension point for other plugins).
   * @param definition { key, label, defaultModel?, fallbackToMain?, timeoutMs?, maxConcurrency? }
   */
  registerTask(definition) {
    if (definition === void 0 || typeof definition.key !== "string" || definition.key.length === 0) {
      throw new Error("registerTask: definition.key must be a non-empty string");
    }
    this._customTasks.set(definition.key, definition);
  }

  /** The definition for a built-in task. */
  _taskDefinition(task) {
    const merged = this._merged[task];
    if (merged === void 0) return void 0;
    return {
      key: task,
      task,
      ...merged,
      fallbackToMain: true,
      timeoutMs: taskTimeoutMs(merged),
      maxConcurrency: taskConcurrency(merged)
    };
  }

  /** Per-task semaphore, created on first use. */
  _semaphoreFor(task, limit) {
    let semaphore = this._semaphores.get(task);
    if (semaphore === void 0 || semaphore.limit !== limit) {
      semaphore = new AsyncSemaphore(limit);
      this._semaphores.set(task, semaphore);
    }
    return semaphore;
  }

  /** Resolve the session's current main model route, when available. */
  async _mainRoute(request) {
    const agent = request.agent;
    const session = request.session;
    if (session !== void 0 && typeof session.requestHeader === "function") {
      try {
        const header = session.requestHeader();
        const config = header?.config;
        if (config?.provider !== void 0 && config?.model !== void 0) {
          return route(config.provider, config.model);
        }
      } catch {
        /* header may be unavailable mid-turn; fall through */
      }
    }
    if (agent !== void 0 && agent.options?.provider !== void 0 && agent.options?.model !== void 0) {
      return route(agent.options.provider, agent.options.model);
    }
    let defaultModel;
    try {
      defaultModel = this.ctx.get("agentDefaultModel");
    } catch {
      return void 0;
    }
    if (defaultModel !== void 0) {
      try {
        const selection = defaultModel.currentSelection();
        if (selection?.provider !== void 0 && selection?.model !== void 0) {
          return route(selection.provider, selection.model);
        }
      } catch {
        /* fall through */
      }
    }
    return void 0;
  }

  /** One route attempt: deadline + stream + assemble. */
  async _callRoute(task, definition, target, request) {
    const timeoutMs = taskTimeoutMs(definition);
    const callDeadline = deadline(request.signal, timeoutMs, AUX_TIMEOUT_CODE);
    try {
      // Image-capability gate: when the request carries images and the
      // candidate route does NOT declare image input, refuse the route
      // (classified as "content" → automatic main-model fallback) instead of
      // burning a call the adapter will reject. Unknown capability (no
      // resolveModelInfo answer) passes through — the provider decides.
      const hasImage = request.messages.some((message) =>
        message.content.some((block) => block.type === "image")
      );
      if (hasImage) {
        const capability = await this._resolveImageCapability(target, callDeadline.signal);
        if (capability === false) {
          const error = new Error(
            `aux: model "${target.model}" does not declare image input for ${task} task`
          );
          error.failure = { code: "UNSUPPORTED_CONTENT", message: error.message };
          throw error;
        }
      }
    } catch (error) {
      callDeadline[Symbol.dispose]();
      throw error;
    }
    const options = deepFreeze({
      provider: target.provider,
      model: target.model,
      messages: request.messages,
      ...(request.system !== void 0 ? { system: request.system } : {}),
      ...(request.tools === void 0 ? {} : { tools: [...request.tools] }),
      ...(request.temperature !== void 0 ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== void 0 ? { maxTokens: request.maxTokens } : {}),
      sessionId: request.session?.id,
      signal: callDeadline.signal
    });
    try {
      const assembler = new BlockAssembler();
      for await (const chunk of this.ctx.llm.stream(options)) {
        callDeadline.signal.throwIfAborted();
        assembler.push(chunk);
      }
      callDeadline.signal.throwIfAborted();
      const terminalError = finishError(assembler.finish);
      if (terminalError !== void 0) throw terminalError;
      const blocks = assembler.blocks();
      if (blocks.some((block) => block.type === "tool-call")) {
        throw new Error("aux: task model unexpectedly requested a tool");
      }
      const text = stripThinkBlocks(
        blocks
          .filter((block) => block.type === "text" || block.type === "reasoning")
          .map((block) => block.text)
          .join(" ")
      );
      if (text.length === 0) throw new Error("aux: task model produced no text");
      return text;
    } finally {
      callDeadline[Symbol.dispose]();
    }
  }

  /**
   * Resolve whether a route declares image input. Returns true when
   * supported, false when explicitly unsupported, undefined when unknown
   * (no resolveModelInfo answer).
   */
  async _resolveImageCapability(target, signal) {
    let llm;
    try {
      llm = this.ctx.get("llm");
    } catch {
      return void 0;
    }
    try {
      const info = await llm.resolveModelInfo(target.provider, target.model, signal);
      if (info?.inputModalities === void 0) return void 0;
      // An EMPTY modality list means the adapter does not know the model's
      // capabilities (pi-ai defaults undeclared models to []). Treat it as
      // UNKNOWN and let the provider decide — only a non-empty list without
      // image is a confident "no".
      if (info.inputModalities.length === 0) return void 0;
      return info.inputModalities.includes("image");
    } catch {
      return void 0;
    }
  }

  /**
   * Prepare messages for a compaction-style AUX call.
   *
   * Compaction replays derived session messages, which may carry image blocks
   * with only durable attachment references. The summarizer can use them only
   * when a compaction candidate route accepts images AND the attachment bytes
   * still exist (they may be missing after attachment GC, or after images were
   * handled by subagents rather than by this plugin). To keep `/compact` and
   * automatic compression resilient:
   *  - if no candidate route accepts images, replace every image block with a
   *    short text placeholder so a text-only auxiliary/main model can still
   *    produce the checkpoint summary;
   *  - otherwise keep image blocks that are still readable, and replace only
   *    missing/corrupt/unreadable ones with the same placeholder.
   */
  async _prepareCompactionMessages(messages, agent, signal) {
    const hasImage = messages.some(
      (message) => Array.isArray(message?.content) && message.content.some((block) => block?.type === "image")
    );
    if (!hasImage) return messages;

    const definition = this._taskDefinition("compaction");
    const primary = resolvePrimaryRoute(definition, this.taskDefaults);
    const mainRoute = await this._mainRoute({ session: agent?.session, agent });
    const candidates = [];
    if (primary !== void 0) candidates.push(primary);
    if (this.fallbackToMain && mainRoute !== void 0) candidates.push(mainRoute);
    let imageCapable = candidates.length === 0;
    for (const candidate of candidates) {
      const capability = await this._resolveImageCapability(candidate, signal);
      if (capability !== false) {
        imageCapable = true;
        break;
      }
    }
    if (!imageCapable) {
      return messages.map((message) =>
        Array.isArray(message?.content) && message.content.some((block) => block?.type === "image")
          ? {
              ...message,
              content: message.content.map((block) =>
                block?.type === "image" ? compactionImagePlaceholder(block.attachment) : block
              )
            }
          : message
      );
    }

    let attachments;
    try {
      attachments = this._imageCtx?.get("attachments") ?? this.ctx.get("attachments");
    } catch {
      attachments = void 0;
    }
    const out = [];
    for (const message of messages) {
      if (!Array.isArray(message?.content) || !message.content.some((block) => block?.type === "image")) {
        out.push(message);
        continue;
      }
      const content = [];
      let changed = false;
      for (const block of message.content) {
        if (block?.type !== "image") {
          content.push(block);
          continue;
        }
        const ref = block.attachment;
        if (attachments !== void 0 && ref !== void 0) {
          try {
            // Verify the object is present; the LLM stream path would otherwise
            // fail with "Attachment object is missing." for GC'd attachments.
            await attachments.readImage(ref, signal);
            content.push(block);
            continue;
          } catch {
            /* missing/corrupt/unreadable: replace with placeholder */
          }
        }
        changed = true;
        content.push(compactionImagePlaceholder(ref));
      }
      out.push(changed ? { ...message, content } : message);
    }
    return out;
  }

  /**
   * Whether the deployed dsh-session supports marking custom events
   * ignorable (the bridge/patch-session-ignorable.mjs patch). Without it,
   * appending "aux/llm-call" would write events the persistence read path
   * rejects (unknown type, not ignorable) and the WHOLE session log becomes
   * unreadable. Detection is cached; missing/undetectable ⇒ treated as
   * unsupported so we degrade to not writing events at all.
   */
  async _sessionEventsSupported() {
    if (this._sessionEventsSupportedCache !== void 0) return this._sessionEventsSupportedCache;
    const candidates = sessionPatchCandidates(import.meta.url);
    for (const candidate of candidates) {
      try {
        const src = await readFileText(candidate);
        if (src.includes("dsh-aux ignorable (local patch)")) {
          this._sessionEventsSupportedCache = true;
          return true;
        }
      } catch {
        /* try the next candidate */
      }
    }
    this._sessionEventsSupportedCache = false;
    return this._sessionEventsSupportedCache;
  }

  /**
   * Log one auxiliary call as a session event, when a session is present.
   * The event is marked ignorable (requires the dsh-session ignorable patch,
   * see bridge/patch-session-ignorable.mjs): the persistence read path
   * accepts out-of-repo event types when ignorable, while the event itself
   * stays in the log so the aux-status projection replays normally.
   * WITHOUT the patch we intentionally do NOT write the event: an
   * unmarked custom event would make the whole session log unreadable.
   */
  async _recordEvent(session, data) {
    if (session === void 0) return;
    if (!await this._sessionEventsSupported()) {
      if (!this._sessionEventsWarned) {
        this._sessionEventsWarned = true;
        this.ctx.logger.warn(
          "dsh-aux: dsh-session ignorable patch not found — aux/llm-call events are NOT written to keep session logs compatible. Run bridge/patch-session-ignorable.mjs (or the repo install.sh) to enable event tracing."
        );
      }
      return;
    }
    try {
      // Drop undefined fields before the event is snapshotted: dsh-session's
      // JSON snapshot (walkJsonValue) rejects ANY undefined property value as
      // "non-lossless JSON", which would make append() throw and silently
      // drop the event. Optional request fields (purpose, errorCode, …) are
      // absent from most calls, so strip them here defensively.
      const clean = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== void 0) clean[key] = value;
      }
      session.append(AUX_CALL_EVENT, clean, void 0, { ignorable: true });
    } catch {
      /* event logging must never fail the call */
    }
  }

  /** Current per-task routing status (for /aux status and UIs). */
  describe() {
    const out = [];
    for (const task of AUX_TASKS) {
      const definition = { task, ...(this._merged[task] ?? {}) };
      const primary = resolvePrimaryRoute(definition, this.taskDefaults);
      out.push({
        task,
        label: TASK_LABELS[task],
        configured: definition?.provider !== void 0,
        primary: primary ?? null,
        timeoutMs: taskTimeoutMs(definition),
        maxConcurrency: taskConcurrency(definition)
      });
    }
    return out;
  }

  /** Handle the /aux command. */
  async _handleCommand(agent, rawInput) {
    const args = rawInput.trim().split(/\s+/).filter(Boolean);
    const sub = args[0] ?? "";
    if (sub === "gc-images") {
      const days = args[1] === void 0 ? 30 : Number(args[1]);
      if (!Number.isInteger(days) || days <= 0) {
        return { kind: "error", text: "用法: /aux gc-images [days] — 清理超过 N 天的附件图片(默认 30)" };
      }
      return await this._gcImages(days);
    }
    if (sub === "model") {
      return await this._handleModelCommand(args.slice(1));
    }
    if (sub === "vision") {
      return await this._handleVisionCommand(agent, args.slice(1));
    }
    if (sub === "test") {
      return await this._handleTestCommand(agent, args.slice(1));
    }
    if (sub === "memory") {
      return await this._handleMemoryCommand(args.slice(1));
    }
    if (sub === "status" || sub === "") {
      // Reconcile first so the status view reflects any deleted-session
      // cleanup that happened while the service was not watching.
      await this._reconcileSessionImages();
      const lines = ["辅助模型系统状态:"];
      // Integrated image-bridge status: report it so a fresh install knows
      // whether pasting images into a text-only main model will work.
      const bridge = await this._imageBridgeStatus();
      if (bridge !== "unknown") {
        const label = {
          v2: "已集成(v2:UI 保留缩略图)",
          v1: "旧版 v1(建议运行 bridge/apply-patch.mjs 升级)",
          partial: "部分安装(建议运行 bridge/apply-patch.mjs 补全)",
          missing: "未安装(纯文本主模型发图会受限;运行仓库 install.sh 一键集成)"
        }[bridge] ?? bridge;
        lines.push("  - image-bridge: " + label);
      }
      // Compaction bridge status: when dsh-compaction-basic is present and a
      // dedicated `compaction` AUX route is configured, native session
      // compaction is routed through AUX.
      const compactionBridgeInstalled = isCompactionBridgeInstalled();
      if (compactionBridgeInstalled) {
        lines.push(
          "  - compaction-bridge: " +
            (isCompactionTaskConfigured(this)
              ? "已启用(会话压缩走 AUX 辅助模型)"
              : "已安装(未配置 compaction 任务 → 原生摘要)")
        );
      } else {
        lines.push("  - compaction-bridge: 未安装(dsh-compaction-basic 缺失)");
      }
      // Session-event tracing status: without the dsh-session ignorable
      // patch, aux/llm-call events are not written (safety degradation).
      const eventsSupported = await this._sessionEventsSupported();
      lines.push(
        "  - 会话事件记录: " +
          (eventsSupported ? "已启用(ignorable 补丁已装)" : "已停用(缺 dsh-session ignorable 补丁,运行 bridge/patch-session-ignorable.mjs 或 install.sh 启用)")
      );
      for (const entry of this.describe()) {
        const primary = entry.primary
          ? `${entry.primary.provider}/${entry.primary.model}`
          : "(未配置 → 主模型)";
        lines.push(
          `  - ${entry.label}(${entry.task}): ${primary} | timeout ${entry.timeoutMs}ms | 并发 ${entry.maxConcurrency}`
        );
      }
      const recent = this._recentCalls(agent);
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

  /**
   * Garbage-collect pasted-image attachments older than `days` days.
   *
   * Pasted images persist under DSH_HOME/attachments/v1/objects (content-
   * addressed, extension-less objects plus the bridge's .ext hardlinks) and
   * DSH ships no retention for them — they accumulate forever. This command
   * deletes files whose mtime is older than the cutoff, and their companion
   * hardlinks. It is deliberately MANUAL (not a timer): deleting attachments
   * can break replay of historical sessions that reference them, so the user
   * decides when to reclaim space. Content addressing means the same image
   * pasted many times is one object, so growth is slower than it looks.
   *
   * @param days cutoff age in days (default 30).
   * @returns a command result describing what was removed.
   */
  async _gcImages(days) {
    const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
    if (home === void 0) return { kind: "error", text: "aux: cannot locate DSH_HOME for attachment cleanup" };
    const objectsRoot = home + "/attachments/v1/objects";
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let removed = 0;
    let removedBytes = 0;
    let scanned = 0;
    let failed = 0;
    try {
      // Only REAL directories and REGULAR files are scanned: a symlinked
      // directory inside the object store could otherwise make readdir follow
      // it into an unrelated tree (e.g. a Windows drive mount under WSL) and
      // unlink files there. Dirent checks reject symlinks outright.
      const buckets = await readdir(objectsRoot, { withFileTypes: true }).catch(() => []);
      for (const bucketEnt of buckets) {
        if (!bucketEnt.isDirectory()) continue;
        const bucketPath = objectsRoot + "/" + bucketEnt.name;
        const entries = await readdir(bucketPath, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const filePath = bucketPath + "/" + entry.name;
          scanned += 1;
          try {
            const st = await statFile(filePath);
            if (st.isFile() && st.mtimeMs < cutoff) {
              await unlinkFile(filePath);
              removed += 1;
              removedBytes += st.size;
            }
          } catch {
            failed += 1;
          }
        }
      }
    } catch (error) {
      return { kind: "error", text: `aux: attachment GC failed: ${error?.message ?? String(error)}` };
    }
    return {
      kind: "success",
      text: `附件清理完成: 扫描 ${scanned} 个文件, 删除 ${removed} 个超过 ${days} 天的附件 (${(removedBytes / 1024 / 1024).toFixed(1)} MB)${failed > 0 ? `, ${failed} 个失败` : ""}。`
    };
  }

  /** Path to the session→attachment ownership map. */
  _sessionImagesPath() {
    const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
    return home === void 0 ? void 0 : home + "/attachments/v1/session-images.json";
  }

  /** Load the ownership map from disk (missing/corrupt → empty). */
  async _loadSessionImages() {
    const path = this._sessionImagesPath();
    if (path === void 0) return new Map();
    try {
      const raw = await readFileText(path);
      const parsed = JSON.parse(raw);
      const map = new Map();
      for (const [sid, ids] of Object.entries(parsed)) {
        if (Array.isArray(ids)) map.set(sid, new Set(ids));
      }
      return map;
    } catch {
      return new Map();
    }
  }

  /** Persist the ownership map atomically (tmp + rename). */
  async _saveSessionImages() {
    const path = this._sessionImagesPath();
    if (path === void 0) return;
    const obj = {};
    for (const [sid, ids] of this._sessionImages) {
      obj[sid] = [...ids];
    }
    try {
      const tmp = path + ".tmp";
      await writeFileText(tmp, JSON.stringify(obj));
      await renameFile(tmp, path);
    } catch {
      /* best-effort: ownership recording must never break vision calls */
    }
  }

  /**
   * Seed the in-memory ownership cache from disk exactly once. Without this,
   * a fresh process (restart) would persist ONLY the sessions seen since
   * startup, overwriting the disk map and losing every older session's
   * ownership — their images would then never be cleaned on deletion.
   */
  async _ensureSessionImagesLoaded() {
    if (this._sessionImagesLoaded) return;
    this._sessionImagesLoaded = true;
    const disk = await this._loadSessionImages();
    for (const [sid, ids] of disk) {
      if (!this._sessionImages.has(sid)) this._sessionImages.set(sid, ids);
    }
  }

  /**
   * Record that one session referenced one image attachment. Called after a
   * vision call resolves its image, so disposal cleanup knows what to prune.
   */
  async _recordAttachmentOwnership(sessionId, attachmentId) {
    if (sessionId === void 0 || attachmentId === void 0) return;
    await this._ensureSessionImagesLoaded();
    let ids = this._sessionImages.get(sessionId);
    if (ids === void 0) {
      ids = new Set();
      this._sessionImages.set(sessionId, ids);
    }
    ids.add(attachmentId);
    if (!this._sessionImagesDirty) {
      this._sessionImagesDirty = true;
      // Debounced persistence: flush shortly after the current turn.
      setTimeout(() => {
        this._sessionImagesDirty = false;
        this._saveSessionImages();
      }, 0);
    }
  }

  /**
   * Collect the ids of every session that still exists: live (attached in
   * memory) plus persisted (on disk). Best-effort: a missing service or a
   * failed list call degrades to the live set only.
   * @returns a Set of session ids that must keep their images.
   */
  async _liveSessionIds() {
    const ids = new Set();
    try {
      const sessions = this.ctx.get("sessions");
      if (sessions !== void 0 && typeof sessions.list === "function") {
        for (const session of sessions.list()) ids.add(session.id);
      }
    } catch { /* service absent */ }
    try {
      const persistence = this.ctx.get("sessionPersistence");
      if (persistence !== void 0 && typeof persistence.listSnapshots === "function") {
        for (const snapshot of await persistence.listSnapshots()) {
          const id = snapshot?.header?.id ?? snapshot?.id;
          if (id !== void 0) ids.add(String(id));
        }
      }
    } catch { /* persistence absent or unreadable */ }
    return ids;
  }

  /**
   * Detect whether the image-bridge patches are applied to the core DSH
   * packages that live NEXT to this plugin in the deployment node_modules
   * (dsh-host-apiproxy admit + dsh-agent-loop buildRequest). The bridge is
   * an integrated part of the install (see the repo's install.sh), so the
   * status command reports it and the AI guide treats it as a default step.
   * @returns "v2" | "v1" | "partial" | "missing" | "unknown" (not in a
   *   standard deployment layout, e.g. running from the source tree).
   */
  async _imageBridgeStatus() {
    // 兼容两种部署形态:
    // - symlink: node_modules/@dolorescaritasangelus/dsh-aux/src -> ../../../@deepseek-ai/...
    // - 源码树: <DSH_ROOT>/dsh work/aux/dsh-aux/src -> ../../../node_modules/@deepseek-ai/...
    const targets = [
      {
        rels: [
          "../../../@deepseek-ai/dsh-host-apiproxy/lib/index.js",
          "../../../node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js"
        ],
        v2Mark: "dsh-image bridge v2 (local patch)",
        v1Mark: "dsh-vision bridge (local patch)"
      },
      {
        rels: [
          "../../../@deepseek-ai/dsh-agent-loop/lib/index.js",
          "../../../node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js"
        ],
        v2Mark: "image-bridge v2 (local patch)",
        v1Mark: void 0
      }
    ];
    const states = [];
    for (const target of targets) {
      let src;
      for (const rel of target.rels) {
        try {
          src = await readFileText(new URL(rel, import.meta.url));
          break;
        } catch {
          /* try next candidate */
        }
      }
      if (src === void 0) {
        states.push("unknown");
        continue;
      }
      if (src.includes(target.v2Mark)) states.push("v2");
      else if (target.v1Mark !== void 0 && src.includes(target.v1Mark)) states.push("v1");
      else states.push("missing");
    }
    if (states.some((state) => state === "unknown")) return "unknown";
    if (states.every((state) => state === "v2")) return "v2";
    if (states.every((state) => state === "missing")) return "missing";
    return "partial";
  }

  /**
   * Reconcile the persisted ownership map against the live session set:
   * any session that no longer exists (deleted while cold, so no
   * session/disposed fired) has its unreferenced images removed. Archive
   * does not delete a session, so archived sessions stay in persistence and
   * are never touched. Idempotent and cheap when the map is empty.
   */
  async _reconcileSessionImages() {
    const map = await this._loadSessionImages();
    if (map.size === 0) return;
    const live = await this._liveSessionIds();
    for (const sessionId of [...map.keys()]) {
      if (!live.has(sessionId)) {
        await this._cleanupSessionImages(sessionId);
      }
    }
  }

  /**
   * Delete-triggered attachment GC. Runs when a session is disposed; removes
   * images that session owned and that no other session references. A burst
   * of simultaneous disposals (process shutdown) is skipped wholesale.
   */
  async _onSessionDisposed(session) {
    const sid = session?.id ?? session?.sessionId;
    if (sid === void 0) return;
    // Process shutdown disposes every session at once — not a user delete.
    if (this._disposalBurst) {
      this._disposalBurst.add(sid);
      return;
    }
    this._disposalBurst = new Set([sid]);
    setTimeout(() => {
      const burst = this._disposalBurst;
      this._disposalBurst = void 0;
      if (burst !== void 0 && burst.size > 1) return; // shutdown: skip
      this._cleanupSessionImages(sid);
    }, 0);
  }

  /** Delete one disposed session's unreferenced images and update the map. */
  async _cleanupSessionImages(sessionId) {
    const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
    if (home === void 0) return;
    const objectsRoot = home + "/attachments/v1/objects";
    const map = await this._loadSessionImages();
    const mine = map.get(sessionId);
    if (mine === void 0 || mine.size === 0) return;
    // Which other sessions reference each id?
    let removed = 0;
    for (const attachmentId of mine) {
      const referencedElsewhere = [...map.entries()].some(([sid, ids]) =>
        sid !== sessionId && ids.has(attachmentId)
      );
      if (referencedElsewhere) continue;
      const match = /^sha256:([a-f0-9]{64})$/.exec(String(attachmentId));
      if (match === null) continue;
      const hash = match[1];
      const real = objectsRoot + "/" + hash.slice(0, 2) + "/" + hash;
      try {
        await unlinkFile(real);
      } catch { /* already gone */ }
      // Companion .ext hardlink from the image bridge, if present.
      const extensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
      for (const ext of extensions) {
        try {
          await unlinkFile(real + ext);
        } catch { /* absent */ }
      }
      removed += 1;
    }
    if (removed > 0) {
      map.delete(sessionId);
      // Keep the in-memory cache consistent: a later debounced save must not
      // resurrect the deleted session's entries from the stale cache.
      this._sessionImages.delete(sessionId);
      const obj = {};
      for (const [sid, ids] of map) obj[sid] = [...ids];
      try {
        const path = this._sessionImagesPath();
        if (path !== void 0) {
          const tmp = path + ".tmp";
          await writeFileText(tmp, JSON.stringify(obj));
          await renameFile(tmp, path);
        }
      } catch { /* best-effort */ }
    }
  }

  /** Handle the /aux model subcommand: read or write one task's route. */
  async _handleModelCommand(args) {
    const task = args[0] ?? "";
    if (!AUX_TASKS.includes(task)) {
      return {
        kind: "error",
        text: `用法: /aux model <task> [provider/model] — task ∈ {${AUX_TASKS.join(", ")}}`
      };
    }
    const definition = { task, ...(this._merged[task] ?? {}) };
    const primary = resolvePrimaryRoute(definition, this.taskDefaults);
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
    const settings = this.ctx.get("settings");
    if (settings === void 0) {
      return { kind: "error", text: "aux: settings service is not mounted; cannot persist the model choice" };
    }
    const currentSection = this._source?.() ?? {};
    const tasks = { ...(currentSection.tasks ?? {}) };
    tasks[task] = { ...(tasks[task] ?? {}), provider, model };
    try {
      await settings.replace(AUX_SETTINGS_NAMESPACE, { ...currentSection, tasks });
      // Recompute so the status view reflects the change immediately.
      this._recomputeMerged();
      return { kind: "success", text: `辅助模型 [${task}] 已设为 ${provider}/${model},下一请求生效。` };
    } catch (error) {
      return { kind: "error", text: `aux: 写入设置失败: ${error?.message ?? String(error)}` };
    }
  }

  /** Fold the latest aux call record per task from a session log. */
  _recentCalls(agent) {
    const events = agent?.session?.events ?? [];
    const latest = new Map();
    for (const event of events) {
      if (event.type !== AUX_CALL_EVENT) continue;
      latest.set(event.data.task, event.data);
    }
    return [...latest.values()];
  }

  /** Register the three auxiliary tools. */
  _registerTools() {
    const ctx = this.ctx;
    // The vision tool needs the durable attachment service; register it in
    // the attachments-injected scope (mirrors dsh-tool-fs read_image), so
    // `ctx.get("attachments")` resolves inside execution even under a
    // subagent-scoped context. The other two tools need no image store.
    ctx.inject(["attachments"], (imageCtx) => {
      this._imageCtx = imageCtx;
      imageCtx.tools.register(defineTool({
        name: "vision_analyze",
        description: "Look at one image (or several via the images array) with the auxiliary vision model and answer a SPECIFIC question about it/them. Always state exactly what you need to know in the question parameter (extract text, count objects, read a chart, check a color, compare elements) — never ask for a generic description, because the vision model answers your intent, not a caption. If the returned description misses a detail you need, call again with a more specific question about that detail. If the same image (same attachmentId) was already analyzed with the same question in this session, reuse that earlier result instead of re-analyzing. Provide one of attachmentId (a session image attachment), imagePath (a local image file), imageUrl (a remote image URL), or an images array (each entry exactly one of those three keys; analyzed in parallel — useful for comparing multiple images with one question).",
        parameters: {
          attachmentId: { type: "string", description: "Session attachment id of an image already attached to this conversation." },
          imagePath: { type: "string", description: "Path to a local PNG/JPEG/WebP/GIF image file." },
          imageUrl: { type: "string", description: "URL of a remote image to fetch and analyze." },
          images: { type: "array", description: "Multiple images (or GIFs) to analyze in parallel with the SAME question. Each entry must be an object with exactly one of: attachmentId, imagePath, imageUrl." },
          question: { type: "string", required: true, description: "The SPECIFIC thing you need to know about the image(s) (your intent). One focused question per call; ask a follow-up call for another detail." }
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              analysis: { type: "string", description: "Present for single-image calls." },
              analyses: { type: "array", description: "Present for multi-image calls; one entry per image." },
              provider: { type: "string", required: true },
              model: { type: "string", required: true }
            }
          },
          render: (_args, value) => [{ type: "text", text: Array.isArray(value.analyses) ? value.analyses.map((a, i) => "【图" + (i + 1) + "】" + a.analysis).join("\n\n") : value.analysis }]
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => true,
        execute: (args, exec) => this._runVision(args, exec)
      }));
    });
    ctx.tools.register(defineTool({
      name: "web_extract",
      description: "Fetch a web page and summarize it with the auxiliary model: returns a factual summary plus key points. Use when you need the essence of a page without carrying its full text.",
      parameters: {
        url: { type: "string", required: true, description: "The HTTP(S) URL to fetch and summarize." },
        question: { type: "string", description: "Optional question to answer from the page." },
        maxChars: { type: "integer", description: "Max page characters sent to the model (default 8000)." }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: { type: "string", required: true },
            summary: { type: "string", required: true },
            keyPoints: { type: "array", items: { type: "string" }, required: true },
            provider: { type: "string", required: true },
            model: { type: "string", required: true }
          }
        },
        render: (args, value) => [
          { type: "text", text: value.summary + (value.keyPoints.length > 0 ? "\n\n要点:\n- " + value.keyPoints.join("\n- ") : "") }
        ]
      },
      timeoutMs: 90_000,
      isConcurrencySafe: () => true,
      execute: (args, exec) => this._runWebExtract(args, exec)
    }));
    ctx.tools.register(defineTool({
      name: "compress_text",
      description: "Compress long text with the auxiliary model, preserving factual details (numbers, paths, identifiers). Use to shrink oversized tool output, research notes, or logs before they enter context.",
      parameters: {
        text: { type: "string", required: true, description: "The text to compress." },
        instruction: { type: "string", description: "Optional additional compression requirements (e.g. 'keep every file path')." },
        targetRatio: { type: "number", description: "Target compressed/original ratio (0.05-0.5, default 0.2)." }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            compressed: { type: "string", required: true },
            originalChars: { type: "integer", required: true },
            compressedChars: { type: "integer", required: true },
            ratio: { type: "number", required: true },
            provider: { type: "string", required: true },
            model: { type: "string", required: true }
          }
        },
        render: (args, value) => [{ type: "text", text: value.compressed }]
      },
      timeoutMs: 120_000,
      isConcurrencySafe: () => true,
      execute: (args, exec) => this._runCompress(args, exec)
    }));
  }

  /** vision_analyze execution. Supports ONE image via the classic single
   * source fields, or MANY via `images` (analyzed in parallel, bounded by
   * the task concurrency semaphore). */
  async _runVision(args, exec) {
    const single = [
      args.attachmentId !== void 0 && args.attachmentId.length > 0,
      args.imagePath !== void 0 && args.imagePath.length > 0,
      args.imageUrl !== void 0 && args.imageUrl.length > 0
    ].filter(Boolean).length;
    const images = Array.isArray(args.images) ? args.images : [];
    const itemCount = images.length + (single > 0 ? 1 : 0);
    if (itemCount === 0) throw new Error("vision_analyze: provide one of attachmentId, imagePath, imageUrl, or an images array");
    if (images.length > 0 && single > 0) throw new Error("vision_analyze: provide either the images array or a single image source, not both");
    if (images.length > 0 && images.some((item) => !this._validImageItem(item))) {
      throw new Error("vision_analyze: each images entry must be an object with exactly one of attachmentId, imagePath, or imageUrl");
    }
    const question = args.question ?? "";
    if (question.length === 0) {
      // Focus-hint contract: the vision model answers the caller's intent,
      // not a generic caption. Refuse instead of silently degrading.
      throw new Error("vision_analyze: question is required — state what you need to know about the image");
    }
    const items = images.length > 0
      ? images
      : [{ attachmentId: args.attachmentId, imagePath: args.imagePath, imageUrl: args.imageUrl }];
    const results = await Promise.all(items.map((item) => this._analyzeOne(item, question, exec)));
    if (images.length === 0) return results[0]; // classic single-image shape
    return {
      analyses: results,
      provider: results[0].provider,
      model: results[0].model
    };
  }

  /** One `images` entry is valid when it names exactly one source. */
  _validImageItem(item) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
    const keys = ["attachmentId", "imagePath", "imageUrl"].filter((k) => typeof item[k] === "string" && item[k].length > 0);
    return keys.length === 1;
  }

  /** Analyze exactly one image through the auxiliary vision route. */
  async _analyzeOne(source, question, exec) {
    const ref = await this._resolveImageRef(source, exec);
    // Record ownership for disposal cleanup (session -> attachment id).
    if (exec.agent?.session?.id !== void 0) {
      this._recordAttachmentOwnership(exec.agent.session.id, ref.attachmentId);
    }
    const messages = [createUserMessage({
      content: [
        { type: "image", attachment: ref },
        { type: "text", text: question }
      ],
      source: { kind: "plugin", plugin: "dsh-aux" }
    })];
    const result = await this.call("vision", {
      messages,
      system: visionSystemPrompt(),
      session: exec.agent?.session,
      agent: exec.agent,
      signal: exec.signal,
      inputChars: question.length
    });
    // Image memory: persist a compact record so a restarted main session can
    // recall what was looked at without re-analyzing. Best-effort.
    if (exec.agent?.session?.id !== void 0) {
      this._recordImageMemory(exec.agent.session.id, ref.attachmentId, question, result.text);
    }
    return { analysis: result.text, provider: result.provider, model: result.model };
  }

  /** Path to the image-memory journal (path/question -> summary). */
  _imageMemoryPath() {
    const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
    return home === void 0 ? void 0 : home + "/attachments/v1/image-memory.json";
  }

  /** Append one vision outcome to the memory journal (bounded, best-effort). */
  async _recordImageMemory(sessionId, attachmentId, question, summary) {
    this._memoryQueue = this._memoryQueue.then(() =>
      this._recordImageMemoryCore(sessionId, attachmentId, question, summary)
    );
    return this._memoryQueue;
  }

  /** The serialized journal append; never rejects (best-effort). */
  async _recordImageMemoryCore(sessionId, attachmentId, question, summary) {
    const path = this._imageMemoryPath();
    if (path === void 0) return;
    try {
      const raw = await readFileText(path).catch(() => "{}");
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      entries.push({
        sessionId,
        attachmentId,
        question: question.slice(0, 200),
        summary: summary.slice(0, 600),
        at: Date.now()
      });
      const trimmed = entries.slice(-200);
      const tmp = path + ".tmp";
      await writeFileText(tmp, JSON.stringify({ entries: trimmed }));
      await renameFile(tmp, path);
    } catch {
      /* best-effort */
    }
  }

  /** /aux memory [n] — list recent image analyses from the journal. */
  async _handleMemoryCommand(args) {
    const path = this._imageMemoryPath();
    if (path === void 0) return { kind: "error", text: "aux: cannot locate DSH_HOME" };
    try {
      const raw = await readFileText(path).catch(() => "{}");
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      const limit = args[0] === void 0 ? 10 : Math.max(1, Math.min(50, Number(args[0]) || 10));
      const recent = entries.slice(-limit).reverse();
      if (recent.length === 0) return { kind: "success", text: "图片记忆为空(尚未分析过图片)" };
      const lines = ["最近图片分析记忆:"];
      for (const e of recent) {
        lines.push(
          `  - [${new Date(e.at).toLocaleString()}] ${String(e.attachmentId).slice(0, 16)}… 问:${e.question.slice(0, 40)} → ${e.summary.slice(0, 80)}…`
        );
      }
      return { kind: "success", text: lines.join("\n") };
    } catch (error) {
      return { kind: "error", text: `aux: 读取图片记忆失败: ${error?.message ?? String(error)}` };
    }
  }

  /**
   * /aux vision <imagePath> <question...> — analyze one image through the
   * auxiliary vision model, usable by any agent or by a human in the UI.
   */
  async _handleVisionCommand(agent, args) {
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
      const value = await this._runVision({ imagePath: path, question }, exec);
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
  async _handleTestCommand(agent, args) {
    const task = args[0] ?? "";
    if (!AUX_TASKS.includes(task)) {
      return { kind: "error", text: `用法: /aux test <task> — task ∈ {${AUX_TASKS.join(", ")}}` };
    }
    const startedAt = Date.now();
    try {
      let text;
      if (task === "compress") {
        const value = await this._runCompress(
          { text: "2026-08-14 15:00:00 INFO boot ok provider=opencode-go model=deepseek-v4-flash session=s-001 duration=1234ms", instruction: "保留所有时间戳、provider、model 和数字" },
          { agent, signal: new AbortController().signal }
        );
        text = `压缩成功: ${value.originalChars} -> ${value.compressedChars} chars (ratio ${value.ratio})`;
      } else if (task === "web_extract") {
        const value = await this._runWebExtract(
          { url: "https://example.com", maxChars: 2000 },
          { agent, signal: new AbortController().signal }
        );
        text = `抓取成功: ${value.url} | 摘要 ${value.summary.slice(0, 80)}...`;
      } else if (task === "compaction") {
        const result = await this.call("compaction", {
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

  /** Resolve an image reference from attachmentId / imagePath / imageUrl. */
  async _resolveImageRef(args, exec) {
    let attachments;
    try {
      attachments = this._imageCtx?.get("attachments") ?? this.ctx.get("attachments");
    } catch {
      attachments = void 0;
    }
    if (args.attachmentId !== void 0 && args.attachmentId.length > 0) {
      // Find the durable ref in the session's user messages.
      const agent = exec.agent;
      const session = agent?.session;
      const events = session?.events ?? [];
      for (const event of events) {
        if (event.type !== "user/message") continue;
        const content = event.message?.content ?? event.data?.message?.content ?? [];
        for (const block of content) {
          if (block?.type === "image" && String(block.attachment?.attachmentId) === String(args.attachmentId)) {
            if (attachments === void 0) throw new Error("vision_analyze: no attachment service mounted");
            const stored = await attachments.readImage(block.attachment, exec.signal);
            return stored.ref;
          }
        }
      }
      throw new Error(`vision_analyze: attachment "${args.attachmentId}" not found in this session's messages`);
    }
    if (args.imagePath !== void 0 && args.imagePath.length > 0) {
      let fs;
      try {
        fs = this.ctx.get("fs");
      } catch {
        fs = void 0;
      }
      if (fs === void 0 || attachments === void 0) {
        throw new Error("vision_analyze: local image support requires the fs and attachment services");
      }
      const mediaType = mediaTypeForPath(args.imagePath);
      if (mediaType === void 0) {
        throw new Error("vision_analyze: imagePath must end in .png/.jpg/.jpeg/.webp/.gif");
      }
      const target = await fs.resolve(args.imagePath, {
        ...(exec.agent?.session?.header?.cwd !== void 0 ? { cwd: exec.agent.session.header.cwd } : {}),
        signal: exec.signal
      });
      const info = await fs.stat(target, exec.signal);
      if (info === void 0) {
        throw new Error(`vision_analyze: image not found at "${target.displayPath}"`);
      }
      if (info.type !== "file") {
        throw new Error(`vision_analyze: "${target.displayPath}" is not a regular file`);
      }
      const byteCap = Math.min(
        attachments.imageLimits.maxImageBytes,
        attachments.imageLimits.maxMessageImageBytes
      );
      const data = await fs.readBytes(target, exec.signal, byteCap);
      try {
        return await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) });
      } catch (error) {
        throw new Error(`vision_analyze: cannot read "${target.displayPath}" as ${mediaType} — the bytes may use a different format`, { cause: error });
      }
    }
    // imageUrl
    if (attachments === void 0) throw new Error("vision_analyze: no attachment service mounted");
    const response = await fetch(args.imageUrl, { signal: exec.signal });
    if (!response.ok) {
      throw new Error(`vision_analyze: fetching imageUrl failed with HTTP ${response.status}`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const mediaType = mediaTypeFromContentType(response.headers.get("content-type"));
    if (mediaType === void 0) {
      throw new Error("vision_analyze: imageUrl did not resolve to a supported image type");
    }
    if (data.length > attachments.imageLimits.maxImageBytes) {
      throw new Error(`vision_analyze: image is ${data.length} bytes, exceeding the ${attachments.imageLimits.maxImageBytes}-byte limit`);
    }
    try {
      return await attachments.saveImage({ data, mediaType });
    } catch (error) {
      throw new Error("vision_analyze: downloaded bytes are not a valid supported image", { cause: error });
    }
  }

  /** web_extract execution. */
  async _runWebExtract(args, exec) {
    const url = args.url.trim();
    if (url.length === 0) throw new Error("web_extract: url must be a non-empty string");
    const maxChars = args.maxChars ?? 8000;
    if (!Number.isInteger(maxChars) || maxChars <= 0) {
      throw new Error("web_extract: maxChars must be a positive integer");
    }
    // Prefer the ctx.web seam (provider-registered fetch: status codes,
    // decoded bodies, truncation); fall back to a plain fetch when no web
    // provider is registered (e.g. no DEEPSEEK_API_KEY), so web_extract
    // works in every environment.
    let pageText;
    let finalUrl = url;
    try {
      const fetchResult = await this.ctx.web.fetch({ url }, exec.signal);
      if (fetchResult.statusCode >= 400) {
        throw new Error(`web_extract: HTTP ${fetchResult.statusCode} fetching ${url}`);
      }
      finalUrl = fetchResult.url;
      // HTML bodies are cleaned to plain text before reaching the auxiliary
      // model; text bodies pass through unchanged.
      pageText = fetchResult.body.kind === "html"
        ? htmlToText(fetchResult.body.content)
        : fetchResult.body.content;
    } catch (error) {
      const message = error?.message ?? String(error);
      if (!/no usable web provider|web provider/i.test(message)) throw error;
      const response = await fetch(url, { signal: exec.signal, redirect: "follow" });
      if (!response.ok) {
        throw new Error(`web_extract: HTTP ${response.status} fetching ${url}`);
      }
      finalUrl = response.url ?? url;
      const contentType = response.headers.get("content-type") ?? "";
      const raw = await response.text();
      pageText = /html/i.test(contentType) ? htmlToText(raw) : raw;
    }
    if (pageText.length > maxChars) {
      pageText = pageText.slice(0, maxChars) + "\n[…truncated]";
    }
    const messages = [createUserMessage({
      content: [{ type: "text", text: webExtractUserMessage(pageText, url, args.question ?? "") }],
      source: { kind: "plugin", plugin: "dsh-aux" }
    })];
    const result = await this.call("web_extract", {
      messages,
      system: webExtractSystemPrompt(),
      temperature: 0.2,
      session: exec.agent?.session,
      agent: exec.agent,
      signal: exec.signal,
      inputChars: pageText.length
    });
    const extracted = extractKeyPoints(result.text);
    return {
      url: finalUrl,
      summary: extracted.summary || result.text,
      keyPoints: extracted.keyPoints,
      provider: result.provider,
      model: result.model
    };
  }

  /** compress_text execution. */
  async _runCompress(args, exec) {
    const text = args.text;
    if (typeof text !== "string" || text.length === 0) throw new Error("compress_text: text must be a non-empty string");
    if (text.length > DEFAULT_MAX_INPUT_CHARS) {
      throw new Error(`compress_text: input is ${text.length} chars, exceeding the ${DEFAULT_MAX_INPUT_CHARS}-char limit`);
    }
    const ratio = clampTargetRatio(args.targetRatio);
    const messages = [createUserMessage({
      content: [{ type: "text", text: compressUserMessage(text, args.instruction ?? "") }],
      source: { kind: "plugin", plugin: "dsh-aux" }
    })];
    const result = await this.call("compress", {
      messages,
      system: compressSystemPrompt(ratio),
      temperature: 0.1,
      session: exec.agent?.session,
      agent: exec.agent,
      signal: exec.signal,
      inputChars: text.length,
      purpose: "compaction"
    });
    const compressed = result.text;
    return {
      compressed,
      originalChars: text.length,
      compressedChars: compressed.length,
      ratio: text.length > 0 ? Math.round((compressed.length / text.length) * 100) / 100 : 0,
      provider: result.provider,
      model: result.model
    };
  }
}

/**
 * Reject a resolved aux settings section whose task entries pair provider
 * without model (or vice versa). Registered as the settings namespace's
 * validator so a half-configured task is refused where it is entered.
 * @param value - the resolved section, schema-valid by construction.
 */
/**
 * Candidate URLs for the patched dsh-session bundle, given this module's URL.
 * Exported for tests; the service tries each candidate and accepts the first
 * one that exists and carries the "dsh-aux ignorable (local patch)" marker.
 */
export function sessionPatchCandidates(baseUrl) {
  return [
    // symlink deploy: node_modules/@dolorescaritasangelus/dsh-aux/src
    // -> ../../../@deepseek-ai/dsh-session
    new URL("../../../@deepseek-ai/dsh-session/lib/index.js", baseUrl),
    // realpath'd source tree: <root>/dsh work/aux/dsh-aux/src -> <root>/node_modules
    new URL("../../../node_modules/@deepseek-ai/dsh-session/lib/index.js", baseUrl),
    // DSH home layout fallback
    new URL("../../../../node_modules/@deepseek-ai/dsh-session/lib/index.js", baseUrl)
  ];
}

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
}

/** Task display labels. */
const TASK_LABELS = Object.freeze({
  vision: "图像分析",
  web_extract: "网页提取",
  compress: "文本压缩",
  compaction: "会话压缩"
});

/**
 * Register a custom auxiliary task (extension point for other plugins).
 * @param definition { key, label, defaultModel?, fallbackToMain?, timeoutMs?, maxConcurrency? }
 */
export function registerAuxTask(ctx, definition) {
  const service = ctx.get("auxLlm");
  if (service === void 0) throw new Error("registerAuxTask: auxLlm service is not mounted");
  service.registerTask(definition);
}

/** Build a text placeholder replacing an unusable compaction image block. */
function compactionImagePlaceholder(ref) {
  const name = ref?.name ?? "";
  const media = ref?.mediaType ?? "image";
  const size =
    ref?.width !== void 0 && ref?.height !== void 0 ? `, ${ref.width}×${ref.height}` : "";
  const label = name.length > 0 ? name : "未命名";
  return { type: "text", text: `[图片: ${label} (${media}${size}) — 未纳入压缩摘要]` };
}

/** Media type from a local path extension. */
function mediaTypeForPath(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return void 0;
}

/** Media type from a Content-Type header (prefix match). */
function mediaTypeFromContentType(contentType) {
  if (typeof contentType !== "string") return void 0;
  const value = contentType.split(";")[0].trim().toLowerCase();
  if (value === "image/png") return "image/png";
  if (value === "image/jpeg" || value === "image/jpg") return "image/jpeg";
  if (value === "image/webp") return "image/webp";
  if (value === "image/gif") return "image/gif";
  return void 0;
}

/** Basename without path semantics (display only). */
function basename(path) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Split the model summary into summary + key points. */
function extractKeyPoints(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const points = [];
  const summaryLines = [];
  for (const line of lines) {
    const stripped = line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");
    if (/^[-*•]|^\d+[.)]/.test(line)) {
      points.push(stripped);
    } else {
      summaryLines.push(line);
    }
  }
  return { summary: summaryLines.join("\n"), keyPoints: points };
}

export default AuxLlmService;
