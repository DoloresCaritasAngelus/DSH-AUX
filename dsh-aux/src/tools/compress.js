/**
 * dsh-aux `compress_text` tool implementation.
 *
 * @module @dolorescaritasangelus/dsh-aux/tools/compress
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { DEFAULT_MAX_INPUT_CHARS } from "../route.js";
import { clampTargetRatio, compressSystemPrompt, compressUserMessage } from "../prompt.js";

/** compress_text execution. */
export async function runCompress(service, args, exec) {
  const text = args.text;
  if (typeof text !== "string" || text.length === 0) throw new Error("compress_text: text must be a non-empty string");
  if (text.length > DEFAULT_MAX_INPUT_CHARS) {
    throw new Error(`compress_text: input is ${text.length} chars, exceeding the ${DEFAULT_MAX_INPUT_CHARS}-char limit`);
  }
  const ratio = clampTargetRatio(args.targetRatio);
  const messages = [createUserMessage({
    content: [{ type: "text", text: compressUserMessage(text, args.instruction ?? "") }],
    source: { kind: "plugin", plugin: "dsh-aux" }
  })];
  const result = await service.call("compress", {
    messages,
    system: compressSystemPrompt(ratio),
    temperature: 0.1,
    session: exec.agent?.session,
    agent: exec.agent,
    signal: exec.signal,
    inputChars: text.length,
    purpose: "compaction"
  });
  const compressed = result.text;
  return {
    compressed,
    originalChars: text.length,
    compressedChars: compressed.length,
    ratio: text.length > 0 ? Math.round((compressed.length / text.length) * 100) / 100 : 0,
    provider: result.provider,
    model: result.model
  };
}
