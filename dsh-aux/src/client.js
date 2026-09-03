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
 * The chip (conversation.input.left seat) renders the latest auxiliary call.
 * It uses the `aux-status` projection for presence and falls back to it when
 * history is unavailable; when session history is readable it picks the most
 * recent `aux/llm-call` event so per-task projection order cannot hide the
 * true latest call.
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
		/** Normalize old `{ ok, result: { ok, value } }` and new `{ ok, value }` remote responses. */
		const unwrapResponse = (resp) => (resp && typeof resp === "object" && resp.result !== void 0 ? resp.result : resp);
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
			".ax-field-head[role=button]{cursor:pointer;border-radius:4px;padding:2px 4px;margin:-2px -4px}",
			".ax-field-head[role=button]:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".ax-field-head[role=button]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}",
			".ax-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:11px;line-height:1.5}",
			".ax-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
			".ax-reset:disabled{cursor:default}",
			".ax-switch{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}",
			".ax-actions{display:flex;gap:8px;align-items:center}",
			".ax-save{border:none;border-radius:4px;padding:4px 12px;font-size:13px;font-weight:500;cursor:pointer;color:#fff;background:var(--dsw-alias-state-success-primary)}",
			".ax-save:disabled{opacity:.6;cursor:default}",
			".ax-status{font-size:12px;line-height:18px;white-space:pre-line;overflow-wrap:anywhere}",
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
			".ax-status-issue-active{border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}",
			".ax-status-issue-text{flex:1;min-width:0;white-space:pre-line;overflow-wrap:anywhere}",
			".ax-status-summary{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
			".ax-patch-ledger{margin-top:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}",
			".ax-patch-ledger-title{padding:8px 12px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}",
			".ax-patch-ledger-table{width:100%;border-collapse:collapse;font-size:12px;line-height:18px}",
			".ax-patch-ledger-table th{text-align:left;padding:6px 10px;color:var(--dsw-alias-label-tertiary);font-weight:500;border-bottom:1px solid var(--dsw-alias-border-l2)}",
			".ax-patch-ledger-table td{padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);vertical-align:top}",
			".ax-patch-ledger-table tr:last-child td{border-bottom:0}",
			".ax-patch-ledger-table .ax-patch-desc{max-width:280px;min-width:180px;white-space:normal;overflow-wrap:anywhere}",
			".ax-patch-pkg{font-family:var(--dsw-alias-font-mono,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".ax-image-overlay{position:fixed;inset:0;z-index:40;background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 55%,transparent);display:flex;align-items:flex-start;justify-content:center;padding:40px 20px}",
			".ax-image-panel{width:min(960px,calc(100vw - 32px));max-height:calc(100vh - 80px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-inverted);border-radius:16px;box-shadow:var(--dsw-shadow-lv3);overflow:hidden}",
			".ax-image-panel-header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
			".ax-image-panel-title{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".ax-image-panel-stats{font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".ax-image-panel-actions{margin-left:auto;display:flex;gap:6px;align-items:center}",
			".ax-image-search{min-width:180px;flex:1;border:1px solid var(--dsw-alias-border-strong);border-radius:8px;padding:5px 10px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}",
			".ax-image-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
			".ax-image-toolbar select{border:1px solid var(--dsw-alias-border-strong);border-radius:6px;padding:2px 6px;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font-family:inherit}",
			".ax-image-view-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".ax-image-chip{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1)}",
			".ax-image-chip-active{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}",
			".ax-image-bulk{display:flex;gap:6px;align-items:center;margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".ax-image-scroll{flex:1;overflow-y:auto;padding:14px;min-height:0}",
			".ax-image-drag-select{position:fixed;z-index:70;pointer-events:none;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px}",
			".ax-image-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(var(--ax-thumb-size,140px),1fr))}",
			".ax-image-groups{display:flex;flex-direction:column;gap:12px}",
			".ax-image-group{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}",
			".ax-image-group-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;font:inherit;color:var(--dsw-alias-label-primary);text-align:left}",
			".ax-image-group-header:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".ax-image-group-header:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}",
			".ax-image-group-header-text{flex:1;min-width:0;font-size:13px;font-weight:600;display:flex;align-items:baseline;gap:8px}",
			".ax-image-group-count{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary)}",
			".ax-image-group-chevron{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);transition:transform .15s}",
			".ax-image-group-chevron-open{transform:rotate(90deg)}",
			".ax-image-group-grid{padding:12px;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(var(--ax-thumb-size,140px),1fr))}",
			".ax-image-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-3);cursor:pointer;position:relative;transition:border-color .15s}",
			".ax-image-card:hover{border-color:var(--dsw-alias-label-secondary)}",
			".ax-image-card-selected{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}",
			".ax-image-thumb{width:100%;height:var(--ax-thumb-size,160px);object-fit:contain;display:block;background:var(--dsw-alias-bg-layer-3)}",
			".ax-image-thumb-placeholder{width:100%;height:var(--ax-thumb-size,160px);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-caption);font-size:24px;background:var(--dsw-alias-bg-layer-3)}",
			".ax-image-card-body{padding:6px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
			".ax-image-badge{display:inline-block;margin:0 2px 2px 0;border-radius:999px;padding:0 5px;font-size:10px;line-height:16px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}",
			".ax-image-badge-orphan{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}",
			".ax-image-badge-archived{color:var(--dsw-alias-label-caption);border-color:var(--dsw-alias-label-caption)}",
			".ax-image-badge-shared{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}",
			".ax-image-badge-retained{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}",
			".ax-image-badge-memory{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}",
			".ax-image-checkbox{position:absolute;top:6px;left:6px;width:16px;height:16px;accent-color:var(--dsw-alias-state-business-primary)}",
			".ax-image-empty{padding:40px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px}",
			".ax-image-notice{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
			".ax-image-detail-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".ax-image-pager{display:flex;gap:6px;align-items:center;justify-content:flex-end;padding:8px 16px;border-top:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-tertiary)}",
			".ax-image-action{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:3px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1)}",
			".ax-image-action-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}",
			".ax-image-action:disabled{opacity:.5;cursor:default}",
			".ax-image-sidebar-badge{display:inline-flex;align-items:center;gap:6px;width:100%;height:42px;padding:0 10px;border:none;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:14px}",
			".ax-image-sidebar-badge:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".ax-image-sidebar-badge[data-rail]{width:36px;height:36px;padding:0;justify-content:center;border-radius:50%}",
			".ax-image-detail-overlay{position:fixed;inset:0;z-index:60;background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 45%,transparent);display:flex;align-items:center;justify-content:center;padding:16px}",
			".ax-image-modal{position:relative;width:min(880px,calc(100vw - 32px));height:auto;max-height:calc(100vh - 32px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-inverted);border-radius:16px;box-shadow:var(--dsw-shadow-lv3);overflow:hidden;resize:both}",
			".ax-image-modal-header{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);cursor:move;user-select:none;flex:none}",
			".ax-image-modal-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}",
			".ax-image-modal-actions{margin-left:auto;display:flex;gap:6px;align-items:center;flex:none}",
			".ax-image-modal-body{display:grid;grid-template-columns:minmax(0,5fr) minmax(300px,6fr);gap:14px;padding:14px;overflow:auto;min-height:0;flex:1}",
			".ax-image-modal-preview{display:flex;align-items:flex-start;justify-content:center;min-width:0;background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:8px;overflow:auto}",
			".ax-image-modal-preview .ax-image-thumb{max-height:56vh;background:transparent}",
			".ax-image-modal-preview .ax-image-thumb-placeholder{height:56vh;max-height:56vh;background:transparent}",
			".ax-image-modal-info{display:flex;flex-direction:column;gap:14px;min-width:0}",
			".ax-image-section-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:6px}",
			".ax-image-meta{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}",
			".ax-image-meta-item{display:contents}",
			".ax-image-meta-label{color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".ax-image-meta-value{overflow-wrap:anywhere}",
			".ax-image-badges{display:flex;flex-wrap:wrap;gap:4px}",
			".ax-image-owner{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;margin-bottom:6px;background:var(--dsw-alias-bg-layer-2)}",
			".ax-image-owner-main{flex:1;min-width:0}",
			".ax-image-owner-title{font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".ax-image-owner-id{font-family:var(--dsw-alias-font-mono,monospace);font-size:10px;color:var(--dsw-alias-label-tertiary)}",
			".ax-image-owner-actions{display:flex;gap:6px;flex:none}",
			".ax-image-memory-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-2)}",
			".ax-image-memory-meta{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}",
			".ax-image-memory-q{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:4px}",
			".ax-image-memory-a{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}",
			".ax-image-memory-more{border:none;background:transparent;color:var(--dsw-alias-state-business-primary);cursor:pointer;font-size:11px;padding:0}",
			".ax-image-resize-handle{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--dsw-alias-label-caption) 50%,var(--dsw-alias-label-caption) 60%,transparent 60%),linear-gradient(135deg,transparent 70%,var(--dsw-alias-label-caption) 70%,var(--dsw-alias-label-caption) 80%,transparent 80%);opacity:.8}",
			".ax-image-resize-handle:hover{opacity:1}"
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
			"settings.readonly": "当前设置为只读,请在 settings.yaml 中直接修改",
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
			"subagent.general": "通用子代理",
			"subagent.vision": "视觉子代理",
			"subagent.reasoningEffort": "思考强度",
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
			"settings.patch": "一键安装当前 DSH 所需全部补丁",
			"settings.patching": "打补丁中…",
			"settings.patchDone": "已触发 /aux patch,请查看会话输出。",
			"settings.patchError": "打补丁失败: ",
			"command.noSession": "当前没有可用会话,无法执行命令",
			"command.unknown": "未知命令: ",
			"command.failed": "命令失败: ",
			"patch.invalidJson": "补丁返回了无效 JSON",
			"patch.failed": "补丁失败",
			"status.refresh": "刷新状态",
			"status.loading": "正在获取平台状态…",
			"status.loadHint": "点击刷新加载平台状态",
			"status.forcedNative": "补丁未装,当前按 native 处理",
			"status.error": "无法获取平台状态: ",
			"status.commandFailed": "状态命令失败",
			"status.noSession": "没有可用会话,无法读取状态",
			"status.notReady": "平台状态尚未生成,请稍后重试",
			"status.invalid": "状态数据异常,请刷新重试",
			"status.core": "🔒 核心保护",
			"status.coreDetail": "图片生命周期 / 会话图片安全 / 失败冷却 / 事件审计(不可关闭)",
			"status.coreCount": "🔒 核心保护 · {count} 项已生效",
			"status.overview": "已启用 {enabled} 项 · 需处理 {issues} 项",
			"status.diagnostics": "诊断与修复",
			"status.diagnostics.desc": "补丁、依赖或配置缺失时,在这里一键修复。",
			"status.noIssues": "所有可选能力状态正常。",
			"status.patchLedger.title": "补丁清单",
			"status.patchLedger.desc": "当前 DSH 所需本地补丁的逐项状态。",
			"status.patchLedger.id": "补丁",
			"status.patchLedger.group": "编号",
			"status.patchLedger.pkg": "目标包",
			"status.patchLedger.state": "状态",
			"status.patchLedger.state.installed": "已安装",
			"status.patchLedger.state.missing": "缺失",
			"status.patchLedger.state.not-applicable": "不适用",
			"status.patchLedger.state.unknown": "未知",
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
			"status.patch.v1": "v1",
			"status.patch.v2": "v2",
			"status.patch.v3": "v3",
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
			"chip.fallback": " (已降级)",
			"imageLibrary.open": "图库",
			"imageLibrary.title": "图片库",
			"imageLibrary.search": "搜索文件名 / 记忆 / 会话",
			"imageLibrary.refresh": "刷新",
			"imageLibrary.close": "关闭",
			"imageLibrary.total": "共 {total} 张",
			"imageLibrary.shared": "共享 {n}",
			"imageLibrary.orphan": "孤儿 {n}",
			"imageLibrary.retained": "固化 {n}",
			"imageLibrary.withMemory": "有记忆 {n}",
			"imageLibrary.archived": "已归档 {n}",
			"imageLibrary.filterAll": "全部",
			"imageLibrary.filterShared": "仅共享",
			"imageLibrary.filterOrphan": "仅孤儿",
			"imageLibrary.filterArchived": "仅已归档",
			"imageLibrary.filterRetained": "仅固化",
			"imageLibrary.filterMemory": "仅有记忆",
			"imageLibrary.selected": "已选 {n}",
			"imageLibrary.selectAll": "全选",
			"imageLibrary.invert": "反选",
			"imageLibrary.clear": "清空",
			"imageLibrary.delete": "删除",
			"imageLibrary.deleteOrphans": "回收孤儿",
			"imageLibrary.retain": "固化",
			"imageLibrary.unretain": "取消固化",
			"imageLibrary.viewSmall": "小",
			"imageLibrary.viewMedium": "中",
			"imageLibrary.viewLarge": "大",
			"imageLibrary.orphanBadge": "孤儿",
			"imageLibrary.archivedBadge": "已归档",
			"imageLibrary.sharedBadge": "共享",
			"imageLibrary.retainedBadge": "固化",
			"imageLibrary.memoryBadge": "有记忆",
			"imageLibrary.noImage": "暂无图片",
			"imageLibrary.noResult": "没有匹配的图片",
			"imageLibrary.confirmDelete": "确认删除所选图片? 被会话引用的图片将跳过,除非强制。",
			"imageLibrary.confirmOrphans": "确认回收这些孤儿图片?",
			"imageLibrary.opDone": "操作完成",
			"imageLibrary.opFailed": "操作失败: {msg}",
			"imageLibrary.detailOwners": "归属会话",
			"imageLibrary.detailMemories": "分析记忆",
			"imageLibrary.jump": "跳转",
			"imageLibrary.image": "图片",
			"imageLibrary.meta": "元数据",
			"imageLibrary.fileName": "文件名",
			"imageLibrary.fileType": "类型",
			"imageLibrary.size": "大小",
			"imageLibrary.modified": "修改时间",
			"imageLibrary.references": "引用数",
			"imageLibrary.goConversation": "去对话",
			"imageLibrary.goTrace": "去轨迹",
			"imageLibrary.offline": "会话不在当前运行列表,仅保留归档入口",
			"imageLibrary.locateFallback": "未能定位消息,已打开会话",
			"imageLibrary.locateNoMessage": "该会话中未找到图片消息,已打开会话",
			"imageLibrary.traceOpened": "已打开会话;请在顶部切换到轨迹视图查看该次 vision_analyze 调用",
			"imageLibrary.memoryExpand": "展开",
			"imageLibrary.memoryCollapse": "收起",
			"imageLibrary.memoriesShowAll": "显示全部 {n} 条记忆",
			"imageLibrary.memoriesShowLess": "收起记忆",
			"imageLibrary.groupBy": "分组",
			"imageLibrary.groupNone": "无分组",
			"imageLibrary.groupDate": "按日期",
			"imageLibrary.groupSession": "按会话",
			"imageLibrary.sortBy": "排序",
			"imageLibrary.sortTimeNew": "时间(新→旧)",
			"imageLibrary.sortTimeOld": "时间(旧→新)",
			"imageLibrary.sortSizeDesc": "大小(大→小)",
			"imageLibrary.sortSizeAsc": "大小(小→大)",
			"imageLibrary.sortNameAsc": "文件名(A→Z)",
			"imageLibrary.sortNameDesc": "文件名(Z→A)",
			"imageLibrary.sortRefsDesc": "引用数(多→少)",
			"imageLibrary.sortMemoryDesc": "记忆数(多→少)",
			"imageLibrary.groupSort": "组间排序",
			"imageLibrary.groupSortDefault": "默认",
			"imageLibrary.groupSortDateNew": "时间(新→旧)",
			"imageLibrary.groupSortDateOld": "时间(旧→新)",
			"imageLibrary.groupSortTitleAz": "标题(A→Z)",
			"imageLibrary.groupSortTitleZa": "标题(Z→A)",
			"imageLibrary.groupSortRefsDesc": "引用数(多→少)",
			"imageLibrary.dateToday": "今天",
			"imageLibrary.dateYesterday": "昨天",
			"imageLibrary.dateThisWeek": "本周",
			"imageLibrary.dateThisMonth": "本月",
			"imageLibrary.dateThisYear": "今年",
			"imageLibrary.groupCount": "{n} 项",
			"imageLibrary.groupCollapse": "折叠此组",
			"imageLibrary.groupExpand": "展开此组"
		};
		const enDict = {
			"settings.title": "Auxiliary Models",
			"settings.intro": "Configure auxiliary model routes, timeouts, concurrency, and reasoning effort.",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.saved": "Saved",
			"settings.loading": "Loading auxiliary model config…",
			"settings.loadError": "Failed to load: ",
			"settings.readonly": "Settings are read-only; edit settings.yaml directly",
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
			"subagent.general": "General subagent",
			"subagent.vision": "Vision subagent",
			"subagent.reasoningEffort": "Reasoning effort",
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
			"settings.patch": "Install all patches for current DSH",
			"settings.patching": "Patching…",
			"settings.patchDone": "Triggered /aux patch; see conversation output.",
			"settings.patchError": "Patch failed: ",
			"command.noSession": "No available session to run the command",
			"command.unknown": "Unknown command: ",
			"command.failed": "Command failed: ",
			"patch.invalidJson": "Patch returned invalid JSON",
			"patch.failed": "Patch failed",
			"status.refresh": "Refresh",
			"status.loading": "Loading platform status…",
			"status.loadHint": "Click refresh to load status",
			"status.forcedNative": "Patch missing; using native",
			"status.error": "Failed to load status: ",
			"status.commandFailed": "Status command failed",
			"status.noSession": "No available session to read status",
			"status.notReady": "Platform status not generated yet; retry later",
			"status.invalid": "Status data is invalid; refresh to retry",
			"status.core": "🔒 Core protections",
			"status.coreDetail": "Image lifecycle / session image safety / failure cooldown / event audit (cannot be disabled)",
			"status.coreCount": "🔒 Core protections · {count} active",
			"status.overview": "{enabled} enabled · {issues} need attention",
			"status.diagnostics": "Diagnostics & Repair",
			"status.diagnostics.desc": "Fix missing patches, dependencies, or configuration here.",
			"status.noIssues": "All optional capabilities are healthy.",
			"status.patchLedger.title": "Patch ledger",
			"status.patchLedger.desc": "Per-patch status for the local DSH modifications.",
			"status.patchLedger.id": "Patch",
			"status.patchLedger.group": "ID",
			"status.patchLedger.pkg": "Package",
			"status.patchLedger.state": "State",
			"status.patchLedger.state.installed": "Installed",
			"status.patchLedger.state.missing": "Missing",
			"status.patchLedger.state.not-applicable": "N/A",
			"status.patchLedger.state.unknown": "Unknown",
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
			"status.patch.v1": "v1",
			"status.patch.v2": "v2",
			"status.patch.v3": "v3",
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
			"chip.fallback": " (fallback)",
			"imageLibrary.open": "Gallery",
			"imageLibrary.title": "Image Library",
			"imageLibrary.search": "Search filename / memory / session",
			"imageLibrary.refresh": "Refresh",
			"imageLibrary.close": "Close",
			"imageLibrary.total": "{total} images",
			"imageLibrary.shared": "shared {n}",
			"imageLibrary.orphan": "orphan {n}",
			"imageLibrary.retained": "retained {n}",
			"imageLibrary.withMemory": "memory {n}",
			"imageLibrary.archived": "archived {n}",
			"imageLibrary.filterAll": "All",
			"imageLibrary.filterShared": "Shared",
			"imageLibrary.filterOrphan": "Orphan",
			"imageLibrary.filterArchived": "Archived",
			"imageLibrary.filterRetained": "Retained",
			"imageLibrary.filterMemory": "Memory",
			"imageLibrary.selected": "{n} selected",
			"imageLibrary.selectAll": "Select all",
			"imageLibrary.invert": "Invert",
			"imageLibrary.clear": "Clear",
			"imageLibrary.delete": "Delete",
			"imageLibrary.deleteOrphans": "Reclaim orphans",
			"imageLibrary.retain": "Retain",
			"imageLibrary.unretain": "Unretain",
			"imageLibrary.viewSmall": "Small",
			"imageLibrary.viewMedium": "Medium",
			"imageLibrary.viewLarge": "Large",
			"imageLibrary.orphanBadge": "Orphan",
			"imageLibrary.archivedBadge": "Archived",
			"imageLibrary.sharedBadge": "Shared",
			"imageLibrary.retainedBadge": "Retained",
			"imageLibrary.memoryBadge": "Memory",
			"imageLibrary.noImage": "No images yet",
			"imageLibrary.noResult": "No matching images",
			"imageLibrary.confirmDelete": "Delete selected images? Referenced images will be skipped unless forced.",
			"imageLibrary.confirmOrphans": "Reclaim these orphan images?",
			"imageLibrary.opDone": "Done",
			"imageLibrary.opFailed": "Failed: {msg}",
			"imageLibrary.detailOwners": "Owner sessions",
			"imageLibrary.detailMemories": "Analysis memory",
			"imageLibrary.jump": "Open",
			"imageLibrary.image": "Image",
			"imageLibrary.meta": "Metadata",
			"imageLibrary.fileName": "File name",
			"imageLibrary.fileType": "Type",
			"imageLibrary.size": "Size",
			"imageLibrary.modified": "Modified",
			"imageLibrary.references": "References",
			"imageLibrary.goConversation": "Go to message",
			"imageLibrary.goTrace": "Go to trace",
			"imageLibrary.offline": "Session is not in the live list; archived entry remains",
			"imageLibrary.locateFallback": "Could not locate the message; session opened",
			"imageLibrary.locateNoMessage": "No image message found in this session; session opened",
			"imageLibrary.traceOpened": "Session opened; switch to the trace view at the top to see this vision_analyze call",
			"imageLibrary.memoryExpand": "Expand",
			"imageLibrary.memoryCollapse": "Collapse",
			"imageLibrary.memoriesShowAll": "Show all {n} memories",
			"imageLibrary.memoriesShowLess": "Collapse memories",
			"imageLibrary.groupBy": "Group",
			"imageLibrary.groupNone": "No grouping",
			"imageLibrary.groupDate": "By date",
			"imageLibrary.groupSession": "By session",
			"imageLibrary.sortBy": "Sort",
			"imageLibrary.sortTimeNew": "Time (new→old)",
			"imageLibrary.sortTimeOld": "Time (old→new)",
			"imageLibrary.sortSizeDesc": "Size (large→small)",
			"imageLibrary.sortSizeAsc": "Size (small→large)",
			"imageLibrary.sortNameAsc": "File name (A→Z)",
			"imageLibrary.sortNameDesc": "File name (Z→A)",
			"imageLibrary.sortRefsDesc": "References (high→low)",
			"imageLibrary.sortMemoryDesc": "Memories (high→low)",
			"imageLibrary.groupSort": "Group order",
			"imageLibrary.groupSortDefault": "Default",
			"imageLibrary.groupSortDateNew": "Time (new→old)",
			"imageLibrary.groupSortDateOld": "Time (old→new)",
			"imageLibrary.groupSortTitleAz": "Title (A→Z)",
			"imageLibrary.groupSortTitleZa": "Title (Z→A)",
			"imageLibrary.groupSortRefsDesc": "References (high→low)",
			"imageLibrary.dateToday": "Today",
			"imageLibrary.dateYesterday": "Yesterday",
			"imageLibrary.dateThisWeek": "This week",
			"imageLibrary.dateThisMonth": "This month",
			"imageLibrary.dateThisYear": "This year",
			"imageLibrary.groupCount": "{n} items",
			"imageLibrary.groupCollapse": "Collapse group",
			"imageLibrary.groupExpand": "Expand group"
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
			const { api, runAuxCommand, sessions } = props;
			const t = (props && props.t) || __t;
			useLocaleRevision();
			const [state, setState] = react.useState({ status: "loading", error: null, value: null, revision: 0, writable: true });
			const [catalog, setCatalog] = react.useState({ providers: [], models: [], reasoning: {} });
			const [openGroups, setOpenGroups] = react.useState({ diagnostics: true, tools: true, bridges: false, subagent: false, global: false });
			const load = react.useCallback(() => {
				let alive = true;
				Promise.all([
					api.settings.describe({}),
					api.llm.providers({}).catch(() => ({ ok: false, error: { message: "providers unavailable" } })),
					api.llm.models({}).catch(() => ({ ok: false, error: { message: "models unavailable" } }))
				]).then(([settingsRaw, providersRaw, modelsRaw]) => {
					if (!alive) return;
					const settingsResponse = unwrapResponse(settingsRaw);
					const providersResponse = unwrapResponse(providersRaw);
					const modelsResponse = unwrapResponse(modelsRaw);
					if (!settingsResponse.ok) {
						setState({ status: "error", error: settingsResponse.error?.message ?? "settings unavailable", value: null, revision: 0, writable: true });
						return;
					}
					const view = settingsResponse.value.namespaces.find((n) => n.ns === "aux");
					const value = view?.value ?? {};
					setState({ status: "ready", error: null, value, revision: view?.revision ?? 0, writable: settingsResponse.value.writable });
					const providers = providersResponse.ok
						? (providersResponse.value.providers ?? []).filter((p) => p.active === true)
						: [];
					const groups = modelsResponse.ok ? (modelsResponse.value.groups ?? []) : [];
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
			const [activeIssueKey, setActiveIssueKey] = react.useState(null);
			const mountedRef = react.useRef(true);
			const statusRequestId = react.useRef(0);
			const openIssueTimer = react.useRef(null);
			react.useEffect(() => {
				mountedRef.current = true;
				return () => {
					mountedRef.current = false;
					if (openIssueTimer.current !== null) clearTimeout(openIssueTimer.current);
				};
			}, []);
			const [status, setStatus] = react.useState(null);
			const [statusLoading, setStatusLoading] = react.useState(false);
			const [statusError, setStatusError] = react.useState(null);
			const auxForcedNative = (key) => {
				const item = (status?.items ?? []).find((entry) => entry !== null && typeof entry === "object" && entry.key === key);
				return item?.state === "unavailable" && item?.action === "patch";
			};
			const loadStatus = react.useCallback(() => {
				let alive = true;
				const requestId = ++statusRequestId.current;
				setStatusLoading(true);
				setStatusError(null);
				Promise.resolve()
					.then(async () => {
						// 非命令通道:从 alpha.3 的 sessions 投影面读取 aux-platform,
						// 不执行 /aux status --json,避免在会话里产生命令卡片。
						const listResponse = unwrapResponse(await api.sessions.list({}));
						const items = listResponse?.value?.items ?? [];
						if (items.length === 0) throw new Error(t("status.noSession"));
						for (const item of items) {
							const data = sessions?.binding?.(item.sessionId)?.session?.projections?.faceOf?.("aux-platform")?.getSnapshot?.();
							if (data && typeof data === "object" && Array.isArray(data.items)) return data;
						}
						throw new Error(t("status.notReady"));
					})
					.then((data) => {
						if (!alive || !mountedRef.current || requestId !== statusRequestId.current) return;
						setStatus(data);
						setActiveIssueKey((current) =>
							current !== null && Array.isArray(data.issues) && data.issues.some((issue) => issue.key === current)
								? current
								: null
						);
					})
					.catch((error) => {
						if (alive && mountedRef.current && requestId === statusRequestId.current) {
							setStatusError(error instanceof Error ? error.message : String(error));
						}
					})
					.finally(() => {
						if (alive && mountedRef.current && requestId === statusRequestId.current) {
							setStatusLoading(false);
						}
					});
				return () => { alive = false; };
			}, [api, t]);
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
					// 任务级 reasoningEffort 可以独立于 provider/model 存在
					// (插件配置可能提供路由),不能因为设置里没填 provider/model 就删掉。
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
					const effort = g.reasoningEffort;
					const effortPath = [...gbase, "reasoningEffort"];
					if (gp && gm) {
						ops.push({ op: "set", path: [...gbase, "provider"], value: g.provider });
						ops.push({ op: "set", path: [...gbase, "model"], value: g.model });
						if (typeof effort === "string" && effort !== "") ops.push({ op: "set", path: effortPath, value: effort });
						else ops.push({ op: "unset", path: effortPath });
					} else {
						ops.push({ op: "unset", path: [...gbase, "provider"] });
						ops.push({ op: "unset", path: [...gbase, "model"] });
						ops.push({ op: "unset", path: effortPath });
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
					// 设计意图 A22 10.5:补丁未装时,aux 不可选/强制 native。
					// 即使草稿里还是 aux(含默认缺省),保存时也落成 native,
					// 避免存一个当前不可用的模式。
					const rawVal = val ?? "aux";
					const effectiveVal = auxForcedNative(key) && rawVal === "aux" ? "native" : val;
					if (effectiveVal !== void 0 && effectiveVal !== "aux") ops.push({ op: "set", path: ["enabled", key], value: effectiveVal });
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
					const resp = unwrapResponse(response);
					if (!resp.ok) {
						setSaveError(resp.error?.message ?? "save failed");
						return;
					}
					setSaved(true);
					setState((s) => ({ ...s, revision: resp.value.revision, value: resp.value.value }));
					setDraft(structuredClone(resp.value.value ?? {}));
					loadStatus();
				}).catch((error) => {
					setSaving(false);
					setSaveError(error instanceof Error ? error.message : String(error));
				});
			};
			const runPatch = (sourceKey) => {
				setPatching(true);
				setActiveIssueKey(sourceKey ?? null);
				setPatchStatus(null);
				Promise.resolve()
					.then(() => runAuxCommand("/aux patch --json"))
					.then((result) => {
						if (!mountedRef.current) return;
						if (result.kind !== "success") throw new Error(result.text ?? t("patch.failed"));
						let data;
						try {
							data = JSON.parse(result.text);
						} catch {
							throw new Error(t("patch.invalidJson"));
						}
						if (!data || typeof data !== "object") throw new Error(t("patch.invalidJson"));
						if (data.ok !== true) {
							const failed = (data.steps ?? []).filter((step) => step.ok !== true);
							const detail = failed
								.map((step) => `[${step.name}] ${step.error ?? "failed"}\n${(step.output ?? "").slice(0, 500)}`)
								.join("\n\n");
							setPatchStatus({ ok: false, key: sourceKey, text: t("settings.patchError") + (detail || t("patch.failed")) });
							// 部分步骤可能已成功/已写盘,失败也要刷新状态和重启提示。
							loadStatus();
							return;
						}
						setPatchStatus({ ok: true, key: sourceKey, text: t("settings.patchDone") });
						loadStatus();
					})
					.catch((error) => {
						if (mountedRef.current) {
							setPatchStatus({ ok: false, key: sourceKey, text: t("settings.patchError") + (error?.message ?? String(error)) });
						}
					})
					.finally(() => {
						if (mountedRef.current) setPatching(false);
					});
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
				disabled: options.length === 0,
				onChange: (e) => {
					const value = e.target.value;
					setField(task, key, value);
					if (key === "provider") {
						setField(task, "model", "");
						setField(task, "reasoningEffort", "");
					}
				}
			}, react.createElement("option", { value: "" }, placeholder),
				options.map((o) => react.createElement("option", { key: o.value, value: o.value }, o.label)));
			const fieldRow = (task, key, label, control) => {
				const controlId = "ax-" + task + "-" + key;
				const labelledControl = react.cloneElement(control, { id: controlId });
				return react.createElement("div", { className: "ax-row" },
					react.createElement("div", { className: "ax-field-head" },
						react.createElement("label", { htmlFor: controlId }, label),
						field(task, key) !== void 0 && field(task, key) !== "" ? react.createElement("button", {
							type: "button",
							className: "ax-reset",
							disabled: false,
							onClick: () => resetField(task, key)
						}, t("settings.reset")) : null
					),
					labelledControl
				);
			};
			const taskCard = (task) => {
				const effortOptions = reasoningOptionsFor(task);
				return react.createElement("div", { key: task, className: "ax-task" },
					react.createElement("h3", null, t("task." + task)),
					react.createElement("div", { className: "ax-grid" },
						fieldRow(task, "provider", t("field.provider"), select(task, "provider", providerOptions, t("placeholder.inheritModel"))),
						fieldRow(task, "model", t("field.model"), select(task, "model", modelOptionsFor(task).map((id) => ({ value: id, label: id })), t("placeholder.inheritModel"))),
						fieldRow(task, "timeoutMs", t("field.timeout"), react.createElement("input", {
							type: "number", value: field(task, "timeoutMs") ?? "", placeholder: "60000", disabled: false, onChange: (e) => setField(task, "timeoutMs", e.target.value)
						})),
						fieldRow(task, "maxConcurrency", t("field.concurrency"), react.createElement("input", {
							type: "number", value: field(task, "maxConcurrency") ?? "", placeholder: "2", disabled: false, onChange: (e) => setField(task, "maxConcurrency", e.target.value)
						})),
						(task === "web_extract" || task === "web_crawl") ? fieldRow(task, "maxChars", t("field.maxChars"), react.createElement("input", {
							type: "number", min: "1", value: field(task, "maxChars") ?? "", placeholder: "8000", disabled: false, onChange: (e) => setField(task, "maxChars", e.target.value)
						})) : null,
						fieldRow(task, "reasoningEffort", t("field.reasoningEffort"), react.createElement("select", {
							value: field(task, "reasoningEffort") ?? "",
							disabled: false || effortOptions.length === 0,
							onChange: (e) => setField(task, "reasoningEffort", e.target.value)
						}, react.createElement("option", { value: "" }, t("placeholder.inheritDefault")),
							effortOptions.map((o) => react.createElement("option", { key: o.id, value: o.id }, o.name ?? o.id))))
					)
				);
			};
			const group = (id, title, desc, ...children) => {
				const open = openGroups[id] === true;
				const bodyId = "ax-group-body-" + id;
				const titleId = "ax-group-title-" + id;
				return react.createElement("div", { id: "ax-group-" + id, className: "ax-group" + (open ? " ax-group-open" : "") },
					react.createElement("button", {
						type: "button",
						className: "ax-group-header",
						"aria-expanded": open,
						"aria-controls": bodyId,
						onClick: () => setOpenGroups((s) => ({ ...s, [id]: !s[id] }))
					},
						react.createElement("span", { className: "ax-group-headText" },
							react.createElement("span", { id: titleId, className: "ax-group-title" }, title),
							react.createElement("span", { className: "ax-group-desc" }, desc)
						),
						react.createElement("span", { className: "ax-group-chevron" + (open ? " ax-group-chevronOpen" : "") }, "▾")
					),
					react.createElement("div", { id: bodyId, className: "ax-group-body", role: "region", "aria-labelledby": titleId, hidden: !open }, ...children)
				);
			};
			const sub = draft?.subagent ?? {};
			const subField = (group, key) => sub?.[group]?.[key];
			const setSub = (patch) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.subagent = { ...(next.subagent ?? {}), ...patch }; return next; }); };
			const setSubGroup = (group, key, value) => { setSaved(false); setSaveError(null); setDraft((d) => { const next = structuredClone(d ?? {}); next.subagent = next.subagent ?? {}; next.subagent[group] = next.subagent[group] ?? {}; if (value === "") delete next.subagent[group][key]; else next.subagent[group][key] = value; return next; }); };
			const subGroupSelect = (group, key, options, placeholder) => react.createElement("select", {
				id: "ax-sub-" + group + "-" + key,
				value: subField(group, key) ?? "",
				disabled: options.length === 0,
				onChange: (e) => { const value = e.target.value; setSubGroup(group, key, value); if (key === "provider") { setSubGroup(group, "model", ""); setSubGroup(group, "reasoningEffort", ""); } }
			}, react.createElement("option", { value: "" }, placeholder),
				options.map((o) => react.createElement("option", { key: o.value, value: o.value }, o.label)));
			const subModelOptionsFor = (group) => {
				const pid = subField(group, "provider") ?? "";
				if (pid === "") return [];
				const models = catalog.models ?? [];
				const ids = models.filter((m) => m.provider === pid).map((m) => m.id);
				return [...new Set(ids)];
			};
			const subReasoningOptionsFor = (group) => {
				const pid = subField(group, "provider") ?? "";
				const mid = subField(group, "model") ?? "";
				if (!pid || !mid) return [];
				const reasoning = catalog?.reasoning ?? {};
				return reasoning[pid + "\u0000" + mid] ?? [];
			};
			const subReasoningSelect = (group) => {
				let options = [];
				try {
					options = subReasoningOptionsFor(group);
				} catch {
					options = [];
				}
				return react.createElement("select", {
					id: "ax-sub-" + group + "-reasoningEffort",
					value: subField(group, "reasoningEffort") ?? "",
					disabled: options.length === 0,
					onChange: (e) => setSubGroup(group, "reasoningEffort", e.target.value)
				}, react.createElement("option", { value: "" }, t("placeholder.inheritDefault")),
					options.map((o) => react.createElement("option", { key: o.id, value: o.id }, o.name ?? o.id)));
			};
			const switchRow = (label, checked, disabled, onChange) => react.createElement("label", { className: "ax-switch" },
				react.createElement("input", { type: "checkbox", checked, disabled: disabled, onChange }), label);
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
					// redactSecrets 默认 true,用户取消时必须显式存 false;
					// 其他布尔默认 false,取消时删除即可恢复默认。
					if (value === "" || (value === false && key !== "redactSecrets") || value === 65536) delete next.debug[key];
					else next.debug[key] = value;
					return next;
				});
			};
			const statusByKey = {};
			if (status !== null && Array.isArray(status.items)) {
				for (const it of status.items) {
					if (it !== null && typeof it === "object") statusByKey[it.key] = it;
				}
			}
			const openIssue = (key) => {
				setOpenGroups((s) => ({ ...s, diagnostics: true, platform: true }));
				setActiveIssueKey(key);
				if (openIssueTimer.current !== null) clearTimeout(openIssueTimer.current);
				openIssueTimer.current = setTimeout(() => {
					openIssueTimer.current = null;
					if (!mountedRef.current) return;
					const el = document.getElementById("ax-issue-" + key);
					if (el) {
						el.scrollIntoView?.({ behavior: "smooth", block: "center" });
						const btn = el.querySelector?.(".ax-repair-button");
						if (btn) btn.focus?.();
						else el.focus?.();
					}
				}, 50);
			};
			const openConfig = (key) => {
				const groupMap = {
					vision_analyze: "tools",
					web_extract: "tools",
					web_crawl: "tools",
					compress_text: "tools",
					compactionBridge: "bridges",
					skillAudit: "bridges",
					imageBridge: "platform",
					subagentBridge: "platform",
					workflowBridge: "platform"
				};
				const target = groupMap[key] ?? "platform";
				setOpenGroups((s) => ({ ...s, [target]: true }));
				setActiveIssueKey(key);
				if (openIssueTimer.current !== null) clearTimeout(openIssueTimer.current);
				openIssueTimer.current = setTimeout(() => {
					openIssueTimer.current = null;
					if (!mountedRef.current) return;
					const el = document.getElementById("ax-group-" + target);
					if (el) el.scrollIntoView?.({ behavior: "smooth", block: "start" });
				}, 50);
			};
			const platformSelect = (key, label) => {
				const meta = statusByKey[key] ?? null;
				const baseState = meta?.state ?? "unknown";
				const state = patching && activeIssueKey === key && meta?.action === "patch" && baseState === "unavailable" ? "fixing" : baseState;
				const stateText = t("status.state." + state);
				const reason = meta ? t("status.reason." + meta.reason) : stateText;
				const patchLabel = meta?.patch ? t("status.patch." + meta.patch) : null;
				const title = label + " · " + stateText + (reason ? " — " + reason : "");
				const actionable = baseState === "unavailable" && meta?.action !== "none";
				const forcedNative = auxForcedNative(key);
				const rawValue = draft?.enabled?.[key] ?? "aux";
				const value = forcedNative && rawValue === "aux" ? "native" : rawValue;
				const headerProps = actionable ? {
					role: "button",
					tabIndex: 0,
					"aria-label": title + " — " + t("status.diagnostics"),
					onClick: () => openIssue(key),
					onKeyDown: (e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							openIssue(key);
						}
					}
				} : {};
				return react.createElement("div", { className: "ax-row", title, "aria-label": title },
					react.createElement("div", { className: "ax-field-head", ...headerProps },
						react.createElement("span", { className: "ax-dot ax-dot-" + state, "aria-hidden": "true" }),
						react.createElement("span", null, label),
						meta?.patch && patchLabel ? react.createElement("span", { className: "ax-status-badge ax-status-badge-" + meta.patch, title: reason }, patchLabel) : null,
						forcedNative && rawValue === "aux" ? react.createElement("span", { className: "ax-status-badge ax-status-badge-partial", title: t("status.forcedNative") }, t("status.forcedNative")) : null
					),
					react.createElement("select", {
						"aria-label": label,
						value,
						disabled: false,
						onChange: (e) => setEnabled(key, e.target.value)
					},
						react.createElement("option", { value: "native" }, t("mode.native")),
						react.createElement("option", { value: "aux", disabled: forcedNative }, t("mode.aux")),
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
				if (status === null) {
					return react.createElement("div", { className: "ax-status-head" },
						react.createElement("span", { className: "ax-status-summary" }, t("status.loadHint")),
						react.createElement("button", { type: "button", className: "ax-repair-button", onClick: loadStatus }, t("status.refresh"))
					);
				}
				if (typeof status !== "object" || !Array.isArray(status.items)) {
					return react.createElement("div", { className: "ax-status-head" },
						react.createElement("span", { className: "ax-status-summary ax-error", role: "alert" }, t("status.invalid")),
						react.createElement("button", { type: "button", className: "ax-repair-button", onClick: loadStatus }, t("status.refresh"))
					);
				}
				const items = status.items.filter((entry) => entry !== null && typeof entry === "object");
				const enabledCount = items.filter((entry) => entry.state === "enabled").length;
				const issues = Array.isArray(status.issues) ? status.issues : [];
				const warnings = Array.isArray(status.warnings) ? status.warnings : [];
				const attentionCount = issues.length + warnings.length;
				const summary = t("status.overview").replace("{enabled}", String(enabledCount)).replace("{issues}", String(attentionCount));
				const patchLedger = Array.isArray(status.patchLedger) ? status.patchLedger : [];
				const patchLedgerBlock = patchLedger.length > 0
					? react.createElement("div", { key: "patch-ledger", className: "ax-patch-ledger" },
						react.createElement("div", { className: "ax-patch-ledger-title" }, t("status.patchLedger.title")),
						react.createElement("table", { className: "ax-patch-ledger-table" },
							react.createElement("thead", null,
								react.createElement("tr", null,
									react.createElement("th", null, t("status.patchLedger.group")),
									react.createElement("th", null, t("status.patchLedger.id")),
									react.createElement("th", null, t("status.patchLedger.pkg")),
									react.createElement("th", null, t("status.patchLedger.state"))
								)
							),
							react.createElement("tbody", null,
								patchLedger.map((entry) => react.createElement("tr", { key: entry.id },
									react.createElement("td", null, entry.group),
									react.createElement("td", { className: "ax-patch-desc", title: entry.description }, entry.description),
									react.createElement("td", { className: "ax-patch-pkg" }, entry.pkg),
									react.createElement("td", null,
										react.createElement("span", { className: "ax-status-badge ax-status-badge-" + (entry.state === "installed" ? "installed" : entry.state === "missing" ? "missing" : entry.state === "unknown" ? "unknown" : "not-applicable") },
											t("status.patchLedger.state." + entry.state)
										)
									)
								))
							)
						)
					)
					: null;
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
								const active = activeIssueKey === issue.key;
								const activePatch = patching && activeIssueKey === issue.key && issue.action === "patch";
								const dotClass = activePatch ? "ax-dot-fixing" : "ax-dot-unavailable";
								return react.createElement("div", { key: issue.key, id: "ax-issue-" + issue.key, tabIndex: -1, className: "ax-status-issue" + (active ? " ax-status-issue-active" : "") },
									react.createElement("span", { className: "ax-dot " + dotClass, "aria-hidden": "true" }),
									react.createElement("div", { className: "ax-status-issue-text" },
										label + ": " + t("status.reason." + issue.reason),
										active && patchStatus !== null && patchStatus.key === issue.key && patchStatus.ok === false
											? react.createElement("div", { className: "ax-status-summary ax-error", role: "alert" }, patchStatus.text)
											: active && patchStatus !== null && patchStatus.key === issue.key && patchStatus.ok === true
												? react.createElement("div", { className: "ax-status-summary ax-ok-text", role: "status" }, patchStatus.text)
												: null
									),
									issue.action === "patch"
										? react.createElement("button", { type: "button", className: "ax-repair-button", disabled: patching, onClick: () => { setActiveIssueKey(issue.key); runPatch(issue.key); } }, activePatch ? t("settings.patching") : t("status.action.patch"))
										: issue.action === "configure"
											? react.createElement("button", { type: "button", className: "ax-repair-button", onClick: () => openConfig(issue.key) }, t("status.action.configure"))
											: null
								);
							}),
							...warnings.map((warning) => {
								return react.createElement("div", { key: warning.code, className: "ax-status-issue" },
									react.createElement("span", { className: "ax-dot ax-dot-fixing", "aria-hidden": "true" }),
									react.createElement("span", { className: "ax-status-issue-text" }, t("status.reason." + warning.reason))
								);
							})
						],
					patchLedgerBlock
				);
			};
			return react.createElement("div", { className: "ax-section" },
				!state.writable ? react.createElement("div", { className: "ax-status-summary ax-error", role: "alert" }, t("settings.readonly")) : null,
				statusPanel(),
				group("tools", t("group.tools"), t("group.tools.desc"),
					tasks.filter((x) => ["vision", "web_extract", "web_crawl", "compress"].includes(x)).map(taskCard)
				),
				group("bridges", t("group.bridges"), t("group.bridges.desc"),
					tasks.filter((x) => ["compaction", "skill"].includes(x)).map(taskCard)
				),
				group("subagent", t("group.subagent"), t("group.subagent.desc"),
					react.createElement("div", { className: "ax-row" },
						react.createElement("label", { htmlFor: "ax-sub-mode" }, t("subagent.mode")),
						react.createElement("select", {
							id: "ax-sub-mode",
							value: sub.mode ?? "native", disabled: false, onChange: (e) => setSub({ mode: e.target.value })
						},
							react.createElement("option", { value: "native" }, t("subagent.native")),
							react.createElement("option", { value: "manual" }, t("subagent.manual")),
							react.createElement("option", { value: "vision-aware" }, t("subagent.visionAware"))
						)
					),
					react.createElement("div", { className: "ax-task" },
						react.createElement("h3", null, t("subagent.general")),
						react.createElement("div", { className: "ax-grid" },
							react.createElement("div", { className: "ax-row" }, react.createElement("label", { htmlFor: "ax-sub-general-provider" }, t("subagent.generalProvider")), subGroupSelect("general", "provider", providerOptions, t("placeholder.inheritModel"))),
							react.createElement("div", { className: "ax-row" }, react.createElement("label", { htmlFor: "ax-sub-general-model" }, t("subagent.generalModel")), subGroupSelect("general", "model", subModelOptionsFor("general").map((id) => ({ value: id, label: id })), t("placeholder.inheritModel"))),
							react.createElement("div", { className: "ax-row" }, react.createElement("label", { htmlFor: "ax-sub-general-reasoningEffort" }, t("subagent.reasoningEffort")), subReasoningSelect("general"))
						)
					),
					react.createElement("div", { className: "ax-task" },
						react.createElement("h3", null, t("subagent.vision")),
						react.createElement("div", { className: "ax-grid" },
							react.createElement("div", { className: "ax-row" }, react.createElement("label", { htmlFor: "ax-sub-vision-provider" }, t("subagent.visionProvider")), subGroupSelect("vision", "provider", providerOptions, t("placeholder.inheritModel"))),
							react.createElement("div", { className: "ax-row" }, react.createElement("label", { htmlFor: "ax-sub-vision-model" }, t("subagent.visionModel")), subGroupSelect("vision", "model", subModelOptionsFor("vision").map((id) => ({ value: id, label: id })), t("placeholder.inheritModel"))),
							react.createElement("div", { className: "ax-row" }, react.createElement("label", { htmlFor: "ax-sub-vision-reasoningEffort" }, t("subagent.reasoningEffort")), subReasoningSelect("vision")),
							react.createElement("div", { className: "ax-row" }, react.createElement("label", { htmlFor: "ax-sub-vision-keywords" }, t("subagent.visionKeywords")), react.createElement("input", {
								id: "ax-sub-vision-keywords",
								type: "text", value: Array.isArray(sub.visionKeywords) ? sub.visionKeywords.join(",") : "", placeholder: "图片,image,截图", disabled: false, onChange: (e) => setSub({ visionKeywords: e.target.value === "" ? [] : e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
							}))
						)
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
							react.createElement("label", { htmlFor: "ax-skill-mode" }, t("skill.mode.label")),
							react.createElement("select", {
								id: "ax-skill-mode",
								value: draft?.skill?.mode ?? "audit",
								disabled: false,
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
						react.createElement("label", { htmlFor: "ax-debug-maxDebugEventBytes" }, t("debug.maxDebugEventBytes")),
						react.createElement("input", {
							id: "ax-debug-maxDebugEventBytes",
							type: "number", min: "1024", value: draft?.debug?.maxDebugEventBytes ?? 65536, disabled: false,
							onChange: (e) => setDebug("maxDebugEventBytes", e.target.value === "" ? "" : Number(e.target.value))
						})
					),
					switchRow(t("debug.debugEventsInHistory"), draft?.debug?.debugEventsInHistory === true, false, (e) => setDebug("debugEventsInHistory", e.target.checked)),
					switchRow(t("debug.redactSecrets"), draft?.debug?.redactSecrets !== false, false, (e) => setDebug("redactSecrets", e.target.checked)),
					react.createElement("div", { className: "ax-actions" },
						react.createElement("button", { type: "button", className: "ax-save", disabled: patching, onClick: () => runPatch() }, patching ? t("settings.patching") : t("settings.patch")),
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
		 * projection. The projection is a per-task snapshot, not a
		 * chronological log, so the chip also reads `aux/llm-call` events from
		 * session history and uses the most recent event when available.
		 * Falls back to the projection's last-inserted task if history is not
		 * available (e.g. older hosts or a failed history read).
		 */
		const IMAGE_LIBRARY_PROJECTION_KEY = "aux-image-library";
		const THUMB_SIZE_PX = { small: 96, medium: 160, large: 240, detail: 420 };
		const THUMB_STORAGE_KEY = "aux.image-library.thumbSize";
		// Stable sentinel ids for synthetic image-library groups. Keep them in
		// one place so group ordering/rendering does not duplicate magic strings.
		const GROUP_ORPHAN = "__orphan__";
		const GROUP_ARCHIVED = "__archived__";
		const GROUP_UNKNOWN = "__unknown__";
		const GROUP_YESTERDAY = "__yesterday__";
		const GROUP_THIS_WEEK = "__thisweek__";
		const GROUP_THIS_MONTH = "__thismonth__";
		const GROUP_THIS_YEAR = "__thisyear__";
		// Synthetic session-group ids. Orphan/archived are pinned above ordinary
		// session groups; if future group types need a position too, add them to
		// this ordered table instead of hard-coding another if/else in sorting.
		const SESSION_GROUP_PRIORITY = new Map([
			[GROUP_ORPHAN, 0],
			[GROUP_ARCHIVED, 1]
		]);

		/** Read the first non-empty `aux-image-library` projection snapshot. */
		function readProjectionSnapshot(sessions) {
			try {
				if (!sessions) return null;
				const list = sessions.list?.getSnapshot?.();
				const ids = Array.isArray(list?.ids) && list.ids.length > 0 ? list.ids : Object.keys(list?.byId ?? {});
				for (const sid of ids) {
					const data = sessions.binding?.(sid)?.session?.projections?.faceOf?.(IMAGE_LIBRARY_PROJECTION_KEY)?.getSnapshot?.();
					// A usable image-library snapshot has a real `counts` object and
					// an `entries` array. Empty shells (`{}` or old placeholder data)
					// should not be treated as authoritative "no images"; keep looking
					// or let the command fallback run.
					if (
						data && typeof data === "object" &&
						data.counts && typeof data.counts === "object" &&
						Array.isArray(data.entries)
					) return data;
				}
			} catch {
				/* projection read is best-effort; fall back to command below */
			}
			return null;
		}

		/** Parse a successful `/aux` JSON command result. */
		function parseAuxCommandJson(result) {
			if (!result || result.kind !== "success") throw new Error((result && result.text) || "image load failed");
			return JSON.parse(result.text);
		}

		/** Resolve a session display title from the live sessions list when present. */
		function sessionTitle(sessions, sessionId) {
			try {
				const summary = sessions?.list?.getSnapshot?.().byId?.[sessionId];
				return summary?.displayTitle || summary?.title || sessionId;
			} catch {
				return sessionId;
			}
		}

		/** Shorten a session id for compact list rows. */
		function shortSessionId(sessionId) {
			const sid = String(sessionId || "");
			return sid.length <= 16 ? sid : sid.slice(0, 10) + "…" + sid.slice(-4);
		}

		/** Format a byte count as a compact human-readable size. */
		function formatBytes(bytes) {
			if (!Number.isFinite(bytes) || bytes <= 0) return "—";
			if (bytes < 1024) return bytes + " B";
			const units = ["KB", "MB", "GB"];
			let value = bytes / 1024;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit += 1;
			}
			return (value >= 100 ? value.toFixed(0) : value.toFixed(1)) + " " + units[unit];
		}

		/** Format an epoch ms value as locale date/time. */
		function formatDateTime(ms) {
			if (!Number.isFinite(ms)) return "—";
			try {
				return new Date(ms).toLocaleString();
			} catch {
				return String(ms);
			}
		}

		/** Readable label for one image entry's modification time. */
		function imageTimeLabel(entry) {
			return formatDateTime(entry.mtimeMs);
		}

		/** Compare two entries by current sort key. Returns -1/0/1. */
		function compareEntries(a, b, sortKey) {
			if (sortKey === "time-new") return (Number(b.mtimeMs) || 0) - (Number(a.mtimeMs) || 0);
			if (sortKey === "time-old") return (Number(a.mtimeMs) || 0) - (Number(b.mtimeMs) || 0);
			if (sortKey === "size-desc") return (Number(b.bytes) || 0) - (Number(a.bytes) || 0);
			if (sortKey === "size-asc") return (Number(a.bytes) || 0) - (Number(b.bytes) || 0);
			if (sortKey === "refs-desc") return (b.ownerSessions?.length || 0) - (a.ownerSessions?.length || 0);
			if (sortKey === "memory-desc") return (b.memories?.length || 0) - (a.memories?.length || 0);
			if (sortKey === "name-asc") return String(a.fileName || a.hash || "").localeCompare(String(b.fileName || b.hash || ""));
			if (sortKey === "name-desc") return String(b.fileName || a.hash || "").localeCompare(String(a.fileName || b.hash || ""));
			return 0;
		}

		/** Stable group identity for one entry under the active group mode. */
		function groupIdentityForEntry(entry, groupBy, sessions) {
			if (groupBy === "session") {
				if (entry.orphan) return { id: GROUP_ORPHAN, label: __t("imageLibrary.orphanBadge"), value: -Infinity };
				if (entry.archived) return { id: GROUP_ARCHIVED, label: __t("imageLibrary.archivedBadge"), value: -1 };
				const sid = (entry.ownerSessions && entry.ownerSessions[0]) || "";
				return { id: sid, label: sessionTitle(sessions, sid), value: sid };
			}
			const ms = Number(entry.mtimeMs) || 0;
			if (!ms) return { id: GROUP_UNKNOWN, label: "—", value: 0 };
			const now = new Date();
			const date = new Date(ms);
			const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
			const startToday = startOfDay(now);
			const diffDays = Math.floor((startToday - startOfDay(date)) / 86400000);
			if (diffDays === 0) {
				const bucket = Math.floor(date.getHours() / 6); // 0..3
				const bucketStart = bucket * 6;
				const label = __t("imageLibrary.dateToday") + " " + String(bucketStart).padStart(2, "0") + ":00";
				return { id: "today-" + bucket, label, value: startToday + bucketStart * 3600000 };
			}
			if (diffDays === 1) {
				const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
				return { id: GROUP_YESTERDAY, label: __t("imageLibrary.dateYesterday"), value: startOfDay(yesterday) };
			}
			const startWeek = new Date(now); startWeek.setHours(0,0,0,0); startWeek.setDate(now.getDate() - now.getDay());
			if (date.getTime() >= startWeek.getTime()) return { id: GROUP_THIS_WEEK, label: __t("imageLibrary.dateThisWeek"), value: startWeek.getTime() };
			const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
			if (date.getTime() >= startMonth.getTime()) return { id: GROUP_THIS_MONTH, label: __t("imageLibrary.dateThisMonth"), value: startMonth.getTime() };
			const startYear = new Date(now.getFullYear(), 0, 1);
			if (date.getTime() >= startYear.getTime()) return { id: GROUP_THIS_YEAR, label: __t("imageLibrary.dateThisYear"), value: startYear.getTime() };
			return { id: "year-" + date.getFullYear(), label: String(date.getFullYear()), value: new Date(date.getFullYear(), 0, 1).getTime() };
		}

		/** Expand multi-owner entries into occurrences for session grouping. */
		function expandSessionOccurrences(entry, sessions) {
			if (entry.orphan) return [{ entry, sid: null }];
			if (entry.archived) return [{ entry, sid: GROUP_ARCHIVED }];
			if (!Array.isArray(entry.ownerSessions) || entry.ownerSessions.length === 0) {
				return [{ entry, sid: null }];
			}
			return entry.ownerSessions.map((sid) => ({ entry, sid }));
		}

		/** Resolve one session occurrence's group id/label. */
		function sessionOccurrenceGroup(occ, sessions) {
			if (occ.sid === null) return { id: GROUP_ORPHAN, label: __t("imageLibrary.orphanBadge") };
			if (occ.sid === GROUP_ARCHIVED) return { id: GROUP_ARCHIVED, label: __t("imageLibrary.archivedBadge") };
			return { id: occ.sid, label: sessionTitle(sessions, occ.sid) };
		}

		/** Compare two session groups; pinned synthetic groups come first by table order. */
		function compareGroupSessions(a, b, groupSortKey) {
			const pa = SESSION_GROUP_PRIORITY.get(a.id);
			const pb = SESSION_GROUP_PRIORITY.get(b.id);
			if (pa !== void 0 || pb !== void 0) {
				if (pa !== void 0 && pb !== void 0) return pa - pb;
				return pa !== void 0 ? -1 : 1;
			}
			if (groupSortKey === "session-title-az") return String(a.label).localeCompare(String(b.label));
			if (groupSortKey === "session-title-za") return String(b.label).localeCompare(String(a.label));
			if (groupSortKey === "session-refs-desc") {
				const countA = a.occurrences.reduce((n, o) => n + (o.entry.ownerSessions?.length || 0), 0);
				const countB = b.occurrences.reduce((n, o) => n + (o.entry.ownerSessions?.length || 0), 0);
				return countB - countA;
			}
			// default: title asc
			return String(a.label).localeCompare(String(b.label));
		}

		/** Build grouped rows from filtered entries. */
		function buildGroups(entries, groupBy, sortKey, groupSortKey, sessions) {
			if (!groupBy || groupBy === "none") {
				return [{ id: null, label: null, entries: [...entries].sort((a, b) => compareEntries(a, b, sortKey)) }];
			}
			const groups = new Map();
			if (groupBy === "session") {
				for (const entry of entries) {
					const occs = expandSessionOccurrences(entry, sessions);
					for (const occ of occs) {
						const group = sessionOccurrenceGroup(occ, sessions);
						if (!groups.has(group.id)) groups.set(group.id, { id: group.id, label: group.label, occurrences: [] });
						groups.get(group.id).occurrences.push({ entry, sid: occ.sid });
					}
				}
			} else {
				for (const entry of entries) {
					const info = groupIdentityForEntry(entry, groupBy, sessions);
					const id = info.id;
					if (!groups.has(id)) groups.set(id, { id, label: info.label, order: info.order || 0, value: info.value, occurrences: [] });
					groups.get(id).occurrences.push({ entry, sid: null });
				}
			}
			const groupList = [...groups.values()];
			if (groupBy === "session") {
				groupList.sort((a, b) => compareGroupSessions(a, b, groupSortKey));
			} else {
				groupList.sort((a, b) => compareDateGroups(a, b, groupSortKey));
			}
			for (const g of groupList) {
				g.entries = g.occurrences.map((o) => o.entry).sort((x, y) => compareEntries(x, y, sortKey));
			}
			return groupList;
		}

		function compareDateGroups(a, b, groupSortKey) {
			const va = Number(a.value) || 0;
			const vb = Number(b.value) || 0;
			if (groupSortKey === "date-old-new") return va - vb;
			// date-new-old default
			return vb - va;
		}

		/** Read the saved thumbnail size preference from localStorage. */
		function initialThumbSize() {
			try {
				const saved = window.localStorage.getItem(THUMB_STORAGE_KEY);
				return THUMB_SIZE_PX[saved] ? saved : "medium";
			} catch {
				return "medium";
			}
		}

		/** Persist the thumbnail size preference. */
		function saveThumbSize(size) {
			try {
				window.localStorage.setItem(THUMB_STORAGE_KEY, size);
			} catch {
				/* localStorage is optional; ignore private-mode failures */
			}
		}

		/**
		 * Image Library floating panel opened from the sidebar footer action.
		 * Opening reads the `aux-image-library` projection (no slash command),
		 * so normal browsing does not pollute the chat with `aux {JSON}` cards.
		 * The Refresh button and the explicit fallback for old hosts may still
		 * run `/aux images --json`.
		 */
		function ImageLibraryPanel(props) {
			const { sessions, runAuxCommand, onClose } = props;
			useLocaleRevision();
			const [data, setData] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [query, setQuery] = react.useState("");
			const [filter, setFilter] = react.useState("all");
			const [thumbSize, setThumbSize] = react.useState(initialThumbSize);
			const [groupBy, setGroupBy] = react.useState("none");
			const [sortKey, setSortKey] = react.useState("time-new");
			const [groupSortKey, setGroupSortKey] = react.useState("group-default");
			const [collapsedGroups, setCollapsedGroups] = react.useState(() => new Set());
			const [selected, setSelected] = react.useState(() => new Set());
			const [detailId, setDetailId] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const scrollRef = react.useRef(null);
			const [dragBox, setDragBox] = react.useState(null);
			const dragRef = react.useRef(null);
			const suppressClickRef = react.useRef(false);

			const applySnapshot = (snapshot) => {
				setData(snapshot);
				setError(null);
			};
			const loadFromProjection = react.useCallback(() => {
				const snapshot = readProjectionSnapshot(sessions);
				if (snapshot) {
					applySnapshot(snapshot);
					return true;
				}
				return false;
			}, [sessions]);
			const loadFromCommand = react.useCallback(async () => {
				// Used by the explicit Refresh button and as the old-host fallback
				// when no projection has been published yet.
				setLoading(true);
				setError(null);
				try {
					const result = await runAuxCommand("/aux images --json");
					applySnapshot(parseAuxCommandJson(result));
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setLoading(false);
				}
			}, [runAuxCommand]);

			react.useEffect(() => {
				let alive = true;
				if (loadFromProjection()) {
					setLoading(false);
					return undefined;
				}
				// Old host without an `aux-image-library` projection: fall back to
				// one `/aux images --json` so the gallery still works. This is not
				// the default open path on current hosts.
				if (runAuxCommand) {
					setLoading(true);
					runAuxCommand("/aux images --json")
						.then((result) => {
							if (alive) applySnapshot(parseAuxCommandJson(result));
						})
						.catch((err) => {
							if (alive) setError(err instanceof Error ? err.message : String(err));
						})
						.finally(() => {
							if (alive) setLoading(false);
						});
				}
				return () => { alive = false; };
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [loadFromProjection, runAuxCommand]);

			const entries = (data?.entries ?? []).filter((entry) => {
				if (filter === "orphan" && !entry.orphan) return false;
				if (filter === "archived" && !entry.archived) return false;
				if (filter === "shared" && !entry.shared) return false;
				if (filter === "retained" && !entry.retained) return false;
				if (filter === "withMemory" && (entry.memories || []).length === 0) return false;
				if (query) {
					const q = query.toLowerCase();
					const memories = entry.memories || [];
					const hit =
						entry.attachmentId.toLowerCase().includes(q) ||
						(entry.fileName || "").toLowerCase().includes(q) ||
						(entry.hash || "").toLowerCase().includes(q) ||
						entry.ownerSessions.some((sid) => sid.toLowerCase().includes(q)) ||
						memories.some((m) => (m.question || "").toLowerCase().includes(q) || (m.summary || "").toLowerCase().includes(q));
					if (!hit) return false;
				}
				return true;
			});
			const counts = data?.counts ?? { total: 0, orphan: 0, archived: 0, shared: 0, retained: 0, withMemory: 0 };
			const groups = buildGroups(entries, groupBy, sortKey, groupSortKey, sessions);
			const toggleGroup = (id) => {
				setCollapsedGroups((prev) => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id); else next.add(id);
					return next;
				});
			};

			const beginDragSelect = (event) => {
				if (event.button !== 0) return;
				// Do not start a drag selection from interactive controls, group
				// headers, checkboxes, links, or the bulk-action area.
				const target = event.target;
				if (target.closest && target.closest("input, button, select, textarea, a, .ax-image-group-header, .ax-image-bulk, .ax-image-toolbar, .ax-image-panel-header")) return;
				const scrollEl = scrollRef.current;
				if (!scrollEl) return;
				event.preventDefault();
				const startX = event.clientX;
				const startY = event.clientY;
				const previous = new Set(selected);
				dragRef.current = {
					active: false,
					startX,
					startY,
					previous,
					lastSelection: new Set(selected),
					suppressClick: false
				};
				suppressClickRef.current = false;
				const onMove = (moveEvent) => {
					const state = dragRef.current;
					if (!state) return;
					const dx = moveEvent.clientX - startX;
					const dy = moveEvent.clientY - startY;
					if (!state.active && Math.hypot(dx, dy) < 4) return;
					state.active = true;
					state.suppressClick = true;
					suppressClickRef.current = true;
					const left = Math.min(startX, moveEvent.clientX);
					const top = Math.min(startY, moveEvent.clientY);
					const right = Math.max(startX, moveEvent.clientX);
					const bottom = Math.max(startY, moveEvent.clientY);
					setDragBox({ left, top, right, bottom, width: right - left, height: bottom - top });
					// Recompute selection from rendered cards.
					const additive = moveEvent.shiftKey || moveEvent.ctrlKey || moveEvent.metaKey;
					const next = additive ? new Set(state.previous) : new Set();
					const cards = scrollEl.querySelectorAll("[data-attachment-id]");
					for (const card of cards) {
						const rect = card.getBoundingClientRect();
						if (rect.right < left || rect.left > right || rect.bottom < top || rect.top > bottom) continue;
						const id = card.getAttribute("data-attachment-id");
						if (id) next.add(id);
					}
					state.lastSelection = next;
					setSelected(next);
				};
				const onUp = (upEvent) => {
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
					const state = dragRef.current;
					if (!state) return;
					if (state.active) {
						setDragBox(null);
						// If no card was captured, plain empty-space drag clears selection
						// unless additive.
						const additive = upEvent.shiftKey || upEvent.ctrlKey || upEvent.metaKey;
						if (!additive && state.lastSelection.size === 0 && state.previous.size > 0) {
							setSelected(new Set());
						}
					}
					dragRef.current = null;
					// Let click run after mouseup; if this was a drag, card onClick
					// will observe suppressClickRef and skip opening detail.
					window.setTimeout(() => {
						suppressClickRef.current = false;
					}, 0);
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			};

			const renderCard = (entry) => {
				const isSel = selected.has(entry.attachmentId);
				return react.createElement("div", {
					key: entry.attachmentId,
					"data-attachment-id": entry.attachmentId,
					className: "ax-image-card" + (isSel ? " ax-image-card-selected" : ""),
					onClick: (e) => {
						if (suppressClickRef.current) {
							e.stopPropagation();
							return;
						}
						setDetailId(entry.attachmentId);
					}
				},
					react.createElement("input", { type: "checkbox", className: "ax-image-checkbox", checked: isSel, onClick: (e) => e.stopPropagation(), onChange: () => toggleSelect(entry.attachmentId) }),
					react.createElement(ImageThumb, { sessions, entry, size: thumbSize }),
					react.createElement("div", { className: "ax-image-card-body" },
						entry.orphan ? react.createElement("span", { className: "ax-image-badge ax-image-badge-orphan" }, __t("imageLibrary.orphanBadge")) : null,
						entry.archived ? react.createElement("span", { className: "ax-image-badge ax-image-badge-archived" }, __t("imageLibrary.archivedBadge")) : null,
						entry.shared ? react.createElement("span", { className: "ax-image-badge ax-image-badge-shared" }, __t("imageLibrary.sharedBadge")) : null,
						entry.retained ? react.createElement("span", { className: "ax-image-badge ax-image-badge-retained" }, __t("imageLibrary.retainedBadge")) : null,
						(entry.memories || []).length > 0 ? react.createElement("span", { className: "ax-image-badge ax-image-badge-memory" }, __t("imageLibrary.memoryBadge")) : null,
						react.createElement("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, entry.fileName || entry.hash)
					)
				);
			};

			const reloadAfterMutation = () => {
				// Host mutations publish a fresh `aux-image-library` projection;
				// give the projection store a beat to land before re-reading.
				// Only when the host has NO projection at all (old host) do we
				// fall back to the command path; on current hosts this keeps the
				// chat free of `aux {JSON}` cards after mutations.
				window.setTimeout(() => {
					if (!loadFromProjection() && runAuxCommand) {
						loadFromCommand();
					}
				}, 120);
			};

			const runAction = async (line, okText) => {
				setBusy(true);
				setNotice(null);
				try {
					const result = await runAuxCommand(line);
					if (result.kind !== "success") throw new Error(result.text || "action failed");
					if (okText) setNotice(okText);
					reloadAfterMutation();
				} catch (err) {
					setNotice(__t("imageLibrary.opFailed").replace("{msg}", err instanceof Error ? err.message : String(err)));
				} finally {
					setBusy(false);
				}
			};

			const deleteSelected = async () => {
				const ids = [...selected];
				if (ids.length === 0) return;
				if (!window.confirm(__t("imageLibrary.confirmDelete"))) return;
				setBusy(true);
				setNotice(null);
				try {
					for (const id of ids) {
						const result = await runAuxCommand("/aux image delete " + id + " --force");
						if (result.kind !== "success") throw new Error(result.text || "delete failed");
					}
					setSelected(new Set());
					setNotice(__t("imageLibrary.opDone"));
					reloadAfterMutation();
				} catch (err) {
					setNotice(__t("imageLibrary.opFailed").replace("{msg}", err instanceof Error ? err.message : String(err)));
				} finally {
					setBusy(false);
				}
			};
			const deleteOrphans = async () => {
				if (!window.confirm(__t("imageLibrary.confirmOrphans"))) return;
				setBusy(true);
				setNotice(null);
				try {
					const result = await runAuxCommand("/aux image gc-orphans");
					if (result.kind !== "success") throw new Error(result.text || "reclaim failed");
					setSelected(new Set());
					setNotice(__t("imageLibrary.opDone"));
					reloadAfterMutation();
				} catch (err) {
					setNotice(__t("imageLibrary.opFailed").replace("{msg}", err instanceof Error ? err.message : String(err)));
				} finally {
					setBusy(false);
				}
			};
			const toggleRetain = (entry) => {
				const line = entry.retained ? "/aux image unretain " + entry.attachmentId : "/aux image retain " + entry.attachmentId;
				runAction(line, __t("imageLibrary.opDone"));
			};
			const toggleSelect = (id) => {
				setSelected((prev) => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id); else next.add(id);
					return next;
				});
			};
			const selectAllVisible = () => {
				setSelected(new Set(entries.map((e) => e.attachmentId)));
			};
			const invertVisible = () => {
				setSelected((prev) => {
					const next = new Set(prev);
					for (const e of entries) {
						if (next.has(e.attachmentId)) next.delete(e.attachmentId); else next.add(e.attachmentId);
					}
					return next;
				});
			};

			const panel = react.createElement("div", { className: "ax-image-panel", onClick: (e) => e.stopPropagation() },
				react.createElement("div", { className: "ax-image-panel-header" },
					react.createElement("span", { className: "ax-image-panel-title" }, __t("imageLibrary.title")),
					react.createElement("input", { className: "ax-image-search", placeholder: __t("imageLibrary.search"), value: query, onChange: (e) => setQuery(e.target.value) }),
					react.createElement("button", { className: "ax-image-action", onClick: () => loadFromCommand(), disabled: loading || busy }, __t("imageLibrary.refresh")),
					react.createElement("button", { className: "ax-image-action", onClick: onClose }, __t("imageLibrary.close"))
				),
				react.createElement("div", { className: "ax-image-toolbar" },
					react.createElement("span", { className: "ax-image-panel-stats" },
						__t("imageLibrary.total").replace("{total}", String(counts.total)) + " · " +
						__t("imageLibrary.shared").replace("{n}", String(counts.shared)) + " · " +
						__t("imageLibrary.orphan").replace("{n}", String(counts.orphan)) + " · " +
						__t("imageLibrary.archived").replace("{n}", String(counts.archived || 0)) + " · " +
						__t("imageLibrary.retained").replace("{n}", String(counts.retained)) + " · " +
						__t("imageLibrary.withMemory").replace("{n}", String(counts.withMemory))
					),
					[["all", "imageLibrary.filterAll"], ["shared", "imageLibrary.filterShared"], ["orphan", "imageLibrary.filterOrphan"], ["archived", "imageLibrary.filterArchived"], ["retained", "imageLibrary.filterRetained"], ["withMemory", "imageLibrary.filterMemory"]].map(([key, label]) =>
						react.createElement("button", { key, className: "ax-image-chip" + (filter === key ? " ax-image-chip-active" : ""), onClick: () => setFilter(key) }, __t(label))
					),
					react.createElement("span", { className: "ax-image-view-controls" },
						react.createElement("span", null, __t("imageLibrary.groupBy") + " "),
						react.createElement("select", { value: groupBy, onChange: (e) => setGroupBy(e.target.value), title: __t("imageLibrary.groupBy") },
							react.createElement("option", { value: "none" }, __t("imageLibrary.groupNone")),
							react.createElement("option", { value: "date" }, __t("imageLibrary.groupDate")),
							react.createElement("option", { value: "session" }, __t("imageLibrary.groupSession"))
						),
						react.createElement("span", null, __t("imageLibrary.sortBy") + " "),
						react.createElement("select", { value: sortKey, onChange: (e) => setSortKey(e.target.value), title: __t("imageLibrary.sortBy") },
							react.createElement("option", { value: "time-new" }, __t("imageLibrary.sortTimeNew")),
							react.createElement("option", { value: "time-old" }, __t("imageLibrary.sortTimeOld")),
							react.createElement("option", { value: "size-desc" }, __t("imageLibrary.sortSizeDesc")),
							react.createElement("option", { value: "size-asc" }, __t("imageLibrary.sortSizeAsc")),
							react.createElement("option", { value: "name-asc" }, __t("imageLibrary.sortNameAsc")),
							react.createElement("option", { value: "name-desc" }, __t("imageLibrary.sortNameDesc")),
							react.createElement("option", { value: "refs-desc" }, __t("imageLibrary.sortRefsDesc")),
							react.createElement("option", { value: "memory-desc" }, __t("imageLibrary.sortMemoryDesc"))
						),
						groupBy && groupBy !== "none" ? react.createElement(react.Fragment, null,
							react.createElement("span", null, __t("imageLibrary.groupSort") + " "),
							react.createElement("select", { value: groupSortKey, onChange: (e) => setGroupSortKey(e.target.value), title: __t("imageLibrary.groupSort") },
								groupBy === "session" ?
									[
										["group-default", "imageLibrary.groupSortDefault"],
										["session-title-az", "imageLibrary.groupSortTitleAz"],
										["session-title-za", "imageLibrary.groupSortTitleZa"],
										["session-refs-desc", "imageLibrary.groupSortRefsDesc"]
									].map(([value, label]) => react.createElement("option", { key: value, value }, __t(label))) :
									[
										["group-default", "imageLibrary.groupSortDefault"],
										["date-new-old", "imageLibrary.groupSortDateNew"],
										["date-old-new", "imageLibrary.groupSortDateOld"]
									].map(([value, label]) => react.createElement("option", { key: value, value }, __t(label)))
							)
						) : null
					),
					react.createElement("span", { className: "ax-image-bulk" },
						__t("imageLibrary.selected").replace("{n}", String(selected.size)),
						react.createElement("button", { className: "ax-image-action", onClick: selectAllVisible }, __t("imageLibrary.selectAll")),
						react.createElement("button", { className: "ax-image-action", onClick: invertVisible }, __t("imageLibrary.invert")),
						react.createElement("button", { className: "ax-image-action", onClick: () => setSelected(new Set()) }, __t("imageLibrary.clear")),
						react.createElement("button", { className: "ax-image-action ax-image-action-danger", disabled: busy || selected.size === 0, onClick: deleteSelected }, __t("imageLibrary.delete")),
						react.createElement("button", { className: "ax-image-action ax-image-action-danger", disabled: busy, onClick: deleteOrphans }, __t("imageLibrary.deleteOrphans")),
						[["small", "imageLibrary.viewSmall"], ["medium", "imageLibrary.viewMedium"], ["large", "imageLibrary.viewLarge"]].map(([key, label]) =>
							react.createElement("button", { key, className: "ax-image-chip" + (thumbSize === key ? " ax-image-chip-active" : ""), onClick: () => {
								setThumbSize(key);
								saveThumbSize(key);
							} }, __t(label))
						)
					)
				),
				react.createElement("div", { ref: scrollRef, className: "ax-image-scroll", onMouseDown: beginDragSelect, style: { "--ax-thumb-size": (THUMB_SIZE_PX[thumbSize] || THUMB_SIZE_PX.medium) + "px" } },
					loading ? react.createElement("div", { className: "ax-image-empty" }, "…") :
					error ? react.createElement("div", { className: "ax-image-empty ax-error" }, String(error)) :
					entries.length === 0 ? react.createElement("div", { className: "ax-image-empty" }, query || filter !== "all" ? __t("imageLibrary.noResult") : __t("imageLibrary.noImage")) :
					groupBy === "none" || groupBy === null || groupBy === void 0 ?
						react.createElement("div", { className: "ax-image-grid" }, groups[0] && groups[0].entries ? groups[0].entries.map(renderCard) : null) :
						react.createElement("div", { className: "ax-image-groups" },
							groups.map((group) => {
								const collapsed = collapsedGroups.has(group.id);
								return react.createElement("div", { key: group.id, className: "ax-image-group" },
									react.createElement("button", { type: "button", className: "ax-image-group-header", onClick: () => toggleGroup(group.id), "aria-expanded": String(!collapsed), title: __t(collapsed ? "imageLibrary.groupExpand" : "imageLibrary.groupCollapse") },
										react.createElement("span", { className: "ax-image-group-header-text" },
											react.createElement("span", null, group.label || "—"),
											react.createElement("span", { className: "ax-image-group-count" }, __t("imageLibrary.groupCount").replace("{n}", String(group.entries.length)))
										),
										react.createElement("span", { className: "ax-image-group-chevron" + (collapsed ? "" : " ax-image-group-chevron-open") }, collapsed ? "▸" : "▾")
									),
									collapsed ? null :
									react.createElement("div", { className: "ax-image-group-grid" }, group.entries.map(renderCard))
								);
							})
						),
					dragBox ? react.createElement("div", { className: "ax-image-drag-select", style: { left: dragBox.left + "px", top: dragBox.top + "px", width: dragBox.width + "px", height: dragBox.height + "px" } }) : null
				),
				notice ? react.createElement("div", { className: "ax-image-detail-row ax-image-notice" }, notice) : null
			);
			return react.createElement("div", { className: "ax-image-overlay", onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
				panel,
				detailId ? react.createElement(ImageDetail, { sessions, entries, detailId, runAuxCommand, toggleRetain, onCloseDetail: () => setDetailId(null), onClosePanel: onClose }) : null
			);
		}

		/** Loads one image thumbnail via readAttachment, trying readable owners in order. */
		function ImageThumb(props) {
			const { sessions, entry, size } = props;
			const [url, setUrl] = react.useState(null);
			const [failed, setFailed] = react.useState(false);
			const sizePx = THUMB_SIZE_PX[size] || THUMB_SIZE_PX.medium;
			const sizeStyle = { "--ax-thumb-size": sizePx + "px" };
			react.useEffect(() => {
				let alive = true;
				let objectUrl = null;
				setUrl(null);
				setFailed(false);
				// Prefer live/readable owners. If the first owner is not bound by
				// the current UI session service, keep trying the remaining live
				// owners (and finally the original readableBySessionId fallback).
				const candidates = [];
				for (const sid of entry.ownerLiveSessions || []) {
					if (!candidates.includes(sid)) candidates.push(sid);
				}
				if (entry.readableBySessionId && !candidates.includes(entry.readableBySessionId)) {
					candidates.push(entry.readableBySessionId);
				}
				if (candidates.length === 0) { setFailed(true); return undefined; }
				let stopped = false;
				const tryNext = async (index) => {
					if (!alive || stopped) return;
					const sid = candidates[index];
					if (sid === void 0) { setFailed(true); return; }
					const binding = sessions?.binding?.(sid);
					const session = binding?.session;
					if (!session || typeof session.readAttachment !== "function") {
						await tryNext(index + 1);
						return;
					}
					try {
						const res = await session.readAttachment(entry.attachmentId);
						if (!alive || stopped) return;
						if (!res.ok || !res.value) {
							await tryNext(index + 1);
							return;
						}
						const bytes = res.value.data;
						const mediaType = res.value.attachment?.mediaType || "image/png";
						const blob = new Blob([bytes], { type: mediaType });
						objectUrl = URL.createObjectURL(blob);
						setUrl(objectUrl);
					} catch {
						await tryNext(index + 1);
					}
				};
				tryNext(0);
				return () => { alive = false; stopped = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [sessions, entry.attachmentId, entry.readableBySessionId, entry.ownerLiveSessions]);
			if (failed) return react.createElement("div", { className: "ax-image-thumb-placeholder", style: sizeStyle }, "🖼");
			if (!url) return react.createElement("div", { className: "ax-image-thumb-placeholder", style: sizeStyle }, "…");
			return react.createElement("img", { className: "ax-image-thumb", style: sizeStyle, src: url, alt: entry.fileName || entry.hash });
		}

		/** Center modal with one image's metadata, memories, and jump actions. */
		function ImageDetail(props) {
			const { sessions, entries, detailId, runAuxCommand, toggleRetain, onCloseDetail, onClosePanel } = props;
			useLocaleRevision();
			const entry = entries.find((e) => e.attachmentId === detailId);
			const [notice, setNotice] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [showAllMemories, setShowAllMemories] = react.useState(false);
			const [expandedSummaries, setExpandedSummaries] = react.useState(() => new Set());
			const modalRef = react.useRef(null);
			react.useEffect(() => {
				setNotice(null);
				setBusy(false);
				setShowAllMemories(false);
				setExpandedSummaries(new Set());
			}, [detailId]);
			if (!entry) return null;

			const memories = Array.isArray(entry.memories) ? entry.memories : [];
			const ownerIds = Array.from(new Set(entry.ownerSessions || []));
			const liveIds = new Set(entry.ownerLiveSessions || []);
			const archivedIds = new Set(entry.ownerArchivedSessions || []);
			const listById = (() => { try { return sessions?.list?.getSnapshot?.().byId || {}; } catch { return {}; } })();

			const goConversation = async (sessionId) => {
				// 不自动执行 `/aux image locate`:那会在聊天流里刷出一条命令 JSON 卡片。
				// 当前 DSH 没有对侧边栏插件暴露“滚动聊天到指定消息”的稳定公共 API,
				// 所以这里做可用降级:打开目标会话并关闭图库,让用户进入该会话上下文。
				sessions?.open?.(sessionId);
				if (onClosePanel) onClosePanel();
				else onCloseDetail();
			};

			const goTrace = (sessionId) => {
				// 官方未开放“打开轨迹并聚焦 callId”的公共能力;降级为打开会话并提示。
				sessions?.open?.(sessionId);
				if (onClosePanel) onClosePanel();
				else onCloseDetail();
			};

			const toggleSummary = (key) => {
				setExpandedSummaries((prev) => {
					const next = new Set(prev);
					if (next.has(key)) next.delete(key); else next.add(key);
					return next;
				});
			};

			const beginDrag = (event) => {
				if (event.button !== 0) return;
				const dialog = modalRef.current;
				if (!dialog) return;
				event.preventDefault();
				const startX = event.clientX;
				const startY = event.clientY;
				const rect = dialog.getBoundingClientRect();
				const onMove = (moveEvent) => {
					const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, rect.left + moveEvent.clientX - startX));
					const top = Math.max(8, Math.min(window.innerHeight - 48, rect.top + moveEvent.clientY - startY));
					dialog.style.left = left + "px";
					dialog.style.top = top + "px";
					dialog.style.transform = "none";
				};
				const onUp = () => {
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			};

			const beginResize = (event) => {
				if (event.button !== 0) return;
				const dialog = modalRef.current;
				if (!dialog) return;
				event.preventDefault();
				event.stopPropagation();
				const startX = event.clientX;
				const startY = event.clientY;
				const rect = dialog.getBoundingClientRect();
				const onMove = (moveEvent) => {
					const width = Math.max(560, Math.min(window.innerWidth - rect.left - 8, rect.width + moveEvent.clientX - startX));
					const height = Math.max(300, Math.min(window.innerHeight - rect.top - 8, rect.height + moveEvent.clientY - startY));
					dialog.style.width = width + "px";
					dialog.style.height = height + "px";
					dialog.style.maxHeight = "calc(100vh - 16px)";
				};
				const onUp = () => {
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			};

			const mediaTypeLabel = entry.mediaType || (entry.fileName && entry.fileName.includes(".") ? entry.fileName.slice(entry.fileName.lastIndexOf(".") + 1) : entry.kind || "image");

			return react.createElement("div", {
				className: "ax-image-detail-overlay",
				onClick: (event) => {
					event.stopPropagation();
					if (event.target === event.currentTarget) {
						onCloseDetail();
					}
				}
			},
				react.createElement("div", { className: "ax-image-modal", ref: modalRef, onClick: (e) => e.stopPropagation() },
					react.createElement("div", { className: "ax-image-modal-header", onMouseDown: beginDrag },
						react.createElement("span", { className: "ax-image-modal-title", title: entry.fileName || entry.hash }, entry.fileName || entry.hash),
						notice ? react.createElement("span", { className: "ax-image-notice", role: "status" }, notice) : null,
						react.createElement("span", { className: "ax-image-modal-actions" },
							react.createElement("button", { className: "ax-image-action", onClick: () => toggleRetain(entry) }, entry.retained ? __t("imageLibrary.unretain") : __t("imageLibrary.retain")),
							react.createElement("button", { className: "ax-image-action ax-image-action-danger", onClick: async () => {
								if (window.confirm(__t("imageLibrary.confirmDelete"))) {
									try {
										const result = await runAuxCommand("/aux image delete " + entry.attachmentId + " --force");
										if (result.kind !== "success") throw new Error(result.text || "delete failed");
										onCloseDetail();
									} catch (err) {
										setNotice(__t("imageLibrary.opFailed").replace("{msg}", err instanceof Error ? err.message : String(err)));
									}
								}
							} }, __t("imageLibrary.delete")),
							react.createElement("button", { className: "ax-image-action", onClick: () => onCloseDetail() }, __t("imageLibrary.close"))
						)
					),
					react.createElement("div", { className: "ax-image-modal-body" },
						react.createElement("div", { className: "ax-image-modal-preview" },
							react.createElement(ImageThumb, { sessions, entry, size: "detail" })
						),
						react.createElement("div", { className: "ax-image-modal-info" },
							react.createElement("div", null,
								react.createElement("div", { className: "ax-image-section-label" }, __t("imageLibrary.meta")),
								react.createElement("div", { className: "ax-image-meta" },
									react.createElement("div", { className: "ax-image-meta-item" },
										react.createElement("span", { className: "ax-image-meta-label" }, __t("imageLibrary.fileName")),
										react.createElement("span", { className: "ax-image-meta-value", title: entry.fileName || entry.hash }, entry.fileName || entry.hash)
									),
									react.createElement("div", { className: "ax-image-meta-item" },
										react.createElement("span", { className: "ax-image-meta-label" }, __t("imageLibrary.fileType")),
										react.createElement("span", { className: "ax-image-meta-value" }, mediaTypeLabel)
									),
									react.createElement("div", { className: "ax-image-meta-item" },
										react.createElement("span", { className: "ax-image-meta-label" }, __t("imageLibrary.size")),
										react.createElement("span", { className: "ax-image-meta-value" }, formatBytes(entry.bytes))
									),
									react.createElement("div", { className: "ax-image-meta-item" },
										react.createElement("span", { className: "ax-image-meta-label" }, __t("imageLibrary.modified")),
										react.createElement("span", { className: "ax-image-meta-value" }, formatDateTime(entry.mtimeMs))
									),
									react.createElement("div", { className: "ax-image-meta-item" },
										react.createElement("span", { className: "ax-image-meta-label" }, __t("imageLibrary.references")),
										react.createElement("span", { className: "ax-image-meta-value" }, String(entry.referenceCount ?? (entry.ownerSessions || []).length))
									)
								),
								react.createElement("div", { className: "ax-image-badges", style: { marginTop: "8px" } },
									entry.orphan ? react.createElement("span", { className: "ax-image-badge ax-image-badge-orphan" }, __t("imageLibrary.orphanBadge")) : null,
									entry.archived ? react.createElement("span", { className: "ax-image-badge ax-image-badge-archived" }, __t("imageLibrary.archivedBadge")) : null,
									entry.shared ? react.createElement("span", { className: "ax-image-badge ax-image-badge-shared" }, __t("imageLibrary.sharedBadge")) : null,
									entry.retained ? react.createElement("span", { className: "ax-image-badge ax-image-badge-retained" }, __t("imageLibrary.retainedBadge")) : null,
									memories.length > 0 ? react.createElement("span", { className: "ax-image-badge ax-image-badge-memory" }, __t("imageLibrary.memoryBadge")) : null
								)
							),
							react.createElement("div", null,
								react.createElement("div", { className: "ax-image-section-label" }, __t("imageLibrary.detailOwners")),
								ownerIds.length === 0 ? react.createElement("div", { className: "ax-image-meta-value" }, "—") :
								ownerIds.map((sid) => {
									const isLive = liveIds.has(sid) || listById[sid] !== void 0;
									const isArchived = archivedIds.has(sid);
									const title = sessionTitle(sessions, sid);
									return react.createElement("div", { key: sid, className: "ax-image-owner" },
										react.createElement("div", { className: "ax-image-owner-main", title },
											react.createElement("div", { className: "ax-image-owner-title" },
												title,
												isArchived ? react.createElement("span", { className: "ax-image-badge ax-image-badge-archived" }, __t("imageLibrary.archivedBadge")) : null
											),
											react.createElement("div", { className: "ax-image-owner-id" }, shortSessionId(sid))
										),
										react.createElement("div", { className: "ax-image-owner-actions" },
											react.createElement("button", { className: "ax-image-action", disabled: !isLive || busy, onClick: () => goConversation(sid), title: isLive ? __t("imageLibrary.goConversation") : __t("imageLibrary.offline") }, __t("imageLibrary.goConversation")),
											react.createElement("button", { className: "ax-image-action", disabled: !isLive || busy, onClick: () => goTrace(sid), title: isLive ? __t("imageLibrary.goTrace") : __t("imageLibrary.offline") }, __t("imageLibrary.goTrace"))
										)
									);
								})
							),
							react.createElement("div", null,
								react.createElement("div", { className: "ax-image-section-label" }, __t("imageLibrary.detailMemories")),
								memories.length === 0 ? react.createElement("div", { className: "ax-image-meta-value" }, "—") :
								react.createElement("div", null,
									memories.slice(0, showAllMemories ? memories.length : 5).map((m, index) => {
										const key = String(m.at || 0) + "-" + m.sessionId + "-" + index;
										const summary = String(m.summary || "");
										const isLong = summary.length > 300;
										const expanded = expandedSummaries.has(key);
										return react.createElement("div", { key, className: "ax-image-memory-card" },
											react.createElement("div", { className: "ax-image-memory-meta" },
												react.createElement("span", null, shortSessionId(m.sessionId)),
												react.createElement("span", null, formatDateTime(m.at)),
												react.createElement("button", { className: "ax-image-memory-more", type: "button", onClick: () => toggleSummary(key) }, isLong ? (expanded ? __t("imageLibrary.memoryCollapse") : __t("imageLibrary.memoryExpand")) : null)
											),
											react.createElement("div", { className: "ax-image-memory-q" }, m.question || ""),
											react.createElement("div", { className: "ax-image-memory-a" }, expanded || !isLong ? summary : summary.slice(0, 300) + "…")
										);
									}),
									memories.length > 5 ? react.createElement("button", { className: "ax-image-memory-more", type: "button", onClick: () => setShowAllMemories((v) => !v) }, showAllMemories ? __t("imageLibrary.memoriesShowLess") : __t("imageLibrary.memoriesShowAll").replace("{n}", String(memories.length))) : null
								)
							)
						)
					),
					react.createElement("div", { className: "ax-image-resize-handle", title: "resize", onMouseDown: beginResize })
				)
			);
		}

		/** Sidebar footer action: button to open the image library. */
		function ImageLibraryButton(props) {
			const { sessions, runAuxCommand, wide } = props;
			const [open, setOpen] = react.useState(false);
			return react.createElement("div", null,
				react.createElement("button", {
					type: "button",
					className: "ax-image-sidebar-badge",
					"data-rail": !wide ? "true" : void 0,
					onClick: () => setOpen(true),
					"aria-label": __t("imageLibrary.open")
				}, wide ? __t("imageLibrary.open") : "🖼"),
				open ? react.createElement(ImageLibraryPanel, { sessions, runAuxCommand, onClose: () => setOpen(false) }) : null
			);
		}

		function AuxStatusChip(props) {
			const t = (props && props.t) || __t;
			useLocaleRevision();
			const projection = props.useProjection("aux-status");
			const [historyCall, setHistoryCall] = react.useState(null);
			const historyRequestId = react.useRef(0);
			const loadLatestCall = react.useCallback(() => {
				if (!props.sessions || !props.sessionId) return;
				const requestId = ++historyRequestId.current;
				setHistoryCall(null);
				Promise.resolve()
					.then(() => {
						const binding = props.sessions.binding?.(props.sessionId);
						const events = binding?.session?.eventSource?.getSnapshot?.().entries ?? [];
						for (let i = events.length - 1; i >= 0; i--) {
							const entry = events[i];
							const event = entry && entry.event;
							if (event && event.type === "aux/llm-call" && event.data && typeof event.data === "object") {
								if (requestId === historyRequestId.current) {
									const data = event.data;
									setHistoryCall({
										task: String(data.task ?? ""),
										ok: data.ok === true,
										fallbackUsed: data.fallbackUsed === true,
										durationMs: typeof data.durationMs === "number" ? data.durationMs : 0,
										seq: event.seq,
										time: event.time
									});
								}
								return;
							}
						}
						if (requestId === historyRequestId.current) setHistoryCall(null);
					})
					.catch(() => {
						// History is only an enhancement; fall back to the projection below.
					});
			}, [props.sessions, props.sessionId]);
			react.useEffect(() => {
				historyRequestId.current++;
				setHistoryCall(null);
			}, [props.sessionId]);
			react.useEffect(() => {
				if (projection !== void 0) loadLatestCall();
			}, [loadLatestCall, projection]);
			if (projection === void 0) return null;
			const tasks = projection.tasks ?? {};
			const entries = Object.values(tasks);
			const projectionLast = entries.length === 0 ? null : entries[entries.length - 1];
			const last = historyCall && historyCall.task ? historyCall : projectionLast;
			if (last === null || last === void 0) return null;
			const ok = last.ok === true;
			const chipKey = "chip." + last.task;
			const taskLabel = (zhDict[chipKey] || enDict[chipKey]) ? t(chipKey) : last.task;
			const label = taskLabel + (ok ? " ✓" : " ✗");
			const durationText = typeof last.durationMs === "number" ? last.durationMs + "ms" : "-";
			const title = `aux ${last.task}: ${ok ? t("chip.success") : t("chip.fail")} ${durationText}${last.fallbackUsed ? t("chip.fallback") : ""}`;
			return react.createElement("span", { className: "ax-wrap", title }, react.createElement("span", {
				className: "ax-chip " + (ok ? "ax-ok" : "ax-fail"),
				"aria-label": title
			}, label));
		}

		/**
		 * Build an alpha.3-compatible `api` facade over the Remote/Sessions
		 * services. The old `connection.api` shape is gone in 0.1.2-alpha.x;
		 * this keeps the settings page/status chip code mostly unchanged while
		 * routing through the current client services.
		 *
		 * Older DSH releases (<= 0.1.1-rc.2) still expose the legacy
		 * `connection.api` surface; prefer it when present so the same client
		 * bundle keeps working across the supported version range.
		 */
		function createAlpha3Api(ctx) {
			const legacy = ctx.get("connection");
			if (legacy && legacy.api && typeof legacy.api === "object") return legacy.api;
			const remote = ctx.get("remote");
			const sessions = ctx.get("sessions");
			return {
				settings: {
					describe: async () => {
						const response = await remote.settings.describe();
						return response.ok ? { ok: true, value: response.value } : { ok: false, error: response.error };
					},
					mutate: async ({ ns, ops, expectedRevision }) => {
						const response = await remote.settings.mutate(ns, ops, expectedRevision);
						return response.ok ? { ok: true, value: response.value } : { ok: false, error: response.error };
					}
				},
				llm: {
					providers: async () => {
						const response = await remote.llm.listProviders();
						if (!response.ok) return { ok: false, error: response.error };
						const providers = (response.value ?? []).map((p) => ({
							provider: p.id,
							name: p.name,
							displayName: p.name,
							active: true
						}));
						return { ok: true, value: { providers } };
					},
					models: async () => {
						const response = await remote.session.modelCatalog();
						if (!response.ok) return { ok: false, error: response.error };
						return { ok: true, value: { groups: response.value.groups ?? [] } };
					}
				},
				sessions: {
					list: async () => {
						const snapshot = sessions.list.getSnapshot();
						const items = snapshot.ids.map((id) => ({ sessionId: id, ...snapshot.byId[id] }));
						return { ok: true, value: { items } };
					}
				}
			};
		}

		/** Required client services. */
		const inject = ["slots", "connection", "remote", "remote.commands", "remote.settings", "remote.llm", "remote.session", "sessions"];
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
			const api = createAlpha3Api(ctx);
			const sessions = ctx.get("sessions");
			const runAuxCommand = async (line) => {
				const listResponse = unwrapResponse(await api.sessions.list({}));
				const items = listResponse?.value?.items ?? [];
				if (items.length === 0) throw new Error(__t("command.noSession"));
				const sessionId = items[0].sessionId;
				const result = await ctx.remote.commands.execute(sessionId, line, []);
				if (!result.ok) throw new Error(__t("command.failed") + (result.error?.code ?? "") + ": " + (result.error?.message ?? ""));
				if (result.value === void 0) throw new Error(__t("command.unknown") + line);
				return result.value.result;
			};
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "aux",
				order: 30,
				label: () => __t("settings.title"),
				locale: NS,
				inject: () => ({ api, runAuxCommand, sessions })
			}, AuxSettingsPage));
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "aux-status",
				locale: NS,
				inject: () => ({ sessions })
			}, AuxStatusChip));
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "aux-image-library",
				order: 20,
				label: () => __t("imageLibrary.open"),
				locale: NS,
				inject: () => ({ sessions, runAuxCommand })
			}, ImageLibraryButton));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
