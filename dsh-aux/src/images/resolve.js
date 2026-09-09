/**
 * dsh-aux image reference resolution: attachmentId / imagePath / imageUrl →
 * a durable attachment ref ready for the vision route.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/resolve
 */
import {
  basename,
  extensionForPath,
  mediaTypeForPath,
  mediaTypeFromContentType,
  sniffImageMediaType,
} from "../media.js";
import { fetchWithSsrf } from "../fetch.js";
import { sessionEvents } from "../session-utils.js";
import { sessionImageRefs } from "./refs.js";

/** Read a response body as bytes, aborting as soon as the cap is exceeded. */
async function readBytesCapped(response, byteCap) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > byteCap) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`vision_analyze: image is ${contentLength} bytes, exceeding the ${byteCap}-byte limit`);
  }
  const reader = response.body?.getReader?.();
  if (reader === void 0) {
    const buf = await response.arrayBuffer();
    if (buf.byteLength > byteCap) {
      throw new Error(`vision_analyze: image is ${buf.byteLength} bytes, exceeding the ${byteCap}-byte limit`);
    }
    return new Uint8Array(buf);
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > byteCap) {
      await reader.cancel().catch(() => {});
      throw new Error(`vision_analyze: image exceeds the ${byteCap}-byte limit`);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

/** Resolve an image reference from attachmentId / imagePath / imageUrl. */
export async function resolveImageRef(service, args, exec) {
  let attachments;
  try {
    attachments = service._imageCtx?.get("attachments") ?? service.ctx.get("attachments");
  } catch {
    attachments = void 0;
  }
  if (args.attachmentId !== void 0 && args.attachmentId.length > 0) {
    // Search every message-producing event, recursing into tool results: a
    // tool-produced image (read_image, the vision_analyze echo) is referenced
    // by the same durable id but never appears in a user message.
    const agent = exec.agent;
    const session = agent?.session;
    const wanted = String(args.attachmentId);
    const found = sessionImageRefs(sessionEvents(session)).find((ref) => String(ref.attachmentId) === wanted);
    if (found !== void 0) {
      if (attachments === void 0) throw new Error("vision_analyze: no attachment service mounted");
      try {
        const stored = await attachments.readImage(found, exec.signal);
        return stored.ref;
      } catch (error) {
        throw new Error(
          `vision_analyze: attachment "${wanted}" is referenced by this session but its stored image is no longer available — it may have been reclaimed by attachment GC`,
          { cause: error },
        );
      }
    }
    throw new Error(`vision_analyze: attachment "${wanted}" not found in this session's messages`);
  }
  if (args.imagePath !== void 0 && args.imagePath.length > 0) {
    // Path confinement/symlink safety is intentionally delegated to the host
    // `fs` service: it owns the workspace sandbox and cwd resolution. The
    // plugin must not re-implement or bypass that boundary.
    let fs;
    try {
      fs = service.ctx.get("fs");
    } catch {
      fs = void 0;
    }
    if (fs === void 0 || attachments === void 0) {
      throw new Error("vision_analyze: local image support requires the fs and attachment services");
    }
    // A recognized extension declares the format; an extension-less path
    // declares nothing and has its leading bytes sniffed after the read. An
    // unknown non-empty extension is refused before any I/O, mirroring
    // read_image: only the four supported extensions (or no extension at all)
    // are accepted.
    const declared = mediaTypeForPath(args.imagePath);
    const extension = extensionForPath(args.imagePath);
    if (declared === void 0 && extension !== "") {
      throw new Error(
        `vision_analyze: imagePath "${args.imagePath}" uses the ${extension} extension, which is not a supported image format — use .png/.jpg/.jpeg/.webp/.gif, or an extension-less file whose content is one of those formats`,
      );
    }
    const target = await fs.resolve(args.imagePath, {
      ...(exec.agent?.session?.header?.cwd !== void 0 ? { cwd: exec.agent.session.header.cwd } : {}),
      signal: exec.signal,
    });
    const info = await fs.stat(target, exec.signal);
    if (info === void 0) {
      throw new Error(`vision_analyze: image not found at "${target.displayPath}"`);
    }
    if (info.type !== "file") {
      throw new Error(`vision_analyze: "${target.displayPath}" is not a regular file`);
    }
    const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes);
    const data = await fs.readBytes(target, exec.signal, byteCap);
    const sniffed = sniffImageMediaType(data);
    const mediaType = declared ?? sniffed;
    if (mediaType === void 0) {
      throw new Error(
        `vision_analyze: "${target.displayPath}" is not a supported image — the path declares no image extension and the bytes match none of the PNG/JPEG/WebP/GIF signatures`,
      );
    }
    // A declared extension that disagrees with the bytes is refused with both
    // facts named; a silent save would store the image under the wrong type.
    if (declared !== void 0 && sniffed !== void 0 && sniffed !== declared) {
      throw new Error(
        `vision_analyze: "${target.displayPath}" declares ${declared} by its extension, but the bytes are ${sniffed} — rename the file to match its actual format or convert it`,
      );
    }
    try {
      return await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) });
    } catch (error) {
      throw new Error(
        `vision_analyze: cannot read "${target.displayPath}" as ${mediaType} — the bytes may use a different format`,
        { cause: error },
      );
    }
  }
  // imageUrl
  if (attachments === void 0) throw new Error("vision_analyze: no attachment service mounted");
  const { response } = await fetchWithSsrf(service, args.imageUrl, "vision_analyze", exec.signal);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`vision_analyze: fetching imageUrl failed with HTTP ${response.status}`);
  }
  const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes);
  const data = await readBytesCapped(response, byteCap);
  const mediaType = mediaTypeFromContentType(response.headers.get("content-type"));
  if (mediaType === void 0) {
    throw new Error("vision_analyze: imageUrl did not resolve to a supported image type");
  }
  try {
    return await attachments.saveImage({ data, mediaType });
  } catch (error) {
    throw new Error("vision_analyze: downloaded bytes are not a valid supported image", { cause: error });
  }
}
