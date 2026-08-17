/**
 * dsh-aux browser half: the auxiliary-model settings page plus a composer
 * status chip.
 *
 * Settings page (settings.section "aux"): per-task provider/model/timeout/
 * concurrency plus the global main-model fallback switch, read and written
 * through the settings wire (`settings.describe` / `settings.mutate` on
 * `aux`). The chip (conversation.input.left seat) renders the latest
 * auxiliary call from the `aux-status` projection.
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
		const css = ".ax-wrap{display:inline-flex;align-items:center;gap:6px;min-width:0}.ax-chip{display:inline-flex;align-items:center;gap:4px;border:none;border-radius:999px;padding:2px 8px;font-size:13px;font-weight:500;line-height:20px;cursor:default;font-family:inherit}.ax-ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}.ax-fail{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}.ax-none{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}.ax-section{display:flex;flex-direction:column;gap:16px;padding:16px;max-width:560px}.ax-task{border:1px solid var(--dsw-alias-border-strong);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px}.ax-task h3{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}.ax-row{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}.ax-row input{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-strong);border-radius:4px;padding:4px 8px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}.ax-row input:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:1px}.ax-row select{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-strong);border-radius:4px;padding:4px 8px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}.ax-row select:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:1px}.ax-switch{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}.ax-actions{display:flex;gap:8px;align-items:center}.ax-save{border:none;border-radius:4px;padding:4px 12px;font-size:13px;font-weight:500;cursor:pointer;color:#fff;background:var(--dsw-alias-state-success-primary)}.ax-save:disabled{opacity:.6;cursor:default}.ax-status{font-size:12px;line-height:18px}.ax-error{color:var(--dsw-alias-state-error-primary)}.ax-ok-text{color:var(--dsw-alias-state-success-primary)}";
		const tagId = "@dolorescaritasangelus/dsh-aux/Aux.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dolorescaritasangelus/dsh-aux";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		/**
		 * Auxiliary-model settings page: one block per task with provider,
		 * model, timeout (ms) and concurrency fields, plus the fallback switch.
		 * Reads the `aux` namespace through settings.describe; writes through
		 * settings.mutate with the revision read at load.
		 */
		function AuxSettingsPage(props) {
			const { api } = props;
			const [state, setState] = react.useState({ status: "loading", error: null, value: null, revision: 0, writable: true });
			const [catalog, setCatalog] = react.useState({ providers: [], models: [] });
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
					// provider/model catalog for the selects: only ACTIVE providers
					// (routes the user actually configured) — dormant directory entries
					// (amazon-bedrock, openai, … without credentials) are noise.
					const providers = providersResponse.result.ok
						? (providersResponse.result.value.providers ?? []).filter((p) => p.active === true)
						: [];
					const groups = modelsResponse.result.ok ? (modelsResponse.result.value.groups ?? []) : [];
					const models = [];
					for (const group of groups) {
						const pid = group.id ?? group.provider ?? "";
						for (const model of (group.models ?? [])) {
							models.push({ provider: pid, id: model.id, name: model.name ?? model.id });
						}
					}
					setCatalog({ providers, models });
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
			if (state.status === "loading") return react.createElement("div", { className: "ax-section" }, "加载辅助模型配置…");
			if (state.status === "error") return react.createElement("div", { className: "ax-section" }, react.createElement("span", { className: "ax-error" }, "加载失败: " + state.error));
			const tasks = ["vision", "web_extract", "compress", "compaction"];
			const labels = { vision: "图像分析 (vision_analyze)", web_extract: "网页提取 (web_extract)", compress: "文本压缩 (compress_text)", compaction: "会话压缩 (compaction)" };
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
			const save = () => {
				setSaving(true);
				setSaveError(null);
				const ops = [];
				for (const task of tasks) {
					const entry = draft?.tasks?.[task] ?? {};
					for (const key of ["provider", "model", "timeoutMs", "maxConcurrency"]) {
						const path = ["tasks", task, key];
						if (entry[key] !== void 0 && entry[key] !== "") ops.push({ op: "set", path, value: key === "timeoutMs" || key === "maxConcurrency" ? Number(entry[key]) : entry[key] });
						else ops.push({ op: "unset", path });
					}
				}
				if (draft?.fallbackToMain !== void 0) {
					if (draft.fallbackToMain) ops.push({ op: "set", path: ["fallbackToMain"], value: true });
					else ops.push({ op: "unset", path: ["fallbackToMain"] });
				}
				if (draft?.forceAuxVision !== void 0) {
					if (draft.forceAuxVision) ops.push({ op: "set", path: ["forceAuxVision"], value: true });
					else ops.push({ op: "unset", path: ["forceAuxVision"] });
				}
				if (draft?.visionFallbackToMain !== void 0) {
					if (draft.visionFallbackToMain) ops.push({ op: "set", path: ["visionFallbackToMain"], value: true });
					else ops.push({ op: "unset", path: ["visionFallbackToMain"] });
				}
				if (draft?.showStatusChip !== void 0) {
					if (draft.showStatusChip === false) ops.push({ op: "set", path: ["showStatusChip"], value: false });
					else ops.push({ op: "unset", path: ["showStatusChip"] });
				}
				api.settings.mutate({ ns: "aux", ops, expectedRevision: state.revision }).then((response) => {
					setSaving(false);
					if (!response.result.ok) {
						setSaveError(response.result.error.message);
						return;
					}
					setSaved(true);
					setState((s) => ({ ...s, revision: response.result.value.revision, value: response.result.value.value }));
				}).catch((error) => {
					setSaving(false);
					setSaveError(error instanceof Error ? error.message : String(error));
				});
			};
			const providerOptions = catalog.providers.map((p) => ({ value: p.provider, label: (p.displayName ?? p.provider) + " (" + p.provider + ")" }));
			const modelOptionsFor = (task) => {
				const pid = field(task, "provider") ?? "";
				if (pid === "") return [];
				const ids = catalog.models.filter((m) => m.provider === pid).map((m) => m.id);
				return [...new Set(ids)];
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
			return react.createElement("div", { className: "ax-section" }, tasks.map((task) => react.createElement("div", { key: task, className: "ax-task" },
				react.createElement("h3", null, labels[task]),
				react.createElement("div", { className: "ax-row" }, react.createElement("label", null, "provider"), select(task, "provider", providerOptions, "(继承主模型)")),
				react.createElement("div", { className: "ax-row" }, react.createElement("label", null, "model"), select(task, "model", modelOptionsFor(task).map((id) => ({ value: id, label: id })), "(继承主模型)")),
				react.createElement("div", { className: "ax-row" }, react.createElement("label", null, "timeout (ms)"), react.createElement("input", {
					type: "number", value: field(task, "timeoutMs") ?? "", placeholder: "60000", disabled: !state.writable, onChange: (e) => setField(task, "timeoutMs", e.target.value)
				})),
				react.createElement("div", { className: "ax-row" }, react.createElement("label", null, "并发上限"), react.createElement("input", {
					type: "number", value: field(task, "maxConcurrency") ?? "", placeholder: "2", disabled: !state.writable, onChange: (e) => setField(task, "maxConcurrency", e.target.value)
				}))
			)),
				react.createElement("label", { className: "ax-switch" },
					react.createElement("input", { type: "checkbox", checked: draft?.fallbackToMain !== false, disabled: !state.writable, onChange: (e) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.fallbackToMain = e.target.checked; return next; }); } }),
					"失败时降级到主模型 (fallbackToMain)"
				),
				react.createElement("label", { className: "ax-switch" },
					react.createElement("input", { type: "checkbox", checked: draft?.forceAuxVision === true, disabled: !state.writable, onChange: (e) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.forceAuxVision = e.target.checked; return next; }); } }),
					"强制原生图片也走 AUX 视觉 (forceAuxVision)"
				),
				react.createElement("label", { className: "ax-switch" },
					react.createElement("input", { type: "checkbox", checked: draft?.visionFallbackToMain !== false, disabled: !state.writable, onChange: (e) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.visionFallbackToMain = e.target.checked; return next; }); } }),
					"视觉辅助失败时降级到主模型 (visionFallbackToMain)"
				),
				react.createElement("label", { className: "ax-switch" },
					react.createElement("input", { type: "checkbox", checked: draft?.showStatusChip !== false, disabled: !state.writable, onChange: (e) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.showStatusChip = e.target.checked; return next; }); } }),
					"在对话界面显示辅助模型状态芯片"
				),
				react.createElement("div", { className: "ax-actions" },
					react.createElement("button", { type: "button", className: "ax-save", disabled: saving || !state.writable, onClick: save }, saving ? "保存中…" : "保存"),
					saveError !== null && react.createElement("span", { className: "ax-status ax-error", role: "alert" }, saveError),
					saved && react.createElement("span", { className: "ax-status ax-ok-text" }, "已保存")
				)
			);
		}
		/**
		 * Composer status chip: latest auxiliary call from the `aux-status`
		 * projection. Renders only while the projection key exists.
		 */
		function AuxStatusChip(props) {
			const projection = props.useProjection("aux-status");
			if (projection === void 0) return null;
			const tasks = projection.tasks ?? {};
			const entries = Object.values(tasks);
			if (entries.length === 0) return null;
			const last = entries[entries.length - 1];
			const ok = last.ok === true;
			const taskLabel = last.task === "vision" ? "视觉" : last.task === "web_extract" ? "网页" : last.task === "compaction" ? "会话压缩" : "压缩";
			const label = taskLabel + (ok ? " ✓" : " ✗");
			const title = `辅助调用 ${last.task}: ${ok ? "成功" : "失败"} ${last.durationMs}ms${last.fallbackUsed ? " (已降级)" : ""}`;
			return react.createElement("span", { className: "ax-wrap", title }, react.createElement("span", {
				className: "ax-chip " + (ok ? "ax-ok" : "ax-fail"),
				"aria-label": title
			}, label));
		}
		/** Required client services. */
		const inject = ["slots", "connection"];
		/**
		 * Client plugin body: register the settings page and the status chip.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const connection = ctx.get("connection");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "aux",
				order: 30,
				label: () => "辅助模型",
				inject: () => ({ api: connection.api })
			}, AuxSettingsPage));
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "aux-status",
				locale: "@dolorescaritasangelus/dsh-aux"
			}, AuxStatusChip));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});