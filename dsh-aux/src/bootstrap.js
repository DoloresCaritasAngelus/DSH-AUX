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
import { AUX_GUIDE_TOOL_NAMES, buildAuxToolsGuide } from "./prompt.js";
import { sessionEvents } from "./session-utils.js";

/** Whether this agent runs the `minimal` preset. */
export function isMinimalPreset(agent) {
  return agent?.session?.header?.agentPreset === "minimal";
}

/** Whether this agent runs a Minimal-like / Anchored Standard preset. */
export function isBootstrapPreset(agent) {
  const preset = agent?.session?.header?.agentPreset;
  return (
    typeof preset === "string" &&
    (preset === "minimal" ||
      preset === "anchored-standard" ||
      preset === "zero-anchored-standard" ||
      preset === "whoami-standard")
  );
}

/**
 * Resolve each guided tool's exposure through the service. An unknown service
 * shape counts as exposed, which preserves the previous full guide.
 */
export function auxGuideExposure(service) {
  const exposed = {};
  for (const name of AUX_GUIDE_TOOL_NAMES) {
    try {
      exposed[name] = service?.isToolExposed?.(name) ?? true;
    } catch {
      exposed[name] = true;
    }
  }
  return exposed;
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
  // A tool retired by its platform switch must not appear here: this section is
  // the model's catalog of what it can call, and naming an absent tool sends it
  // looking for something that does not exist.
  return buildAuxToolsGuide(auxGuideExposure(service));
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

/**
 * Mode-aware reminder text injected once after Bootstrap promotion.
 * @param agent - the running agent (its preset selects the wording).
 * @param exposed - per-tool exposure; retired tools are not named. An absent
 *   entry counts as exposed, preserving the previous full reminder.
 * @returns the reminder, or an empty string when no guided tool is exposed.
 */
export function auxPreStepReminderText(agent, exposed = {}) {
  const preset = agent?.session?.header?.agentPreset;
  const head =
    preset === "minimal"
      ? "辅助模型提示(dsh-aux):当前是极简模式。首轮 AUX 工具不可用;后续轮次中,"
      : "辅助模型提示(dsh-aux):当前是 Anchored Standard。首轮 AUX 工具不可用;晋升后工具目录已开放,";
  const lines = [];
  if (exposed.vision_analyze !== false) {
    lines.push("需要查看/分析图片或 GIF 时,请直接使用 vision_analyze 工具,不要为此创建子代理。");
  }
  if (exposed.web_extract !== false) lines.push("需要网页内容时用 web_extract。");
  if (exposed.compress_text !== false) lines.push("超长文本先用 compress_text 压缩再讨论。");
  if (lines.length === 0) return "";
  return head + lines.join("");
}
