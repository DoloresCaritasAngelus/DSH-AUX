/**
 * AUX message-image gallery: the shipped thumbnail plus a `第N/共M` badge for
 * user-pasted images.
 *
 * This file is the single source of truth. It is inlined into the shipped
 * browser bundle (`src/client.js`) by `scripts/gen-client-message-images.mjs`,
 * because a client package has exactly one bundle entry (`exports["./client"]`)
 * and the browser bundle cannot import sibling files. The generator refuses any
 * `import`/`require` in this file, so it stays dependency-free by construction.
 *
 * Retirement: disable `enabled.messageImages` (default native) or delete this
 * file plus its generated block and call site — the official attachment
 * gallery returns with no residue.
 *
 * @module @dolorescaritasangelus/dsh-aux/client/message-images
 */

/** Content blocks of one message, tolerating any shape. */
function contentBlocks(content) {
  return Array.isArray(content) ? content : [];
}

/**
 * Durable image ids of a message content array, in source order. Counts only
 * top-level image blocks: the bridge numbers exactly these, so the badge and
 * the model-facing anchor agree.
 * @param content message content blocks.
 * @returns attachment ids in order (empty for non-image content).
 */
export function contentImageIds(content) {
  const ids = [];
  for (const block of contentBlocks(content)) {
    if (block === null || typeof block !== "object" || block.type !== "image") continue;
    const attachment = block.attachment;
    const id = attachment !== null && typeof attachment === "object" ? attachment.attachmentId : void 0;
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return ids;
}

/**
 * The `第N/共M` position of one rendered image, or null when it cannot be
 * stated unambiguously.
 *
 * Only user-pasted images are numbered (`align === "end"`): the numbering
 * contract covers the message the user sent, not assistant markdown groups or
 * tool echoes. A submission-echo preview carries no durable id yet, so it is
 * never numbered. The position comes from the assembled conversation
 * (`useTrajectory().eventNodes`, the same nodes the transcript renders), matched
 * by attachment id; if the id appears in more than one user message, the answer
 * is ambiguous and no badge is shown.
 *
 * @param options.useTrajectory session standard prop (may be absent).
 * @param options.image one MessageImageSource.
 * @param options.align owner alignment.
 * @returns `{ index, total }` (1-based) or null.
 */
export function messageImageOrdinal({ useTrajectory, image, align }) {
  if (align !== "end") return null;
  if (image === null || typeof image !== "object") return null;
  const attachment = image.attachment;
  const attachmentId = attachment !== null && typeof attachment === "object" ? attachment.attachmentId : void 0;
  if (typeof attachmentId !== "string" || attachmentId.length === 0) return null;
  if (typeof useTrajectory !== "function") return null;
  let snapshot;
  try {
    snapshot = useTrajectory((value) => value);
  } catch {
    return null;
  }
  const nodes =
    snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.eventNodes) ? snapshot.eventNodes : [];
  const positions = [];
  for (const node of nodes) {
    if (node === null || typeof node !== "object") continue;
    // Only messages the user sent carry the numbering contract.
    if (node.kind !== "user" && node.kind !== "steering") continue;
    const ids = contentImageIds(node.content);
    const index = ids.indexOf(attachmentId);
    if (index >= 0) positions.push({ index: index + 1, total: ids.length });
  }
  if (positions.length !== 1) return null;
  return positions[0];
}

/**
 * Install the gallery into `conversation.message.images`.
 *
 * The shipped attachment plugin registers that single slot at the default
 * priority 0; a second registration at the same priority throws, so this entry
 * must shadow it at a LOWER priority ("lowest renders"). Disposing this entry
 * leaves the shipped one in place, which is the retirement path.
 *
 * @param options.ctx client plugin context.
 * @param options.react the bundle's React.
 * @param options.t locale lookup for this plugin's own labels.
 * @returns disposer removing the entry (idempotent).
 */
export function installMessageImages({ ctx, react, t, priority = -1 }) {
  const label = typeof t === "function" ? t : (key) => key;

  /** One thumbnail: peek first frame, load/retry, click to open the lightbox. */
  function Thumbnail(props) {
    const image = props.image;
    const load = props.load;
    const compact = props.compact === true;
    const badge = props.badge;
    const attachment = image !== null && typeof image === "object" ? image.attachment : void 0;
    const preview = image !== null && typeof image === "object" ? image.preview : void 0;
    const [src, setSrc] = react.useState(() =>
      attachment !== void 0 && typeof load.peek === "function" ? (load.peek(attachment) ?? null) : null,
    );
    const [failed, setFailed] = react.useState(false);
    const [attempt, setAttempt] = react.useState(0);
    const [open, setOpen] = react.useState(false);
    react.useEffect(() => {
      if (attachment === void 0) return void 0;
      let live = true;
      setFailed(false);
      setSrc(typeof load.peek === "function" ? (load.peek(attachment) ?? null) : null);
      void load(attachment)
        .then((url) => {
          if (live) setSrc(url);
        })
        .catch(() => {
          if (live) setFailed(true);
        });
      return () => {
        live = false;
      };
    }, [attachment, load, attempt]);
    const name =
      (preview !== void 0 && typeof preview.name === "string" ? preview.name : void 0) ??
      (attachment !== void 0 && typeof attachment.name === "string" ? attachment.name : void 0) ??
      label("messageImages.image");
    const source = preview !== void 0 && typeof preview.url === "string" ? preview.url : src;
    if (failed) {
      return react.createElement(
        "button",
        {
          type: "button",
          className: "ax-mi-error",
          "data-variant": compact ? "tile" : "single",
          title: label("messageImages.retry"),
          onClick: () => {
            setAttempt((value) => value + 1);
          },
        },
        label("messageImages.loadFailed"),
      );
    }
    const frame = react.createElement(
      "button",
      {
        type: "button",
        className: "ax-mi-frame",
        "data-variant": compact ? "tile" : "single",
        title: label("messageImages.open"),
        "aria-label": label("messageImages.openNamed") + name,
        onClick: () => {
          if (source !== null && source !== void 0) setOpen(true);
        },
      },
      source === null || source === void 0
        ? react.createElement("span", { className: "ax-mi-loading" }, label("messageImages.loading"))
        : react.createElement("img", { src: source, alt: name }),
    );
    const children = [frame];
    if (badge !== null && badge !== void 0) {
      children.push(react.createElement("span", { className: "ax-mi-badge", key: "badge" }, badge));
    }
    if (open && source !== null && source !== void 0) {
      children.push(
        react.createElement(
          "div",
          {
            className: "ax-mi-lightbox",
            key: "lightbox",
            role: "dialog",
            "aria-label": label("messageImages.lightbox"),
            onClick: () => {
              setOpen(false);
            },
          },
          react.createElement("img", { src: source, alt: name }),
        ),
      );
    }
    return react.createElement("div", { className: "ax-mi-item" }, ...children);
  }

  /** The gallery slot component: thumbnails, with badges on user images only. */
  function MessageImagesGallery(props) {
    const images = Array.isArray(props.images) ? props.images : [];
    const align = props.align === "start" ? "start" : "end";
    const compact = props.compact === true || images.length > 1;
    const t2 = (props && props.t) || label;
    if (images.length === 0) return null;
    return react.createElement(
      "div",
      { className: "ax-mi-gallery", "data-align": align },
      ...images.map((image, index) => {
        const ordinal = messageImageOrdinal({ useTrajectory: props.useTrajectory, image, align });
        return react.createElement(Thumbnail, {
          key: "image-" + index,
          image,
          load: props.loadImage,
          compact,
          // A lone image needs no disambiguation: the badge exists to let a
          // human and the model agree on "the second image", which only exists
          // when the message carries more than one.
          badge: ordinal === null || ordinal.total < 2 ? null : "第" + ordinal.index + "/共" + ordinal.total,
        });
      }),
    );
  }

  let dispose = null;
  let cancelled = false;
  ctx.slots.inject("conversation.message.images", () => {
    // The slot may mount after a disable already ran: honor the latest intent.
    if (cancelled) return () => {};
    dispose = ctx.slots.register(
      {
        name: "conversation.message.images",
        // Lower than the shipped attachment plugin's default 0: a single slot
        // refuses a same-priority second registration, and the lowest priority
        // renders.
        priority,
      },
      MessageImagesGallery,
    );
    return dispose;
  });
  return () => {
    cancelled = true;
    if (dispose === null) return;
    const current = dispose;
    dispose = null;
    current();
  };
}
