/**
 * dsh-aux routing core: task configuration, route resolution, error
 * classification, and per-route failure cooldown. All pure logic.
 *
 * @module @dolorescaritasangelus/dsh-aux/route
 */
import type { AuxRoute, AuxTaskConfigEntry } from './index.js';

/** Built-in auxiliary task keys. */
export declare const AUX_TASKS: readonly ['vision', 'web_extract', 'web_crawl', 'compress', 'compaction'];
/** Default per-task timeout (ms). */
export declare const DEFAULT_TASK_TIMEOUT_MS: number;
/** Default per-task concurrency cap. */
export declare const DEFAULT_TASK_CONCURRENCY: number;
/** Hard upper bound for any per-task concurrency cap. */
export declare const MAX_TASK_CONCURRENCY: number;
/** Default page-text cap (code points) for web_extract. */
export declare const DEFAULT_MAX_CHARS: number; // default page-text code-point cap (web_extract/web_crawl)
/** Failures in a row that put a route into cooldown. */
export declare const COOLDOWN_FAILURE_THRESHOLD: number;
/** Cooldown TTL after the threshold is reached (ms). */
export declare const COOLDOWN_TTL_MS: number;

/** Build a provider/model route. */
export declare function route(provider: string, model: string): AuxRoute;

/** Validate the plugin config shape; unknown keys fail at load. */
export declare function resolveConfig(config: unknown): { tasks: Record<string, AuxTaskConfigEntry>; guideText?: string; allowInternalUrls?: boolean };

/** Merge a settings section over plugin config (settings wins). */
export declare function mergeTaskConfig(pluginEntry: AuxTaskConfigEntry, settingsEntry: AuxTaskConfigEntry): AuxTaskConfigEntry;

/** Effective timeout for a task: config value, else default. */
export declare function taskTimeoutMs(merged: AuxTaskConfigEntry): number;

/** Effective concurrency cap for a task: config value, else default. */
export declare function taskConcurrency(merged: AuxTaskConfigEntry): number;

/** Effective page-text cap for web_extract: config value, else default. */
export declare function taskMaxChars(merged: AuxTaskConfigEntry): number;

/**
 * Resolve the primary route for a task: explicit config, then task default,
 * then undefined (caller falls back to the main model).
 */
export declare function resolvePrimaryRoute(merged: AuxTaskConfigEntry & { task?: string }, defaults: Record<string, AuxRoute>): AuxRoute | undefined;

/** Failure classification codes. */
export type AuxFailureKind =
    | 'aborted' | 'timeout' | 'rate-limit' | 'auth' | 'payment'
    | 'model-not-found' | 'connection' | 'content' | 'other';

/** Classify an auxiliary call failure. */
export declare function classifyFailure(error: unknown, signal?: AbortSignal): AuxFailureKind;

/** Whether a failure class merits an automatic main-model fallback. */
export declare function shouldFallback(kind: AuxFailureKind): boolean;

/** Per-route failure cooldown (failure streak -> TTL skip). */
export declare class FailureCooldown {
    constructor(options?: { threshold?: number; ttlMs?: number });
    recordFailure(provider: string, model: string, now?: number): boolean;
    recordSuccess(provider: string, model: string): void;
    isCoolingDown(provider: string, model: string, now?: number): boolean;
    snapshot(now?: number): Record<string, { provider: string; model: string; failures: number; coolingDown: boolean; until: number }>;
}

/** An async FIFO semaphore. */
export declare class AsyncSemaphore {
    constructor(limit: number);
    readonly limit: number;
    acquire(): Promise<() => void>;
    release(): void;
}
