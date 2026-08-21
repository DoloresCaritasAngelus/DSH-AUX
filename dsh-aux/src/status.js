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
import { resolvePackageFile } from "./bridge-locate.js";
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
import { recordPlatformEvent, sessionEventsSupported } from "./events.js";

/** Tool keys that do not depend on bridge patches. */
const TOOL_KEYS = ["vision_analyze", "web_extract", "web_crawl", "compress_text"];

/** Packages whose patched `lib/index.js` participates in restart detection. */
const PATCH_PACKAGES = [
  "dsh-host-apiproxy",
  "dsh-agent-loop",
  "dsh-tool-subagent",
  "dsh-workflow-worker-thread",
  "dsh-tool-skill",
  "dsh-session"
];

/** All candidate on-disk paths for patched DSH files. */
function patchTargetPaths() {
  const paths = [];
  for (const pkg of PATCH_PACKAGES) {
    const target = resolvePackageFile(pkg);
    if (target !== void 0) paths.push(target);
  }
  return paths;
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

  // 保留人类可读的桥接配置细节,避免统一到 status 后丢掉 subagent 模式、
  // workflow includeWorkflow、compaction/skill 是否已配置等信息。
  const subItem = items.find((entry) => entry.key === "subagentBridge");
  if (subItem !== void 0) {
    subItem.detail = `mode=${service.subagentMode ?? "native"}${service.subagentPrepareTools ? ", prepareTools" : ""}`;
  }
  const wfItem = items.find((entry) => entry.key === "workflowBridge");
  if (wfItem !== void 0) {
    wfItem.detail = `includeWorkflow=${service.subagentIncludeWorkflow ? "on" : "off"}`;
  }
  const compactionItem = items.find((entry) => entry.key === "compactionBridge");
  if (compactionItem !== void 0) {
    compactionItem.detail = `installed=${isCompactionBridgeInstalled() ? "yes" : "no"}, configured=${isCompactionTaskConfigured(service) ? "yes" : "no"}`;
  }
  const skillItem = items.find((entry) => entry.key === "skillAudit");
  if (skillItem !== void 0) {
    skillItem.detail = `configured=${isSkillTaskConfigured(service) ? "yes" : "no"}, mode=${service.skillMode ?? "audit"}`;
  }

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

/**
 * Publish the current platform status to one session as a hidden,
 * ignorable `aux/platform-status` event. The `aux-platform` projection folds
 * this event, so the settings page can read the snapshot through
 * `sessions.history` without executing a slash command.
 */
export async function publishPlatformStatusToSession(service, session) {
  try {
    const status = await collectPlatformStatus(service);
    await recordPlatformEvent(service, session, status);
  } catch {
    /* status publishing must never break session lifecycle */
  }
}

/**
 * Publish the current platform status to every attached session. Called on
 * service start, settings changes, and after patch runs so the settings page
 * always has a fresh projection to read.
 */
export async function publishPlatformStatus(service) {
  const sessions = service.ctx?.sessions?.list?.() ?? [];
  await Promise.all(sessions.map((session) => publishPlatformStatusToSession(service, session)));
}
