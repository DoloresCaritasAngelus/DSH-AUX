/**
 * dsh-aux `aux-status` session projection.
 *
 * @module @dolorescaritasangelus/dsh-aux/projection
 */
import { z as zodz } from "zod";
import { AUX_CALL_EVENT, AUX_PLATFORM_EVENT, AUX_PLATFORM_KEY, AUX_STATUS_KEY } from "./config.js";

const AUX_STATUS_SCHEMA = zodz.object({
  tasks: zodz.record(zodz.object({
    task: zodz.string(),
    ok: zodz.boolean(),
    fallbackUsed: zodz.boolean(),
    durationMs: zodz.number()
  }))
});

function applyAuxStatus(state, event) {
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
}

/**
 * Build the `aux-status` projection definition for the installed
 * session-projection API. DSH 0.1.1-rc.1 replaced `schema`/`view` with
 * `stateSchema`/`wire`; the old rc.6/7/8 API is still supported by feature
 * detection (`stateOf` exists only in the new registry).
 */
function createAuxStatusProjectionDefinition(registry) {
  const base = {
    key: AUX_STATUS_KEY,
    init: () => ({ tasks: {} }),
    apply: applyAuxStatus,
    stateVersion: 1
  };
  const isNewProjectionApi = typeof registry?.stateOf === "function";
  if (isNewProjectionApi) {
    return {
      ...base,
      stateSchema: AUX_STATUS_SCHEMA,
      wire: { viewSchema: AUX_STATUS_SCHEMA, view: (state) => state }
    };
  }
  return {
    ...base,
    schema: AUX_STATUS_SCHEMA,
    view: (state) => state
  };
}

const AUX_PLATFORM_SCHEMA = zodz.record(zodz.unknown());

function applyAuxPlatform(state, event) {
  if (event.type === AUX_PLATFORM_EVENT) {
    return event.data ?? {};
  }
  return state;
}

/**
 * Build the `aux-platform` projection definition. It carries the latest full
 * platform-status snapshot for the settings UI; the host publishes hidden
 * `aux/platform-status` events on status changes so the settings page can
 * read the projection without executing a slash command.
 */
function createAuxPlatformProjectionDefinition(registry) {
  const base = {
    key: AUX_PLATFORM_KEY,
    init: () => ({}),
    apply: applyAuxPlatform,
    stateVersion: 1
  };
  const isNewProjectionApi = typeof registry?.stateOf === "function";
  if (isNewProjectionApi) {
    return {
      ...base,
      stateSchema: AUX_PLATFORM_SCHEMA,
      wire: { viewSchema: AUX_PLATFORM_SCHEMA, view: (state) => state }
    };
  }
  return {
    ...base,
    schema: AUX_PLATFORM_SCHEMA,
    view: (state) => state
  };
}

/**
 * Register or unregister the `aux-platform` projection. It is always exposed
 * while the plugin is mounted (the settings page needs it); unlike
 * `aux-status`, it is not gated by `showStatusChip`.
 */
export function syncAuxPlatformProjection(service) {
  if (service._projectionCtx === void 0) return;
  if (service._auxPlatformProjectionDispose === void 0) {
    service._auxPlatformProjectionDispose = service._projectionCtx.sessionProjections.register(
      createAuxPlatformProjectionDefinition(service._projectionCtx.sessionProjections)
    );
  }
}

/**
 * Register or unregister the `aux-status` projection according to the
 * `showStatusChip` setting. The projection is the Web-visible surface for
 * the composer chip; when the user disables the chip, we stop exposing it
 * to third-party plugins entirely. The `/aux status` command reads session
 * events directly and is not affected.
 */
export function syncAuxStatusProjection(service) {
  if (service._projectionCtx === void 0) return;
  const enabled = service.showStatusChip !== false;
  if (enabled && service._auxStatusProjectionDispose === void 0) {
    service._auxStatusProjectionDispose = service._projectionCtx.sessionProjections.register(
      createAuxStatusProjectionDefinition(service._projectionCtx.sessionProjections)
    );
  } else if (!enabled && service._auxStatusProjectionDispose !== void 0) {
    service._auxStatusProjectionDispose();
    service._auxStatusProjectionDispose = void 0;
  }
}
