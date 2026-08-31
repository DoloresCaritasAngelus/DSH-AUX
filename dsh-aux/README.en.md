<!--
  README.en.md — generated snapshot of the repo-root <../../README.en.md> (single source of truth).
  DO NOT EDIT BY HAND. Regenerate with: npm run gen-package-readme
  (runs automatically on prepack before npm pack/publish).
-->
**English** | [简体中文](README.md)

<div align="center"><img src="assets/deepseek-girl.png" alt="AUX" width="120" /></div>

<div align="center">

> Hi~ I'm AUX, your auxiliary model little helper 💙
> The main model stays focused on the chat; I take care of images, web pages, and compressing long text!
> Whenever you need me, just call me directly～

![Version](https://img.shields.io/badge/version-0.4.1-blue)
![Tests](https://img.shields.io/badge/tests-319-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/DSH-0.1.0--rc.6%20~%200.1.1--rc.1-0078D4)

</div>

# dsh-aux — Auxiliary Model System for DSH

> Give the main agent a "co-pilot": **vision analysis, web extraction, and long-text compression** are handled by a separate auxiliary LLM, so the main model stays focused on the conversation.
> It can also transparently take over your existing `subagent` / `workflow` calls—**without creating extra sub-agents** and without stealing the main model's conversation.

> 💬 "Leave these chores to me, and you just enjoy the chat~"

---

## Table of Contents

- [What is this?](#what-is-this)
- [Highlights](#highlights)
- [What can I do for you](#what-can-i-do-for-you)
- [Platform switches & SKILL modes](#platform-switches--skill-modes)
- [Quick Start](#quick-start)
- [Daily commands](#daily-commands)
- [Settings & status panel](#settings--status-panel)
- [Bridges & advanced capabilities](#bridges--advanced-capabilities)
- [Security boundaries](#security-boundaries)
- [How It Works](#how-it-works)
- [Project Layout](#project-layout)
- [Compatibility & Dependencies](#compatibility--dependencies)
- [Documentation](#documentation)
- [FAQ](#faq)
- [Related Projects](#related-projects)
- [License](#license)

---

## What is this?

Models keep getting stronger, but handing "look at this image", "read this page", "compress this long text" to the main model interrupts the flow and burns context. **dsh-aux** routes those chores to a **separate auxiliary LLM**: you just send the request, and it automatically routes to the right model—the main model answers your conversation, while the auxiliary model takes care of "look at this image", "summarize this page", "compress these 50k words".

- **Unified auxiliary LLM routing**: per-task model / timeout / concurrency / reasoning effort.
- **Zero-config by default**: works without any model configuration; falls back to the session's main model.
- **Observable**: every call is written to the session log; visible through `/aux status`, the settings page, and the status chip.

## Highlights

| Feature | Description |
|---|---|
| **Four ready-to-use tools** | `vision_analyze`, `web_extract`, `web_crawl`, `compress_text` |
| **Unified routing & fallback** | Per-task model/timeout/concurrency; fallback to the main model on failure, cooldown after repeated failures |
| **Platform switches** | Each tool/bridge can be `native` / `aux`; `compat` is reserved for the future |
| **SKILL audit** | Four modes: `native` / `audit` / `report` / `report-ondemand` |
| **Subagent / workflow bridge** | Native `subagent` and parallel `agent()` children of `workflow` transparently use AUX |
| **Skill pre-audit bridge** | An auxiliary model reads SKILL.md + current task first and returns a pre-audit report |
| **Compaction bridge** | With a `compaction` task configured, native auto/manual compaction routes through AUX |
| **Settings + status panel** | Grouped and collapsible, bilingual; full platform status, patch diagnostics, one-click repair, and restart detection |
| **Session image lifecycle** | Deleting a session cleans up unreferenced images; shared images are preserved; image memory survives restarts |
| **Zero third-party runtime deps** | peerDependencies are all official DSH packages |

## What can I do for you

| Tool | What it does | Typical use |
|---|---|---|
| `vision_analyze` | Image analysis (parallel multi-image) | "What's in this image?" "Read the chart values" |
| `web_extract` | Web page fetch + summary (same-origin recursion) | "Summarize this page" "Answer a question from this page" |
| `web_crawl` | Site-wide deep crawl + overall summary | "Crawl the whole docs site and summarize" |
| `compress_text` | Long-text compression (code/log/doc aware) | Compress logs, docs, or very long context |

> 💬 "Seeing images, reading pages, compressing long text—all my specialties!"

<details>
<summary><b>Full tool parameters (click to expand)</b></summary>

### web_extract

| Parameter | Default | Description |
|---|---|---|
| `url` | required | The page to fetch |
| `question` | — | Optional follow-up to focus the answer |
| `maxChars` | 32000 | Page character budget |
| `followLinks` | `off` | `same-origin` recursively follows in-origin links |
| `maxPages` / `maxDepth` | 3 / 1 | Recursive page / depth limits (`0` = seed only) |

- **Output**: single page returns `summary` / `keyPoints` + `chars` / `truncated`; recursion adds `pages`, `totalChars`.
- **Boundary**: static-HTML summary agent—does not execute JS; cannot click/paginate/fill forms.
- **Recursion**: uses the same crawl engine as `web_crawl`, honoring robots.txt, rate limits, and per-hop SSRF checks.

### web_crawl

| Parameter | Default | Description |
|---|---|---|
| `url` | required | Starting seed page |
| `scope` | `same-origin` | Crawl scope; `hosts` only crawls listed hosts |
| `hosts` | — | Allowed hosts when `scope=hosts` |
| `seedUrls` | — | Extra depth-0 seeds (still SSRF-checked) |
| `maxPages` / `maxDepth` | 10 / 2 | Page limit / link depth limit |
| `maxCharsPerPage` | 32000 | Per-page character budget |
| `respectRobots` | true | Honors robots.txt |
| `minIntervalMs` | 250 | Minimum interval between requests to the same host |
| `useSitemap` | false | Seeds from `<origin>/sitemap.xml` |
| `maxPagesPerHost` | 0 (unlimited) | Per-host page limit |
| `perPageSummaries` | false | false=aggregate summary; true=per-page summaries |

**Two summary modes**

| Mode | How it summarizes | Cost |
|---|---|---|
| **A (default)** | One call over all pages → overall summary + page list | 1 call |
| **B** | Per-page summaries, then aggregate | ≈ pages + 1 call |

</details>

### Cleaning & anti-crawl (zero dependencies)

- **Encoding**: decodes via `Content-Type` / `<meta charset>`; GBK/GB18030 etc. remain intact.
- **JS Challenge**: detects Cloudflare/challenge shells → returns `browserRequired`, does not burn tokens, suggests a browser.
- **429 / 502-504**: retries once with a short backoff; if it still fails, reports a rate-limited error.
- **403 and other 4xx**: returns a "may need a browser / login" message instead of feeding empty content to the auxiliary model.
- **Redirects**: follows each hop with SSRF checks and exposes the `redirects` count.
- **Proxy**: direct connection first; automatically falls back to `HTTP(S)_PROXY` (respecting `NO_PROXY`), zero dependencies.

## Platform switches & SKILL modes

This is the core v0.4.0 experience: AUX is no longer "automatic but opaque"—it is **configurable, disablable, and explainable**.

### Tool / bridge three-state switches

| Mode | Behavior |
|---|---|
| `native` | AUX off; DSH native behavior; AUX tools hidden from the model |
| `aux` | AUX on; use our implementation / bridge |
| `compat` | **Reserved for the future**, currently unavailable and disabled in the UI |

Applies to: `vision_analyze`, `web_extract`, `web_crawl`, `compress_text`, `imageBridge`, `subagentBridge`, `workflowBridge`, `compactionBridge`, `skillAudit`.

> 💬 "Don't want me in the way? One click back to native~"

### SKILL audit modes

| Mode | Behavior |
|---|---|
| `native` | No interception, native pass-through |
| `audit` | Auxiliary model audits SKILL.md + current task first, then the main model acts |
| `report` | Returns only the audit report, no execution |
| `report-ondemand` | Fetches the original text on demand (`includeOriginal: true`) |

### Diagnostics & repair panel

The settings page top shows each tool/bridge's **status dot, patch badge, and unavailable reason**; when a patch is missing you can re-apply it in one click, and it reminds you to restart DSH afterward. Status data is read through the hidden `aux/platform-status` event + `aux-platform` projection (a non-command channel, so it does not generate `/aux status --json` command cards in the session).

> 💬 "If something's off, I'll light up and tell you~"

## Quick Start

```sh
# Option 1: clone and install everything (recommended, includes image-bridge)
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX && ./install.sh

# Option 2: install the plugin package from a local source tree (use this until npm is published)
git clone https://github.com/DoloresCaritasAngelus/DSH-AUX.git
cd DSH-AUX/dsh-aux
dsh plugin --profile web add "file:$(pwd)"
```

After restarting DSH:

1. Send an image to the agent and it will describe it with `vision_analyze` (even a text-only main model can receive images—image-bridge is integrated);
2. Run `/aux status` to see each task's route;
3. Want vision to use a dedicated model? `/aux model vision <provider>/mimo-v2.5`.

> 💬 "Once installed, just call me~"

### Updating (GitHub installs)

```sh
./update.sh                # pull latest code + re-wire (idempotent)
./update.sh --no-pull      # if you already updated the source, just re-wire
node scripts/doctor.mjs    # post-update health check (does not modify anything)
```

> Why isn't `git pull` enough? dsh-aux's bridge patches and start-up self-heal hook live in the DSH deployment (`node_modules` / `start-dsh.sh`); `git pull` only updates the source. `./update.sh` re-runs `install.sh` to write new patches / self-heal hooks into the deployment.

## Daily commands

| Command | Purpose |
|---|---|
| `/aux status` | Show task routes and recent calls |
| `/aux status --json` | Structured platform status (for settings/diagnostics) |
| `/aux history [N]` | Brief trace: last N auxiliary calls (default 10) |
| `/aux history full [N]` | Full event fields |
| `/aux debug [N]` | View AUX content-truth / debug events |
| `/aux debug <target> [N]` | Cross-session view (@this / session id / prefix / cwd) |
| `/aux patch` | Install all patches required by the current DSH and self-heal |
| `/aux patch --json` | Same, with structured step results |
| `/aux model <task> [provider/model]` | View / set a task's auxiliary model |
| `/aux vision <path> <question...>` | Directly view an image from the command line |
| `/aux test <task>` | Self-test a task route |
| `/aux memory [n]` | View recent image analysis memory |
| `/aux gc-images [days]` | Manually reclaim old attachment images |

## Settings & status panel

### Why look here first?

Some AUX bridges need platform patches to work fully (`image-bridge`, `subagent` / `workflow`, `compaction`, `skill`, etc.). The old experience led users into two traps:

- not knowing whether a patch is actually required;
- not knowing whether their patch is actually installed.

This settings page turns both into **visible status**: it tells you each tool/bridge's current state, whether a patch is missing, and what to do about it. The platform switches turn "are patches required or optional?" from a philosophy question into a **configurable choice**:

| Mode | Patch relationship |
|---|---|
| `native` | No AUX patch needed; uses native DSH |
| `aux` | Needs the corresponding patch; if missing, the status panel marks it and offers one-click repair |
| `compat` | Reserved for the future, currently unavailable |

> 💬 "Is the patch installed? Don't guess—I'll tell you directly~"

### 3-step getting started

1. **Restart DSH** after installing;
2. Open Web → Settings → Auxiliary Models;
3. Look at the **Diagnostics & Repair** panel at the top:
   - Status normal: you're ready to go;
   - Patch missing / abnormal: click **one-click repair**;
   - After repair, it tells you to **restart DSH for the patch to take effect**; restart and come back to confirm the status is healthy.

### What else the settings page can do

Web → Settings → Auxiliary Models. Configure per-task model, timeout, concurrency, `maxChars`, and **reasoning effort** for `vision` / `web_extract` / `web_crawl` / `compress` / `compaction` / `skill`. The page is grouped into collapsible "Tool Tasks / Bridge Tasks / Subagents / Global / Platform Switches" sections and follows the DSH language (zh/en).

- **Status chip**: the composer shows the latest auxiliary call (task, duration, whether it fell back).
- **Diagnostics & repair**: each tool/bridge shows a status dot, patch badge, and unavailable reason; missing patches can be re-applied in one click, with restart detection after writing.
- **Platform switches**: tools and bridges can switch `native` / `aux` / `compat`; turn off AUX anywhere you don't want it.
- **SKILL audit modes**: `native` / `audit` / `report` / `report-ondemand`.
- **Privacy**: you can turn off "Show auxiliary model status chip in conversation UI"; when off, the `aux-status` projection is no longer exposed to Web/third-party readers, while `/aux status` still works.

## Bridges & advanced capabilities

### Subagent / workflow bridge

The native `subagent` tool and the parallel `agent()` children fanned out by `workflow` are **transparently bridged** to AUX—you keep using `subagent` / `workflow` as usual, but the actual work is done by the AUX auxiliary model. **Zero new tools, zero system-prompt changes.**

| Mode | Which model subagents use |
|---|---|
| `native` (default) | No interception; fully native / main-model behavior |
| `manual` | All subagents use the `subagent.general` model |
| `vision-aware` | Uses `subagent.vision` when vision is needed, otherwise `general` |

> 💬 "Hand your subagents to me too—I won't talk over them, just help~"

<details>
<summary><b>Subagent config example (click to expand)</b></summary>

```yaml
aux:
  subagent:
    mode: vision-aware        # native | manual | vision-aware
    general: { provider: opencode-go, model: glm-5.2, reasoningEffort: high }
    vision:  { provider: opencode-go, model: kimi-k2.7-code, reasoningEffort: high }
    includeWorkflow: true      # workflow parallel agent() children also use AUX
    prepareTools: true         # inject vision_analyze etc. into subagents as a fallback
    visionKeywords: [ "image", "picture", "screenshot" ]
    retryVisionWithAux: false  # reserved experimental config, not implemented yet
```

</details>

### Skill pre-audit bridge (skill-audit)

DSH's native flow is "main model sees catalog → calls `skill` → directly executes SKILL.md". dsh-aux inserts an **auxiliary-model due-diligence** step:

```
Main model sees catalog → decides to call skill → native skill tool loads SKILL.md
    ↓
AUX intercepts → auxiliary model reads SKILL.md + current task
    ↓
Returns "how to apply / known pitfalls / 🔻rot-prone stale assertions / execution advice"
    ↓
Main model sees both "original SKILL.md + pre-audit report" → verifies → truly executes
```

- **Enable**: only intercepts after you configure a dedicated auxiliary model in settings or `/aux model skill <provider>/<model>`; without it, native pass-through.
- **Does not own skills**: dsh-aux does not create/manage skills; that remains the native or memory-management plugin's job.
- **Fail-soft**: if the auxiliary call fails, the original SKILL.md is returned and the main model is not blocked.

### Compaction bridge

Configure a `compaction` task and native DSH auto/manual compaction routes through the AUX model, reusing AUX timeout/concurrency/cooldown/fallback/event tracing. In image-containing sessions, if images are unavailable, they are downgraded to text placeholders and compaction does not fail.

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

## Security boundaries

- **SSRF protection (on by default)**: `web_extract`, `web_crawl`, and `vision_analyze`'s `imageUrl` reject internal/loopback/cloud-metadata addresses by default; the fallback fetch path validates **every redirect hop before sending**. To fetch local/intranet services, explicitly set `allowInternalUrls: true`.
- **Prompt injection mitigation**: page bodies, compressed text, and text inside images are treated as **untrusted data**, physically separated from the trusted `Question` instructions, with embedded instructions explicitly forbidden.
- **Concurrency hard cap**: even if `maxConcurrency` is configured higher, each task is capped at **10**.

> 💬 "Suspicious pages and instructions? I'll block them first and call you~"

## How It Works

- **Route resolution**: explicit config > task default > session main model; on auxiliary failure, automatically falls back to the main model.
- **Robustness**: per-task timeout (default 60s), concurrency semaphore (default 2), failure cooldown (3 consecutive failures → stop 60s), error classification, and aggregated error reporting per attempt.
- **Observability**: every call writes an `aux/llm-call` session event + `aux-status` projection, replayable from history.
- **Image capability gate**: checks model input capabilities before calling; explicitly unsupported models are skipped; unknown capabilities are passed to the provider.
- **Compaction synergy**: `dsh-compaction-basic` summaries can run through `ctx.auxLlm`'s `compaction` task.

## Project Layout

- `dsh-aux/src/` — plugin core (routing, tools, bridges, status/commands, client UI)
- `bridge/` — platform patches, self-heal, install scripts
- `tests/` — full test suite
- `scripts/` — doctor and README generator
- `assets/` — mascot images

## Compatibility & Dependencies

- **Platform**: DSH 0.1.0-rc.6 ~ 0.1.2-alpha.2 (verified on rc.6 / rc.7 / rc.8 / 0.1.1-rc.1 / rc.2 / 0.1.2-alpha.2); Node ≥ 20.
- **Zero third-party runtime deps**: peerDependencies are all official DSH packages (bundled with the platform); no `dependencies`.
- **Zero test deps**: `node --test tests/*.test.js` (319 tests; file list and baseline in `TESTING.md`).

### Integrated components

- **image-bridge**: lets text-only main models receive pasted images while keeping thumbnails; re-run `bridge/apply-patch.mjs` after `npm update`.
- **settings dynamic exposure**: the settings page can read/write aux config; corresponding patches are shipped in this repo's `bridge/`.
- **session event registration channel**: `aux/llm-call` is written with `ignorable: true`; if the patch is missing, events are downgraded (not written) to protect session logs.
- **session deletion synergy**: works with `dsh-plugin-session-delete` to clean up unreferenced images when a session is deleted.
- **subagent-bridge**: transparently takes over native `subagent` and `workflow` parallel `agent()` children.

### Minimal / Anchored Standard compatibility

Before the first persistent `tool/call`, only the Minimal tool pair is exposed and auto-injected context is stripped. dsh-aux **never injects AUX context/prompts in the first turn**; after the first `tool/call`, the tool directory opens, AUX tools appear, and a one-time `agent/pre-step` hint guides direct use of `vision_analyze`.

## Documentation

| Doc | Content |
|---|---|
| [CHANGELOG.md](./CHANGELOG.md) | Version history |
| [TESTING.md](./TESTING.md) | Test file list and baseline |
| [PRD.md](./PRD.md) | Requirements & design decisions |
| [WEB-CRAWL-DESIGN.md](./WEB-CRAWL-DESIGN.md) | Site crawl design |
| [SUBAGENT-BRIDGE.md](./SUBAGENT-BRIDGE.md) | Subagent bridge design |
| [WORKFLOW-BRIDGE.md](./WORKFLOW-BRIDGE.md) | Workflow bridge design |
| [AI.md](./dsh-aux/AI.md) | AI agent install guide |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution guide |

## FAQ

**Q1: Why can't I see `vision_analyze` and other AUX tools in the first turn of Minimal / Anchored Standard?**

Those presets expose only the Minimal tool pair before the first persistent `tool/call` and strip auto-injected context. dsh-aux respects this and **never injects AUX context/prompts in the first turn**, nor exposes its tools early. After the first `tool/call`, the tool directory opens and AUX tools appear.

**Q2: Why did `/compact` fail in an image-containing session?**

If the image block's attachment object has already been GC/cleaned, or none of the available compaction routes support image input, images are unavailable for compaction. dsh-aux then **downgrades images to text placeholders** and continues compacting through AUX, so compaction normally does not fail.

**Q3: Do I need to configure a model for dsh-aux?**

No. dsh-aux is **zero-config**: it works without any model configuration and falls back to the session's main model. You can assign a dedicated model later via the settings page or `/aux model <task> <provider/model>`.

## Related Projects

- [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main) — Anchored Standard preset
- [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) — community vision toolkit
- [dsh-plugin-session-delete](https://github.com/lsz-asd/dsh-plugin-session-delete) — session deletion plugin
- [SeekMaid-pet](https://github.com/DoloresCaritasAngelus/SeekMaid-pet) — DeepSeek desktop pet

## License

[MIT License](./LICENSE) © 2026 dsh-aux contributors
