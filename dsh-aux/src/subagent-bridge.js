/**
 * dsh-aux subagent-bridge patch detection.
 *
 * The transparent takeover of `subagent` is a local patch on
 * `dsh-tool-subagent` (schema get `requires_vision` + execute calls
 * `ctx.auxLlm.subagentRoute`). We report whether it is installed so a fresh
 * install knows the route actually reaches AUX.
 *
 * @module @dolorescaritasangelus/dsh-aux/subagent-bridge
 */
import { readPackageFile } from "./bridge-locate.js";

/**
 * @returns "installed" | "missing" | "unknown" (not in a standard layout).
 */
export async function subagentBridgeStatus() {
  const src = await readPackageFile("dsh-tool-subagent");
  if (src === void 0) return "unknown";
  if (
    src.includes("requires_vision:") &&
    src.includes('ctx.get("auxLlm")') &&
    src.includes("subagentRoute")
  ) {
    return "installed";
  }
  return "missing";
}

/**
 * Detect whether the workflow-engine bridge is installed
 * (`dsh-workflow-worker-thread` `startChild` consults `ctx.auxLlm`).
 * @returns "installed" | "missing" | "unknown".
 */
export async function workflowBridgeStatus() {
  const src = await readPackageFile("dsh-workflow-worker-thread");
  if (src === void 0) return "unknown";
  if (
    src.includes("subagentIncludeWorkflow") &&
    src.includes("subagentRoute") &&
    src.includes("this.ctx?.get?.(\"auxLlm\")")
  ) {
    return "installed";
  }
  return "missing";
}
