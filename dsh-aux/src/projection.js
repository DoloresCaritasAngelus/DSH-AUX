/**
 * dsh-aux `aux-status` session projection.
 *
 * @module @dolorescaritasangelus/dsh-aux/projection
 */
import { z as zodz } from "zod";
import { AUX_CALL_EVENT, AUX_STATUS_KEY } from "./config.js";

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
    service._auxStatusProjectionDispose = service._projectionCtx.sessionProjections.register({
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
  } else if (!enabled && service._auxStatusProjectionDispose !== void 0) {
    service._auxStatusProjectionDispose();
    service._auxStatusProjectionDispose = void 0;
  }
}
