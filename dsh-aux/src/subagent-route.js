/**
 * dsh-aux subagent bridge routing: pure decision logic for routing a native
 * `subagent` call onto AUX auxiliary models. No DSH service access — fully
 * testable offline.
 *
 * @module @dolorescaritasangelus/dsh-aux/subagent-route
 */

/** AUX tools injected into routed subagents so the child can escalate to the
 * auxiliary model when its own capability is insufficient (e.g. a text-only
 * manual subagent needs vision → vision_analyze). */
export const AUX_SUBAGENT_TOOL_NAMES = Object.freeze([
  "vision_analyze",
  "web_extract",
  "compress_text",
]);

/** Built-in keywords that hint a task needs vision capability. */
export const DEFAULT_VISION_KEYWORDS = Object.freeze([
  "图片",
  "图像",
  "截图",
  "看图",
  "画面",
  "缩略图",
  "describe",
  "image",
  "vision",
  "attachmentId",
  "imagePath",
  "imageUrl",
  "vision_analyze",
  "visual",
]);

/**
 * Conservative heuristic: does this prompt need vision capability?
 * Unknown / no keyword → false (fall back to the general subagent), so we
 * never over-use an expensive vision subagent model by accident.
 * @param prompt the delegated task text.
 * @param keywords extra keywords from settings (optional).
 */
export function detectNeedsVision(prompt, keywords = []) {
  if (typeof prompt !== "string" || prompt.length === 0) return false;
  const lower = prompt.toLowerCase();
  const words = [...DEFAULT_VISION_KEYWORDS, ...keywords].map((k) => String(k).toLowerCase());
  return words.some((k) => k.length > 0 && lower.includes(k));
}

/**
 * Resolve one subagent call onto an AUX route.
 *
 * @param settings the `aux.subagent` settings section:
 *   { mode?: "native"|"manual"|"vision-aware", general?: {provider,model},
 *     vision?: {provider,model}, prepareTools?: boolean, visionKeywords?: string[] }
 * @param request { requiresVision?: "auto"|"true"|"false" (or boolean),
 *   prompt?: string, existingAllow?: string[], existingDeny?: string[] }
 * @returns { settled: boolean, agentOptions?, toolFilter?, needsVision? }
 *   `settled:false` means "do nothing, run native" (missing config, native
 *   mode, or incomplete provider/model).
 */
export function resolveSubagentRoute(settings, request = {}) {
  const mode = settings?.mode ?? "native";
  if (mode === "native" || (mode !== "manual" && mode !== "vision-aware")) {
    return { settled: false };
  }
  const requiresVision = request.requiresVision;
  const explicitVision = requiresVision === true || requiresVision === "true";
  const explicitNoVision = requiresVision === false || requiresVision === "false";
  const needsVision =
    mode === "vision-aware"
      ? explicitVision
        ? true
        : explicitNoVision
          ? false
          : detectNeedsVision(request.prompt ?? "", settings?.visionKeywords)
      : false;

  const group = mode === "manual" ? settings?.general : needsVision ? settings?.vision : settings?.general;
  if (
    group === void 0 ||
    typeof group.provider !== "string" || group.provider.length === 0 ||
    typeof group.model !== "string" || group.model.length === 0
  ) {
    // Missing / half-configured route: run native (never silently misroute).
    return { settled: false };
  }

  const agentOptions = { provider: group.provider, model: group.model };

  // Tool filter: keep the child's existing allow list, union the AUX tools so
  // the child can escalate to the auxiliary model when needed (fallback chain).
  const allows = new Set(Array.isArray(request.existingAllow) ? request.existingAllow : []);
  if (settings?.prepareTools !== false) {
    for (const name of AUX_SUBAGENT_TOOL_NAMES) allows.add(name);
  }
  const deny = Array.isArray(request.existingDeny) && request.existingDeny.length > 0
    ? [...request.existingDeny]
    : void 0;
  const toolFilter = allows.size > 0 || deny !== void 0
    ? {
        ...(allows.size > 0 ? { allow: [...allows] } : {}),
        ...(deny !== void 0 ? { deny } : {})
      }
    : void 0;

  return {
    settled: true,
    agentOptions,
    ...(toolFilter === void 0 ? {} : { toolFilter }),
    needsVision
  };
}
