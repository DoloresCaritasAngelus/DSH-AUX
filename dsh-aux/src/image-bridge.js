/**
 * dsh-aux image-bridge patch detection.
 *
 * @module @dolorescaritasangelus/dsh-aux/image-bridge
 */
import { readFile as readFileText } from "node:fs/promises";

/**
 * Detect whether the image-bridge patches are applied to the core DSH
 * packages that live NEXT to this plugin in the deployment node_modules
 * (dsh-host-apiproxy admit + dsh-agent-loop buildRequest +
 * dsh-host-apiproxy selectModel + dsh-agent-loop forceAuxVision). The bridge
 * is an integrated part of the install (see the repo's install.sh), so the
 * status command reports it and the AI guide treats it as a default step.
 * @returns "v3" | "v2" | "v1" | "partial" | "missing" | "unknown" (not in a
 *   standard deployment layout, e.g. running from the source tree).
 */
export async function imageBridgeStatus() {
  // 兼容两种部署形态:
  // - symlink: node_modules/@dolorescaritasangelus/dsh-aux/src -> ../../../@deepseek-ai/...
  // - 源码树: <DSH_ROOT>/dsh work/aux/dsh-aux/src -> ../../../node_modules/@deepseek-ai/...
  const targets = [
    {
      rels: [
        "../../../@deepseek-ai/dsh-host-apiproxy/lib/index.js",
        "../../../node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js"
      ],
      v2Mark: "dsh-image bridge v2 (local patch)",
      v1Mark: "dsh-vision bridge (local patch)"
    },
    {
      rels: [
        "../../../@deepseek-ai/dsh-agent-loop/lib/index.js",
        "../../../node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js"
      ],
      v2Mark: "image-bridge v2 (local patch)",
      v1Mark: void 0
    },
    {
      rels: [
        "../../../@deepseek-ai/dsh-host-apiproxy/lib/index.js",
        "../../../node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js"
      ],
      v2Mark: "dsh-image bridge v3 (local patch)",
      v1Mark: void 0
    },
    {
      rels: [
        "../../../@deepseek-ai/dsh-agent-loop/lib/index.js",
        "../../../node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js"
      ],
      v2Mark: "forceAuxVision",
      v1Mark: void 0
    }
  ];
  const states = [];
  for (const target of targets) {
    let src;
    for (const rel of target.rels) {
      try {
        src = await readFileText(new URL(rel, import.meta.url));
        break;
      } catch {
        /* try next candidate */
      }
    }
    if (src === void 0) {
      states.push("unknown");
      continue;
    }
    if (src.includes(target.v2Mark)) states.push("v2");
    else if (target.v1Mark !== void 0 && src.includes(target.v1Mark)) states.push("v1");
    else states.push("missing");
  }
  if (states.some((state) => state === "unknown")) return "unknown";
  if (states.every((state) => state === "v2")) return "v3";
  if (states.every((state) => state === "missing")) return "missing";
  // 旧版 v2(前两个目标已打、selectModel/forceAuxVision 未打)也算可工作,
  // 只是切换模型仍受限、且不支持强制原生视觉走 AUX。
  if (states[0] === "v2" && states[1] === "v2" && states[2] === "missing" && states[3] === "missing") return "v2";
  return "partial";
}
