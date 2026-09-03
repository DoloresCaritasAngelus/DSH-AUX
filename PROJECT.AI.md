# DSH-AUX Project Brief (AI / Automation Friendly)

> For AI agents and automation: concise, structured, actionable facts about this repository.
> Human-oriented version: [PROJECT.md](./PROJECT.md). Keep both in sync; this file mirrors the same facts.

## Identity

- Name: `@dolorescaritasangelus/dsh-aux` (workspace: DSH-AUX)
- Repo: https://github.com/DoloresCaritasAngelus/DSH-AUX
- Purpose: auxiliary-model system for DeepSeek Harness (DSH)
- Current version: `0.4.3` (package `dsh-aux/package.json`)
- Current supported DSH: `0.1.2-alpha.2` ~ `0.1.2-rc.1`
- Legacy DSH (`0.1.0-rc.6` ~ `0.1.1-rc.2`): permanent branch `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2`, release `v0.4.1-legacy`
- Runtime deps: none third-party; peerDependencies are official DSH packages only
- Node: >=20

## What it does

- Provides tasks: `vision_analyze`, `web_extract`, `web_crawl`, `compress_text`, `compaction`, `skill`
- Unified aux LLM routing with per-task provider/model/timeout/concurrency/reasoning effort
- Fallback to main model, failure cooldown, session-event observability
- Platform switches per tool/bridge: `native` / `aux` / `compat` (reserved)
- Bridges: image bridge, subagent bridge, workflow bridge, skill audit, compaction bridge
- Client: Web settings section (`settings.section` id `aux`), composer status chip, diagnostics & repair panel

## Repository layout

```text
dsh-aux/src/             plugin source (server + client)
bridge/                  local DSH patches + self-heal + installers
scripts/                 CI helpers, doctor, readme generator
tests/                   node --test suite
dsh-aux/README*          generated snapshots from root README (do not hand-edit)
PROJECT.md               human long-term overview
PROJECT.AI.md            this file
IMAGE-LIBRARY-DESIGN.md  Image-library visualization design
IMAGE-LIBRARY-IMPLEMENTATION-PLAN.md  Image-library execution plan
dsh-aux/AI.md            AI install/verification guide
```

## Key invariants / maintenance rules

1. **Minimize native-package intrusion.**
   Prefer official extension points / events / services. When patching DSH packages is unavoidable, keep patches small, identifiable by unique markers, and self-healable.
2. **Patch detection is read-only and marker-based.**
   Use `bridge-locate.js` to resolve the real deployed package file. Each patch must have a unique marker.
3. **Status must expose patch ledger.**
   `collectPlatformStatus()` returns `patchLedger` entries:
   `{ id, group, pkg, description, state, installed, required, present }`.
   States: `installed` | `missing` | `not-applicable` | `unknown`.
   UI renders this in Diagnostics & Repair.
4. **One-click patch must target the real DSH deployment.**
   `handlePatchCommand()` resolves `detectDshRoot()` and passes `DSH_ROOT` + `cwd` to child scripts.
   Avoid falling back to repo-local `node_modules` when a real deployment is detected.
5. **DSH upgrades require self-heal.**
   `bridge/self-heal.mjs` is idempotent and runs from `start-dsh.sh`; it may also be run manually.
6. **Docs single-source.**
   Root README is source for package README snapshots. `PROJECT.md` / `PROJECT.AI.md` are synchronized mirrors.
7. **Git discipline.**
   Work from `main` on short-lived branches; do not push to merged/closed branches; no force-push of published history.

## Bridge/patch system

Files:
- `bridge/apply-patch.mjs` — idempotent apply/dry-run/rollback for P1-P6/P11 bridge patches
- `bridge/self-heal.mjs` — symlink + P7/P8 guard, runs at DSH startup
- `bridge/patch-session-ignorable.mjs` — P7 session ignorable write support
- `bridge/retired/` — retired rc.6/host-apiproxy/rc.8 patches (not used on main)

Patch ledger families:
- P1-P6/P11: agent-loop / session-controller / subagent schema+request / workflow / skill schema
- P7: session `append(..., { ignorable: true })`
- P8: `aux/llm-call` event whitelist
- Retired: host-apiproxy admit/selectModel, rc.6 settings P9/P10, rc.8 anchors — in `bridge/retired/`

Current deployment verification pattern:
- From DSH root cwd or via DSH_ROOT, `resolvePackageFile(pkg)` should point only at `<DSH_ROOT>/node_modules/@deepseek-ai/<pkg>/lib/index.js`.
- `bridge-locate.js` intentionally does NOT fall back to repo `node_modules` when a real deployment root is detected (unless running repo-local tests without `DSH_ROOT`).

## Client settings / alpha.3 notes

- DSH alpha.3 removed `connection.api`; client uses `remote.settings`, `remote.llm`, `remote.session`, `sessions`.
- `client.js` has `createAlpha3Api(ctx)` facade; `inject` includes remote/session namespaces.
- Settings UI reads provider/model/reasoning from `remote.session.modelCatalog()`.
- Status projection `aux-platform` carries full platform status incl. `patchLedger`.
- Client registration uses `settings.section` only; do not re-add duplicate `settings.plugin.item` for AUX.

## Tests / quality gates

- Run: `node --test tests/*.test.js`
- Bridge dry-run: `node bridge/apply-patch.mjs --dry-run`; `node bridge/self-heal.mjs --dry-run`
- CI: syntax checks, fake-DSH patch smoke, compat matrix `[0.1.2-alpha.2, 0.1.2-alpha.3, 0.1.2-alpha.4, 0.1.2-alpha.5, 0.1.2-rc.1]`
- Keep README snapshots in sync via `scripts/gen-package-readme.mjs --check`
- Keep TESTING baseline current when test count changes

## Common pitfalls

- Running `apply-patch` from repo cwd without DSH_ROOT can target repo-local old DSH dev deps; always resolve deployment root first.
- `bridge-locate` tests may run in repo mode (no DSH_ROOT) and should still resolve repo `node_modules` for unit tests; production path is deployment-root-authoritative.
- Never hand-edit `dsh-aux/README*.md`; regenerate.
- Do not store GitHub tokens in files/commands/logs.
- Keep legacy branch untouched by main-line changes.
