/**
 * dsh-aux image reference resolution: attachmentId / imagePath / imageUrl →
 * a durable attachment ref ready for the vision route.
 *
 * @module @dolorescaritasangelus/dsh-aux/images/resolve
 */
import { basename, mediaTypeForPath, mediaTypeFromContentType } from "../media.js";
import { fetchWithSsrf } from "../fetch.js";

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
    // Find the durable ref in the session's user messages.
    const agent = exec.agent;
    const session = agent?.session;
    const events = session?.events ?? [];
    for (const event of events) {
      if (event.type !== "user/message") continue;
      const content = event.message?.content ?? event.data?.message?.content ?? [];
      for (const block of content) {
        if (block?.type === "image" && String(block.attachment?.attachmentId) === String(args.attachmentId)) {
          if (attachments === void 0) throw new Error("vision_analyze: no attachment service mounted");
          const stored = await attachments.readImage(block.attachment, exec.signal);
          return stored.ref;
        }
      }
    }
    throw new Error(`vision_analyze: attachment "${args.attachmentId}" not found in this session's messages`);
  }
  if (args.imagePath !== void 0 && args.imagePath.length > 0) {
    let fs;
    try {
      fs = service.ctx.get("fs");
    } catch {
      fs = void 0;
    }
    if (fs === void 0 || attachments === void 0) {
      throw new Error("vision_analyze: local image support requires the fs and attachment services");
    }
    const mediaType = mediaTypeForPath(args.imagePath);
    if (mediaType === void 0) {
      throw new Error("vision_analyze: imagePath must end in .png/.jpg/.jpeg/.webp/.gif");
    }
    const target = await fs.resolve(args.imagePath, {
      ...(exec.agent?.session?.header?.cwd !== void 0 ? { cwd: exec.agent.session.header.cwd } : {}),
      signal: exec.signal
    });
    const info = await fs.stat(target, exec.signal);
    if (info === void 0) {
      throw new Error(`vision_analyze: image not found at "${target.displayPath}"`);
    }
    if (info.type !== "file") {
      throw new Error(`vision_analyze: "${target.displayPath}" is not a regular file`);
    }
    const byteCap = Math.min(
      attachments.imageLimits.maxImageBytes,
      attachments.imageLimits.maxMessageImageBytes
    );
    const data = await fs.readBytes(target, exec.signal, byteCap);
    try {
      return await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) });
    } catch (error) {
      throw new Error(`vision_analyze: cannot read "${target.displayPath}" as ${mediaType} — the bytes may use a different format`, { cause: error });
    }
  }
  // imageUrl
  if (attachments === void 0) throw new Error("vision_analyze: no attachment service mounted");
  const { response } = await fetchWithSsrf(service, args.imageUrl, "vision_analyze", exec.signal);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`vision_analyze: fetching imageUrl failed with HTTP ${response.status}`);
  }
  const byteCap = Math.min(
    attachments.imageLimits.maxImageBytes,
    attachments.imageLimits.maxMessageImageBytes
  );
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
