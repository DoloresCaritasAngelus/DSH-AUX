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
import { readFile as readFileText } from "node:fs/promises";

/**
 * @returns "installed" | "missing" | "unknown" (not in a standard layout).
 */
export async function subagentBridgeStatus() {
  const rels = [
    "../../../@deepseek-ai/dsh-tool-subagent/lib/index.js",
    "../../../node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js"
  ];
  let src;
  for (const rel of rels) {
    try {
      src = await readFileText(new URL(rel, import.meta.url));
      break;
    } catch {
      /* try next candidate */
    }
  }
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
  const rels = [
    "../../../@deepseek-ai/dsh-workflow-worker-thread/lib/index.js",
    "../../../node_modules/@deepseek-ai/dsh-workflow-worker-thread/lib/index.js"
  ];
  let src;
  for (const rel of rels) {
    try {
      src = await readFileText(new URL(rel, import.meta.url));
      break;
    } catch {
      /* try next candidate */
    }
  }
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
