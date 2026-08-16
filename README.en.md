# dsh-aux — Auxiliary Model System for DSH

**English** | [简体中文](README.md)

> Give the main agent a "co-pilot": **vision analysis, web extraction, and long-text compression** are handled by a separate auxiliary LLM, so the main model stays focused on the conversation. No sub-agents, no session orchestration — install and it just works, zero configuration.

---

## Why

Conversation models are getting stronger, but "look at this image", "read this page", and "compress this long text" can interrupt the flow and burn context. dsh-aux delegates these side tasks to an **auxiliary model**: you just ask, and the plugin routes to the right model behind the scenes — the main model answers you, the auxiliary model "takes a look", "summarizes the page", or "compresses 50K characters".

## Key Features

| Feature | Description |
|---|---|
| **Unified auxiliary LLM routing** | Per-task model/timeout/concurrency; automatic fallback to the main model; failure cooldown; every call is recorded as a session event for auditability |
| **Three ready-to-use tools** | `vision_analyze` (image analysis), `web_extract` (page extraction + summary), `compress_text` (long-text compression) |
| **Session compaction bridge** | Once the `compaction` task is configured, native DSH automatic/manual compaction routes through the AUX model; image degradation keeps compaction working even when attachments are missing or the route is text-only |
| **`/aux` commands** | Status, model switching, image GC, vision self-test, image memory |
| **Web settings + status chip** | Per-task model dropdowns; composer shows the latest auxiliary call |
| **Session image lifecycle** | Deleted sessions clean up unreferenced images; shared images are preserved; image memory survives restarts |
| **Zero-config** | Works without any model configuration — auxiliary tasks automatically use the session's main model |

### The Three Tools

| Tool | What it does | Typical use |
|---|---|---|
| `vision_analyze` | Image analysis (multi-image parallel) | "What's in this image?" "Read the chart values" "Compare two images" |
| `web_extract` | Fetch + summarize web pages | "Summarize this page" "Answer from this page" |
| `compress_text` | Long-text compression (preserves numbers/paths/identifiers) | Compress logs, docs, or context |

## Quick Start

```sh
# Option 1: clone and install everything (recommended, includes image-bridge)
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX && ./install.sh

# Option 2: plugin only
dsh plugin --profile web add git+https://github.com/DoloresCaritasAngelus/DSH-AUX.git
```

After restarting DSH:

1. Send an image to the agent — it will use `vision_analyze` to describe it (text-only main models work too; image-bridge is included);
2. Run `/aux status` to see per-task routes;
3. Want a dedicated vision model? `/aux model vision volcengine-ark/doubao-seed-2.0-lite`.

## Usage

### Commands

| Command | Purpose |
|---|---|
| `/aux status` | Show routes and recent auxiliary calls |
| `/aux model <task> [provider/model]` | View/set a task's auxiliary model |
| `/aux vision <path> <question...>` | Analyze an image from the command line |
| `/aux test <task>` | Self-test a task route |
| `/aux memory [n]` | Show recent image analysis memory |
| `/aux gc-images [days]` | Manually reclaim old attachment images |

### Settings

Web → Settings → Auxiliary Models

### Programmatic API (for plugin developers)

```js
const result = await ctx.auxLlm.call("compress", {
  messages,
  system,
  session,
  signal
});
// => { text, provider, model }
```

Custom tasks: `ctx.auxLlm.registerTask(...)`.

## How It Works

- **Route resolution**: explicit config > task default > session main model; auxiliary failure falls back to the main model.
- **Robustness**: per-task timeout (default 60s), concurrency semaphore (default 2), failure cooldown (3 consecutive failures → 60s pause), error classification, and aggregate errors with per-attempt details.
- **Observability**: every call writes an `aux/llm-call` session event + `aux-status` projection, replayable from history.
- **Image capability gate**: checks model input capabilities before calling; explicitly unsupported models are skipped. Unknown capabilities pass through to the provider.
- **Compaction synergy**: `dsh-compaction-basic` summarization can run through `ctx.auxLlm`'s `compaction` task, reusing AUX timeout/concurrency/cooldown/fallback/event tracing.

## Compatibility & Dependencies

- **Platform**: DSH ≥ 0.1.0-rc.6; Node ≥ 20.
- **Zero runtime third-party dependencies**: all peerDependencies are official DSH packages; no `dependencies`.
- **Zero-dependency tests**: `node --test tests/aux.test.js` (87) + `node --test tests/memory-race.test.js` (1) + `node --test tests/bridge.test.js` (4).

### Integrated Components

- **image-bridge**: lets text-only main models paste images directly while the UI keeps thumbnails; re-run `bridge/apply-patch.mjs` after `npm update`.
- **Settings dynamic exposure**: the Web settings page can read/write aux config; the patch ships in this repo's `bridge/` and does not require upstream deepseek-harness changes.
- **Session event channel**: `aux/llm-call` events are written with `ignorable: true`; without the patch the plugin degrades to not writing events, protecting session logs.
- **Session delete synergy**: works with the community plugin dsh-plugin-session-delete to clean up unreferenced images when a session is deleted.
- **compaction-bridge**: once `compaction` is configured, native compaction routes through AUX; unusable images are degraded to text placeholders so compaction never fails outright.

### Minimal / Anchored Standard Compatibility

Before the first durable `tool/call`, these presets expose only the Minimal tool pair and strip auto-injected context — that is the core of their first-round trajectory anchoring. dsh-aux **never injects any AUX context/prompt on the first round**; after the first `tool/call`, the catalog opens, AUX tools appear, and a one-time `agent/pre-step` reminder guides the model to use `vision_analyze` directly instead of spawning a sub-agent. See [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main) for the Anchored Standard design.

## Documentation

| Doc | Content |
|---|---|
| [AI.md](./dsh-aux/AI.md) | Installation guide for AI agents |
| [PRD.md](./PRD.md) | Requirements & design decisions |
| [CHANGELOG.md](./CHANGELOG.md) | Version history |
| [COMPARISON.md](./COMPARISON.md) | Architecture comparison with community vision plugins |
| [VISION-AGENT.md](./VISION-AGENT.md) | Vision sub-agent strategy & memory architecture |
| [SESSION-ATTACHMENT-GC.md](./SESSION-ATTACHMENT-GC.md) | Image cleanup design on session delete |
| [CONTRIBUTIONS.md](./CONTRIBUTIONS.md) | Acknowledgments & inspirations |

## Acknowledgments

Inspired by **Hermes Agent**, **agent-vision-toolkit**, **dsh-vision**, **deepseek-harness #733**, and the **DeepSeek Harness** platform. See [CONTRIBUTIONS.md](./CONTRIBUTIONS.md) for details.

## License

[MIT License](./LICENSE) © 2026 dsh-aux contributors
