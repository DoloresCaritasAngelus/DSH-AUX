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
import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Message, ToolSchema } from '@deepseek-ai/dsh-llm';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';

/** The built-in auxiliary task keys. */
export type AuxTaskKey = 'vision' | 'web_extract' | 'compress' | 'compaction';

/** A resolved provider/model route. */
export interface AuxRoute {
    provider: string;
    model: string;
}

/** One recorded auxiliary call (the `aux/llm-call` event payload). */
export interface AuxCallRecord {
    task: string;
    provider: string;
    model: string;
    ok: boolean;
    durationMs: number;
    errorCode?: string;
    fallbackUsed?: boolean;
    inputChars?: number;
    outputChars?: number;
    purpose?: string;
    enteredCooldown?: boolean;
}

/** Wire value of the `aux-status` projection. */
export interface AuxStatusProjection {
    tasks: Record<string, AuxCallRecord>;
}

/** Per-task config entry (all fields optional; absent = inherit). */
export interface AuxTaskConfigEntry {
    provider?: string;
    model?: string;
    timeoutMs?: number;
    maxConcurrency?: number;
    /** web_extract page-text cap (code points); positive integer. */
    maxChars?: number;
}

/** Plugin config: optional per-task overrides. */
export interface AuxConfig {
    tasks?: Partial<Record<AuxTaskKey, AuxTaskConfigEntry>>;
    /** User-supplied main-agent guide section (trusted plugin config). */
    guideText?: string;
    /** Opt-in to fetching loopback/private URLs (SSRF guard, default false). */
    allowInternalUrls?: boolean;
}

/** One auxiliary LLM request. */
export interface AuxLlmRequest {
    /** Ordered provider-facing messages (may include image blocks). */
    messages: Message[];
    /** System prompt text. */
    system?: string;
    /** Tool schemas forwarded to the LLM call (used by the compaction bridge). */
    tools?: readonly ToolSchema[];
    temperature?: number;
    maxTokens?: number;
    /** Cancellation fused into the per-task deadline. */
    signal?: AbortSignal;
    /** The owning session; aux calls are logged here when present. */
    session?: Session;
    /** The owning agent, for main-model route resolution. */
    agent?: Agent;
    /** Input size in chars, recorded with the event. */
    inputChars?: number;
    /** Semantic tag recorded with the event. */
    purpose?: string;
}

/** One auxiliary call outcome. */
export interface AuxLlmResult {
    text: string;
    provider: string;
    model: string;
}

/** A custom auxiliary task definition (extension point). */
export interface AuxTaskDefinition {
    key: string;
    label?: string;
    provider?: string;
    model?: string;
    timeoutMs?: number;
    maxConcurrency?: number;
}

/** Per-task routing status snapshot for UIs. */
export interface AuxTaskStatus {
    task: string;
    label: string;
    configured: boolean;
    primary: AuxRoute | null;
    timeoutMs: number;
    maxConcurrency: number;
}

declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * One auxiliary LLM call, logged after it settles (success or
         * exhaustion). Log-only; the `aux-status` projection folds the latest
         * record per task.
         */
        'aux/llm-call': AuxCallRecord;
    }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /**
         * Latest auxiliary call record per task. Capability absence (plugin not
         * composed) is the key's absence, never a value.
         */
        'aux-status': AuxStatusProjection;
    }
}

declare module '@deepseek-ai/cordis' {
    interface Context {
        auxLlm: AuxLlmService;
    }
}

/** Settings namespace carrying the aux configuration section. */
export declare const AUX_SETTINGS_NAMESPACE: SettingsNamespace;
/** Timeout code stamped onto aux deadline timeouts. */
export declare const AUX_TIMEOUT_CODE: 'AUX_TIMEOUT';
/** Session event type recording one auxiliary call. */
export declare const AUX_CALL_EVENT: 'aux/llm-call';
/** Projection key exposing the latest per-task aux call snapshot. */
export declare const AUX_STATUS_KEY: 'aux-status';

/**
 * One auxiliary call outcome.
 */
export declare class AuxCallError extends Error {
    constructor(task: string, attempts: Array<{ provider: string; model: string; kind: string; error?: Error }>);
    task: string;
    attempts: Array<{ provider: string; model: string; kind: string; error?: Error }>;
}

/**
 * Candidate URLs for the patched dsh-session bundle.
 */
export declare function sessionPatchCandidates(baseUrl: string | URL): URL[];

/**
 * `ctx.auxLlm`: the unified auxiliary-model router. Owns task definitions,
 * per-task semaphores, the failure cooldown table, and the settings section;
 * every call is logged as an `aux/llm-call` session event and reflected in
 * the `aux-status` projection.
 */
export declare class AuxLlmService extends Service {
    static inject: readonly ['llm', 'tools', 'settings', 'web', 'fs', 'systemPrompt'];
    static Config: unknown;
    /** Default auxiliary routes per task (explicit-config-independent). */
    readonly taskDefaults: Record<string, AuxRoute>;
    /** Live fallback switch from the settings section. */
    fallbackToMain: boolean;
    /** Whether the composer status chip is enabled (settings section). */
    showStatusChip: boolean;
    /** Whether loopback/private URL fetches are allowed (SSRF guard). */
    allowInternalUrls: boolean;
    constructor(ctx: Context, config?: AuxConfig);
    /**
     * Run one auxiliary LLM call. Route resolution per task: explicit config,
     * then task default, then the session's main model as automatic fallback
     * (configurable). Failures are classified; retryable classes fall back to
     * the main model once; a route in cooldown is skipped.
     */
    call(task: string, request: AuxLlmRequest): Promise<AuxLlmResult>;
    /**
     * Register a custom auxiliary task (extension point for other plugins).
     */
    registerTask(definition: AuxTaskDefinition): void;
    /** Current per-task routing status (for /aux status and UIs). */
    describe(): AuxTaskStatus[];
}

/**
 * Register a custom auxiliary task on a mounted `ctx.auxLlm`.
 */
export declare function registerAuxTask(ctx: Context, definition: AuxTaskDefinition): void;

/**
 * Reject a resolved aux settings section whose task entries pair provider
 * without model (or vice versa). Registered as the settings namespace's
 * validator so a half-configured task is refused where it is entered.
 */
export declare function validateAuxSettings(value: unknown): void;

export default AuxLlmService;
