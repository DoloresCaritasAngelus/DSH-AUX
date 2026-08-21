/**
 * dsh-aux browser half: the auxiliary-model settings page plus a composer
 * status chip.
 *
 * Settings page (settings.section "aux"): grouped collapsible cards for
 * tool/bridge/subagent/global settings, per-task provider/model/timeout/
 * concurrency/maxChars/reasoningEffort, global save, and per-field reset.
 * The page is bilingual (zh/en) and follows the DSH locale service when
 * present.
 *
 * The chip (conversation.input.left seat) renders the latest auxiliary call
 * from the `aux-status` projection.
 *
 * Bundle format mirrors the shipped client plugins: `window.__ModuleLoader__`
 * factory returning { apply, inject }.
 */
window.__ModuleLoader__.load({
	id: "@dolorescaritasangelus/dsh-aux",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		// Package-owned stylesheet, deduplicated by tag id and cleaned up with the run.
		const css = [
			".ax-wrap{display:inline-flex;align-items:center;gap:6px;min-width:0}",
			".ax-chip{display:inline-flex;align-items:center;gap:4px;border:none;border-radius:999px;padding:2px 8px;font-size:13px;font-weight:500;line-height:20px;cursor:default;font-family:inherit}",
			".ax-ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}",
			".ax-fail{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}",
			".ax-none{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}",
			".ax-section{display:flex;flex-direction:column;gap:12px;padding:16px;max-width:760px}",
			".ax-group{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
			".ax-group-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
			".ax-group-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
			".ax-group-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
			".ax-group-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
			".ax-group-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
			".ax-group-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
			".ax-group-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
			".ax-group-chevronOpen{transform:rotate(180deg)}",
			".ax-group-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:8px 0 12px}",
			".ax-task{border:1px solid var(--dsw-alias-border-strong);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;margin-top:10px}",
			".ax-task h3{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".ax-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 16px}",
			".ax-row{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--dsw-alias-label-secondary);min-width:0}",
			".ax-row label{font-size:12px;color:var(--dsw-alias-label-tertiary)}",
			".ax-row input,.ax-row select{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-strong);border-radius:4px;padding:4px 8px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}",
			".ax-row input:focus-visible,.ax-row select:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:1px}",
			".ax-field-head{display:flex;align-items:center;gap:6px;min-width:0}",
			".ax-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:11px;line-height:1.5}",
			".ax-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
			".ax-reset:disabled{cursor:default}",
			".ax-switch{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}",
			".ax-actions{display:flex;gap:8px;align-items:center}",
			".ax-save{border:none;border-radius:4px;padding:4px 12px;font-size:13px;font-weight:500;cursor:pointer;color:#fff;background:var(--dsw-alias-state-success-primary)}",
			".ax-save:disabled{opacity:.6;cursor:default}",
			".ax-status{font-size:12px;line-height:18px}",
			".ax-error{color:var(--dsw-alias-state-error-primary)}",
			".ax-ok-text{color:var(--dsw-alias-state-success-primary)}",
			".ax-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}",
			".ax-dot-enabled{background:var(--dsw-alias-state-success-primary)}",
			".ax-dot-disabled{background:var(--dsw-alias-label-tertiary)}",
			".ax-dot-unavailable{background:var(--dsw-alias-state-error-primary)}",
			".ax-dot-fixing{background:var(--dsw-alias-state-warn-primary)}",
			".ax-dot-unknown{background:var(--dsw-alias-label-caption)}",
			".ax-status-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".ax-status-badge{font-size:11px;line-height:16px;border-radius:999px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}",
			".ax-status-badge-installed{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent)}",
			".ax-status-badge-missing{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}",
			".ax-status-badge-partial{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent)}",
			".ax-status-badge-unknown,.ax-status-badge-not-applicable{color:var(--dsw-alias-label-tertiary)}",
			".ax-repair-button{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 8px;font-size:11px;line-height:20px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1)}",
			".ax-repair-button:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".ax-repair-button:disabled{opacity:.6;cursor:default}",
			".ax-status-issue{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px}",
			".ax-status-issue-text{flex:1;min-width:0}",
			".ax-status-summary{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}"
		].join("");
		const tagId = "@dolorescaritasangelus/dsh-aux/Aux.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dolorescaritasangelus/dsh-aux";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const NS = "@dolorescaritasangelus/dsh-aux";
		const zhDict = {
			"settings.title": "辅助模型",
			"settings.intro": "配置辅助模型的路由、超时、并发与思考档位。",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.saved": "已保存",
			"settings.loading": "加载辅助模型配置…",
			"settings.loadError": "加载失败: ",
			"settings.reset": "重置",
			"group.tools": "工具任务",
			"group.tools.desc": "图像、网页提取、长文本压缩等辅助工具。",
			"group.bridges": "桥接任务",
			"group.bridges.desc": "会话压缩与技能预审。",
			"group.subagent": "子代理",
			"group.subagent.desc": "子代理辅助模型路由与工具注入。",
			"group.global": "全局",
			"group.global.desc": "降级策略与界面显示。",
			"task.vision": "图像分析 (vision_analyze)",
			"task.web_extract": "网页提取 (web_extract)",
			"task.web_crawl": "站点抓取 (web_crawl)",
			"task.compress": "文本压缩 (compress_text)",
			"task.compaction": "会话压缩 (compaction)",
			"task.skill": "技能预审 (skill)",
			"field.provider": "Provider",
			"field.model": "Model",
			"field.timeout": "超时 (ms)",
			"field.concurrency": "并发上限",
			"field.maxChars": "maxChars (页面字符上限)",
			"field.reasoningEffort": "思考档位",
			"placeholder.inheritModel": "(继承主模型)",
			"placeholder.inheritDefault": "(继承默认)",
			"subagent.mode": "模式",
			"subagent.native": "native (原生,不拦截)",
			"subagent.manual": "manual (统一用 general)",
			"subagent.visionAware": "vision-aware (按需 vision / general)",
			"subagent.generalProvider": "general provider",
			"subagent.generalModel": "general model",
			"subagent.visionProvider": "vision provider",
			"subagent.visionModel": "vision model",
			"subagent.visionKeywords": "视觉关键词 (逗号分隔)",
			"subagent.includeWorkflow": "workflow 并行子代理也走此路由 (includeWorkflow)",
			"subagent.prepareTools": "给子代理注入 AUX 工具作兜底 (prepareTools)",
			"global.fallbackToMain": "失败时降级到主模型 (fallbackToMain)",
			"global.forceAuxVision": "强制原生图片也走 AUX 视觉 (forceAuxVision)",
			"global.visionFallbackToMain": "视觉辅助失败时降级到主模型 (visionFallbackToMain)",
			"global.showStatusChip": "在对话界面显示辅助模型状态芯片",

			"group.platform": "平台开关",
			"group.platform.desc": "选择每个工具/桥接使用原生、AUX 还是未来深耕模式。",
			"field.mode": "模式",
			"mode.native": "native (原生)",
			"mode.aux": "aux (使用 AUX)",
			"mode.compat": "compat (未来深耕,暂不可用)",
			"skill.mode.label": "SKILL 模式",
			"skill.mode.native": "native (不审计)",
			"skill.mode.audit": "audit (原文+报告)",
			"skill.mode.report": "report (仅报告)",
			"skill.mode.report-ondemand": "report-ondemand (仅报告,可按需取原文)",
			"skill.mode.auto": "auto (未来)",
			"debug.fullToolTrace": "记录完整工具调用/反馈 (fullToolTrace)",
			"debug.maxDebugEventBytes": "单条 debug 事件大小上限 (字节)",
			"debug.debugEventsInHistory": "debug 事件混入 /aux history",
			"debug.redactSecrets": "记录时排除疑似密钥/PII (redactSecrets)",
			"settings.patch": "一键打补丁",
			"settings.patching": "打补丁中…",
			"settings.patchDone": "已触发 /aux patch,请查看会话输出。",
			"settings.patchError": "打补丁失败: ",
			"status.refresh": "刷新状态",
			"status.loading": "正在获取平台状态…",
			"status.error": "无法获取平台状态: ",
			"status.core": "🔒 核心保护",
			"status.coreDetail": "图片生命周期 / 会话图片安全 / 失败冷却 / 事件审计(不可关闭)",
			"status.coreCount": "🔒 核心保护 · {count} 项已生效",
			"status.overview": "已启用 {enabled} 项 · 需处理 {issues} 项",
			"status.diagnostics": "诊断与修复",
			"status.diagnostics.desc": "补丁、依赖或配置缺失时,在这里一键修复。",
			"status.noIssues": "所有可选能力状态正常。",
			"status.restartRequired": "补丁已写入,重启 DSH 后生效",
			"status.state.enabled": "可用",
			"status.state.disabled": "已关闭",
			"status.state.unavailable": "不可用",
			"status.state.fixing": "修复中",
			"status.state.unknown": "未知",
			"status.reason.mode-native": "当前为 native,未使用 AUX",
			"status.reason.mode-aux": "当前为 aux,使用 AUX 实现",
			"status.reason.mode-compat": "compat 为规划中模式,暂不可用",
			"status.reason.patch-ok": "补丁已安装",
			"status.reason.patch-v1": "旧版 v1 补丁,建议升级",
			"status.reason.patch-partial": "补丁部分安装,需重打",
			"status.reason.patch-missing": "补丁未安装,需打补丁",
			"status.reason.patch-unknown": "无法检测补丁状态,请运行 install.sh 或确认安装方式",
			"status.reason.config-missing": "需要配置对应任务模型",
			"status.reason.dependency-missing": "缺少 dsh-compaction-basic 依赖",
			"status.reason.skill-mode-native": "SKILL 模式为 native,未审计",
			"status.reason.vision-disabled-image-bridge-enabled": "vision_analyze 已关闭,但 imageBridge 仍开启",
			"status.patch.installed": "已装",
			"status.patch.missing": "未装",
			"status.patch.partial": "部分",
			"status.patch.unknown": "未知",
			"status.patch.not-applicable": "—",
			"status.action.patch": "打补丁",
			"status.action.configure": "去配置",
			"status.issue": "{label}: {reason}",
			"chip.vision": "视觉",
			"chip.web_extract": "网页",
			"chip.web_crawl": "站点",
			"chip.compaction": "会话压缩",
			"chip.skill": "技能预审",
			"chip.compress": "压缩",
			"chip.success": "成功",
			"chip.fail": "失败",
			"chip.fallback": " (已降级)"
		};
		const enDict = {
			"settings.title": "Auxiliary Models",
			"settings.intro": "Configure auxiliary model routes, timeouts, concurrency, and reasoning effort.",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.saved": "Saved",
			"settings.loading": "Loading auxiliary model config…",
			"settings.loadError": "Failed to load: ",
			"settings.reset": "Reset",
			"group.tools": "Tool Tasks",
			"group.tools.desc": "Vision, web extraction, long-text compression, and other auxiliary tools.",
			"group.bridges": "Bridge Tasks",
			"group.bridges.desc": "Session compaction and skill pre-audit.",
			"group.subagent": "Subagents",
			"group.subagent.desc": "Subagent auxiliary model routing and tool injection.",
			"group.global": "Global",
			"group.global.desc": "Fallback policy and interface display.",
			"task.vision": "Vision (vision_analyze)",
			"task.web_extract": "Web Extract (web_extract)",
			"task.web_crawl": "Web Crawl (web_crawl)",
			"task.compress": "Compress (compress_text)",
			"task.compaction": "Compaction (compaction)",
			"task.skill": "Skill Pre-audit (skill)",
			"field.provider": "Provider",
			"field.model": "Model",
			"field.timeout": "Timeout (ms)",
			"field.concurrency": "Max concurrency",
			"field.maxChars": "maxChars (page char limit)",
			"field.reasoningEffort": "Reasoning effort",
			"placeholder.inheritModel": "(Inherit main model)",
			"placeholder.inheritDefault": "(Inherit default)",
			"subagent.mode": "Mode",
			"subagent.native": "native (no interception)",
			"subagent.manual": "manual (always use general)",
			"subagent.visionAware": "vision-aware (vision/general on demand)",
			"subagent.generalProvider": "general provider",
			"subagent.generalModel": "general model",
			"subagent.visionProvider": "vision provider",
			"subagent.visionModel": "vision model",
			"subagent.visionKeywords": "Vision keywords (comma separated)",
			"subagent.includeWorkflow": "Route workflow parallel subagents through this too (includeWorkflow)",
			"subagent.prepareTools": "Inject AUX tools into subagents as fallback (prepareTools)",
			"global.fallbackToMain": "Fall back to main model on failure (fallbackToMain)",
			"global.forceAuxVision": "Force native images through AUX vision (forceAuxVision)",
			"global.visionFallbackToMain": "Fall back to main model when vision fails (visionFallbackToMain)",
			"global.showStatusChip": "Show auxiliary model status chip in conversation UI",

			"group.platform": "Platform Switches",
			"group.platform.desc": "Choose native, AUX, or future deep-compat mode for each tool/bridge.",
			"field.mode": "Mode",
			"mode.native": "native",
			"mode.aux": "aux",
			"mode.compat": "compat (future, unavailable)",
			"skill.mode.label": "SKILL mode",
			"skill.mode.native": "native (no audit)",
			"skill.mode.audit": "audit (original + report)",
			"skill.mode.report": "report (report only)",
			"skill.mode.report-ondemand": "report-ondemand (report only, original on demand)",
			"skill.mode.auto": "auto (future)",
			"debug.fullToolTrace": "Record full tool calls/results (fullToolTrace)",
			"debug.maxDebugEventBytes": "Max debug event bytes",
			"debug.debugEventsInHistory": "Include debug events in /aux history",
			"debug.redactSecrets": "Redact likely secrets/PII when recording (redactSecrets)",
			"settings.patch": "Run patch",
			"settings.patching": "Patching…",
			"settings.patchDone": "Triggered /aux patch; see conversation output.",
			"settings.patchError": "Patch failed: ",
			"status.refresh": "Refresh",
			"status.loading": "Loading platform status…",
			"status.error": "Failed to load status: ",
			"status.core": "🔒 Core protections",
			"status.coreDetail": "Image lifecycle / session image safety / failure cooldown / event audit (cannot be disabled)",
			"status.coreCount": "🔒 Core protections · {count} active",
			"status.overview": "{enabled} enabled · {issues} need attention",
			"status.diagnostics": "Diagnostics & Repair",
			"status.diagnostics.desc": "Fix missing patches, dependencies, or configuration here.",
			"status.noIssues": "All optional capabilities are healthy.",
			"status.restartRequired": "Patches written; restart DSH to apply",
			"status.state.enabled": "Enabled",
			"status.state.disabled": "Disabled",
			"status.state.unavailable": "Unavailable",
			"status.state.fixing": "Fixing",
			"status.state.unknown": "Unknown",
			"status.reason.mode-native": "Currently native; AUX not used",
			"status.reason.mode-aux": "Currently aux; AUX implementation used",
			"status.reason.mode-compat": "compat is planned and not available yet",
			"status.reason.patch-ok": "Patch installed",
			"status.reason.patch-v1": "Old v1 patch; upgrade recommended",
			"status.reason.patch-partial": "Patch partially installed; re-run patch",
			"status.reason.patch-missing": "Patch missing; run patch",
			"status.reason.patch-unknown": "Patch status cannot be detected; run install.sh or check installation",
			"status.reason.config-missing": "Configure the corresponding task model",
			"status.reason.dependency-missing": "Missing dsh-compaction-basic dependency",
			"status.reason.skill-mode-native": "SKILL mode is native; no audit",
			"status.reason.vision-disabled-image-bridge-enabled": "vision_analyze is disabled but imageBridge is still enabled",
			"status.patch.installed": "Installed",
			"status.patch.missing": "Missing",
			"status.patch.partial": "Partial",
			"status.patch.unknown": "Unknown",
			"status.patch.not-applicable": "—",
			"status.action.patch": "Patch",
			"status.action.configure": "Configure",
			"status.issue": "{label}: {reason}",
			"chip.vision": "Vision",
			"chip.web_extract": "Web",
			"chip.web_crawl": "Crawl",
			"chip.compaction": "Compaction",
			"chip.skill": "Skill",
			"chip.compress": "Compress",
			"chip.success": "OK",
			"chip.fail": "FAIL",
			"chip.fallback": " (fallback)"
		};

		var __locale = null;
		function localeFallbackLang() {
			if (typeof navigator === "undefined") return "zh";
			for (const tag of (navigator.languages || []).concat([navigator.language])) {
				const primary = String(tag || "").toLowerCase().split("-")[0];
				if (primary === "zh" || primary === "en") return primary;
			}
			return "zh";
		}
		function __t(key) {
			if (__locale && typeof __locale.translate === "function") {
				const text = __locale.translate(NS, key);
				if (typeof text === "string" && text !== key) return text;
			}
			return (localeFallbackLang() === "en" ? enDict : zhDict)[key] || key;
		}
		function useLocaleRevision() {
			const [, setRev] = react.useState(0);
			react.useEffect(() => {
				if (!__locale || typeof __locale.subscribe !== "function") return undefined;
				return __locale.subscribe(() => setRev((v) => v + 1));
			}, []);
		}
		function adoptLocale(locale, ctx) {
			if (!locale) return;
			__locale = locale;
			try {
				if (typeof locale.register === "function") {
					ctx.effect(() => locale.register(NS, { zh: zhDict, en: enDict }));
				}
			} catch { /* namespace already registered: keep existing copy */ }
		}

		/**
		 * Auxiliary-model settings page: grouped collapsible cards.
		 * Reads the `aux` namespace through settings.describe; writes through
		 * settings.mutate with the revision read at load.
		 */
		function AuxSettingsPage(props) {
			const { api, runAuxCommand } = props;
			const t = (props && props.t) || __t;
			useLocaleRevision();
			const [state, setState] = react.useState({ status: "loading", error: null, value: null, revision: 0, writable: true });
			const [catalog, setCatalog] = react.useState({ providers: [], models: [], reasoning: {} });
			const [openGroups, setOpenGroups] = react.useState({ diagnostics: true, tools: true, bridges: false, subagent: false, global: false });
			const load = react.useCallback(() => {
				let alive = true;
				Promise.all([
					api.settings.describe({}),
					api.llm.providers({}).catch(() => ({ result: { ok: false, error: { message: "providers unavailable" } } })),
					api.llm.models({}).catch(() => ({ result: { ok: false, error: { message: "models unavailable" } } }))
				]).then(([settingsResponse, providersResponse, modelsResponse]) => {
					if (!alive) return;
					if (!settingsResponse.result.ok) {
						setState({ status: "error", error: settingsResponse.result.error.message, value: null, revision: 0, writable: true });
						return;
					}
					const view = settingsResponse.result.value.namespaces.find((n) => n.ns === "aux");
					const value = view?.value ?? {};
					setState({ status: "ready", error: null, value, revision: view?.revision ?? 0, writable: settingsResponse.result.value.writable });
					const providers = providersResponse.result.ok
						? (providersResponse.result.value.providers ?? []).filter((p) => p.active === true)
						: [];
					const groups = modelsResponse.result.ok ? (modelsResponse.result.value.groups ?? []) : [];
					const models = [];
					const reasoning = {};
					for (const group of groups) {
						const pid = group.id ?? group.provider ?? "";
						for (const model of (group.models ?? [])) {
							const mid = model.id;
							models.push({ provider: pid, id: mid, name: model.name ?? model.id });
							const efforts = model?.reasoning?.efforts ?? group?.reasoning?.efforts;
							if (Array.isArray(efforts) && efforts.length > 0) {
								reasoning[pid + "\u0000" + mid] = efforts;
							}
						}
					}
					setCatalog({ providers, models, reasoning });
				}).catch((error) => {
					if (alive) setState({ status: "error", error: error instanceof Error ? error.message : String(error), value: null, revision: 0, writable: true });
				});
				return () => { alive = false; };
			}, [api]);
			react.useEffect(load, [load]);
			const [draft, setDraft] = react.useState(null);
			react.useEffect(() => {
				if (state.status === "ready" && draft === null) setDraft(structuredClone(state.value ?? {}));
			}, [state, draft]);
			const [saving, setSaving] = react.useState(false);
			const [saveError, setSaveError] = react.useState(null);
			const [saved, setSaved] = react.useState(false);
			const [patching, setPatching] = react.useState(false);
			const [patchStatus, setPatchStatus] = react.useState(null);
			const [status, setStatus] = react.useState(null);
			const [statusLoading, setStatusLoading] = react.useState(true);
			const [statusError, setStatusError] = react.useState(null);
			const loadStatus = react.useCallback(() => {
				let alive = true;
				setStatusLoading(true);
				setStatusError(null);
				Promise.resolve()
					.then(() => runAuxCommand("/aux status --json"))
					.then((result) => {
						if (!alive) return;
						if (result.kind !== "success" || typeof result.text !== "string") {
							throw new Error(result.text ?? "status command failed");
						}
						setStatus(JSON.parse(result.text));
					})
					.catch((error) => {
						if (alive) setStatusError(error instanceof Error ? error.message : String(error));
					})
					.finally(() => {
						if (alive) setStatusLoading(false);
					});
				return () => { alive = false; };
			}, [runAuxCommand]);
			react.useEffect(loadStatus, [loadStatus]);
			if (state.status === "loading") return react.createElement("div", { className: "ax-section" }, t("settings.loading"));
			if (state.status === "error") return react.createElement("div", { className: "ax-section" }, react.createElement("span", { className: "ax-error" }, t("settings.loadError") + state.error));
			const tasks = ["vision", "web_extract", "web_crawl", "compress", "compaction", "skill"];
			const field = (task, key) => draft?.tasks?.[task]?.[key];
			const setField = (task, key, value) => {
				setSaved(false);
				setSaveError(null);
				setDraft((d) => {
					const next = structuredClone(d ?? {});
					next.tasks = next.tasks ?? {};
					next.tasks[task] = next.tasks[task] ?? {};
					if (value === "") delete next.tasks[task][key];
					else next.tasks[task][key] = value;
					return next;
				});
			};
			const resetField = (task, key) => {
				setSaved(false);
				setSaveError(null);
				setDraft((d) => {
					const next = structuredClone(d ?? {});
					if (next.tasks?.[task]?.[key] !== void 0) delete next.tasks[task][key];
					return next;
				});
			};
			const save = () => {
				setSaving(true);
				setSaveError(null);
				const ops = [];
				for (const task of tasks) {
					const entry = draft?.tasks?.[task] ?? {};
					const base = ["tasks", task];
					const hasProvider = typeof entry.provider === "string" && entry.provider !== "";
					const hasModel = typeof entry.model === "string" && entry.model !== "";
					if (hasProvider && hasModel) {
						ops.push({ op: "set", path: [...base, "provider"], value: entry.provider });
						ops.push({ op: "set", path: [...base, "model"], value: entry.model });
					} else {
						ops.push({ op: "unset", path: [...base, "provider"] });
						ops.push({ op: "unset", path: [...base, "model"] });
					}
					for (const key of ["timeoutMs", "maxConcurrency"]) {
						const val = entry[key];
						const path = [...base, key];
						if (val !== void 0 && val !== "") ops.push({ op: "set", path, value: Number(val) });
						else ops.push({ op: "unset", path });
					}
					if (task === "web_extract" || task === "web_crawl") {
						const val = entry.maxChars;
						const path = [...base, "maxChars"];
						if (val !== void 0 && val !== "") ops.push({ op: "set", path, value: Number(val) });
						else ops.push({ op: "unset", path });
					}
					const effort = entry.reasoningEffort;
					const effortPath = [...base, "reasoningEffort"];
					if (typeof effort === "string" && effort !== "") ops.push({ op: "set", path: effortPath, value: effort });
					else ops.push({ op: "unset", path: effortPath });
				}
				const sub = draft?.subagent ?? {};
				if (sub.mode !== void 0 && sub.mode !== "native") ops.push({ op: "set", path: ["subagent", "mode"], value: sub.mode });
				else ops.push({ op: "unset", path: ["subagent", "mode"] });
				if (sub.includeWorkflow === false) ops.push({ op: "set", path: ["subagent", "includeWorkflow"], value: false });
				else ops.push({ op: "unset", path: ["subagent", "includeWorkflow"] });
				for (const group of ["general", "vision"]) {
					const g = sub?.[group] ?? {};
					const gbase = ["subagent", group];
					const gp = typeof g.provider === "string" && g.provider !== "";
					const gm = typeof g.model === "string" && g.model !== "";
					if (gp && gm) {
						ops.push({ op: "set", path: [...gbase, "provider"], value: g.provider });
						ops.push({ op: "set", path: [...gbase, "model"], value: g.model });
					} else {
						ops.push({ op: "unset", path: [...gbase, "provider"] });
						ops.push({ op: "unset", path: [...gbase, "model"] });
					}
				}
				if (sub.prepareTools === false) ops.push({ op: "set", path: ["subagent", "prepareTools"], value: false });
				else ops.push({ op: "unset", path: ["subagent", "prepareTools"] });
				if (Array.isArray(sub.visionKeywords) && sub.visionKeywords.length > 0) ops.push({ op: "set", path: ["subagent", "visionKeywords"], value: sub.visionKeywords });
				else ops.push({ op: "unset", path: ["subagent", "visionKeywords"] });
				if (draft?.fallbackToMain !== void 0) {
					if (draft.fallbackToMain === false) ops.push({ op: "set", path: ["fallbackToMain"], value: false });
					else ops.push({ op: "unset", path: ["fallbackToMain"] });
				}
				if (draft?.forceAuxVision !== void 0) {
					if (draft.forceAuxVision) ops.push({ op: "set", path: ["forceAuxVision"], value: true });
					else ops.push({ op: "unset", path: ["forceAuxVision"] });
				}
				if (draft?.visionFallbackToMain !== void 0) {
					if (draft.visionFallbackToMain === false) ops.push({ op: "set", path: ["visionFallbackToMain"], value: false });
					else ops.push({ op: "unset", path: ["visionFallbackToMain"] });
				}
				if (draft?.showStatusChip !== void 0) {
					if (draft.showStatusChip === false) ops.push({ op: "set", path: ["showStatusChip"], value: false });
					else ops.push({ op: "unset", path: ["showStatusChip"] });
				}
				const enabledKeys = ["vision_analyze", "web_extract", "web_crawl", "compress_text", "imageBridge", "subagentBridge", "workflowBridge", "compactionBridge", "skillAudit"];
				for (const key of enabledKeys) {
					const val = draft?.enabled?.[key];
					if (val !== void 0 && val !== "aux") ops.push({ op: "set", path: ["enabled", key], value: val });
					else ops.push({ op: "unset", path: ["enabled", key] });
				}
				const skillMode = draft?.skill?.mode;
				if (skillMode !== void 0 && skillMode !== "audit") ops.push({ op: "set", path: ["skill", "mode"], value: skillMode });
				else ops.push({ op: "unset", path: ["skill", "mode"] });
				const debugDefaults = { fullToolTrace: false, maxDebugEventBytes: 65536, debugEventsInHistory: false, redactSecrets: true };
				for (const key of Object.keys(debugDefaults)) {
					const val = draft?.debug?.[key];
					if (val !== void 0 && val !== debugDefaults[key]) ops.push({ op: "set", path: ["debug", key], value: key === "maxDebugEventBytes" ? Number(val) : val });
					else ops.push({ op: "unset", path: ["debug", key] });
				}
				api.settings.mutate({ ns: "aux", ops, expectedRevision: state.revision }).then((response) => {
					setSaving(false);
					if (!response.result.ok) {
						setSaveError(response.result.error.message);
						return;
					}
					setSaved(true);
					setState((s) => ({ ...s, revision: response.result.value.revision, value: response.result.value.value }));
					loadStatus();
				}).catch((error) => {
					setSaving(false);
					setSaveError(error instanceof Error ? error.message : String(error));
				});
			};
			const runPatch = () => {
				setPatching(true);
				setPatchStatus(null);
				Promise.resolve()
					.then(() => runAuxCommand("/aux patch"))
					.then((result) => {
						if (result.kind !== "success") throw new Error(result.text ?? "patch failed");
						setPatchStatus({ ok: true, text: t("settings.patchDone") });
						loadStatus();
					})
					.catch((error) => {
						setPatchStatus({ ok: false, text: t("settings.patchError") + (error?.message ?? String(error)) });
					})
					.finally(() => setPatching(false));
			};
			const providerOptions = catalog.providers.map((p) => ({ value: p.provider, label: (p.displayName ?? p.provider) + " (" + p.provider + ")" }));
			const modelOptionsFor = (task) => {
				const pid = field(task, "provider") ?? "";
				if (pid === "") return [];
				const ids = catalog.models.filter((m) => m.provider === pid).map((m) => m.id);
				return [...new Set(ids)];
			};
			const reasoningOptionsFor = (task) => {
				const pid = field(task, "provider") ?? "";
				const mid = field(task, "model") ?? "";
				if (!pid || !mid) return [];
				return catalog.reasoning[pid + "\u0000" + mid] ?? [];
			};
			const select = (task, key, options, placeholder) => react.createElement("select", {
				value: field(task, key) ?? "",
				disabled: !state.writable || options.length === 0,
				onChange: (e) => {
					const value = e.target.value;
					setField(task, key, value);
					if (key === "provider") setField(task, "model", "");
				}
			}, react.createElement("option", { value: "" }, placeholder),
				options.map((o) => react.createElement("option", { key: o.value, value: o.value }, o.label)));
			const fieldRow = (task, key, label, control) => react.createElement("div", { className: "ax-row" },
				react.createElement("div", { className: "ax-field-head" },
					react.createElement("label", null, label),
					field(task, key) !== void 0 && field(task, key) !== "" ? react.createElement("button", {
						type: "button",
						className: "ax-reset",
						disabled: !state.writable,
						onClick: () => resetField(task, key)
					}, t("settings.reset")) : null
				),
				control
			);
			const taskCard = (task) => {
				const effortOptions = reasoningOptionsFor(task);
				return react.createElement("div", { key: task, className: "ax-task" },
					react.createElement("h3", null, t("task." + task)),
					react.createElement("div", { className: "ax-grid" },
						fieldRow(task, "provider", t("field.provider"), select(task, "provider", providerOptions, t("placeholder.inheritModel"))),
						fieldRow(task, "model", t("field.model"), select(task, "model", modelOptionsFor(task).map((id) => ({ value: id, label: id })), t("placeholder.inheritModel"))),
						fieldRow(task, "timeoutMs", t("field.timeout"), react.createElement("input", {
							type: "number", value: field(task, "timeoutMs") ?? "", placeholder: "60000", disabled: !state.writable, onChange: (e) => setField(task, "timeoutMs", e.target.value)
						})),
						fieldRow(task, "maxConcurrency", t("field.concurrency"), react.createElement("input", {
							type: "number", value: field(task, "maxConcurrency") ?? "", placeholder: "2", disabled: !state.writable, onChange: (e) => setField(task, "maxConcurrency", e.target.value)
						})),
						(task === "web_extract" || task === "web_crawl") ? fieldRow(task, "maxChars", t("field.maxChars"), react.createElement("input", {
							type: "number", min: "1", value: field(task, "maxChars") ?? "", placeholder: "8000", disabled: !state.writable, onChange: (e) => setField(task, "maxChars", e.target.value)
						})) : null,
						fieldRow(task, "reasoningEffort", t("field.reasoningEffort"), react.createElement("select", {
							value: field(task, "reasoningEffort") ?? "",
							disabled: !state.writable || effortOptions.length === 0,
							onChange: (e) => setField(task, "reasoningEffort", e.target.value)
						}, react.createElement("option", { value: "" }, t("placeholder.inheritDefault")),
							effortOptions.map((o) => react.createElement("option", { key: o.id, value: o.id }, o.name ?? o.id))))
					)
				);
			};
			const group = (id, title, desc, children) => {
				const open = openGroups[id] === true;
				return react.createElement("div", { className: "ax-group" + (open ? " ax-group-open" : "") },
					react.createElement("button", {
						type: "button",
						className: "ax-group-header",
						"aria-expanded": open,
						onClick: () => setOpenGroups((s) => ({ ...s, [id]: !s[id] }))
					},
						react.createElement("span", { className: "ax-group-headText" },
							react.createElement("span", { className: "ax-group-title" }, title),
							react.createElement("span", { className: "ax-group-desc" }, desc)
						),
						react.createElement("span", { className: "ax-group-chevron" + (open ? " ax-group-chevronOpen" : "") }, "▾")
					),
					open ? react.createElement("div", { className: "ax-group-body" }, children) : null
				);
			};
			const sub = draft?.subagent ?? {};
			const subField = (group, key) => sub?.[group]?.[key];
			const setSub = (patch) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.subagent = { ...(next.subagent ?? {}), ...patch }; return next; }); };
			const setSubGroup = (group, key, value) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.subagent = next.subagent ?? {}; next.subagent[group] = next.subagent[group] ?? {}; if (value === "") delete next.subagent[group][key]; else next.subagent[group][key] = value; return next; }); };
			const subGroupSelect = (group, key, options, placeholder) => react.createElement("select", {
				value: subField(group, key) ?? "",
				disabled: !state.writable || options.length === 0,
				onChange: (e) => { const value = e.target.value; setSubGroup(group, key, value); if (key === "provider") setSubGroup(group, "model", ""); }
			}, react.createElement("option", { value: "" }, placeholder),
				options.map((o) => react.createElement("option", { key: o.value, value: o.value }, o.label)));
			const subModelOptionsFor = (group) => {
				const pid = subField(group, "provider") ?? "";
				if (pid === "") return [];
				const ids = catalog.models.filter((m) => m.provider === pid).map((m) => m.id);
				return [...new Set(ids)];
			};
			const switchRow = (label, checked, disabled, onChange) => react.createElement("label", { className: "ax-switch" },
				react.createElement("input", { type: "checkbox", checked, disabled: disabled || !state.writable, onChange }), label);
			const setEnabled = (key, value) => {
				setSaved(false);
				setSaveError(null);
				setDraft((d) => {
					const next = structuredClone(d ?? {});
					next.enabled = next.enabled ?? {};
					if (value === "aux") delete next.enabled[key];
					else next.enabled[key] = value;
					return next;
				});
			};
			const setSkillMode = (value) => {
				setSaved(false);
				setSaveError(null);
				setDraft((d) => {
					const next = structuredClone(d ?? {});
					next.skill = next.skill ?? {};
					if (value === "audit") delete next.skill.mode;
					else next.skill.mode = value;
					return next;
				});
			};
			const setDebug = (key, value) => {
				setSaved(false);
				setSaveError(null);
				setDraft((d) => {
					const next = structuredClone(d ?? {});
					next.debug = next.debug ?? {};
					if (value === "" || value === false || value === 65536) delete next.debug[key];
					else next.debug[key] = value;
					return next;
				});
			};
			const statusByKey = {};
			if (status !== null && Array.isArray(status.items)) {
				for (const it of status.items) statusByKey[it.key] = it;
			}
			const platformSelect = (key, label) => {
				const meta = statusByKey[key] ?? null;
				const state = meta?.state ?? "unknown";
				const stateText = t("status.state." + state);
				const reason = meta ? t("status.reason." + meta.reason) : stateText;
				const patchLabel = meta?.patch ? t("status.patch." + meta.patch) : null;
				const title = label + " · " + stateText + (reason ? " — " + reason : "");
				return react.createElement("div", { className: "ax-row", title },
					react.createElement("div", { className: "ax-field-head" },
						react.createElement("span", { className: "ax-dot ax-dot-" + state, "aria-hidden": "true" }),
						react.createElement("label", null, label),
						meta?.patch && patchLabel ? react.createElement("span", { className: "ax-status-badge ax-status-badge-" + meta.patch, title: reason }, patchLabel) : null
					),
					react.createElement("select", {
						value: draft?.enabled?.[key] ?? "aux",
						disabled: !state.writable,
						onChange: (e) => setEnabled(key, e.target.value)
					},
						react.createElement("option", { value: "native" }, t("mode.native")),
						react.createElement("option", { value: "aux", disabled: meta?.state === "unavailable" && meta?.action === "patch" }, t("mode.aux")),
						react.createElement("option", { value: "compat", disabled: true }, t("mode.compat"))
					)
				);
			};
			const statusPanel = () => {
				if (statusLoading) {
					return react.createElement("div", { className: "ax-status-summary" }, t("status.loading"));
				}
				if (statusError !== null) {
					return react.createElement("div", { className: "ax-status-head" },
						react.createElement("span", { className: "ax-status-summary ax-error", role: "alert" }, t("status.error") + statusError),
						react.createElement("button", { type: "button", className: "ax-repair-button", onClick: loadStatus }, t("status.refresh"))
					);
				}
				const items = status?.items ?? [];
				const enabledCount = items.filter((entry) => entry.state === "enabled").length;
				const unavailableCount = items.filter((entry) => entry.state === "unavailable").length;
				const issues = status?.issues ?? [];
				const warnings = status?.warnings ?? [];
				const summary = t("status.overview").replace("{enabled}", String(enabledCount)).replace("{issues}", String(unavailableCount));
				return group("diagnostics", t("status.diagnostics"), t("status.diagnostics.desc"),
					react.createElement("div", { className: "ax-status-head" },
						react.createElement("span", { className: "ax-status-summary" },
							t("status.coreCount").replace("{count}", String(status?.core?.count ?? 0))
						),
						react.createElement("span", { className: "ax-status-summary" }, summary),
						react.createElement("button", { type: "button", className: "ax-repair-button", disabled: statusLoading, onClick: loadStatus }, t("status.refresh"))
					),
					issues.length === 0 && warnings.length === 0 && status?.restartRequired !== true
						? react.createElement("div", { className: "ax-status-summary" }, t("status.noIssues"))
						: [
							status?.restartRequired === true
								? react.createElement("div", { key: "restart-required", className: "ax-status-issue" },
									react.createElement("span", { className: "ax-dot ax-dot-fixing", "aria-hidden": "true" }),
									react.createElement("span", { className: "ax-status-issue-text" }, t("status.restartRequired"))
								)
								: null,
							...issues.map((issue) => {
								const label = issue.key;
								return react.createElement("div", { key: issue.key, className: "ax-status-issue" },
									react.createElement("span", { className: "ax-dot ax-dot-unavailable", "aria-hidden": "true" }),
									react.createElement("span", { className: "ax-status-issue-text" }, label + ": " + t("status.reason." + issue.reason)),
									issue.action === "patch"
										? react.createElement("button", { type: "button", className: "ax-repair-button", disabled: patching, onClick: runPatch }, patching ? t("settings.patching") : t("status.action.patch"))
										: issue.action === "configure"
											? react.createElement("span", { className: "ax-status-badge ax-status-badge-partial" }, t("status.action.configure"))
											: null
								);
							}),
							...warnings.map((warning) => {
								return react.createElement("div", { key: warning.code, className: "ax-status-issue" },
									react.createElement("span", { className: "ax-dot ax-dot-fixing", "aria-hidden": "true" }),
									react.createElement("span", { className: "ax-status-issue-text" }, t("status.reason." + warning.reason))
								);
							})
						]
				);
			};
			return react.createElement("div", { className: "ax-section" },
				statusPanel(),
				group("tools", t("group.tools"), t("group.tools.desc"),
					tasks.filter((x) => ["vision", "web_extract", "web_crawl", "compress"].includes(x)).map(taskCard)
				),
				group("bridges", t("group.bridges"), t("group.bridges.desc"),
					tasks.filter((x) => ["compaction", "skill"].includes(x)).map(taskCard)
				),
				group("subagent", t("group.subagent"), t("group.subagent.desc"),
					react.createElement("div", { className: "ax-grid" },
						react.createElement("div", { className: "ax-row" }, react.createElement("label", null, t("subagent.mode")), react.createElement("select", {
							value: sub.mode ?? "native", disabled: !state.writable, onChange: (e) => setSub({ mode: e.target.value })
						},
							react.createElement("option", { value: "native" }, t("subagent.native")),
							react.createElement("option", { value: "manual" }, t("subagent.manual")),
							react.createElement("option", { value: "vision-aware" }, t("subagent.visionAware"))
						)),
						react.createElement("div", { className: "ax-row" }, react.createElement("label", null, t("subagent.generalProvider")), subGroupSelect("general", "provider", providerOptions, t("placeholder.inheritModel"))),
						react.createElement("div", { className: "ax-row" }, react.createElement("label", null, t("subagent.generalModel")), subGroupSelect("general", "model", subModelOptionsFor("general").map((id) => ({ value: id, label: id })), t("placeholder.inheritModel"))),
						react.createElement("div", { className: "ax-row" }, react.createElement("label", null, t("subagent.visionProvider")), subGroupSelect("vision", "provider", providerOptions, t("placeholder.inheritModel"))),
						react.createElement("div", { className: "ax-row" }, react.createElement("label", null, t("subagent.visionModel")), subGroupSelect("vision", "model", subModelOptionsFor("vision").map((id) => ({ value: id, label: id })), t("placeholder.inheritModel"))),
						react.createElement("div", { className: "ax-row" }, react.createElement("label", null, t("subagent.visionKeywords")), react.createElement("input", {
							type: "text", value: Array.isArray(sub.visionKeywords) ? sub.visionKeywords.join(",") : "", placeholder: "图片,image,截图", disabled: !state.writable, onChange: (e) => setSub({ visionKeywords: e.target.value === "" ? [] : e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
						}))
					),
					switchRow(t("subagent.includeWorkflow"), sub.includeWorkflow !== false, false, (e) => setSub({ includeWorkflow: e.target.checked })),
					switchRow(t("subagent.prepareTools"), sub.prepareTools !== false, false, (e) => setSub({ prepareTools: e.target.checked }))
				),
				group("global", t("group.global"), t("group.global.desc"),
					switchRow(t("global.fallbackToMain"), draft?.fallbackToMain !== false, false, (e) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.fallbackToMain = e.target.checked; return next; }); }),
					switchRow(t("global.forceAuxVision"), draft?.forceAuxVision === true, false, (e) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.forceAuxVision = e.target.checked; return next; }); }),
					switchRow(t("global.visionFallbackToMain"), draft?.visionFallbackToMain !== false, false, (e) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.visionFallbackToMain = e.target.checked; return next; }); }),
					switchRow(t("global.showStatusChip"), draft?.showStatusChip !== false, false, (e) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.showStatusChip = e.target.checked; return next; }); })
				),
				group("platform", t("group.platform"), t("group.platform.desc"),
					react.createElement("div", { className: "ax-grid" },
						platformSelect("vision_analyze", "vision_analyze"),
						platformSelect("web_extract", "web_extract"),
						platformSelect("web_crawl", "web_crawl"),
						platformSelect("compress_text", "compress_text"),
						platformSelect("imageBridge", "imageBridge"),
						platformSelect("subagentBridge", "subagentBridge"),
						platformSelect("workflowBridge", "workflowBridge"),
						platformSelect("compactionBridge", "compactionBridge"),
						platformSelect("skillAudit", "skillAudit"),
						react.createElement("div", { className: "ax-row" },
							react.createElement("label", null, t("skill.mode.label")),
							react.createElement("select", {
								value: draft?.skill?.mode ?? "audit",
								disabled: !state.writable,
								onChange: (e) => setSkillMode(e.target.value)
							},
								react.createElement("option", { value: "native" }, t("skill.mode.native")),
								react.createElement("option", { value: "audit" }, t("skill.mode.audit")),
								react.createElement("option", { value: "report" }, t("skill.mode.report")),
								react.createElement("option", { value: "report-ondemand" }, t("skill.mode.report-ondemand")),
								react.createElement("option", { value: "auto", disabled: true }, t("skill.mode.auto"))
							)
						)
					),
					switchRow(t("debug.fullToolTrace"), draft?.debug?.fullToolTrace === true, false, (e) => setDebug("fullToolTrace", e.target.checked)),
					react.createElement("div", { className: "ax-row" },
						react.createElement("label", null, t("debug.maxDebugEventBytes")),
						react.createElement("input", {
							type: "number", min: "1024", value: draft?.debug?.maxDebugEventBytes ?? 65536, disabled: !state.writable,
							onChange: (e) => setDebug("maxDebugEventBytes", e.target.value === "" ? "" : Number(e.target.value))
						})
					),
					switchRow(t("debug.debugEventsInHistory"), draft?.debug?.debugEventsInHistory === true, false, (e) => setDebug("debugEventsInHistory", e.target.checked)),
					switchRow(t("debug.redactSecrets"), draft?.debug?.redactSecrets !== false, false, (e) => setDebug("redactSecrets", e.target.checked)),
					react.createElement("div", { className: "ax-actions" },
						react.createElement("button", { type: "button", className: "ax-save", disabled: patching, onClick: runPatch }, patching ? t("settings.patching") : t("settings.patch")),
						patchStatus !== null && react.createElement("span", { className: "ax-status " + (patchStatus.ok ? "ax-ok-text" : "ax-error"), role: "status" }, patchStatus.text)
					)
				),
				react.createElement("div", { className: "ax-actions" },
					react.createElement("button", { type: "button", className: "ax-save", disabled: saving || !state.writable, onClick: save }, saving ? t("settings.saving") : t("settings.save")),
					saveError !== null && react.createElement("span", { className: "ax-status ax-error", role: "alert" }, saveError),
					saved && react.createElement("span", { className: "ax-status ax-ok-text" }, t("settings.saved"))
				)
			);
		}

		/**
		 * Composer status chip: latest auxiliary call from the `aux-status`
		 * projection. Renders only while the projection key exists.
		 */
		function AuxStatusChip(props) {
			const t = (props && props.t) || __t;
			useLocaleRevision();
			const projection = props.useProjection("aux-status");
			if (projection === void 0) return null;
			const tasks = projection.tasks ?? {};
			const entries = Object.values(tasks);
			if (entries.length === 0) return null;
			const last = entries[entries.length - 1];
			const ok = last.ok === true;
			const chipKey = "chip." + last.task;
			const taskLabel = (zhDict[chipKey] || enDict[chipKey]) ? t(chipKey) : last.task;
			const label = taskLabel + (ok ? " ✓" : " ✗");
			const title = `aux ${last.task}: ${ok ? t("chip.success") : t("chip.fail")} ${last.durationMs}ms${last.fallbackUsed ? t("chip.fallback") : ""}`;
			return react.createElement("span", { className: "ax-wrap", title }, react.createElement("span", {
				className: "ax-chip " + (ok ? "ax-ok" : "ax-fail"),
				"aria-label": title
			}, label));
		}

		/** Required client services. */
		const inject = ["slots", "connection", "remote", "remote.commands"];
		/**
		 * Client plugin body: register the settings page and the status chip.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			adoptLocale(ctx.get("locale"), ctx);
			if (!__locale) {
				ctx.inject(["locale"], (sub) => {
					adoptLocale(sub.locale, ctx);
				});
			}
			const connection = ctx.get("connection");
			const runAuxCommand = async (line) => {
				const listResponse = await connection.api.sessions.list({});
				const items = listResponse?.result?.value?.items ?? [];
				if (items.length === 0) throw new Error("当前没有可用会话,无法执行命令");
				const sessionId = items[0].sessionId;
				const result = await ctx.remote.commands.execute(sessionId, line);
				if (!result.ok) throw new Error((result.error?.code ?? "") + ": " + (result.error?.message ?? "command failed"));
				if (result.value === void 0) throw new Error("unknown command: " + line);
				return result.value.result;
			};
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "aux",
				order: 30,
				label: () => __t("settings.title"),
				locale: NS,
				inject: () => ({ api: connection.api, runAuxCommand })
			}, AuxSettingsPage));
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "aux-status",
				locale: NS
			}, AuxStatusChip));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
