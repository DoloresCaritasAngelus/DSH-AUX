/**
 * Browser half of dsh-aux: the auxiliary-model settings page (settings.section
 * "aux") plus a composer status chip. The chip reads the `aux-status`
 * projection for presence and falls back to it, but prefers the most recent
 * `aux/llm-call` event from session history so the displayed call is the true
 * latest by event order/time.
 * Bundle-format module consumed by the web client module loader.
 *
 * @module @dolorescaritasangelus/dsh-aux/client
 */
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-client-connection/client';

/** Privacy-minimized wire entry of the `aux-status` projection. */
export interface AuxStatusCallWire {
    task: string;
    ok: boolean;
    fallbackUsed?: boolean;
    durationMs: number;
}

/** Wire value of the `aux-status` projection (per-task snapshot, not chronological). */
export interface AuxStatusProjectionWire {
    tasks: Record<string, AuxStatusCallWire>;
}

/** One `aux/llm-call` event read from session history for chronological chip selection. */
export interface AuxCallHistoryEvent {
    event: {
        type: 'aux/llm-call';
        seq: number;
        time: number;
        data: AuxStatusCallWire;
    };
}

/** Wire value of the `aux-platform` projection used by the diagnostics panel. */
export interface AuxPlatformProjection {
    generatedAt?: number;
    restartRequired?: boolean;
    core?: {
        count: number;
        protected?: string[];
    };
    eventsSupported?: boolean;
    items: Array<{
        key: string;
        kind?: 'tool' | 'bridge';
        mode?: string;
        state: 'enabled' | 'disabled' | 'unavailable' | 'unknown' | 'fixing';
        reason: string;
        action?: 'none' | 'patch' | 'configure';
        patch?: string;
        detail?: string;
    }>;
    warnings?: Array<{
        code: string;
        reason: string;
    }>;
    issues?: Array<{
        key: string;
        reason: string;
        action: 'none' | 'patch' | 'configure';
    }>;
}

/** One reasoning-effort entry advertised for an exact model route. */
export interface AuxModelReasoningEffort {
    id: string;
    name: string;
    description?: string;
}

/** Selectable reasoning metadata for a model route. */
export interface AuxModelReasoning {
    efforts?: AuxModelReasoningEffort[];
    defaultEffort?: string;
}

/** Provider group in the `llm.models` catalog. */
export interface AuxModelGroup {
    id: string;
    name?: string;
    /** Legacy alias accepted by the client when `id` is absent. */
    provider?: string;
    reasoning?: AuxModelReasoning;
    models: Array<{
        id: string;
        name?: string;
        description?: string;
        reasoning?: AuxModelReasoning;
    }>;
}

/** Value returned by a successful `sessions.history` call. */
export interface AuxSessionHistoryValue {
    events: Array<{
        event: {
            type: string;
            seq: number;
            time: number;
            data: unknown;
        };
        view?: unknown;
    }>;
    hasMore: boolean;
    projections?: {
        asOfSeq?: number;
        values?: {
            'aux-status'?: AuxStatusProjectionWire;
            'aux-platform'?: AuxPlatformProjection;
            [key: string]: unknown;
        };
    };
}

/** Minimal sessions API surface used by the settings page and status chip. */
export interface AuxSessionsApi {
    list(request: {}): Promise<{
        result: { ok: true; value: { items: { sessionId: string }[] } } | { ok: false; error: { message: string } };
    }>;
    history(request: { sessionId: string; beforeSeq?: number; maxMessages?: number }): Promise<{
        result: { ok: true; value: AuxSessionHistoryValue } | { ok: false; error: { message: string } };
    }>;
}

/** Standard slot props supplied by the settings.section shell. */
export interface AuxSettingsPageProps {
    /** Settings wire face (settings.describe / settings.mutate / sessions read). */
    api: {
        sessions: AuxSessionsApi;
        settings: {
            describe(request: {}): Promise<{
                result: { ok: true; value: { writable: boolean; namespaces: SettingsNamespaceView[] } } | { ok: false; error: { message: string } };
            }>;
            mutate(request: {
                ns: string;
                ops: SettingsPathOpView[];
                expectedRevision: number;
            }): Promise<{
                result: { ok: true; value: { revision: number; value: unknown } } | { ok: false; error: { message: string } };
            }>;
        };
        llm: {
            providers(request: {}): Promise<{
                result: { ok: true; value: { providers: { provider: string; displayName: string; active: boolean }[] } } | { ok: false; error: { message: string } };
            }>;
            models(request: {}): Promise<{
                result: { ok: true; value: { groups: AuxModelGroup[] } } | { ok: false; error: { message: string } };
            }>;
        };
    };
    /** Run one `/aux` command on the first available session and return its command result. */
    runAuxCommand: (line: string) => Promise<{
        kind: 'success' | 'error';
        text?: string;
    }>;
    /** Close the settings panel (shell-owned). */
    close: () => void;
}

/** Standard slot props supplied by the conversation.input.left seat. */
export interface AuxStatusChipProps {
    /** The owning session id (standard seat prop). */
    sessionId: string;
    /** Projection hook provided by the seat owner. */
    useProjection: (key: 'aux-status') => AuxStatusProjectionWire | undefined;
    /**
     * Injected by dsh-aux. Used to read `aux/llm-call` events so the chip can
     * show the true latest call by event order/time rather than relying on the
     * per-task `aux-status` record's insertion order.
     */
    api?: {
        sessions: AuxSessionsApi;
    };
}

/** The client plugin entry: registered slot contributions. */
export declare function apply(ctx: unknown): void;
/** Required client services. */
export declare const inject: readonly ['slots', 'connection', 'remote', 'remote.commands'];
