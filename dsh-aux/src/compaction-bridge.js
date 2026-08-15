/**
 * dsh-aux compaction bridge.
 *
 * Makes the native `dsh-compaction-basic` summarization call go through
 * `ctx.auxLlm`'s `compaction` task when that task is explicitly configured.
 * This lets session compaction reuse AUX's per-task model routing, timeout,
 * concurrency cap, failure cooldown, main-model fallback and `aux/llm-call`
 * event tracing — while leaving the default native summarizer untouched for
 * deployments that do not configure a dedicated compaction model.
 *
 * The bridge is installed as a side effect when this module is imported. It
 * patches only the `summarize()` subclass hook, which is the documented
 * extension seam of `BasicCompactionEngine`; all pressure, retention, shrink
 * validation and lifecycle logic stays in the native engine.
 *
 * @module @dolorescaritasangelus/dsh-aux/compaction-bridge
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";

/**
 * The same compaction instruction the native summarizer appends as the final
 * user message. Kept in sync with `dsh-compaction-basic` so a compaction
 * request routed through AUX produces the same checkpoint shape.
 */
const COMPACTION_INSTRUCTION = [
  "You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.",
  "",
  "Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write \"(none)\" for an empty section — never drop a section.",
  "",
  "## Primary Request and Intent",
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  "",
  "## Key Technical Concepts",
  "- [technologies, frameworks, patterns, and conventions in play]",
  "",
  "## Files and Code",
  "- [exact path: why it matters, key changes or snippets]",
  "",
  "## Errors and Fixes",
  "- [error: how it was resolved, plus any related user feedback]",
  "",
  "## Pending Jobs",
  "- [explicitly requested work not yet completed]",
  "",
  "## Current Work",
  "- [precisely what was in progress at this checkpoint]",
  "",
  "## Next Step",
  "- [the single next action, directly in line with the most recent request, or \"(none)\"]",
  "",
  "## Critical Context",
  "- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]",
  "",
  "Rules:",
  "- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.",
  "- Capture user feedback and explicit instructions faithfully, especially corrections.",
  "- Do NOT mention this summarization request or that the context was compacted.",
  "- Output only the checkpoint text: do not call any tool or take any other action.",
  "- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure."
].join("\n");

/** Marker preventing double patching. */
const PATCHED = Symbol("dsh-aux.compactionBridgePatched");

let installed = false;

/**
 * Install the prototype patch on `BasicCompactionEngine` once.
 * Safe to call multiple times; no-op when the package is absent or already
 * patched.
 */
async function install() {
  if (installed) return;
  let mod;
  try {
    mod = await import("@deepseek-ai/dsh-compaction-basic");
  } catch {
    // The platform may run without compaction-basic; AUX still works.
    return;
  }
  const BasicCompactionEngine = mod.default ?? mod.BasicCompactionEngine;
  if (BasicCompactionEngine === void 0 || BasicCompactionEngine.prototype[PATCHED]) return;

  const originalSummarize = BasicCompactionEngine.prototype.summarize;
  BasicCompactionEngine.prototype.summarize = async function summarize(input, agent, signal) {
    let aux;
    try {
      aux = this.ctx.get("auxLlm");
    } catch {
      aux = void 0;
    }
    if (aux !== void 0 && isCompactionTaskConfigured(aux)) {
      // Do NOT fall back to the native summarizer here: `aux.call("compaction")`
      // already includes the configured compaction model plus the main-model
      // fallback. Falling back again would repeat the same main-model call and
      // hide the real AUX error (e.g. timeout, input limit, image support).
      try {
        return await summarizeViaAux(aux, input, agent, signal, maxTokensFor(this, agent));
      } catch (error) {
        this.ctx.logger?.warn?.(
          `dsh-aux compaction bridge failed: ${formatAuxError(error)}`
        );
        throw error;
      }
    }
    return originalSummarize.call(this, input, agent, signal);
  };
  Object.defineProperty(BasicCompactionEngine.prototype, PATCHED, {
    value: true,
    configurable: false,
    writable: false
  });
  installed = true;
}

/**
 * Whether the `compaction` AUX task has an explicit provider/model route.
 * The bridge only takes over when the user has configured a dedicated
 * session-compaction model; otherwise native behavior is preserved.
 */
export function isCompactionTaskConfigured(aux) {
  try {
    const status = aux.describe().find((entry) => entry.task === "compaction");
    return status?.configured === true && status.primary !== null && status.primary !== void 0;
  } catch {
    return false;
  }
}

/** Whether the native engine prototype has been patched by this bridge. */
export function isCompactionBridgeInstalled() {
  return installed;
}

/**
 * Resolve the effective summarization `maxTokens` the same way the native
 * engine does: an exact `modelPolicies` entry for the current conversation
 * target wins, otherwise the top-level `maxTokens` default applies.
 */
function maxTokensFor(engine, agent) {
  const config = engine?.config;
  if (config === void 0) return void 0;
  const routed = agent?.session?.requestHeader?.()?.config;
  const target =
    routed?.provider !== void 0 && routed?.model !== void 0
      ? { provider: routed.provider, model: routed.model }
      : agent?.options?.provider !== void 0 && agent?.options?.model !== void 0
        ? { provider: agent.options.provider, model: agent.options.model }
        : void 0;
  if (target === void 0) return config.maxTokens;
  const policy = config.modelPolicies?.find(
    (entry) => entry.provider === target.provider && entry.model === target.model
  );
  return policy?.maxTokens ?? config.maxTokens;
}

/**
 * Run one compaction summarization through `ctx.auxLlm.call("compaction", …)`.
 * Returns the `SummaryResult` shape expected by `BasicCompactionEngine`.
 */
export async function summarizeViaAux(aux, input, agent, signal, maxTokens) {
  const instructionMessage = createUserMessage({
    content: [{ type: "text", text: COMPACTION_INSTRUCTION }],
    source: { kind: "plugin", plugin: "dsh-aux" }
  });
  const result = await aux.call("compaction", {
    messages: [...input.messages, instructionMessage],
    ...(input.system === void 0 ? {} : { system: input.system }),
    ...(input.tools === void 0 ? {} : { tools: [...input.tools] }),
    ...(maxTokens === void 0 ? {} : { maxTokens }),
    session: agent.session,
    agent,
    signal,
    purpose: "compaction"
  });
  return {
    summary: [{ type: "text", text: result.text }],
    provider: result.provider,
    model: result.model
  };
}

/** Format an AUX error for logs, including per-attempt details when present. */
function formatAuxError(error) {
  if (error?.attempts?.length > 0) {
    const lines = error.attempts.map(
      (attempt) => `  - ${attempt.provider}/${attempt.model}: ${attempt.error?.message ?? String(attempt.error)} (${attempt.kind})`
    );
    return `${error.message ?? String(error)}\n${lines.join("\n")}`;
  }
  return error?.message ?? String(error);
}

await install();
