# Upstream feature requests from dsh-aux

> Requester: the `dsh-aux` plugin (auxiliary-model routing plus `vision_analyze` /
> `web_extract` / `compress_text` tools).
> Baseline: DSH **0.1.5-alpha.1** (`5dda764ed3`). Source line references are
> snapshots; behaviour statements are from that checkout.
> Status: draft for the maintainers. Not filed as an issue.

Two requests, ordered by cost to the plugin ecosystem. Both exist because the
plugin today reaches below the public surface — one through a local patch of a
shipped bundle, one through a documented-as-forbidden use of an opaque value.

---

## Request 1 — A supported "request projection" seam

### What dsh-aux needs to do

A text-only main model cannot receive `image` content blocks. When a user pastes
images into a session whose main route is text-only, the plugin replaces each
image block in the **model request only** with a text anchor:

```
[本条消息第N张/共M张, attachmentId=<sha256:…>。可用 vision_analyze 的 attachmentId 参数查看]
```

so the model knows the image exists and can call `vision_analyze` with a stable
id. The session log and the UI keep the original image; only the derived request
changes. The transformation is a pure function of the session log.

### Why the current seams do not work

| Candidate seam | Why it is not usable |
| --- | --- |
| `llm/stream` waterfall | Officially a **read-only** observation point: a loop-built request "arrives deep-frozen (mutation throws) … so listeners read it, never rewrite it" (`packages/llm/llm/src/index.ts:60-67`); `isAgentLoopRequest` identifies exactly those envelopes (`packages/llm/llm/src/call-config.ts:76`). Re-issuing a rewritten `ctx.llm.stream()` from a listener bypasses `next()` and violates the reconstructability contract. |
| `agent/pre-step` | It replaces the messages that **enter the log** (`packages/core/agent/src/runtime-types.ts:330`), so the UI would show the rewritten text instead of the image and the projection would persist — the opposite of "UI keeps the original". |
| A `tools/post-execute` hook | Only rewrites one tool result, not the user's pasted images, and runs after the log entry exists. |

Today the plugin patches the model-input boundary of the shipped agent loop
(`packages/core/agent-loop/src/agent.ts:603` — `session.deriveMessages()`, then
`markAgentLoopRequest` at `:610`). That patch must be re-cut on every release:
the anchor already moved once (`dsh-agent-loop/index.ts buildRequest` →
`core/agent-loop/src/agent.ts`), and the rewrite must stay before `deepFreeze`
to keep the frozen-message semantics intact. It is permanent maintenance debt
for a three-line semantic change, and it makes the plugin version-sensitive
against unrelated releases.

### Proposed API

Either shape is acceptable:

1. **A waterfall event**, e.g. `agent/request-projection`, invoked with the
   derived messages after `session.deriveMessages()` and before
   `markAgentLoopRequest` / `deepFreeze`; a listener may return
   `{ messages }` (a replacement list) or `undefined` to pass through.
2. **A registry of pure transforms**, e.g.
   `ctx.agentLoop.requestProjection(transform)`, where each transform maps the
   derived message list to a new one, applied in registration order.

Requirements:

- the projected list is still a pure function of the session log (same input →
  same output), so reconstructability holds;
- the session log, events and UI are untouched;
- the projection is observable for diagnostics (a debug event or an inspection
  hook naming which transforms ran);
- a transform that throws fails the request loudly rather than silently
  degrading.

### Acceptance criteria

- A plugin can replace `image` blocks for one request without patching any
  shipped package.
- With the feature unused, requests are byte-for-byte identical to today's.
- With a projection registered, the persisted session log still contains the
  original image blocks.

### Impact if not provided

The patch debt stays: every DSH release needs an anchor re-cut, a snapshot
refresh and a compatibility matrix entry, and a missed anchor degrades silently
to "the text-only model receives an image it cannot read".

---

## Request 2 — Attachment enumeration and reclamation seam

### What dsh-aux needs to do

The plugin maintains an image library over durable attachments (list, per-session
ownership, delete unreferenced objects). Deletion is only safe when the plugin
can (a) enumerate the objects that exist and (b) remove one object completely.

### Why the current seams do not work

- `AttachmentId` is explicitly opaque: "consumers must neither parse that
  representation nor derive a filesystem path from it"
  (`docs/subsystems/attachment.md:13`). `imageHostPath(ref)` is the one
  sanctioned host-path query (`docs/subsystems/attachment.md:241`,
  implementation `packages/attachment/attachment-local/src/index.ts:225`).
- There is **no enumeration and no reclamation API**. A grep of
  `packages/attachment` for `deleteAttachment`, `removeAttachment`,
  `collectAttachments` and `pruneAttachments` returns nothing in 0.1.5-alpha.1.
- The docs state the service is "retention-neutral: resumed and forked sessions
  may share objects, so reference-aware garbage collection is deferred rather
  than tied to one session's deletion" (`docs/subsystems/attachment.md:160`) —
  which is exactly the operation a consumer cannot implement correctly from the
  outside.

Consequently the plugin scans the local backend's directory tree
(`<DSH_HOME>/attachments/v1/objects/**`) and re-derives object names from the
id. That is the contract violation above; on any other backend the library
silently reports zero objects and never reclaims anything.

### Proposed API

```ts
interface AttachmentService {
  /** Enumerate stored objects, newest-agnostic, paged and cancellable. */
  list(options?: { signal?: AbortSignal; cursor?: string; limit?: number }):
    Promise<{ items: ImageAttachmentRef[]; cursor?: string }>

  /** Remove one stored object and every derived artifact of it. */
  remove(ref: ImageAttachmentRef, options?: { signal?: AbortSignal }): Promise<boolean>
}
```

- `list` returns refs (id + mediaType + bytes + dimensions are enough for
  ownership decisions); a cursor keeps it usable on large stores.
- `remove` must be idempotent (`false` when already gone) and must refuse (or
  report) when the object is still referenced by a live session, if the service
  can know that.
- If enumeration is intentionally out of scope, please instead **document the
  local backend's layout contract** (object naming, extension aliases, derived
  caches) so consumers can rely on it explicitly rather than reverse-engineering
  it.

### Deletion must cover the object and its `.ext` alias

In the local backend, `objects/<hash>` and `objects/<hash>.<ext>` are **hard
links to the same inode** (link count 2). Deleting only the extension-less object
leaves the bytes reachable through the alias and reclaims nothing; deleting only
the alias leaves the object. Any `remove` (or documented layout) must therefore
cover **the object and every derived name**, including the route-derived
`request-images/` variants, whose ids are content hashes of
(ref + policy + encoder) and are not derivable from the attachment id.

### Acceptance criteria

- A consumer can enumerate and reclaim unreferenced objects without parsing
  `AttachmentId` and without reading the storage layout.
- After `remove`, no hard link to the inode remains, and a subsequent
  `readImage` of the same ref fails with the existing
  `ATTACHMENT_NOT_FOUND`-style error.

### Impact if not provided

The plugin keeps a layout-coupled scanner (silent no-op on a different backend)
and keeps re-deriving paths from an opaque id — the two things the documentation
explicitly asks consumers not to do.

---

## Request 3 — Number (or decorate) the shipped message-image gallery

### What dsh-aux needs to do

A user can paste several images into one message. The model is told each image's
position in that message ("本条消息第N张/共M张", same order as the message
content), and the plugin would like the human to see the same numbering above
the gallery, so "the second image" means the same thing to both. The plugin must
not replace the shipped gallery to do it.

### Why the current seams do not work

- `conversation.message.images` is a **single** slot: a registration *replaces*
  the shipped gallery ("A registration replaces the shipped gallery; without
  one, images are omitted." — `packages/client/ui-chat/src/client/contract/slots.ts:190-194`).
- The owner props carry no position: `MessageImagesOwnerProps = { images,
  loadImage, align, compact? }` (`packages/client/ui-conversation/src/client/contract/slots.ts:99-108`).
  The caller *has* the index and drops it — `MessageItem.tsx:197-204` maps the
  message's attachments and passes `images: [attachment.image]` one image at a
  time; `AssistantMarkdown.tsx:112-115` passes a whole group in one call.
- Registering at the default priority **throws** while the shipped attachment
  plugin occupies the slot ("single slot … already has a registration … register
  at a different priority to shadow it (lowest renders)" —
  `packages/client/ui-slots/src/index.ts:839-843`). A decorator must therefore
  register at a negative priority, which is a takeover by construction.
- The available workaround (read `useTrajectory().eventNodes` and match
  `attachmentId`) is indirect, subscribes the gallery to the whole trajectory,
  and cannot number a submission-echo preview (it has no attachment id yet).

### Proposed API

Either is sufficient:

1. **Add the position to the owner props**: `index: number` (1-based) and
   `total: number` for the owning message's image sequence, beside the existing
   `images`/`align`/`compact`. The caller already computes both; they are pure
   data and backward compatible.
2. **Or a decoration seam**: `decorate?(source, index, total): ReactNode` (or a
   chain-shaped variant of the slot) so a third party can draw a badge around
   the shipped thumbnail without replacing it.

### Acceptance criteria

- With no third-party registration, the gallery is byte-for-byte today's.
- A plugin can add a per-image ordinal (or any small decoration) without
  reimplementing loading, retry, `peek`, the lightbox, alignment or aria labels.
- The position matches the message content order (the same order the bridge text
  numbers).

### Impact if not provided

Every tool that wants one small badge must take over the official gallery:
reimplement thumbnail loading/retry/`peek`, the lightbox and alignment, register
at a negative priority to shadow the shipped entry, and keep parity as the
shipped gallery evolves. The plugin does exactly that today, behind a switch that
defaults to the official gallery.
