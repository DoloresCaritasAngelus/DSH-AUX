/**
 * dsh-aux image-memory journal: compact records of past vision analyses so a
 * restarted main session can recall what was looked at without re-analyzing.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/memory
 */
import { readFile as readFileText, rename as renameFile, writeFile as writeFileText } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/** Path to the image-memory journal (path/question -> summary). */
export function imageMemoryPath() {
  const home = process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : void 0);
  return home === void 0 ? void 0 : home + "/attachments/v1/image-memory.json";
}

/** Append one vision outcome to the memory journal (bounded, best-effort). */
export function recordImageMemory(service, sessionId, attachmentId, question, summary) {
  service._memoryQueue = service._memoryQueue.then(() =>
    recordImageMemoryCore(sessionId, attachmentId, question, summary),
  );
  return service._memoryQueue;
}

/** Move a corrupt journal aside so a fresh file can take its place (evidence preserved). */
async function quarantineJournalFile(path) {
  try {
    await renameFile(path, path + ".corrupt-" + Date.now() + "-" + randomUUID());
  } catch {
    /* best-effort: quarantine is a diagnostic nicety, never fatal */
  }
}

/** The serialized journal append; never rejects (best-effort). */
async function recordImageMemoryCore(sessionId, attachmentId, question, summary) {
  const path = imageMemoryPath();
  if (path === void 0) return;
  try {
    const raw = await readFileText(path).catch(() => "{}");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt journal: quarantine it and start fresh so future records can
      // still land. Never silently swallow the write (old + new both lost).
      await quarantineJournalFile(path);
      parsed = {};
    }
    if (parsed === null || typeof parsed !== "object") {
      await quarantineJournalFile(path);
      parsed = {};
    }
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    entries.push({
      sessionId,
      attachmentId,
      question: question.slice(0, 200),
      summary: summary.slice(0, 600),
      at: Date.now(),
    });
    const trimmed = entries.slice(-200);
    const tmp = path + ".tmp";
    await writeFileText(tmp, JSON.stringify({ entries: trimmed }));
    await renameFile(tmp, path);
  } catch {
    /* best-effort */
  }
}

/** /aux memory [n] — list recent image analyses from the journal. */
export async function handleMemoryCommand(args) {
  const path = imageMemoryPath();
  if (path === void 0) return { kind: "error", text: "aux: cannot locate DSH_HOME" };
  try {
    const raw = await readFileText(path).catch(() => "{}");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const limit = args[0] === void 0 ? 10 : Math.max(1, Math.min(50, Number(args[0]) || 10));
    const recent = entries.slice(-limit).reverse();
    if (recent.length === 0) return { kind: "success", text: "图片记忆为空(尚未分析过图片)" };
    const lines = ["最近图片分析记忆:"];
    for (const e of recent) {
      lines.push(
        `  - [${new Date(e.at).toLocaleString()}] ${String(e.attachmentId).slice(0, 16)}… 问:${e.question.slice(0, 40)} → ${e.summary.slice(0, 80)}…`,
      );
    }
    return { kind: "success", text: lines.join("\n") };
  } catch (error) {
    return { kind: "error", text: `aux: 读取图片记忆失败: ${error?.message ?? String(error)}` };
  }
}
