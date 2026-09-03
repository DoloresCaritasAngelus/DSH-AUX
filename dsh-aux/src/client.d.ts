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
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client';

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

/** One patch-ledger entry shown by the diagnostics panel. */
export interface AuxPatchLedgerEntry {
    id: string;
    group: string;
    pkg: string;
    description: string;
    state: 'installed' | 'missing' | 'not-applicable' | 'unknown';
    installed: boolean;
    required: boolean;
    present: boolean;
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
    patchLedger?: AuxPatchLedgerEntry[];
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

/** One image-library memory record shown in the UI. */
export interface ImageLibraryMemory {
    sessionId: string;
    question: string;
    summary: string;
    at: number;
}

/** One image-library entry shown by the gallery panel. */
export interface ImageLibraryEntry {
    kind: string;
    attachmentId: string;
    hash: string;
    mediaType?: string;
    bytes?: number;
    mtimeMs?: number;
    /**
     * Optional display/preview dimensions. Not currently emitted by the host;
     * kept as an opt-in extension point so future server-side metadata can
     * surface without changing the UI contract.
     */
    width?: number;
    height?: number;
    ownerSessions: string[];
    ownerLiveSessions: string[];
    ownerArchivedSessions?: string[];
    referenceCount: number;
    shared: boolean;
    orphan: boolean;
    archived?: boolean;
    retained: boolean;
    memories: ImageLibraryMemory[];
    firstSeenAt?: number;
    lastSeenAt?: number;
    readableBySessionId?: string;
    fileName?: string;
}

/** Snapshot returned by `/aux images --json` / `aux-image-library` projection. */
export interface ImageLibrarySnapshot {
    generatedAt: number;
    settings: {
        imageRetentionDays: number;
        imageAutoCleanEnabled: boolean;
    };
    counts: {
        total: number;
        orphan: number;
        archived: number;
        shared: number;
        retained: number;
        withMemory: number;
    };
    entries: ImageLibraryEntry[];
}

/** One located anchor returned by `/aux image locate <id> --json`. */
export interface ImageLibraryAnchor {
    sessionId: string;
    messageSeq: number | null;
    callId: string | null;
    callSeq: number | null;
}

/** Wire result of `/aux image locate <id> --json`. */
export interface AuxImageLocateResult {
    attachmentId: string;
    found: boolean;
    anchors: ImageLibraryAnchor[];
}

/**
 * Session services actually consumed by the image library components
 * (projection reads, attachment reads, session titles, and precise open/load).
 */
export interface AuxImageLibrarySessions {
    open(sessionId: string): void;
    binding(sessionId: string): {
        session?: {
            projections?: {
                faceOf(key: string): {
                    getSnapshot(): unknown;
                };
            };
            readAttachment(attachmentId: string): Promise<{
                ok: boolean;
                value?: {
                    data: Uint8Array;
                    attachment?: { mediaType?: string };
                };
            }>;
            loadThrough(seq: number): Promise<void>;
        };
    } | undefined;
    list: {
        getSnapshot(): {
            ids: string[];
            byId: Record<string, {
                id?: string;
                sessionId?: string;
                displayTitle?: string;
                title?: string;
            }>;
        };
    };
}

/** Props supplied to the sidebar footer image-library action. */
export interface AuxImageLibraryButtonProps {
    wide: boolean;
    sessions: AuxImageLibrarySessions;
    runAuxCommand: (line: string) => Promise<{
        kind: 'success' | 'error';
        text?: string;
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

/** Provider group in the `remote.session.modelCatalog()` result. */
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

/** Minimal session list API surface used by the settings page and command runner. */
export interface AuxSessionsApi {
    list(request: {}): Promise<{
        ok: true;
        value: { items: { sessionId: string }[] };
    } | {
        ok: false;
        error: { message: string };
    }>;
}

/** Standard slot props supplied by the settings.section shell. */
export interface AuxSettingsPageProps {
    /** Alpha.3-compatible settings/llm/session wire face. */
    api: {
        sessions: AuxSessionsApi;
        settings: {
            describe(): Promise<{
                ok: true;
                value: { writable: boolean; namespaces: SettingsNamespaceView[] };
            } | {
                ok: false;
                error: { message: string };
            }>;
            mutate(request: {
                ns: string;
                ops: SettingsPathOpView[];
                expectedRevision: number;
            }): Promise<{
                ok: true;
                value: { revision: number; value: unknown };
            } | {
                ok: false;
                error: { message: string };
            }>;
        };
        llm: {
            providers(): Promise<{
                ok: true;
                value: { providers: { provider: string; displayName: string; active: boolean }[] };
            } | {
                ok: false;
                error: { message: string };
            }>;
            models(): Promise<{
                ok: true;
                value: { groups: AuxModelGroup[] };
            } | {
                ok: false;
                error: { message: string };
            }>;
        };
    };
    /** Alpha.3 client sessions service, used to read `aux-platform` projections. */
    sessions?: {
        binding(sessionId: string): {
            session?: {
                projections?: {
                    faceOf(key: string): {
                        getSnapshot(): unknown;
                    };
                };
            };
        } | undefined;
        list: {
            getSnapshot(): {
                ids: string[];
                byId: Record<string, { id?: string; sessionId?: string }>;
            };
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
    sessions?: {
        binding(sessionId: string): {
            session?: {
                eventSource?: {
                    getSnapshot(): {
                        entries: AuxCallHistoryEvent[];
                    };
                };
            };
        } | undefined;
    };
}

/** The client plugin entry: registered slot contributions. */
export declare function apply(ctx: unknown): void;
/** Required client services. */
export declare const inject: readonly [
    'slots',
    'connection',
    'remote',
    'remote.commands',
    'remote.settings',
    'remote.llm',
    'remote.session',
    'sessions'
];
