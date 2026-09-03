/**
 * dsh-aux image-bridge patch detection (DSH alpha line).
 *
 * Main branch supports DSH 0.1.2-alpha.2 ~ 0.1.2-alpha.3 only.
 * In this architecture:
 * - `dsh-agent-loop` carries the model-input image bridge + forceAuxVision;
 * - `dsh-api-session-controller` owns the image-admission capability gate and
 *   needs the prompt-gate removal patch.
 * Old rc.6 ~ 0.1.1-rc.2 `dsh-host-apiproxy` patches live in legacy branch /
 * `bridge/retired/` and are intentionally not checked here.
 *
 * @module @dolorescaritasangelus/dsh-aux/image-bridge
 */
import { readPackageFile } from "./bridge-locate.js";

/**
 * Detect whether the image-bridge patches are applied to the alpha DSH
 * packages that live NEXT to this plugin in the deployment node_modules.
 * @returns "v3" | "v2" | "partial" | "missing" | "unknown" (not in a
 *   standard deployment layout).
 */
export async function imageBridgeStatus() {
  const [agent, controller] = await Promise.all([
    readPackageFile("dsh-agent-loop"),
    readPackageFile("dsh-api-session-controller")
  ]);
  if (agent === void 0 || controller === void 0) return "unknown";

  const agentPatched = agent.includes("image-bridge v2 (local patch)");
  const forceAuxVision = agent.includes("forceAuxVision");
  const controllerPatched = controller.includes("dsh-aux image bridge v3 (local patch)");

  if (agentPatched && controllerPatched && forceAuxVision) return "v3";
  if (agentPatched && controllerPatched && !forceAuxVision) return "v2";
  if (!agentPatched && !controllerPatched) return "missing";
  return "partial";
}
