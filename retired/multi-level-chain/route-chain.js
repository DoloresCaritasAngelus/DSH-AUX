/**
 * 退役:多级辅助模型降级链(`dsh-aux/src/route.js` 于 2026-09-17 移除的三个纯函数)。
 *
 * **逐字节原文**,从该文件退役前的内容原样拷来(含它依赖的 `route()` 辅助函数,
 * 以便本文件自足可读);仅加了这一行说明。不再被任何活代码引用,仅作历史。
 * 语义见同目录 `tests/route-chain.test.js`。
 */

/** A resolved provider/model route. */
export function route(provider, model) {
  return { provider, model };
}

/**
 * Resolve the ordered auxiliary route chain for a task:
 *   1. `models` (non-empty) — the explicit chain, in order; a singular
 *      provider/model is then IGNORED (surfaced as a status warning, never a
 *      config error: existing configs must keep loading);
 *   2. otherwise the singular provider+model from merged config;
 *   3. otherwise the task's default auxiliary route (from the defaults map);
 *   4. otherwise an empty chain (caller falls back to the main model).
 * Duplicate "provider/model" entries are collapsed, keeping the first.
 * @param merged merged task config.
 * @param defaults map of task key -> route() of a default auxiliary model.
 * @returns the ordered routes; empty when nothing is configured.
 */
export function resolveRouteChain(merged, defaults) {
  const models = Array.isArray(merged?.models)
    ? merged.models.filter((spec) => typeof spec === "string" && spec.length > 0)
    : [];
  const chain = [];
  if (models.length > 0) {
    for (const spec of models) chain.push(parseRouteSpec(spec));
  } else if (merged?.provider !== void 0 && merged?.model !== void 0) {
    chain.push(route(merged.provider, merged.model));
  } else {
    const fallback = defaults?.[merged?.task ?? ""] ?? defaults?._any;
    if (fallback !== void 0) chain.push(fallback);
  }
  const seen = new Set();
  return chain.filter((entry) => {
    const key = entry.provider + "\u0000" + entry.model;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parse one "provider/model" spec. The model may itself contain slashes
 * (e.g. an OpenRouter-style id), so only the FIRST slash separates.
 * @param spec non-empty string.
 * @returns the route.
 */
export function parseRouteSpec(spec) {
  const text = String(spec ?? "").trim();
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) {
    throw new Error(`aux: route spec "${text}" must be "provider/model"`);
  }
  return route(text.slice(0, slash), text.slice(slash + 1));
}

/** Validate a route-spec list (`models` config value). */
export function assertRouteSpecList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of "provider/model" strings`);
  return value.map((spec) => {
    if (typeof spec !== "string" || spec.trim().length === 0) {
      throw new Error(`${label} must contain only non-empty "provider/model" strings`);
    }
    parseRouteSpec(spec);
    return spec.trim();
  });
}
