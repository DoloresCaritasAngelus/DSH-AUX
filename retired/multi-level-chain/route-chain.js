/**
 * 退役:多级辅助模型降级链的纯函数(2026-09-17 从 `dsh-aux/src/route.js` 移除)。
 * 冻结留存,仅作历史;不再被任何活代码引用。语义见同目录 tests/route-chain.test.js。
 */

/** 解析一个 "provider/model" 规格(只按第一个斜杠切分,模型名本身可含斜杠)。 */
export function parseRouteSpec(spec) {
  const text = String(spec ?? "").trim();
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) {
    throw new Error(`aux: route spec "${text}" must be "provider/model"`);
  }
  return { provider: text.slice(0, slash), model: text.slice(slash + 1) };
}

/** 校验规格数组(`models` 配置值)。 */
export function assertRouteSpecList(value, label) {
  if (!Array.isArray(value)) throw new Error(`S{} must be an array of "provider/model" strings`.replace("{}", label));
  return value.map((spec) => {
    if (typeof spec !== "string" || spec.trim().length === 0) {
      throw new Error(`S{} must contain only non-empty "provider/model" strings`.replace("{}", label));
    }
    parseRouteSpec(spec);
    return spec.trim();
  });
}

/** 解析任务的有序路由链:models > 单数 provider/model > 任务默认 > 空。 */
export function resolveRouteChain(merged, defaults) {
  const models = Array.isArray(merged?.models)
    ? merged.models.filter((spec) => typeof spec === "string" && spec.length > 0)
    : [];
  const chain = [];
  if (models.length > 0) {
    for (const spec of models) chain.push(parseRouteSpec(spec));
  } else if (merged?.provider !== void 0 && merged?.model !== void 0) {
    chain.push({ provider: merged.provider, model: merged.model });
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
