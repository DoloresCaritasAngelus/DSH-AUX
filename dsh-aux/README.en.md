**English** | [简体中文](README.md)

<div align="center"><img src="../assets/deepseek-girl.png" alt="AUX" width="120" /></div>

> Hi~ I'm AUX, your auxiliary model little assistant 💙 Leave vision, web extraction, and text compression to me, and you just focus on the conversation, Master!

---

# dsh-aux — Auxiliary Model System for DSH

> Inspired by the auxiliary model mechanism of [Hermes Agent](https://github.com/NousResearch/hermes-agent),
> rebuilt from scratch with no legacy baggage as a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(DSH) plugin:
> a unified auxiliary LLM routing service + three auxiliary task tools for the main agent.
> **No sub-agents, no session collaboration** — auxiliary tasks (vision, web extraction, text compression) are handled by an independent auxiliary LLM.

[![version](https://img.shields.io/badge/version-0.1.7-blue)](https://github.com/DoloresCaritasAngelus/DSH-AUX)
[![tests](https://img.shields.io/badge/tests-161-brightgreen)](https://github.com/DoloresCaritasAngelus/DSH-AUX)
[![license](https://img.shields.io/badge/license-MIT-green)](https://github.com/DoloresCaritasAngelus/DSH-AUX)

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Integration Components & Companions](#integration-components--companions)
- [Tests](#tests)
- [Compatibility & Dependencies](#compatibility--dependencies)
- [FAQ](#faq)
- [Related Projects](#related-projects)
- [License & Acknowledgements](#license--acknowledgements)

## Features

- **Unified auxiliary LLM routing** (`ctx.auxLlm`): task dispatch, route resolution, timeout, concurrency control, failure cooldown, fallback to the main model, and aggregated errors, with full end-to-end event tracing (session events + `aux-status` projection, auditable and recoverable).
- **Three auxiliary task tools**:
  | Tool | Purpose |
  |---|---|
  | `vision_analyze` | Image analysis (attachmentId / imagePath / imageUrl), focus-hint intent awareness |
  | `web_extract` | Web page fetching and summarization (HTML cleaning, optional question) |
  | `compress_text` | Long-text compression (auto-detects code/log/doc, supports `maxOutputChars`, multi-round/hierarchical) |
- **Session compaction bridge**: adds a `compaction` auxiliary task; once configured, native DSH auto/manual context compaction goes through the AUX auxiliary model route, solving the problem of image-bearing sessions that cannot be compacted under a text-only main model.
- **`/aux` commands**: status, model configuration, image GC, vision self-test, image memory.
- **Settings page + status chip**: configure provider/model/timeout/concurrency per task in the DSH Web settings; the composer status chip shows the most recent auxiliary call.
- **Session image lifecycle management**: automatically cleans up unreferenced images when a session is deleted (event-driven + cold-session reconciliation), shared images are kept, archives are not mistakenly deleted; image memory is queryable across restarts.
- **Works with zero config**: with no tasks configured, auxiliary tasks automatically use the session's main model; to use a dedicated auxiliary model, configure it on demand in the settings page (the dropdown only lists active providers on this machine).

## Requirements

- **DSH** ≥ 0.1.0-rc.6
- **Node.js** ≥ 20

## Installation

### Method 1: One-click install (recommended, includes the image-bridge integration component)

```sh
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX && ./install.sh     # plugin wiring + image-bridge patch + settings allowlist (idempotent, re-runnable)
```

### Method 2: Plugin only (until npm is published, install from a local source tree)

```sh
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX/dsh-aux
dsh plugin --profile web add "file:$(pwd)"
# Add image-bridge (required for sending images with a text-only main model):
cd <repo>/bridge && node apply-patch.mjs
# Add the settings allowlist (so aux config is writable from the settings page):
node <repo>/bridge/patch-settings-allowlist.mjs
```

### Method 3: Manual

```sh
ln -s /path/to/dsh-aux <DSH>/node_modules/@dolorescaritasangelus/dsh-aux
# Append to cordis.patch.yml in the profile:
# - insert:
#     - id: aux
#       name: '@dolorescaritasangelus/dsh-aux'
```

Then restart DSH.

## Usage

- Call the tools directly: the main agent will use `vision_analyze` / `web_extract` / `compress_text` when needed.
- CLI: `/aux status` (routing and recent calls), `/aux model <task> [provider/model]` (view/set), `/aux vision <imagePath> <question...>` (look at an image from the CLI), `/aux test <task>` (self-test), `/aux memory [n]` (image memory), `/aux gc-images [days]` (manually reclaim old attachments).
- Settings page: Web → Settings → Auxiliary Model. You can configure a model for `vision` / `web_extract` / `compress` / `compaction`; `compaction` is the session-compaction model — once configured, native compaction routes through AUX. You can also disable "Show auxiliary model status chip in conversation UI" — when disabled, the `aux-status` projection is no longer exposed to Web/third-party readers, while `/aux status` still works.

### Programmatic calls (for other plugins)

```js
const result = await ctx.auxLlm.call("compress", {
  messages,      // DSH messages (may contain image blocks)
  system,        // optional system prompt
  session,       // session in which aux/llm-call events are recorded
  signal,        // cancellation signal (merged with the per-task timeout)
  purpose        // semantic label (e.g. "compaction")
});
// => { text, provider, model }
```

Custom tasks: `ctx.auxLlm.registerTask({ key, label, timeoutMs, maxConcurrency })`.

## Configuration

Per task: `provider` + `model` (must be paired), `timeoutMs` (default 60000), `maxConcurrency` (default 2, **hard cap 10**).
Settings-page globals: `fallbackToMain` (automatically fall back to the main model when the auxiliary model fails, enabled by default), `showStatusChip` (status chip toggle, enabled by default).
Plugin-config globals: `allowInternalUrls` (SSRF guard, default `false`), `guideText` (custom main-agent guide, trusted).

Route resolution order: explicit config (settings/plugin config) > if unconfigured → session main model.
Failure cooldown: 3 consecutive failures for the same provider+model → 60s cooldown.

**SSRF protection (on by default)**: `web_extract` and `vision_analyze`'s `imageUrl`
reject internal/loopback/cloud-metadata addresses (`localhost`, `127.0.0.1`, `10.x`,
`192.168.x`, `169.254.169.254`, `*.local`, etc.) by default and only allow `http/https`;
every redirect hop is validated before the request is sent. To fetch local/intranet
services, explicitly set `allowInternalUrls: true` in the plugin config. Auxiliary prompts
treat page content, text-to-compress, and text inside images as **untrusted data** and
explicitly forbid executing embedded instructions; `guideText` is trusted plugin config —
only copy it from trusted sources.

The `compaction` task: once provider/model is configured, the session compaction bridge is enabled — the `dsh-compaction-basic` summarization call goes through `ctx.auxLlm`. For image-bearing sessions, it is recommended to choose a model that truly supports images and has enough context (e.g. `mimo-v2.5` or `minimax-m3`).

```sh
/aux model compaction <provider>/mimo-v2.5
```

> Note: native `dsh-compaction-basic` performs a **single full summarization**, with no chunking/progressive capability.
> For very large inputs (tested to succeed in a single pass with a shadowed 449K tokens), increase
> `compaction.timeoutMs` (e.g. `300000`); the default 60s tends to time out on very large inputs.

> When compacting an image-bearing session, AUX first checks the image attachments and routing capability: if the attachment is readable and the route supports images, the image information is kept; if the attachment has been GC'd/cleaned or the route is text-only, the image is automatically degraded to a text placeholder to prevent `/compact` / auto compaction from failing entirely due to a single unavailable image.

## Integration Components & Companions

- **image-bridge (integration component)**: installed together with the plugin (install.sh runs it by default). Lets a **text-only main model** paste and send images directly, while user messages keep image thumbnails (modal-aware rewriting of the model input boundary to path text; multimodal models see images natively). It modifies npm core packages in node_modules — after `npm update`, re-run `bridge/apply-patch.mjs`; `/aux status` reports its state.
- **compaction-bridge (session compaction coordination)**: a runtime bridge that does not modify node_modules files. When the `compaction` task has a dedicated model configured, `dsh-aux` overrides `BasicCompactionEngine.prototype.summarize` so native summarization calls go through `ctx.auxLlm.call("compaction", …)`, reusing AUX's routing/timeout/concurrency/cooldown/fallback/event recording; if unconfigured, native summarization behavior is unchanged.
- **Dynamic settings exposure** (applied by install.sh): reading/writing aux config from the settings page is a **native plugin capability** — the namespace declares `exposedToWeb` on registration, implemented via dsh-settings' `listExposed()` merged dynamically with api-proxy (a local implementation of the platform's deferred work).
- **Session deletion coordination**: DSH has no native "delete session" feature; it is provided by the community plugin [dsh-plugin-session-delete](https://github.com/lsz-asd/dsh-plugin-session-delete) (Web UI delete button + risk confirmation). The two have **zero code dependency and coordinate at the event level**: the delete plugin calls `sessions.detachEntered()` → the platform broadcasts `session/disposed` → dsh-aux automatically cleans up the session's unreferenced images (with a 5-minute reconciliation fallback). Without it, all other dsh-aux capabilities are unaffected.
- **Minimal / Anchored Standard Bootstrap is by design**: before the first persisted `tool/call`, only the Minimal tool pair (`bash` + `str_replace_editor`) is exposed, and auto-injected context and hints are stripped — this is the core of these presets' "first-round trajectory anchoring", not a bug. dsh-aux **never injects any AUX context/prompt in the first round** (including image-bearing first rounds), and filters its three tools out of the assembled directory in minimal mode; after the first `tool/call` the directory opens, AUX tools appear, and a one-time hint is injected via `agent/pre-step` to guide the model to use `vision_analyze` directly, avoiding the creation of a sub-agent just to look at an image. Whether `vision_analyze` persists depends on the preset's resident directory / `dev_tool_search` unlock policy. See the design and implementation of Anchored Standard at [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main).

## Tests

```sh
node --test tests/*.test.js            # 161 tests, zero dependencies
```

## Source Layout

`src/index.js` intentionally keeps only **Service assembly and routing dispatch**; the rest lives in focused modules:

- `config.js` / `route.js` / `prompt.js` / `url-policy.js` — config, routing, prompts, SSRF policy
- `events.js` / `projection.js` / `bootstrap.js` / `commands.js` / `fetch.js` — events, projection, Bootstrap guidance, commands, fetching
- `tools/` — the three tool implementations and registration
- `images/` — attachment ownership, cleanup, image memory, image reference resolution
- `image-bridge.js` / `compaction-bridge.js` / `compaction-messages.js` — bridges and compaction message degradation

## Compatibility & Dependencies

- **Platform**: DSH ≥ 0.1.0-rc.6; Node ≥ 20.
- **Zero third-party runtime dependencies**: all peerDependencies are official DSH packages (bundled with the DSH environment), no `dependencies`; tests are likewise zero-dependency and offline.

## FAQ

### 1. Why can't I use AUX tools in the first round under "Minimal / Anchored Standard" mode?

This is **by design in the Anchored Standard Bootstrap**, not a bug: before the first persisted `tool/call`, only the Minimal tool pair (`bash` + `str_replace_editor`) is exposed and auto-injected context and hints are stripped, to achieve "first-round trajectory anchoring". dsh-aux **never injects any AUX context/prompt in the first round** (including image-bearing first rounds); after the first `tool/call` the tool directory opens, AUX tools appear, and a one-time hint is injected via `agent/pre-step` to guide the model to use `vision_analyze` directly. See [Anchored Standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main) for details.

### 2. Why do images get "degraded" to text placeholders when compacting an image-bearing session?

Before compacting, AUX checks the image attachments and routing capability: if the attachment is readable and the route supports images, the image information is kept; if the attachment has been GC'd/cleaned, or the route is text-only (a model that doesn't support images), the image is automatically degraded to a text placeholder to prevent `/compact` or auto compaction from failing entirely because of a single unavailable image. It is recommended to choose a model that truly supports images and has enough context for image-bearing sessions (e.g. `mimo-v2.5` or `minimax-m3`) and to increase `compaction.timeoutMs` accordingly (the default 60s tends to time out on very large inputs).

### 3. Why are images cleaned up when a session is deleted?

This is part of **session image lifecycle management**: when a session is deleted, its unreferenced images are automatically cleaned up (event-driven + cold-session reconciliation); shared images are kept, archives are not mistakenly deleted. Combined with the community plugin [dsh-plugin-session-delete](https://github.com/lsz-asd/dsh-plugin-session-delete) for the delete entry point, the two coordinate at the event level with zero code dependency.

## Related Projects

- [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main): Anchored Standard preset — first-round trajectory anchoring and minimal Bootstrap.
- [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit): Vision toolset.
- [dsh-plugin-session-delete](https://github.com/lsz-asd/dsh-plugin-session-delete): Session deletion plugin, coordinating with dsh-aux at the event level to clean up images.
- [SeekMaid-pet](https://github.com/DoloresCaritasAngelus/SeekMaid-pet): Desktop pet SeekMaid (DeepSeek 娘).

## License & Acknowledgements

[MIT License](./LICENSE) © 2026 dsh-aux contributors — free to use, modify, and distribute, provided the copyright notice is retained.

Design is inspired by **Hermes Agent** (auxiliary model mechanism concept), **agent-vision-toolkit** (focus-hint intent-awareness methodology, in-image text strategy), **dsh-vision** (prompt guidance and chain-of-thought block stripping), and **deepseek-harness #733** (image bridging idea). Item-by-item borrowings and differences are documented in [CONTRIBUTIONS.md](./CONTRIBUTIONS.md).
