/**
 * dsh-aux platform status collection.
 *
 * Produces a structured, JSON-safe snapshot of every tool/bridge platform
 * switch plus global diagnostics. This is the host→client status channel
 * used by the settings page: the client asks `/aux status --json` and the
 * command serializes this object, so the browser never re-implements
 * patch-detection or state derivation.
 *
 * @module @dolorescaritasangelus/dsh-aux/status
 */
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { imageBridgeStatus } from "./image-bridge.js";
import {
  subagentBridgeStatus,
  workflowBridgeStatus
} from "./subagent-bridge.js";
import {
  isCompactionBridgeInstalled,
  isCompactionTaskConfigured
} from "./compaction-bridge.js";
import { isSkillTaskConfigured, skillBridgeStatus } from "./skill-bridge.js";
import { sessionEventsSupported } from "./events.js";

/** Tool keys that do not depend on bridge patches. */
const TOOL_KEYS = ["vision_analyze", "web_extract", "web_crawl", "compress_text"];
/** Bridge keys that depend on local patches / host packages. */
const BRIDGE_KEYS = ["imageBridge", "subagentBridge", "workflowBridge", "compactionBridge", "skillAudit"];

const require = createRequire(import.meta.url);

/** Relative candidate paths for patched DSH files (symlink/source-tree layouts). */
const PATCH_REL_CANDIDATES = [
  "../../../@deepseek-ai/dsh-host-apiproxy/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js",
  "../../../@deepseek-ai/dsh-agent-loop/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js",
  "../../../@deepseek-ai/dsh-tool-subagent/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js",
  "../../../@deepseek-ai/dsh-workflow-worker-thread/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-workflow-worker-thread/lib/index.js",
  "../../../@deepseek-ai/dsh-tool-skill/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-tool-skill/lib/index.js",
  "../../../@deepseek-ai/dsh-session/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-session/lib/index.js"
];

/** Packages whose patched `lib/index.js` we can resolve through Node. */
const PATCH_RESOLVE_PACKAGES = [
  "@deepseek-ai/dsh-host-apiproxy",
  "@deepseek-ai/dsh-agent-loop",
  "@deepseek-ai/dsh-tool-subagent",
  "@deepseek-ai/dsh-workflow-worker-thread",
  "@deepseek-ai/dsh-tool-skill",
  "@deepseek-ai/dsh-session"
];

/** All candidate on-disk paths for patched DSH files. */
function patchTargetPaths() {
  const paths = [];
  for (const rel of PATCH_REL_CANDIDATES) {
    try {
      paths.push(fileURLToPath(new URL(rel, import.meta.url)));
    } catch {
      /* skip malformed candidate */
    }
  }
  for (const pkg of PATCH_RESOLVE_PACKAGES) {
    try {
      paths.push(require.resolve(pkg + "/lib/index.js"));
    } catch {
      /* package may be absent in this deployment */
    }
  }
  return [...new Set(paths)];
}

/**
 * Whether any patched DSH file was modified after this Node process started.
 * Patches edit node_modules source files; already-loaded modules stay stale
 * until DSH restarts, so a newer mtime means a restart is required for the
 * new patch code to take effect.
 */
async function anyPatchFileNewerThanProcessStart() {
  const startedAt = Date.now() - Math.round(process.uptime() * 1000);
  for (const target of patchTargetPaths()) {
    try {
      const info = await stat(target);
      if (info.mtimeMs > startedAt + 1000) return true;
    } catch {
      /* candidate not present; try next */
    }
  }
  return false;
}

/**
 * Build one status item.
 * @param {object} item
 * @returns {object} JSON-safe platform status item.
 */
function item(entry) {
  const out = {
    key: entry.key,
    kind: entry.kind,
    mode: entry.mode,
    state: entry.state,
    reason: entry.reason,
    action: entry.action ?? "none"
  };
  if (entry.patch !== void 0) out.patch = entry.patch;
  if (entry.detail !== void 0) out.detail = entry.detail;
  return out;
}

/**
 * Status for one model-facing tool. Tools are available whenever the plugin
 * is mounted; only the user's mode switch changes their state.
 */
function toolStatus(service, key) {
  const mode = service.toolBridgeMode(key);
  if (mode === "native") {
    return item({ key, kind: "tool", mode, state: "disabled", reason: "mode-native", action: "none" });
  }
  if (mode === "compat") {
    return item({ key, kind: "tool", mode, state: "unavailable", reason: "mode-compat", action: "none" });
  }
  return item({ key, kind: "tool", mode, state: "enabled", reason: "mode-aux", action: "none" });
}

/**
 * Status for the image bridge. v3/v2 are usable; v1 still works but should
 * be upgraded; partial/missing need the patch.
 */
function imageBridgeStatusItem(service, status) {
  const mode = service.toolBridgeMode("imageBridge");
  if (mode === "native") {
    return item({ key: "imageBridge", kind: "bridge", mode, state: "disabled", reason: "mode-native", action: "none", patch: "not-applicable" });
  }
  if (mode === "compat") {
    return item({ key: "imageBridge", kind: "bridge", mode, state: "unavailable", reason: "mode-compat", action: "none", patch: status });
  }
  switch (status) {
    case "v3":
    case "v2":
      return item({ key: "imageBridge", kind: "bridge", mode, state: "enabled", reason: "patch-ok", action: "none", patch: "installed" });
    case "v1":
      return item({ key: "imageBridge", kind: "bridge", mode, state: "enabled", reason: "patch-v1", action: "patch", patch: "partial" });
    case "partial":
      return item({ key: "imageBridge", kind: "bridge", mode, state: "unavailable", reason: "patch-partial", action: "patch", patch: "partial" });
    case "missing":
      return item({ key: "imageBridge", kind: "bridge", mode, state: "unavailable", reason: "patch-missing", action: "patch", patch: "missing" });
    default:
      return item({ key: "imageBridge", kind: "bridge", mode, state: "unknown", reason: "patch-unknown", action: "none", patch: "unknown" });
  }
}

/**
 * Status for a simple file-patch bridge (subagent / workflow / skill).
 */
function filePatchBridgeStatusItem(service, key, status) {
  const mode = service.toolBridgeMode(key);
  if (mode === "native") {
    return item({ key, kind: "bridge", mode, state: "disabled", reason: "mode-native", action: "none", patch: "not-applicable" });
  }
  if (mode === "compat") {
    return item({ key, kind: "bridge", mode, state: "unavailable", reason: "mode-compat", action: "none", patch: status });
  }
  switch (status) {
    case "installed":
      return item({ key, kind: "bridge", mode, state: "enabled", reason: "patch-ok", action: "none", patch: "installed" });
    case "missing":
      return item({ key, kind: "bridge", mode, state: "unavailable", reason: "patch-missing", action: "patch", patch: "missing" });
    default:
      return item({ key, kind: "bridge", mode, state: "unknown", reason: "patch-unknown", action: "none", patch: "unknown" });
  }
}

/**
 * Status for the compaction bridge. It is an in-process patch installed only
 * when `dsh-compaction-basic` is present, and it only routes when a
 * dedicated `compaction` task is configured.
 */
function compactionBridgeStatusItem(service) {
  const mode = service.toolBridgeMode("compactionBridge");
  if (mode === "native") {
    return item({ key: "compactionBridge", kind: "bridge", mode, state: "disabled", reason: "mode-native", action: "none", patch: "not-applicable" });
  }
  if (mode === "compat") {
    return item({ key: "compactionBridge", kind: "bridge", mode, state: "unavailable", reason: "mode-compat", action: "none", patch: "not-applicable" });
  }
  if (!isCompactionBridgeInstalled()) {
    return item({ key: "compactionBridge", kind: "bridge", mode, state: "unavailable", reason: "dependency-missing", action: "none", patch: "missing" });
  }
  if (!isCompactionTaskConfigured(service)) {
    return item({ key: "compactionBridge", kind: "bridge", mode, state: "unavailable", reason: "config-missing", action: "configure", patch: "installed" });
  }
  return item({ key: "compactionBridge", kind: "bridge", mode, state: "enabled", reason: "patch-ok", action: "none", patch: "installed" });
}

/**
 * Status for the skill audit bridge. Besides the schema patch, it needs an
 * explicit `skill` aux route and a SKILL mode other than native.
 */
function skillBridgeStatusItem(service, status) {
  const mode = service.toolBridgeMode("skillAudit");
  if (mode === "native") {
    return item({ key: "skillAudit", kind: "bridge", mode, state: "disabled", reason: "mode-native", action: "none", patch: "not-applicable" });
  }
  if (mode === "compat") {
    return item({ key: "skillAudit", kind: "bridge", mode, state: "unavailable", reason: "mode-compat", action: "none", patch: status });
  }
  if (status !== "installed") {
    return item({ key: "skillAudit", kind: "bridge", mode, state: "unavailable", reason: "patch-missing", action: "patch", patch: status });
  }
  if (service.skillMode === "native") {
    return item({ key: "skillAudit", kind: "bridge", mode, state: "disabled", reason: "skill-mode-native", action: "none", patch: "installed" });
  }
  if (!isSkillTaskConfigured(service)) {
    return item({ key: "skillAudit", kind: "bridge", mode, state: "unavailable", reason: "config-missing", action: "configure", patch: "installed" });
  }
  return item({ key: "skillAudit", kind: "bridge", mode, state: "enabled", reason: "patch-ok", action: "none", patch: "installed" });
}

/**
 * Collect the full platform status snapshot.
 * @param {AuxLlmService} service
 * @returns {Promise<object>} JSON-safe status object.
 */
export async function collectPlatformStatus(service) {
  const [image, sub, workflow, skill, events, restartRequired] = await Promise.all([
    imageBridgeStatus(),
    subagentBridgeStatus(),
    workflowBridgeStatus(),
    skillBridgeStatus(),
    sessionEventsSupported(service),
    service._patchAppliedThisSession === true
      ? Promise.resolve(true)
      : anyPatchFileNewerThanProcessStart()
  ]);

  const items = [];
  for (const key of TOOL_KEYS) items.push(toolStatus(service, key));
  items.push(imageBridgeStatusItem(service, image));
  items.push(filePatchBridgeStatusItem(service, "subagentBridge", sub));
  items.push(filePatchBridgeStatusItem(service, "workflowBridge", workflow));
  items.push(compactionBridgeStatusItem(service));
  items.push(skillBridgeStatusItem(service, skill));

  const warnings = [];
  const enabled = service._enabled ?? {};
  if (enabled.vision_analyze === "native" && enabled.imageBridge !== "native") {
    warnings.push({
      code: "vision-disabled-image-bridge-enabled",
      keys: ["vision_analyze", "imageBridge"],
      reason: "vision-disabled-image-bridge-enabled"
    });
  }

  const issues = items
    .filter((entry) => entry.state === "unavailable")
    .map((entry) => ({ key: entry.key, reason: entry.reason, action: entry.action }));

  return {
    generatedAt: Date.now(),
    restartRequired,
    core: {
      count: 4,
      protected: [
        "image-lifecycle",
        "session-image-safety",
        "failure-cooldown",
        "event-audit"
      ]
    },
    eventsSupported: events,
    items,
    warnings,
    issues
  };
}
