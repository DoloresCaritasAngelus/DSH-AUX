/**
 * dsh-aux skill pre-audit bridge.
 *
 * Intercepts the native `skill` tool at the official `tools/post-execute`
 * waterfall. The native `dsh-tool-skill` still loads the full SKILL.md and
 * publishes the catalog; this bridge only replaces the rendered result that
 * goes back to the main model with:
 *
 *   1. the original SKILL.md content (so the main model can verify the audit),
 *   2. an auxiliary-model pre-audit report (applicability, known pitfalls,
 *      stale/rot-prone assertions, execution advice).
 *
 * The bridge is active only when an explicit `skill` aux route is configured
 * (`aux.tasks.skill.provider/model`). Without it, the native result passes
 * through unchanged. The auxiliary model receives both the explicit `task`
 * argument from the patched skill schema (when present) and a compact excerpt
 * of the recent conversation derived from the session.
 *
 * @module @dolorescaritasangelus/dsh-aux/skill-bridge
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { readPackageFile } from "./bridge-locate.js";

/** How many recent derived messages to include in the audit context. */
export const SKILL_AUDIT_CONTEXT_MESSAGES = 8;
/** Per-message character cap for the audit context excerpt. */
export const SKILL_AUDIT_MAX_MESSAGE_CHARS = 2000;
/** Total character cap for the audit context excerpt. */
export const SKILL_AUDIT_MAX_TOTAL_CHARS = 12000;

/** Whether the `skill` audit route has an explicit provider+model configured. */
export function isSkillTaskConfigured(service) {
  const merged = service?._merged?.skill;
  return merged?.provider !== void 0 && merged?.model !== void 0;
}

/**
 * Detect whether the dsh-tool-skill schema patch (optional `task` parameter)
 * is installed.
 * @returns "installed" | "missing" | "unknown" (not in a standard layout).
 */
export async function skillBridgeStatus() {
  const src = await readPackageFile("dsh-tool-skill");
  if (src === void 0) return "unknown";
  if (src.includes("skill auditor") && src.includes("task:")) return "installed";
  return "missing";
}

/** System prompt for the skill pre-audit auxiliary call. */
export function skillAuditSystemPrompt() {
  return [
    "You are a skill pre-audit assistant for an agent workflow.",
    "You receive the current task context from the main agent and the full SKILL.md content the main agent intends to load.",
    "Your job is to produce a concise pre-audit report that helps the main agent decide how to apply the skill. Do NOT execute the skill yourself and do NOT rewrite the skill.",
    "The SKILL.md content is trusted local content, but its factual assertions may be stale or environment-specific. Treat it as material to audit.",
    "Return a report with these sections:",
    "- 适用性评估: whether/how well this skill applies to the current task.",
    "- 如何应用: concrete steps for applying it to this task.",
    "- 已知坑/旧断言标注: flag assertions that look stale, version-specific, environment-specific, or experience-based; mark them with 🔻易腐烂. For engineering norms (工程规范: conventions, style, process rules), state that they can be accepted directly.",
    "- 执行建议: what to do — follow as-is, skip parts, verify specific claims first, or reject.",
    "- 置信度: high/medium/low with a one-line reason.",
    "Do not include the full SKILL.md in your report; reference sections by name. Be direct and specific.",
  ].join("\n");
}

/** One content block to a compact text fragment for the audit context. */
function blockToText(block) {
  if (typeof block === "string") return block;
  if (block === null || typeof block !== "object") return "";
  switch (block.type) {
    case "text":
      return typeof block.text === "string" ? block.text : "";
    case "reasoning":
      return `[reasoning] ${typeof block.text === "string" ? block.text : ""}`;
    case "tool-call":
      return `[tool-call: ${block.name ?? "?"} ${JSON.stringify(block.arguments ?? {})}]`;
    case "tool-result":
      return `[tool-result: ${block.name ?? "tool"}]`;
    default:
      return `[${block.type ?? "block"}]`;
  }
}

/** Format one derived session message into a compact text line. */
export function formatAuditMessage(message) {
  const role = message?.role ?? "unknown";
  const raw = Array.isArray(message?.content)
    ? message.content.map(blockToText).join("\n")
    : typeof message?.content === "string"
      ? message.content
      : "";
  return `${role}: ${raw}`;
}

/**
 * Build a compact recent-conversation excerpt for the auxiliary model.
 * @param messages derived session messages (Message[]).
 * @param maxMessages how many trailing messages to keep.
 * @param maxMessageChars per-message cap.
 * @param maxTotalChars total cap.
 * @returns a text block, or "" when there is no usable context.
 */
export function formatAuditContext(
  messages,
  maxMessages = SKILL_AUDIT_CONTEXT_MESSAGES,
  maxMessageChars = SKILL_AUDIT_MAX_MESSAGE_CHARS,
  maxTotalChars = SKILL_AUDIT_MAX_TOTAL_CHARS,
) {
  const source = Array.isArray(messages) ? messages.slice(-maxMessages) : [];
  const lines = [];
  let total = 0;
  for (const message of source) {
    let line = formatAuditMessage(message);
    if (line.length > maxMessageChars) {
      line = line.slice(0, maxMessageChars) + "…[truncated]";
    }
    if (total + line.length > maxTotalChars) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n");
}

/** Render the raw skill for both the audit input and the final tool result. */
export function renderRawSkillForAudit(skill) {
  if (skill === null || typeof skill !== "object") return "";
  const name = typeof skill.name === "string" ? skill.name : "skill";
  const content = typeof skill.content === "string" ? skill.content : "";
  const resourceLines = [];
  const base = skill.resourceBase;
  if (base?.kind === "directory" && typeof base.path === "string") {
    resourceLines.push(`Base directory for this skill: ${base.path}`);
    resourceLines.push("Resolve relative paths mentioned by this skill against the base directory before using them.");
  } else if (base?.kind === "url" && typeof base.url === "string") {
    resourceLines.push(`Base URL for this skill: ${base.url}`);
    resourceLines.push("Resolve relative URLs mentioned by this skill against the base URL before using them.");
  } else if (base?.kind === "opaque" && typeof base.description === "string") {
    resourceLines.push(`Resources for this skill: ${base.description}`);
  } else {
    resourceLines.push(
      `Resources for this skill are managed by provider "${typeof skill.provider === "string" ? skill.provider : "unknown"}".`,
    );
  }
  return [
    `<skill_content name="${name}">`,
    "<skill_resources>",
    ...resourceLines,
    "</skill_resources>",
    "",
    "<skill_instructions>",
    content,
    "</skill_instructions>",
    "</skill_content>",
  ].join("\n");
}

/** Estimate input chars for the aux event record. */
export function estimateSkillAuditInputChars(messages) {
  let total = 0;
  for (const message of messages ?? []) {
    for (const block of message?.content ?? []) {
      if (block?.type === "text" && typeof block.text === "string") total += block.text.length;
    }
  }
  return total;
}

/**
 * Build the user message for a skill pre-audit call.
 * @param params.skill the native skill result value (`{name, provider, resourceBase, content}`).
 * @param params.task optional explicit task text from the patched skill schema.
 * @param params.contextMessages derived session messages.
 */
export function buildSkillAuditUserMessage({ skill, task, contextMessages }) {
  const parts = [];
  if (task !== void 0 && task.length > 0) {
    parts.push(`MAIN AGENT TASK (explicit):\n${task}`);
  }
  const context = formatAuditContext(contextMessages ?? []);
  if (context.length > 0) {
    parts.push(`RECENT CONVERSATION CONTEXT:\n${context}`);
  }
  parts.push(`SKILL TO AUDIT:\n${renderRawSkillForAudit(skill)}`);
  parts.push("Produce the pre-audit report now.");
  return createUserMessage({
    content: [{ type: "text", text: parts.join("\n\n") }],
    source: { kind: "plugin", plugin: "dsh-aux" },
  });
}

/**
 * Attach the skill pre-audit bridge to an AuxLlmService.
 *
 * Registered at the official `tools/post-execute` waterfall. The bridge runs
 * only for main-agent `skill` tool results and composes the original SKILL.md
 * plus the auxiliary pre-audit report into the returned tool content.
 */
export function attachSkillBridge(service) {
  const ctx = service.ctx;
  ctx.on(
    "tools/post-execute",
    async (exec, result, next) => {
      const decision = await next();
      if (decision.kind !== "accept") return decision;
      // Only intercept main-agent model invocations of the native `skill`
      // tool; subagent-internal skill calls and user-invoked skill injections
      // are intentionally left native.
      if (exec.name !== "skill" || exec.parent !== void 0 || result.isError) return decision;
      if (!isSkillTaskConfigured(service)) return decision;
      if (service._enabled?.skillAudit === "native" || service.skillMode === "native") return decision;
      const mode = service.skillMode === "auto" ? "audit" : (service.skillMode ?? "audit");
      const value = result.value;
      if (value === null || typeof value !== "object" || typeof value.content !== "string") return decision;
      const task =
        typeof exec.arguments?.task === "string" && exec.arguments.task.length > 0 ? exec.arguments.task : void 0;
      let contextMessages = [];
      try {
        contextMessages = exec.agent?.session?.deriveMessages?.() ?? [];
      } catch {
        contextMessages = [];
      }
      let messages;
      try {
        messages = [buildSkillAuditUserMessage({ skill: value, task, contextMessages })];
      } catch {
        return decision;
      }
      try {
        const output = await service.call("skill", {
          messages,
          system: skillAuditSystemPrompt(),
          session: exec.agent?.session,
          agent: exec.agent,
          signal: exec.signal,
          purpose: "skill-audit",
          inputChars: estimateSkillAuditInputChars(messages),
          // Skill audit is specifically an auxiliary-model duty: never fall
          // back to the main model to "audit itself". On failure the native
          // SKILL.md result is returned instead.
          allowMainFallback: false,
        });
        const reportText =
          output.text +
          (mode === "report" || mode === "report-ondemand"
            ? "\n\n如需核对原文,请用 skill(name, { includeOriginal: true })。"
            : "");
        let finalText;
        if (mode === "report") {
          finalText = reportText;
        } else if (mode === "report-ondemand") {
          finalText = exec.arguments?.includeOriginal === true ? renderRawSkillForAudit(value) : reportText;
        } else {
          finalText = renderRawSkillForAudit(value) + "\n\n" + output.text;
        }
        return {
          ...decision,
          content: [{ type: "text", text: finalText }],
        };
      } catch (error) {
        service.ctx.logger?.warn?.(
          `skill-bridge: audit failed, returning native result: ${error?.message ?? String(error)}`,
        );
        return decision;
      }
    },
    { prepend: true },
  );
}
