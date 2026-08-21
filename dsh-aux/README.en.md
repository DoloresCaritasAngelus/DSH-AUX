<!--
  README.en.md — generated snapshot of the repo-root <../../README.en.md> (single source of truth).
  DO NOT EDIT BY HAND. Regenerate with: npm run gen-package-readme
  (runs automatically on prepack before npm pack/publish).
-->
**English** | [简体中文](README.md)

<div align="center"><img src="assets/deepseek-girl.png" alt="AUX" width="120" /></div>

> Hi~ I'm AUX, your auxiliary model little helper 💙
> The main model stays focused on the chat; I take care of images, web pages, and compressing long text!
> Whenever you need me, just call me directly～

<div align="center">

![Version](https://img.shields.io/badge/version-0.3.2-blue)
![Tests](https://img.shields.io/badge/tests-291-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/DSH-0.1.0--rc.6%20~%200.1.1--rc.1-0078D4)

</div>

# dsh-aux — Auxiliary Model System for DSH

> Give the main agent a "co-pilot": **vision analysis, web extraction, and long-text compression** are handled by a separate auxiliary LLM, so the main model stays focused on the conversation. No sub-agents, no session orchestration — install and it just works, zero configuration.

---

## Table of Contents

- [Why](#why)
- [Key Features](#key-features)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [How It Works](#how-it-works)
- [Compatibility & Dependencies](#compatibility--dependencies)
- [FAQ](#faq)
- [Related Projects](#related-projects)
- [Documentation](#documentation)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Why

Conversation models are getting stronger, but "look at this image", "read this page", and "compress this long text" can interrupt the flow and burn context. dsh-aux delegates these side tasks to an **auxiliary model**: you just ask, and the plugin routes to the right model behind the scenes — the main model answers you, the auxiliary model "takes a look", "summarizes the page", or "compresses 50K characters".

## Key Features

| Feature | Description |
|---|---|
| **Unified auxiliary LLM routing** | Per-task model/timeout/concurrency; automatic fallback to the main model; failure cooldown; every call is recorded as a session event for auditability |
| **Four ready-to-use tools** | `vision_analyze` (image analysis), `web_extract` (page extraction + summary), `web_crawl` (site deep-crawl + overall summary), `compress_text` (long-text compression) |
| **Session compaction bridge** | Once the `compaction` task is configured, native DSH automatic/manual compaction routes through the AUX model; image degradation keeps compaction working even when attachments are missing or the route is text-only |
| **Subagent / workflow bridge** | The native `subagent` tool and `workflow`'s parallel `agent()` children transparently route to AUX (native / manual / vision-aware); no new tools, no system-prompt changes |
| **Skill pre-audit bridge** | Once the `skill` aux model is configured, native `skill` calls are first audited by the auxiliary model (SKILL.md + current task), returning "how to apply / known pitfalls / 🔻rot-prone assertions / execution advice"; the main model can verify against the original text |
| **`/aux` commands** | Status, model switching, image GC, vision self-test, image memory |
| **Web settings + status chip** | Grouped collapsible settings; per-task model/timeout/concurrency/reasoning effort; bilingual zh/en following DSH locale; composer shows the latest auxiliary call |
| **Session image lifecycle** | Deleted sessions clean up unreferenced images; shared images are preserved; image memory survives restarts |
| **Zero-config** | Works without any model configuration — auxiliary tasks automatically use the session's main model |

### The Four Tools

| Tool | What it does | Typical use |
|---|---|---|
| `vision_analyze` | Image analysis (multi-image parallel) | "What's in this image?" "Read the chart values" "Compare two images" |
| `web_extract` | Fetch + summarize web pages (supports `followLinks` same-origin recursion) | "Summarize this page" "Answer from this page" "Summarize this doc site" |
| `web_crawl` | Deep-crawl a site + overall summary (scope/robots/rate limits/budgets) | "Crawl the whole docs site and summarize" "List all API endpoints on the docs site" |
| `compress_text` | Long-text compression (auto-detects code/log/doc, supports output budget, multi-round/hierarchical) | Compress logs, docs, or oversized context |

## Requirements

- **DSH** 0.1.0-rc.6 ~ 0.1.1-rc.1 (verified rc.6 / rc.7 / rc.8 / 0.1.1-rc.1)
- **Node.js** ≥ 20
- **Zero runtime third-party dependencies**: all peerDependencies are official DSH packages (shipped with the environment); there is no `dependencies` block, so no extra third-party runtime packages are needed.

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

1. Send an image to the agent — it will use `vision_analyze` to describe it (text-only main models work too; image-bridge is included);
2. Run `/aux status` to see per-task routes;
3. Want a dedicated vision model? `/aux model vision <provider>/mimo-v2.5`.

## Updating (GitHub installs)

```sh
# Recommended: pull latest code and re-wire (idempotent; applies new patches / self-heal hook)
./update.sh

# If you already pulled or extracted a zip, just re-wire:
./update.sh --no-pull

# Post-update health check (does not modify anything):
node scripts/doctor.mjs
```

> Why is `git pull` not enough? dsh-aux's bridge patches and startup self-heal
> hook live in the DSH deployment (`node_modules` / `start-dsh.sh`); `git pull`
> only updates the source. `./update.sh` re-runs `install.sh` to write new
> patches/self-heal into the deployment. The self-heal hook restores symlinks,
> patches, and the whitelist before every DSH start; if your launch script is
> not `start-dsh.sh`, run `./update.sh` manually.

## Usage

### Commands

| Command | Purpose |
|---|---|
| `/aux status` | Show routes and recent auxiliary calls |
| `/aux history [N]` | Brief trace: last N auxiliary calls (default 10) |
| `/aux history full [N]` | Full trace: complete event fields (defaults to all) |
| `/aux model <task> [provider/model]` | View/set a task's auxiliary model |
| `/aux vision <path> <question...>` | Analyze an image from the command line |
| `/aux test <task>` | Self-test a task route |
| `/aux memory [n]` | Show recent image analysis memory |
| `/aux gc-images [days]` | Manually reclaim old attachment images |

### Settings

Web → Settings → Auxiliary Models. Configure a model per `vision` / `web_extract` / `web_crawl` / `compress` / `compaction` / `skill`. **`compaction` is the session-compaction model** — once configured, native DSH automatic/manual compaction routes through the AUX model. **`skill` is the skill pre-audit model** — once configured, native `skill` calls get an auxiliary pre-audit report. `web_extract` / `web_crawl` also expose `maxChars` (page character budget, default 32000). Each task can also select a "reasoning effort"; options come from the current provider/model's `reasoning.efforts`, and omitting it preserves the provider default. The settings page is grouped into collapsible "Tool Tasks / Bridge Tasks / Subagents / Global" sections and is bilingual (zh/en) following the DSH language. You can also turn off "Show auxiliary model status chip in conversation UI" (the `aux-status` projection is then no longer exposed to Web/third-party readers; `/aux status` still works).

### web_extract

Fetches a page (or crawls same-origin links with `followLinks`) and returns a **factual summary + key points** from the auxiliary model.

| Parameter | Default | What it does |
|---|---|---|
| `url` | required | The page to fetch |
| `question` | — | Optional follow-up to focus the answer |
| `maxChars` | 32000 | Page character budget (configurable; total budget when crawling) |
| `followLinks` | `off` | `same-origin` crawls same-origin document links |
| `maxPages` / `maxDepth` | 3 / 1 | Crawl page / link-depth cap (`0` = seed only) |

- **Output**: single pages return `summary`/`keyPoints` + `chars` and `truncated`; crawls additionally return `pages` and `totalChars`.
- **Boundary**: a static-HTML summary proxy — no JS execution (SPA sites may be empty shells), no clicking/pagination/forms.
- **Crawling**: shares web_crawl's engine — respects robots.txt, per-host rate limits and per-hop SSRF; follows only same-origin document links, skipping media/archives.

### web_crawl

Deep-crawls a whole documentation site (or a `hosts`-whitelisted set of sub-sites) from a seed URL and returns an **overall summary + page index** in one auxiliary call. Full design: `WEB-CRAWL-DESIGN.md`.

| Parameter | Default | What it does |
|---|---|---|
| `url` | required | Starting seed page |
| `scope` | `same-origin` | Crawl scope; `hosts` = only the listed hosts |
| `hosts` | — | Allowed hosts when `scope=hosts` (seed must be included) |
| `seedUrls` | — | Extra depth-0 seeds (SSRF-checked, scope-filtered) |
| `maxPages` / `maxDepth` | 10 / 2 | Page cap / link-depth cap |
| `maxCharsPerPage` | 32000 | Per-page character budget |
| `respectRobots` | true | Honor robots.txt (Disallow paths are skipped) |
| `minIntervalMs` | 250 | Minimum gap between requests to the same host |
| `useSitemap` | false | Seed from `<origin>/sitemap.xml` (nested indices skipped) |
| `maxPagesPerHost` | 0 (unlimited) | Per-host page cap |
| `perPageSummaries` | false | false = aggregated summary; true = per-page summaries |

**Two summary modes**

| Mode | How it summarizes | Cost |
|---|---|---|
| **A (default)** | One call over all pages → overall `summary`/`keyPoints` + `pages` index | 1 call |
| **B** (`perPageSummaries:true`) | A summary per page → `perPage`, then one aggregation call | ≈ pages + 1 calls |

**Behavior**: honors robots and per-host rate limits; every page and hop runs the per-hop SSRF check; static HTML, no JS rendering; explicitly **not concurrency-safe** (`isConcurrencySafe=false`), backed by sequential BFS + rate limits so a single domain is never flooded.

### Cleaning & anti-crawl (large-context era)

For cheap large-context auxiliary models, the goal shifts from "shrink to minimum" to "**deliver clean, de-toxed content whole**": hand the clean page to the aux model to answer/summarize directly; the main model only receives the result.

**Cleaning**: `htmlToText` drops whole non-content blocks (`script/style/iframe/canvas` …) and `data:` base64, keeping plain text, numbers and URLs. **De-tox (H5) stays unchanged**: page bodies go into a random-nonce untrusted-data block, physically separated from `Question`, ignoring any embedded instructions.

**Anti-crawl (zero-dependency)**

| Scenario | Behavior |
|---|---|
| Encoding | Decodes by `Content-Type` / `<meta charset>` via `TextDecoder` (GBK/GB18030 no longer mojibake) |
| JS Challenge | Detects CF/bot shells → returns a `browserRequired` marker, no aux tokens burned, hint to switch to a browser |
| 429 / 502-504 | One automatic retry (short backoff); then a rate-limited HTTP error |
| 403 etc. 4xx | HTTP error with a "may need browser/login" hint instead of feeding empty content to the aux model |
| Redirects | Followed per-hop with SSRF checks; exposes `redirects` hop count (landing ≠ request URL) |
| Proxy | Direct-first; on transport failure falls back to `HTTP(S)_PROXY` CONNECT tunnel (honors `NO_PROXY`), zero-dependency |

### Subagent & workflow bridge

DSH's native `subagent` tool, as well as the **concurrently fanned-out `agent()` children of `workflow`**, are transparently bridged to AUX — you keep calling `subagent`/`workflow` as usual, but the work is done by the auxiliary model, reusing per-task config, failure cooldown and main-model fallback. **Zero new tools, zero system-prompt changes.**

| Mode | What model the subagents use |
|---|---|
| `native` (default) | Not intercepted — fully native / main-model behavior |
| `manual` | All subagents use the `subagent.general` model |
| `vision-aware` | Uses `subagent.vision` when "needs vision" (e.g. matches `visionKeywords`), otherwise `general` |

**Configuration** (settings page "Subagent" block, or yaml):

```yaml
aux:
  subagent:
    mode: vision-aware        # native | manual | vision-aware
    general: { provider: opencode-go, model: glm-5.2 }
    vision:  { provider: opencode-go, model: kimi-k2.7-code }
    includeWorkflow: true      # workflow's parallel agent() children also route via AUX (default true)
    prepareTools: true         # inject AUX tools (vision_analyze etc.) as a fallback for subagents
    visionKeywords: [ "图片", "图像", "截图" ]
    retryVisionWithAux: false  # experimental: re-dispatch a failed subagent to the AUX vision route
```

- `includeWorkflow=false` means that even with `mode != native`, `workflow` children are not intercepted (only the `subagent` tool is).
- Installation: the local patches come with `install.sh` (or `bridge/apply-patch.mjs`); `/aux status` shows `subagent-bridge` / `workflow-bridge` mode + patch state. Design: `SUBAGENT-BRIDGE.md` / `WORKFLOW-BRIDGE.md`.

### Skill pre-audit bridge (skill-audit)

The native DSH flow is "main model sees catalog → calls `skill` → executes SKILL.md directly". dsh-aux inserts an **auxiliary-model due-diligence step** in between:

```
Main model sees catalog → decides to call skill("auth-flow")
    ↓
Native skill tool loads SKILL.md as usual
    ↓
【AUX tools/post-execute interception】
    ↓
Auxiliary model reads SKILL.md + current task (explicit task parameter + recent conversation)
    ↓
Returns pre-audit report:
  - how to apply / applicability assessment
  - known pitfalls / 🔻rot-prone stale assertions
  - execution advice / confidence
    ↓
Main model sees both "original SKILL.md + pre-audit report" → critically reviews → accept / modify / reject
    ↓
Actually executes
```

- **Enable**: configure a dedicated model in the "Skill pre-audit" settings block or via `/aux model skill <provider>/<model>`. Without configuration, the native result passes through untouched.
- **No skill management**: dsh-aux does not create or manage skills; skills stay with the official native system or memory-management plugins.
- **Original text retained**: the main model always sees the original SKILL.md, so it is not forced to trust the auxiliary model blindly.
- **Failure degrades**: if the auxiliary call fails, the native SKILL.md result is returned and the main model is not blocked.

### Security boundaries

- **SSRF protection (on by default)**: `web_extract`, `web_crawl`, and `vision_analyze`'s `imageUrl` reject internal/loopback/cloud-metadata addresses (`localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `169.254.169.254`, `*.local`, Teredo/6to4-embedded private addresses, etc.) by default and only allow `http/https`; the fallback fetch path validates **every redirect hop before the request is sent** (per-hop DNS + address check), and the provider-seam path requires a final URL, re-validates it, and hands any 3xx back to the per-hop follower. To fetch local/intranet services, explicitly set `allowInternalUrls: true` in the plugin config.
- **Prompt-injection mitigation**: auxiliary prompts treat page content, text-to-compress, and text inside images as **untrusted data** and explicitly forbid executing embedded instructions; page bodies are wrapped in nonce-bearing `<<<UNTRUSTED PAGE DATA …>>>` … `<<<END UNTRUSTED PAGE DATA …>>>` data blocks, physically separated from the `Question` instruction; `guideText` is trusted plugin config — only copy it from trusted sources.
- **Concurrency hard cap**: even if a task's `maxConcurrency` is configured higher, the effective value is capped at **10**, preventing misconfiguration from flooding the auxiliary model.

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

## Source Layout

`dsh-aux/src/index.js` intentionally keeps only **Service assembly and routing dispatch**; everything else lives in focused modules so contributors can find the right file quickly:

- `config.js` / `route.js` / `prompt.js` / `url-policy.js` — config, routing, prompts, SSRF policy
- `events.js` / `projection.js` / `bootstrap.js` / `commands.js` / `fetch.js` — events, projection, Bootstrap guidance, commands, fetching
- `tools/` — `vision_analyze` / `web_extract` / `compress_text` implementations and registration
- `images/` — attachment ownership, cleanup, image memory, image reference resolution
- `image-bridge.js` / `compaction-bridge.js` / `compaction-messages.js` — bridges and compaction message degradation

## Compatibility & Dependencies

- **Platform**: DSH 0.1.0-rc.6 ~ 0.1.1-rc.1; Node ≥ 20.
- **Zero runtime third-party dependencies**: all peerDependencies are official DSH packages; no `dependencies`.
- **Zero-dependency tests**: `node --test tests/*.test.js` (285 total; see `TESTING.md` for the file inventory and baseline).

### Integrated Components

- **image-bridge**: lets text-only main models paste images directly while the UI keeps thumbnails, and allows switching to a text-only model in image-bearing sessions (v3); re-run `bridge/apply-patch.mjs` after `npm update`.
- **Settings dynamic exposure**: the Web settings page can read/write aux config; the patch ships in this repo's `bridge/` and does not require upstream deepseek-harness changes.
- **Session event channel**: `aux/llm-call` events are written with `ignorable: true`; without the patch the plugin degrades to not writing events, protecting session logs.
- **Session delete synergy**: works with the community plugin dsh-plugin-session-delete to clean up unreferenced images when a session is deleted.
- **compaction-bridge**: once `compaction` is configured, native compaction routes through AUX; unusable images are degraded to text placeholders so compaction never fails outright.
- **subagent-bridge**: transparently takes over the native `subagent` tool and routes it to AUX auxiliary models in native / manual / vision-aware modes; injects `vision_analyze` into the child as a fallback, with zero system-prompt changes. `workflow` `agent()` parallel children can share the same route (includeWorkflow).

### Minimal / Anchored Standard Compatibility

Before the first durable `tool/call`, these presets expose only the Minimal tool pair and strip auto-injected context — that is the core of their first-round trajectory anchoring. dsh-aux **never injects any AUX context/prompt on the first round**; after the first `tool/call`, the catalog opens, AUX tools appear, and a one-time `agent/pre-step` reminder guides the model to use `vision_analyze` directly instead of spawning a sub-agent. See [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main) for the Anchored Standard design.

## FAQ

**Q1: Why are AUX tools like `vision_analyze` not visible in the first round of the Minimal / Anchored Standard presets?**

A: Because of the "first-round trajectory anchoring" mechanism of these presets: before the first durable `tool/call`, only the Minimal tool pair is exposed and auto-injected context is stripped out. dsh-aux respects this — it **never injects any AUX context/prompt on the first round** and does not expose its tools early. After the first `tool/call`, the catalog opens, `vision_analyze` / `web_extract` / `compress_text` appear, and a one-time `agent/pre-step` reminder guides direct use.

**Q2: Why did `/compact` fail with an image session?**

A: If the image block in the replayed messages points to an attachment object that has already been GC'd/cleaned (reporting `Attachment object is missing.`), or none of the available compaction routes support image input, the images are unusable for compaction. In that case dsh-aux **degrades the images to text placeholders** (the actual placeholder is generated in Chinese, e.g. `[图片: name (type, WxH) — 未纳入压缩摘要]`) and continues compacting through AUX, so the compaction task does not fail outright.

**Q3: Does dsh-aux require configuring models?**

A: No. dsh-aux is **zero-config**: it works without configuring any model, and auxiliary tasks automatically fall back to the session's main model. You can assign a dedicated model to any task at any time via the settings page or `/aux model <task> <provider/model>`.

## Related Projects

- [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/tree/main) — design & implementation of the Anchored Standard preset
- [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) — community vision toolkit
- [dsh-plugin-session-delete](https://github.com/lsz-asd/dsh-plugin-session-delete) — session-delete plugin (cleans up unreferenced images on session delete)
- [SeekMaid-pet](https://github.com/DoloresCaritasAngelus/SeekMaid-pet) — SeekMaid electronic pet

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
