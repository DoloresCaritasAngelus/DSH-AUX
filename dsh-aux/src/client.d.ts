/**
 * Browser half of dsh-aux: the auxiliary-model settings page (settings.section
 * "aux") plus a composer status chip over the `aux-status` projection.
 * Bundle-format module consumed by the web client module loader.
 *
 * @module @dolorescaritasangelus/dsh-aux/client
 */
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-client-connection/client';

/** Standard slot props supplied by the settings.section shell. */
export interface AuxSettingsPageProps {
    /** Settings wire face (settings.describe / settings.mutate). */
    api: {
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
                result: { ok: true; value: { groups: { id: string; name: string; models: { id: string; name?: string }[] }[] } } | { ok: false; error: { message: string } };
            }>;
        };
    };
    /** Close the settings panel (shell-owned). */
    close: () => void;
}

/** Standard slot props supplied by the conversation.input.left seat. */
export interface AuxStatusChipProps {
    /** The owning session id (standard seat prop). */
    sessionId: string;
    /** Projection hook provided by the seat owner. */
    useProjection: (key: 'aux-status') => { tasks: Record<string, {
        task: string;
        provider: string;
        model: string;
        ok: boolean;
        durationMs: number;
        fallbackUsed?: boolean;
    }> } | undefined;
}

/** The client plugin entry: registered slot contributions. */
export declare function apply(ctx: unknown): void;
/** Required client services. */
export declare const inject: readonly ['slots', 'connection'];
