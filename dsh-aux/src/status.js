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
import { performance } from "node:perf_hooks";
import { resolvePackageFile, readPackageFile } from "./bridge-locate.js";
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
  "dsh-agent-loop",
  "dsh-api-session-controller",
  "dsh-tool-subagent",
  "dsh-workflow-worker-thread",
  "dsh-tool-skill",
  "dsh-session"
];

/**
 * Patch ledger: one row per local bridge patch that dsh-aux maintains.
 * Main branch supports DSH 0.1.2-alpha.2 ~ 0.1.2-alpha.3 only.
 * Retired legacy patches (host-apiproxy / rc.6 settings) live in
 * `bridge/retired/` and are intentionally not listed here.
 *
 * Each entry:
 * - `id`: stable key used by the UI and status payloads.
 * - `group`: P-number ledger family (P1-P6/P11 bridge apply-patch, P7 session,
 *   P8 whitelist).
 * - `pkg`: target DSH package that the patch would modify.
 * - `mark`: source marker string that indicates the patch is applied.
 * - `description`: short human-readable purpose.
 */
const PATCH_LEDGER = [
  {
    id: "bridge-agent-loop",
    group: "P1-P6",
    pkg: "dsh-agent-loop",
    mark: "image-bridge v2 (local patch)",
    description: "模型输入边界将图片改写为 vision_analyze 路径文本"
  },
  {
    id: "bridge-session-controller",
    group: "P1-P6",
    pkg: "dsh-api-session-controller",
    mark: "dsh-aux image bridge v3 (local patch)",
    description: "alpha.x session-controller 图片门控移除"
  },
  {
    id: "bridge-subagent-schema",
    group: "P1-P6",
    pkg: "dsh-tool-subagent",
    mark: "requires_vision:",
    description: "subagent 工具增加 requires_vision 可选参数"
  },
  {
    id: "bridge-subagent-request",
    group: "P1-P6",
    pkg: "dsh-tool-subagent",
    mark: 'ctx.get("auxLlm")',
    description: "subagent execute 读取 auxLlm.subagentRoute 注入路由"
  },
  {
    id: "bridge-workflow",
    group: "P1-P6",
    pkg: "dsh-workflow-worker-thread",
    mark: "subagentIncludeWorkflow",
    description: "workflow agent() 子代理也走 AUX 路由"
  },
  {
    id: "bridge-skill",
    group: "P1-P6",
    pkg: "dsh-tool-skill",
    mark: "skill auditor",
    description: "skill 工具增加可选 task 参数供预审桥接"
  },
  {
    id: "session-ignorable",
    group: "P7",
    pkg: "dsh-session",
    mark: "dsh-aux ignorable (local patch)",
    description: "session.append 支持 ignorable 自定义事件"
  },
  {
    id: "session-whitelist",
    group: "P8",
    pkg: "dsh-session",
    mark: "aux/llm-call",
    description: "aux/llm-call 事件白名单"
  }
];

/** Read one patched package's lib source once, returning undefined if absent. */
async function readPatchSource(pkg) {
  try {
    return await readPackageFile(pkg);
  } catch {
    return void 0;
  }
}

/**
 * Collect the detailed patch ledger. It only reads installed files and never
 * writes to native packages. For each patch it reports:
 * - `state`: installed | missing | unknown
 * - `present`: whether the target package file exists
 * - `required`: whether this patch is needed on the current DSH line
 *   (all listed patches are required on alpha.2/alpha.3)
 */
export async function collectPatchLedger() {
  const sources = new Map();
  const rows = [];
  for (const patch of PATCH_LEDGER) {
    let src = sources.get(patch.pkg);
    if (src === void 0) {
      src = await readPatchSource(patch.pkg);
      sources.set(patch.pkg, src);
    }
    const present = src !== void 0;
    const installed = present && src.includes(patch.mark);
    const state = !present ? "unknown" : installed ? "installed" : "missing";
    rows.push({
      id: patch.id,
      group: patch.group,
      pkg: patch.pkg,
      description: patch.description,
      state,
      installed,
      required: true,
      present
    });
  }
  return rows;
}

/**
 * Precise wall-clock process start from Node's performance origin. This is
 * more reliable than `Date.now() - Math.round(process.uptime() * 1000)` for
 * deciding whether a patched file changed after this process started.
 */
const PROCESS_STARTED_AT_MS = performance.timeOrigin;

/**
 * Small mtime tolerance for filesystems with coarse timestamp granularity.
 * The previous 1s tolerance could hide patches written shortly after boot;
 * 250ms is enough slack for common filesystems while keeping the check sharp.
 */
const RESTART_MTIME_TOLERANCE_MS = 250;

/**
 * How long the same-process patch hint remains authoritative when mtime is
 * ambiguous. `/aux patch` stores `_patchAppliedThisSessionAt`; after this
 * window the file mtime check is the source of truth so a stale flag cannot
 * mask a later rollback/reset forever.
 */
const PATCH_APPLIED_HINT_TOLERANCE_MS = 5000;

/** Serializes platform-status publishes per service instance. */
const platformPublishQueues = new WeakMap();

/** Monotonic per-service publish sequence for status snapshots. */
const platformPublishSeqs = new WeakMap();

function nextPlatformPublishSeq(service) {
  const next = (platformPublishSeqs.get(service) ?? 0) + 1;
  platformPublishSeqs.set(service, next);
  return next;
}

/** Queue one status publish behind all previous publishes for the same service. */
function enqueuePlatformPublish(service, task) {
  const previous = platformPublishQueues.get(service) ?? Promise.resolve();
  const run = previous.then(task, task);
  platformPublishQueues.set(service, run.catch(() => {}));
  return run;
}

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
  const startedAt = PROCESS_STARTED_AT_MS;
  for (const target of patchTargetPaths()) {
    try {
      const info = await stat(target);
      if (info.mtimeMs > startedAt + RESTART_MTIME_TOLERANCE_MS) return true;
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
  if (status === "unknown") {
    return item({ key: "skillAudit", kind: "bridge", mode, state: "unknown", reason: "patch-unknown", action: "none", patch: "unknown" });
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
  const [image, sub, workflow, skill, events, fileRestartRequired, patchLedger] = await Promise.all([
    imageBridgeStatus(),
    subagentBridgeStatus(),
    workflowBridgeStatus(),
    skillBridgeStatus(),
    sessionEventsSupported(service),
    anyPatchFileNewerThanProcessStart(),
    collectPatchLedger()
  ]);
  // A same-process patch is a hint, not a permanent override. If the mtime
  // check later says no patched file changed after boot (e.g. a rollback that
  // restored original timestamps), the stale flag should not keep reporting
  // restartRequired forever.
  const patchAppliedAt = service._patchAppliedThisSessionAt ?? Date.now();
  const patchAppliedHint =
    service._patchAppliedThisSession === true &&
    Date.now() - patchAppliedAt < PATCH_APPLIED_HINT_TOLERANCE_MS;
  const restartRequired = fileRestartRequired || patchAppliedHint;

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
    patchLedger,
    items,
    warnings,
    issues
  };
}

/**
 * Collect one status snapshot, stamp it with a monotonic sequence, and record
 * it to the given sessions. All errors are swallowed: status publishing must
 * never break session lifecycle.
 */
async function publishStatusSnapshot(service, sessions) {
  // 同进程内刚打过补丁时,当前 dsh-session 仍是旧代码,不能写需要 ignorable
  // 标记的新事件;等重启后由启动发布再写入。
  if (service._patchAppliedThisSession === true) return;
  try {
    const status = await collectPlatformStatus(service);
    status.publishSeq = nextPlatformPublishSeq(service);
    await Promise.all(
      sessions.map((session) => recordPlatformEvent(service, session, status).catch(() => {}))
    );
  } catch {
    /* status publishing must never break session lifecycle */
  }
}

/**
 * Publish the current platform status to one session as a hidden,
 * ignorable `aux/platform-status` event. The `aux-platform` projection folds
 * this event, so the settings page can read the snapshot through
 * `sessions.history` without executing a slash command.
 *
 * Publishes are serialized per service: a slower/older `collectPlatformStatus`
 * cannot append after a newer snapshot, which would otherwise let the
 * projection regress to stale data. Each snapshot also carries a monotonic
 * `publishSeq` for consumers that want to order/ignore snapshots.
 */
export async function publishPlatformStatusToSession(service, session) {
  if (session === void 0) return Promise.resolve();
  return enqueuePlatformPublish(service, () => publishStatusSnapshot(service, [session]));
}

/**
 * Publish the current platform status to every attached session. Called on
 * service start, settings changes, and after patch runs so the settings page
 * always has a fresh projection to read.
 *
 * The per-service queue also coalesces the fire-and-forget call sites in
 * index.js/commands.js into ordered snapshots, so an older publish cannot land
 * after a newer one in the session log.
 */
export async function publishPlatformStatus(service) {
  return enqueuePlatformPublish(service, () => {
    const sessions = service.ctx?.sessions?.list?.() ?? [];
    return publishStatusSnapshot(service, sessions);
  });
}
