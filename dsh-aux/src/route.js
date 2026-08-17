/**
 * dsh-aux routing core: task configuration, route resolution, error
 * classification, and per-route failure cooldown. All pure logic — no DSH
 * service access — so every branch is testable offline.
 *
 * @module @dolorescaritasangelus/dsh-aux/route
 */

/** Built-in auxiliary task keys. */
export const AUX_TASKS = Object.freeze(["vision", "web_extract", "compress", "compaction"]);

/** Default per-task timeout (ms). */
export const DEFAULT_TASK_TIMEOUT_MS = 60_000;
/** Default per-task concurrency cap. */
export const DEFAULT_TASK_CONCURRENCY = 2;
/** Hard upper bound for any per-task concurrency cap. */
export const MAX_TASK_CONCURRENCY = 10;
/** Default input size cap (code points) for web_extract page text. */
export const DEFAULT_MAX_CHARS = 8000;
/** Failures in a row that put a route into cooldown. */
export const COOLDOWN_FAILURE_THRESHOLD = 3;
/** Cooldown TTL after the threshold is reached (ms). */
export const COOLDOWN_TTL_MS = 60_000;

/** A resolved provider/model route. */
export function route(provider, model) {
  return { provider, model };
}

/**
 * Validate the plugin config shape. Unknown keys fail at load rather than
 * being ignored. Supported shape:
 *
 *   { tasks: { vision?, webExtract?, compress?, compaction? }, allowInternalUrls? }
 *
 * Each task entry: { provider?, model?, timeoutMs?, maxConcurrency? }.
 * `allowInternalUrls` is an explicit opt-in for fetching loopback/private URLs
 * (SSRF guard); it defaults to false.
 * @param config raw plugin config (may be undefined).
 * @returns a detached, validated config.
 */
export function resolveConfig(config) {
  const source = config ?? {};
  const unknown = Object.keys(source).filter((key) => key !== "tasks" && key !== "guideText" && key !== "allowInternalUrls");
  if (unknown.length > 0) {
    throw new Error(`AuxConfig has unknown key(s) ${unknown.join(", ")} — config is { tasks?, guideText?, allowInternalUrls? }`);
  }
  const tasks = {};
  for (const task of AUX_TASKS) {
    const raw = source.tasks?.[task] ?? {};
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`AuxConfig tasks.${task} must be an object`);
    }
    const entry = {};
    const allowedKeys = ["provider", "model", "timeoutMs", "maxConcurrency"];
    // maxChars (deployment-level page-text cap) is meaningful for web_extract;
    // kept task-scoped so a stray vision.maxChars is refused rather than
    // silently ignored.
    if (task === "web_extract") allowedKeys.push("maxChars");
    const unknownKeys = Object.keys(raw).filter((key) => !allowedKeys.includes(key));
    if (unknownKeys.length > 0) {
      throw new Error(`AuxConfig tasks.${task} has unknown key(s) ${unknownKeys.join(", ")}`);
    }
    if (raw.provider !== void 0) {
      if (typeof raw.provider !== "string" || raw.provider.length === 0) {
        throw new Error(`AuxConfig tasks.${task}.provider must be a non-empty string`);
      }
      entry.provider = raw.provider;
    }
    if (raw.model !== void 0) {
      if (typeof raw.model !== "string" || raw.model.length === 0) {
        throw new Error(`AuxConfig tasks.${task}.model must be a non-empty string`);
      }
      entry.model = raw.model;
    }
    if (entry.provider !== void 0 && entry.model === void 0) {
      throw new Error(`AuxConfig tasks.${task}: provider and model must be supplied together`);
    }
    if (raw.timeoutMs !== void 0) {
      if (!Number.isInteger(raw.timeoutMs) || raw.timeoutMs <= 0) {
        throw new Error(`AuxConfig tasks.${task}.timeoutMs must be a positive integer`);
      }
      entry.timeoutMs = raw.timeoutMs;
    }
    if (raw.maxConcurrency !== void 0) {
      if (!Number.isInteger(raw.maxConcurrency) || raw.maxConcurrency <= 0) {
        throw new Error(`AuxConfig tasks.${task}.maxConcurrency must be a positive integer`);
      }
      entry.maxConcurrency = raw.maxConcurrency;
    }
    if (raw.maxChars !== void 0) {
      if (!Number.isInteger(raw.maxChars) || raw.maxChars <= 0) {
        throw new Error(`AuxConfig tasks.${task}.maxChars must be a positive integer`);
      }
      entry.maxChars = raw.maxChars;
    }
    tasks[task] = entry;
  }
  if (source.guideText !== void 0 && typeof source.guideText !== "string") {
    throw new Error("AuxConfig guideText must be a string (empty string disables the main-agent guide section)");
  }
  if (source.allowInternalUrls !== void 0 && typeof source.allowInternalUrls !== "boolean") {
    throw new Error("AuxConfig allowInternalUrls must be a boolean");
  }
  return {
    tasks,
    ...(source.guideText === void 0 ? {} : { guideText: source.guideText }),
    ...(source.allowInternalUrls === void 0 ? {} : { allowInternalUrls: source.allowInternalUrls })
  };
}

/** Merge a settings section over plugin config (settings wins). */
export function mergeTaskConfig(pluginEntry, settingsEntry) {
  return {
    provider: settingsEntry.provider ?? pluginEntry.provider,
    model: settingsEntry.model ?? pluginEntry.model,
    timeoutMs: settingsEntry.timeoutMs ?? pluginEntry.timeoutMs,
    maxConcurrency: settingsEntry.maxConcurrency ?? pluginEntry.maxConcurrency,
    maxChars: settingsEntry.maxChars ?? pluginEntry.maxChars
  };
}

/** Effective timeout for a task: config value, else default. */
export function taskTimeoutMs(merged) {
  return merged.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
}

/** Effective concurrency cap for a task: config value (hard-capped), else default. */
export function taskConcurrency(merged) {
  return Math.min(merged.maxConcurrency ?? DEFAULT_TASK_CONCURRENCY, MAX_TASK_CONCURRENCY);
}

/** Effective page-text cap for web_extract: config value, else default. */
export function taskMaxChars(merged) {
  return merged.maxChars ?? DEFAULT_MAX_CHARS;
}

/**
 * Resolve the primary route for a task:
 *   1. explicit provider+model from merged config
 *   2. the task's default auxiliary route (from the defaults map)
 *   3. undefined (caller falls back to the main model)
 * @param merged merged task config.
 * @param defaults map of task key -> route() of a default auxiliary model.
 * @returns the route, or undefined when nothing is configured.
 */
export function resolvePrimaryRoute(merged, defaults) {
  if (merged.provider !== void 0 && merged.model !== void 0) {
    return route(merged.provider, merged.model);
  }
  const fallback = defaults[merged.task ?? ""] ?? defaults._any;
  return fallback ?? void 0;
}

/**
 * Classify an auxiliary call failure. Returns a stable machine code:
 *   - "aborted"     — the caller cancelled (never retry/fallback)
 *   - "timeout"     — deadline exceeded
 *   - "rate-limit"  — 429 or provider throttle
 *   - "auth"        — 401/403 or invalid key
 *   - "payment"     — 402 / credit exhaustion
 *   - "model-not-found" — 404-ish unknown model
 *   - "connection"  — transport/network failure
 *   - "content"     — provider refused the request (unsupported content/params)
 *   - "other"       — anything else
 * @param error the thrown error or LlmFailure-shaped object.
 * @param signal the call's abort signal (aborted calls classify first).
 * @returns the classification code.
 */
export function classifyFailure(error, signal) {
  if (signal?.aborted) return "aborted";
  const failure = error?.failure ?? error;
  const code = typeof failure?.code === "string" ? failure.code : "";
  const status = typeof failure?.status === "number" ? failure.status : void 0;
  const message = typeof failure?.message === "string" ? failure.message : String(error?.message ?? error ?? "");
  const lower = message.toLowerCase();
  if (code === "ABORTED" || code === "aborted") return "aborted";
  if (code.includes("TIMEOUT") || /timeout|timed out|deadline/i.test(lower)) return "timeout";
  if (status === 429 || /rate.?limit|throttl|too many requests/i.test(lower)) return "rate-limit";
  if (status === 402 || /402|credit|balance|insufficient.?funds|payment/i.test(lower)) return "payment";
  if (status === 401 || status === 403 || /unauthori[sz]ed|invalid api key|forbidden|auth/i.test(lower)) return "auth";
  if (status === 404 || /model.*not.?found|unknown model|no such model/i.test(lower)) return "model-not-found";
  if (/fetch failed|econnrefused|econnreset|enetunreach|dns|socket|network|tls|certificate/i.test(lower)) return "connection";
  if (code === "UNSUPPORTED_CONTENT" || /unsupported|does not support|cannot represent/i.test(lower)) return "content";
  return "other";
}

/** Whether a failure class merits an automatic main-model fallback. */
export function shouldFallback(kind) {
  return kind !== "aborted";
}

/**
 * Per-route failure cooldown. A route that fails `threshold` times in a row
 * (with no success in between) enters cooldown for `ttlMs`; during cooldown
 * `isCoolingDown` reports true so the caller skips the route entirely.
 */
export class FailureCooldown {
  constructor(options = {}) {
    this.threshold = options.threshold ?? COOLDOWN_FAILURE_THRESHOLD;
    this.ttlMs = options.ttlMs ?? COOLDOWN_TTL_MS;
    /** route key -> { failures, until } */
    this.state = new Map();
  }

  /** Stable route key for cooldown accounting. */
  static key(provider, model) {
    return provider + "\u0000" + model;
  }

  /**
   * Record one failure and apply cooldown when the threshold is reached.
   * @returns true when this failure pushed the route into cooldown.
   */
  recordFailure(provider, model, now = Date.now()) {
    const key = FailureCooldown.key(provider, model);
    const entry = this.state.get(key) ?? { failures: 0, until: 0 };
    entry.failures += 1;
    let entered = false;
    if (entry.failures >= this.threshold) {
      entry.until = now + this.ttlMs;
      entry.failures = 0;
      entered = true;
    }
    this.state.set(key, entry);
    return entered;
  }

  /** Record one success: the streak resets. */
  recordSuccess(provider, model) {
    this.state.delete(FailureCooldown.key(provider, model));
  }

  /** Whether the route is currently cooling down. */
  isCoolingDown(provider, model, now = Date.now()) {
    const entry = this.state.get(FailureCooldown.key(provider, model));
    if (entry === void 0) return false;
    if (now >= entry.until) {
      this.state.delete(FailureCooldown.key(provider, model));
      return false;
    }
    return true;
  }

  /** Detached snapshot for status displays. */
  snapshot(now = Date.now()) {
    const out = {};
    for (const [key, entry] of this.state) {
      const [provider, model] = key.split("\u0000");
      out[key] = {
        provider,
        model,
        failures: entry.failures,
        coolingDown: now < entry.until,
        until: entry.until
      };
    }
    return out;
  }
}

/**
 * An async semaphore for per-task concurrency caps. FIFO fair.
 */
export class AsyncSemaphore {
  constructor(limit) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("semaphore limit must be a positive integer");
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    }).then(() => {
      this.active += 1;
      return () => this.release();
    });
  }

  release() {
    this.active -= 1;
    const next = this.queue.shift();
    if (next !== void 0) next();
  }
}
