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
 * This entry file deliberately contains only Service assembly and routing
 * dispatch. Tool implementations, commands, image lifecycle, projection,
 * bootstrap guidance and event logging live in sibling modules.
 *
 * @module @dolorescaritasangelus/dsh-aux
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { BlockAssembler, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm";
import { deadline, MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { installSettingsSection } from "@deepseek-ai/dsh-settings";
import {
  AUX_TASKS,
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
import { resolveSubagentRoute } from "./subagent-route.js";
import { stripThinkBlocks } from "./prompt.js";
import {
  AUX_SETTINGS_NAMESPACE,
  AUX_SETTINGS_SCHEMA,
  AUX_TIMEOUT_CODE,
  AUX_TOOL_NAMES,
  SESSION_IMAGE_RECONCILE_INTERVAL_MS,
  TASK_LABELS,
  projectSettings,
  validateAuxSettings
} from "./config.js";
import { AuxCallError, finishError, recordAuxEvent, sessionPatchCandidates } from "./events.js";
import { syncAuxStatusProjection } from "./projection.js";
import {
  auxPreStepReminderText,
  auxToolsGuide,
  isAuxGuidePromoted,
  isMinimalPreset,
  shouldUsePreStepAuxGuide
} from "./bootstrap.js";
import { registerAuxTools } from "./tools/register.js";
import { onSessionDisposed, reconcileSessionImages } from "./images/ownership.js";
import { handleAuxCommand } from "./commands.js";
import { prepareCompactionMessages } from "./compaction-messages.js";
import { attachSkillBridge } from "./skill-bridge.js";

export { AUX_SETTINGS_NAMESPACE, AUX_TIMEOUT_CODE, AUX_CALL_EVENT, AUX_STATUS_KEY, validateAuxSettings } from "./config.js";
export { AuxCallError, sessionPatchCandidates } from "./events.js";

/**
 * `ctx.auxLlm`: the unified auxiliary-model router. Owns task definitions,
 * per-task semaphores, the failure cooldown table, and the settings section;
 * every call is logged as an `aux/llm-call` session event and reflected in
 * the `aux-status` projection.
 */
export class AuxLlmService extends Service {
  static inject = ["llm", "tools", "settings", "web", "fs", "systemPrompt"];
  static Config = z.object({
    allowInternalUrls: z.boolean(),
    guideText: z.string(),
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
      web_crawl: z.object({
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
      }),
      skill: z.object({
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
  /** `aux.subagent` routing settings section (bridge). */
  _subagentSettings;
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
    this.allowInternalUrls = resolved.allowInternalUrls ?? false;
    this._dnsLookup = dnsLookup;
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
    // guideText is TRUSTED plugin config: it is injected verbatim into the
    // main system prompt, so only copy it from sources you trust.
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
        text: (context) => auxToolsGuide(this, context)
      });
    }
    installSettingsSection(ctx, AUX_SETTINGS_NAMESPACE, AUX_SETTINGS_SCHEMA, projectSettings({}), {
      setSource: (current) => {
        this._source = current;
        this._recomputeMerged();
        syncAuxStatusProjection(this);
      },
      onChange: () => {
        this._recomputeMerged();
        syncAuxStatusProjection(this);
      },
      validate: validateAuxSettings,
      // The settings page is a first-class capability of this plugin:
      // declare the namespace exposed to the Web configuration client
      // (requires the dynamic-expose patch on dsh-settings + api-proxy,
      // see bridge/patch-settings-dynamic-expose.mjs).
      exposedToWeb: true
    });
    registerAuxTools(this);
    attachSkillBridge(this);
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
      this._auxGuideInjectedSessions.delete(session?.id ?? session?.sessionId);
      onSessionDisposed(this, session);
    });
    // Cold-session fallback: a session deleted while NOT attached (e.g. after
    // a restart it was never resumed) is removed by the deleter without any
    // session/disposed event. Reconcile the ownership map periodically so its
    // unreferenced images still get cleaned up.
    ctx.effect(() => {
      const timer = setInterval(() => {
        reconcileSessionImages(this).catch(() => {
          /* best-effort: reconciliation must never crash the service */
        });
      }, SESSION_IMAGE_RECONCILE_INTERVAL_MS);
      // A maintenance timer must not keep the process alive by itself.
      timer.unref?.();
      return () => clearInterval(timer);
    });
    ctx.inject(["sessionProjections"], (projectionCtx) => {
      this._projectionCtx = projectionCtx;
      syncAuxStatusProjection(this);
    });
    ctx.inject(["commands"], (commandCtx) => {
      commandCtx.commands.register({
        name: "aux",
        description: "辅助模型系统: /aux status — 查看各任务路由与最近调用",
        // The input hint is load-bearing, not cosmetic: dsh's client-side
        // command matching treats a bare host command WITHOUT an input hint as
        // a no-args command — an argued line like "/aux status" then falls
        // through to ordinary chat instead of executing (official ui-commands
        // matchEnter: `if (desc.input !== undefined) return claim; if (!bare)
        // return undefined`). Declaring `input` routes every `/aux ...` line
        // (bare or argued) through the leading-claim executor, so subcommands
        // actually run. Mirror of how official /goal /plan /preset /echo
        // register their argument-taking commands.
        input: {
          hint: "status | history [N] | history full [N] | model <task> [provider/model] | vision <imagePath> <question> | test <task> | gc-images [days] | memory"
        },
        handler: ({ agent, rawInput }) => handleAuxCommand(this, agent, rawInput)
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
      if (!isMinimalPreset(context?.agent)) return assembled;
      if (isAuxGuidePromoted(context?.agent)) return assembled;
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
      if (!shouldUsePreStepAuxGuide(this, agent)) return decision;
      if (!isAuxGuidePromoted(agent)) return decision;
      if (decision.kind === "reject" || !Array.isArray(decision.messages)) return decision;
      const sessionId = agent?.session?.id;
      if (sessionId === void 0 || this._auxGuideInjectedSessions.has(sessionId)) return decision;
      this._auxGuideInjectedSessions.add(sessionId);
      const reminder = createUserMessage({
        content: [{ type: "text", text: auxPreStepReminderText(agent) }],
        source: { kind: "aux-guide" }
      });
      return { ...decision, messages: [...decision.messages, reminder] };
    });
  }

  /** Recomputed merged task config from the live settings source. */
  _recomputeMerged() {
    const settings = this._source?.() ?? { fallbackToMain: true, forceAuxVision: false, visionFallbackToMain: true, showStatusChip: true, tasks: {}, subagent: {} };
    const merged = {};
    for (const task of AUX_TASKS) {
      merged[task] = mergeTaskConfig(
        this.pluginTasks[task] ?? {},
        settings.tasks?.[task] ?? {}
      );
    }
    this._merged = merged;
    this._subagentSettings = settings.subagent ?? {};
    this.subagentMode = this._subagentSettings.mode ?? "native";
    this.subagentPrepareTools = this._subagentSettings.prepareTools !== false;
    this.subagentIncludeWorkflow = this._subagentSettings.includeWorkflow !== false;
    this.fallbackToMain = settings.fallbackToMain ?? true;
    this.forceAuxVision = settings.forceAuxVision ?? false;
    this.visionFallbackToMain = settings.visionFallbackToMain ?? true;
    this.showStatusChip = settings.showStatusChip ?? true;
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
    if (request.signal?.aborted) {
      const error = new Error("aux: call aborted");
      error.failure = { code: "ABORTED", message: "aux: call aborted" };
      throw error;
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
      // `visionFallbackToMain=false` disables falling back to the main model
      // AFTER a configured vision aux route fails; when NO vision aux route is
      // configured at all, the main model is the only option (not a fallback),
      // so keep it usable.
      const allowMainFallback =
        (request.allowMainFallback ?? this.fallbackToMain) &&
        (task !== "vision" || this.visionFallbackToMain || primary === void 0);
      if (
        allowMainFallback &&
        mainRoute !== void 0 &&
        !(primary !== void 0 && primary.provider === mainRoute.provider && primary.model === mainRoute.model)
      ) {
        candidates.push(mainRoute);
      }
      if (candidates.length === 0) {
        // No route at all (no configured primary and no main model). Log the
        // failure explicitly so the no-route case is observable in the status
        // projection even though it never reaches the attempt loop.
        await recordAuxEvent(this, request.session, {
          task,
          provider: "",
          model: "",
          ok: false,
          durationMs: Date.now() - startedAt,
          errorCode: "no-route",
          fallbackUsed: false,
          purpose: request.purpose
        });
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
          await recordAuxEvent(this, request.session, {
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
          if (!shouldFallback(kind)) break;
          // `content` failures are request-specific (e.g. unsupported image
          // input), not route-health problems; don't poison the shared cooldown
          // for other tasks using the same provider+model.
          if (kind !== "content") {
            const entered = this._cooldown.recordFailure(candidate.provider, candidate.model);
            if (entered) attempts[attempts.length - 1].enteredCooldown = true;
          }
        }
      }
      await recordAuxEvent(this, request.session, {
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
    if (semaphore === void 0) {
      semaphore = new AsyncSemaphore(limit);
      this._semaphores.set(task, semaphore);
    } else if (semaphore.limit !== limit) {
      // Update in place so in-flight calls keep counting against the same
      // semaphore; replacing it would transiently exceed the configured cap.
      semaphore.limit = limit;
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
        message.content?.some((block) => block.type === "image") ?? false
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
    // Custom tasks registered via registerTask/registerAuxTask also appear in
    // the status view (label defaults to the task key).
    for (const [key, definition] of this._customTasks) {
      const customDef = { task: key, ...definition };
      const primary = resolvePrimaryRoute(customDef, this.taskDefaults);
      out.push({
        task: key,
        label: definition.label ?? key,
        configured: definition?.provider !== void 0,
        primary: primary ?? null,
        timeoutMs: taskTimeoutMs(customDef),
        maxConcurrency: taskConcurrency(customDef)
      });
    }
    return out;
  }

  /**
   * Resolve one native `subagent` call onto an AUX route. Called by the
   * dsh-tool-subagent bridge patch (see bridge/). Returns
   * `{ settled:false }` (run native) when subagent bridging is off or the
   * mode's route is unconfigured.
   * @param payload { prompt?, requiresVision?, existingAllow?, existingDeny? }
   */
  subagentRoute(payload) {
    return resolveSubagentRoute(this._subagentSettings, payload ?? {});
  }

  /**
   * Prepare messages for a compaction-style AUX call. Kept as a service
   * method because the compaction bridge duck-types on it; the implementation
   * lives in `compaction-messages.js`.
   */
  async _prepareCompactionMessages(messages, agent, signal) {
    return prepareCompactionMessages(this, messages, agent, signal);
  }
}

/**
 * Register a custom auxiliary task (extension point for other plugins).
 * @param definition { key, label, defaultModel?, fallbackToMain?, timeoutMs?, maxConcurrency? }
 */
export function registerAuxTask(ctx, definition) {
  const service = ctx.get("auxLlm");
  if (service === void 0) throw new Error("registerAuxTask: auxLlm service is not mounted");
  service.registerTask(definition);
}

export default AuxLlmService;
