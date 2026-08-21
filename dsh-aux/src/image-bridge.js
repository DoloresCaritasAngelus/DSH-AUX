/**
 * dsh-aux image-bridge patch detection.
 *
 * @module @dolorescaritasangelus/dsh-aux/image-bridge
 */
import { readPackageFile } from "./bridge-locate.js";

/**
 * Detect whether the image-bridge patches are applied to the core DSH
 * packages that live NEXT to this plugin in the deployment node_modules
 * (dsh-host-apiproxy admit + dsh-agent-loop buildRequest +
 * dsh-host-apiproxy selectModel + dsh-agent-loop forceAuxVision). The bridge
 * is an integrated part of the install (see the repo's install.sh), so the
 * status command reports it and the AI guide treats it as a default step.
 * @returns "v3" | "v2" | "v1" | "partial" | "missing" | "unknown" (not in a
 *   standard deployment layout).
 */
export async function imageBridgeStatus() {
  const [api, agent] = await Promise.all([
    readPackageFile("dsh-host-apiproxy"),
    readPackageFile("dsh-agent-loop")
  ]);
  const state = (src, v2Mark, v1Mark) => {
    if (src === void 0) return "unknown";
    if (src.includes(v2Mark)) return "v2";
    if (v1Mark !== void 0 && src.includes(v1Mark)) return "v1";
    return "missing";
  };
  const states = [
    state(api, "dsh-image bridge v2 (local patch)", "dsh-vision bridge (local patch)"),
    state(agent, "image-bridge v2 (local patch)", void 0),
    state(api, "dsh-image bridge v3 (local patch)", void 0),
    state(agent, "forceAuxVision", void 0)
  ];
  if (states.some((value) => value === "unknown")) return "unknown";
  if (states.every((value) => value === "v2")) return "v3";
  if (states.every((value) => value === "missing")) return "missing";
  // 旧版 v2(前两个目标已打、selectModel/forceAuxVision 未打)也算可工作,
  // 只是切换模型仍受限、且不支持强制原生视觉走 AUX。
  if (states[0] === "v2" && states[1] === "v2" && states[2] === "missing" && states[3] === "missing") return "v2";
  return "partial";
}
