/**
 * dsh-aux `compress_text` tool implementation.
 *
 * @module @dolorescaritasangelus/dsh-aux/tools/compress
 */
import { compressWithPlan } from "../compression.js";

/** compress_text execution. */
export async function runCompress(service, args, exec) {
  return compressWithPlan(service, args, exec);
}
