/**
 * Vision delivery routing: `aux` (auxiliary vision model) vs `native`
 * (hand the durable image straight to an image-capable main model).
 *
 * The decision is a pure function of resolved facts so it can be tested
 * exhaustively without a runtime. Two safety rules dominate:
 *
 * - `nativeRoutes` is a **whitelist**: an unlisted route never gets native
 *   delivery, because route-level `defaultInput` can claim image support a
 *   model does not really have.
 * - `inputModalities` is only a **negative gate**: a non-empty list that
 *   omits `image` refuses native delivery. An absent/undefined list is not
 *   proof of capability and never authorizes anything by itself.
 *
 * @module @dolorescaritasangelus/dsh-aux/vision-route
 */

/** Route key used by the `nativeRoutes` whitelist. */
export function routeKey(provider, model) {
  if (typeof provider !== "string" || provider.length === 0) return void 0;
  if (typeof model !== "string" || model.length === 0) return void 0;
  return `${provider}/${model}`;
}

/**
 * Decide how one vision call is delivered.
 *
 * @param {object} facts Resolved routing facts.
 * @param {string} [facts.visionRoute] "aux" | "native-when-capable" | "auto".
 * @param {ReadonlyArray<string>} [facts.nativeRoutes] Whitelisted route keys.
 * @param {boolean} [facts.forceAuxVision] Force every image through AUX.
 * @param {{provider: string, model: string}|undefined} facts.mainRoute Main route.
 * @param {{provider: string, model: string}|undefined} facts.auxRoute Resolved aux vision route.
 * @param {ReadonlyArray<string>|undefined} facts.mainInputModalities Main model modalities.
 * @returns {{ mode: "aux"|"native", reason: string }}
 */
export function resolveVisionDelivery({
  visionRoute = "aux",
  nativeRoutes = [],
  forceAuxVision = false,
  mainRoute,
  auxRoute,
  mainInputModalities,
} = {}) {
  if (forceAuxVision === true) return { mode: "aux", reason: "force-aux-vision" };
  if (visionRoute !== "native-when-capable" && visionRoute !== "auto") {
    return { mode: "aux", reason: "route-aux" };
  }
  const key = routeKey(mainRoute?.provider, mainRoute?.model);
  if (key === void 0) return { mode: "aux", reason: "no-main-route" };
  if (Array.isArray(mainInputModalities) && mainInputModalities.length > 0 && !mainInputModalities.includes("image")) {
    return { mode: "aux", reason: "main-text-only" };
  }
  if (!Array.isArray(nativeRoutes) || !nativeRoutes.includes(key)) {
    return { mode: "aux", reason: "route-not-whitelisted" };
  }
  if (visionRoute === "auto" && auxRoute !== void 0) {
    // `auto` targets the exact "aux == main" case; a different configured aux
    // route keeps the auxiliary model as the analysis engine.
    if (auxRoute.provider !== mainRoute.provider || auxRoute.model !== mainRoute.model) {
      return { mode: "aux", reason: "auto-route-mismatch" };
    }
  }
  return { mode: "native", reason: "native-capable" };
}
