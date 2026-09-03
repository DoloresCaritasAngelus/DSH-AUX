/**
 * dsh-aux Bootstrap-preset guidance (Minimal / Anchored Standard).
 *
 * These presets use a complete persona that suppresses the normal
 * `aux:tools-guide` system-prompt section and, for Minimal, keeps the tool
 * catalog to the exact two-tool pair before the first durable tool/call.
 * This module centralizes the preset detection and the post-promotion
 * reminder text.
 *
 * @module @dolorescaritasangelus/dsh-aux/bootstrap
 */
import { AUX_TOOLS_GUIDE } from "./prompt.js";
import { sessionEvents } from "./session-utils.js";

/** Whether this agent runs the `minimal` preset. */
export function isMinimalPreset(agent) {
  return agent?.session?.header?.agentPreset === "minimal";
}

/** Whether this agent runs a Minimal-like / Anchored Standard preset. */
export function isBootstrapPreset(agent) {
  const preset = agent?.session?.header?.agentPreset;
  return typeof preset === "string" && (
    preset === "minimal" ||
    preset === "anchored-standard" ||
    preset === "zero-anchored-standard" ||
    preset === "whoami-standard"
  );
}

/**
 * Dynamic system-prompt guide for the current agent.
 *
 * For ordinary presets (standard, unknown) the full AUX tool guide is
 * injected through the `aux:tools-guide` section. For Bootstrap presets
 * (Minimal / Anchored Standard) the section is suppressed by their complete
 * persona anyway, so return an empty string here and let the pre-step
 * reminder carry the guidance after promotion.
 */
export function auxToolsGuide(service, context) {
  if (service.guideText !== void 0 && service.guideText !== "") return service.guideText;
  if (isBootstrapPreset(context?.agent)) return "";
  return AUX_TOOLS_GUIDE;
}

/** Whether the pre-step reminder channel should be used at all. */
export function shouldUsePreStepAuxGuide(service, agent) {
  // Minimal and Anchored Standard both open the catalog after the first
  // durable tool/call, so both receive the post-promotion AUX reminder.
  if (!isBootstrapPreset(agent)) return false;
  // A user-supplied guideText remains the user's explicit choice; do not
  // silently duplicate it through the pre-step channel.
  return service.guideText === void 0 || service.guideText === "";
}

/**
 * Promotion gate for the pre-step reminder. The installed Anchored Standard
 * preset promotes on the first durable `tool/call`; requiring a tool call is
 * also safe for newer resident-directory variants because it means the model
 * has actually started using tools and the catalog has been expanded.
 */
export function isAuxGuidePromoted(agent) {
  const events = sessionEvents(agent?.session);
  return events.some((event) => event.type === "tool/call");
}

/** Mode-aware reminder text injected once after Bootstrap promotion. */
export function auxPreStepReminderText(agent) {
  const preset = agent?.session?.header?.agentPreset;
  if (preset === "minimal") {
    return "辅助模型提示(dsh-aux):当前是极简模式。首轮 AUX 工具不可用;后续轮次中,需要查看/分析图片或 GIF 时,请直接使用 vision_analyze 工具,不要为此创建子代理。";
  }
  return "辅助模型提示(dsh-aux):当前是 Anchored Standard。首轮 AUX 工具不可用;晋升后工具目录已开放,需要查看/分析图片或 GIF 时,请直接使用 vision_analyze 工具,不要为此创建子代理。";
}
