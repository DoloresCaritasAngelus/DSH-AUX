#!/usr/bin/env node
/**
 * dsh-image-bridge 补丁安装器 v2(适配 dsh-aux vision_analyze 版)
 *
 * 让纯文本对话模型(deepseek-v4-flash 等)也能接收用户粘贴的图片,同时
 * 让用户在 UI 里看到自己发的图片缩略图:
 *
 *  1) @deepseek-ai/dsh-host-apiproxy(admit):image block 原样保留进
 *     会话消息(UI 渲染缩略图),仅为每个附件对象补建带扩展名的硬链接。
 *  2) @deepseek-ai/dsh-agent-loop(buildRequest):模型输入边界处,把
 *     image block 改写为"本地路径文本"(仅当模型非图像能力——
 *     resolveModelInfo 的 inputModalities 不含 image;或 dsh-aux 开启了
 *     forceAuxVision 强制原生视觉也走 AUX),模型用 dsh-aux
 *     的 vision_analyze 工具(imagePath 参数)把图片交给辅助视觉模型。
 *     多模态模型(如 volcengine-ark/doubao-seed-2.0-lite)默认保持原生图片。
 *  3) @deepseek-ai/dsh-host-apiproxy(selectModel):允许在含图片的会话中
 *     切换到纯文本模型。旧逻辑会因为"会话里有图片"而拒绝无图像能力的
 *     模型;有了上面的输入边界桥接后这个限制不再必要。
 *  4) @deepseek-ai/dsh-tool-subagent(schema):为 subagent 工具增加
 *     可选的 `requires_vision` 参数(native 透明接管用)。
 *  5) @deepseek-ai/dsh-tool-subagent(request):executed 时读取
 *     `ctx.auxLlm.subagentRoute()` 注入 agentOptions/toolFilter。
 *  6) @deepseek-ai/dsh-workflow-worker-thread(startChild):让 workflow
 *     `agent()` 扇出的子代理同样走 AUX 子代理路由(includeWorkflow 门控)。
 *  7) @deepseek-ai/dsh-tool-skill(schema):为 skill 工具增加可选 `task`
 *     参数,供技能预审桥接读取主模型意图。
 *
 * 用法:
 *   node apply-patch.mjs            # 应用/升级补丁(自动定位、备份、替换、校验)
 *   node apply-patch.mjs --dry-run  # 只检查,不修改
 *   node apply-patch.mjs --rollback # 回滚到最近一次备份(各目标各自回滚)
 */
import { readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { deployedFile, guardTarget } from "./target.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 目标文件 ────────────────────────────────────────────────────────────────
// 不写死任何用户绝对路径:按部署形态相对解析(symlink / 源码树),并在读写前
// 校验目标必须位于 node_modules/@deepseek-ai/.../lib/index.js。
const API_PROXY_FILE = guardTarget(deployedFile(
  "../../../@deepseek-ai/dsh-host-apiproxy/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js"
), "dsh-image-bridge");
const AGENT_LOOP_FILE = guardTarget(deployedFile(
  "../../../@deepseek-ai/dsh-agent-loop/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js"
), "dsh-image-bridge");
const SUBAGENT_TOOL_FILE = guardTarget(deployedFile(
  "../../../@deepseek-ai/dsh-tool-subagent/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js"
), "dsh-subagent-bridge");
const WORKFLOW_ENGINE_FILE = guardTarget(deployedFile(
  "../../../@deepseek-ai/dsh-workflow-worker-thread/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-workflow-worker-thread/lib/index.js"
), "dsh-workflow-bridge");
const SKILL_TOOL_FILE = guardTarget(deployedFile(
  "../../../@deepseek-ai/dsh-tool-skill/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-tool-skill/lib/index.js"
), "dsh-skill-bridge");
const WEB_FETCH_TOOL_FILE = guardTarget(deployedFile(
  "../../../@deepseek-ai/dsh-tool-web/lib/index.js",
  "../../../node_modules/@deepseek-ai/dsh-tool-web/lib/index.js"
), "dsh-web-fetch-compat");

const TARGETS = [
  {
    label: "dsh-host-apiproxy",
    file: API_PROXY_FILE,
    mark: "dsh-image bridge v2 (local patch)",
    states: [
      { name: "v2", detect: (d) => d.includes("dsh-image bridge v2 (local patch)"), action: "skip" },
      { name: "v1", detect: (d) => d.includes("dsh-vision bridge (local patch)"), block: await readFile(join(HERE, "v1-block.txt"), "utf8"), action: "replace" },
      { name: "original", detect: (d) => d.includes("MODEL_DOES_NOT_SUPPORT_IMAGES"), block: await readFile(join(HERE, "orig-block.txt"), "utf8"), action: "replace" }
    ],
    patched: await readFile(join(HERE, "patched-block.txt"), "utf8"),
    backupPrefix: "index.js.bak-"
  },
  {
    label: "dsh-agent-loop",
    file: AGENT_LOOP_FILE,
    mark: "image-bridge v2 (local patch)",
    states: [
      { name: "v3", detect: (d) => d.includes("image-bridge v2 (local patch)") && d.includes("await this.bridgeImagesForModel(boundaryMessages") && d.includes("forceAuxVision"), action: "skip" },
      { name: "v2", detect: (d) => d.includes("image-bridge v2 (local patch)") && d.includes("await this.bridgeImagesForModel(boundaryMessages") && !d.includes("forceAuxVision"), block: 'if (Array.isArray(modalities) && modalities.includes("image")) return messages;', replacement: 'let forceAuxVision = false;\n\t\t\ttry {\n\t\t\t\tconst aux = this.loopCtx?.get?.("auxLlm");\n\t\t\t\tforceAuxVision = aux?.forceAuxVision === true;\n\t\t\t} catch { /* auxLlm may be absent during early boot */ }\n\t\t\tif (!forceAuxVision && Array.isArray(modalities) && modalities.includes("image")) return messages;', action: "replace" },
      { name: "half", detect: (d) => d.includes("image-bridge v2 (local patch)"), block: "messages: boundaryMessages,", replacement: "messages: await this.bridgeImagesForModel(boundaryMessages, config.provider, config.model, this.loopCtx.llm, signal),", action: "replace" },
      { name: "original", detect: (d) => d.includes("Compose one frozen request and bind it to the adapter registration"), block: await readFile(join(HERE, "orig-agent-loop-block.txt"), "utf8"), action: "replace" }
    ],
    patched: await readFile(join(HERE, "patched-agent-loop-block.txt"), "utf8"),
    backupPrefix: "index.js.bak-"
  },
  {
    label: "dsh-host-apiproxy (selectModel)",
    file: API_PROXY_FILE,
    mark: "dsh-image bridge v3 (local patch)",
    states: [
      { name: "v3", detect: (d) => d.includes("dsh-image bridge v3 (local patch)"), action: "skip" },
      { name: "original", detect: (d) => d.includes("does not accept image input, but this session already contains images"), block: await readFile(join(HERE, "orig-select-model-block.txt"), "utf8"), action: "replace" }
    ],
    patched: await readFile(join(HERE, "patched-select-model-block.txt"), "utf8"),
    backupPrefix: "index.js.bak-"
  },
  {
    label: "dsh-tool-subagent (schema)",
    file: SUBAGENT_TOOL_FILE,
    mark: "requires_vision",
    states: [
      { name: "patched", detect: (d) => d.includes("requires_vision:"), action: "skip" },
      { name: "original", detect: (d) => d.includes("...backgroundEnabled ? { run_in_background:"), block: await readFile(join(HERE, "orig-subagent-schema-block.txt"), "utf8"), action: "replace" }
    ],
    patched: await readFile(join(HERE, "patched-subagent-schema-block.txt"), "utf8"),
    backupPrefix: "index.js.bak-"
  },
  {
    label: "dsh-tool-subagent (request)",
    file: SUBAGENT_TOOL_FILE,
    mark: 'ctx.get("auxLlm")',
    states: [
      { name: "patched", detect: (d) => d.includes("ctx.get(\"auxLlm\")") && d.includes("subagentRoute"), action: "skip" },
      { name: "original", detect: (d) => d.includes("...config.agentOptions !== void 0 ? { agentOptions: config.agentOptions } : {}"), block: await readFile(join(HERE, "orig-subagent-request-block.txt"), "utf8"), action: "replace" }
    ],
    patched: await readFile(join(HERE, "patched-subagent-request-block.txt"), "utf8"),
    backupPrefix: "index.js.bak-"
  },
  {
    label: "dsh-workflow-worker-thread",
    file: WORKFLOW_ENGINE_FILE,
    mark: "subagentIncludeWorkflow",
    states: [
      { name: "patched", detect: (d) => d.includes("subagentIncludeWorkflow") && d.includes("subagentRoute"), action: "skip" },
      { name: "original", detect: (d) => d.includes("run = await this.subagents.start(this.provider, {"), block: await readFile(join(HERE, "orig-workflow-startchild-block.txt"), "utf8"), action: "replace" }
    ],
    patched: await readFile(join(HERE, "patched-workflow-startchild-block.txt"), "utf8"),
    backupPrefix: "index.js.bak-"
  },
  {
    label: "dsh-tool-skill (schema)",
    file: SKILL_TOOL_FILE,
    mark: "skill auditor",
    states: [
      { name: "patched", detect: (d) => d.includes("skill auditor"), action: "skip" },
      { name: "original", detect: (d) => d.includes("parameters: { name: {"), block: await readFile(join(HERE, "orig-skill-tool-block.txt"), "utf8"), action: "replace" }
    ],
    patched: await readFile(join(HERE, "patched-skill-tool-block.txt"), "utf8"),
    backupPrefix: "index.js.bak-"
  },
  {
    label: "dsh-tool-web (web_fetch compat)",
    file: WEB_FETCH_TOOL_FILE,
    mark: "dsh-aux web_fetch compat (local patch)",
    states: [
      { name: "patched", detect: (d) => d.includes("dsh-aux web_fetch compat (local patch)"), action: "skip" },
      { name: "original", detect: (d) => d.includes("const result = await ctx.web.fetch({ url: input.url }, exec.signal);"), block: await readFile(join(HERE, "orig-web-fetch-block.txt"), "utf8"), action: "replace" }
    ],
    patched: await readFile(join(HERE, "patched-web-fetch-block.txt"), "utf8"),
    backupPrefix: "index.js.bak-"
  }
];

function log(msg) { console.log(`[dsh-image-bridge] ${msg}`); }

function syntaxCheck(file, label) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    log(`${label} 语法检查通过`);
  } catch (error) {
    log(`${label} 语法检查失败: ${error.stderr?.toString() ?? error.message}`);
    process.exitCode = 1;
  }
}

async function rollbackOne(target) {
  const file = target.file;
  if (!existsSync(file)) { log(`${target.label} 不存在,跳过回滚`); return; }
  const dir = dirname(file);
  const baks = (await readdir(dir)).filter((f) => f.startsWith(target.backupPrefix) && !f.includes(".node"));
  baks.sort().reverse();
  if (baks.length === 0) { log(`${target.label} 无备份可回滚`); return; }
  const bak = join(dir, baks[0]);
  await copyFile(bak, file);
  log(`${target.label} 已回滚: ${file} <- ${baks[0]}`);
  syntaxCheck(file, target.label);
}

async function applyOne(target, dryRun) {
  const file = target.file;
  if (!existsSync(file)) { log(`${target.label} 未找到: ${file}`); return; }
  let data = await readFile(file, "utf8");
  let bak;
  let applied = 0;
  for (let i = 0; i < target.states.length + 3; i++) {
    const state = target.states.find((candidate) => candidate.detect(data));
    if (state === void 0) {
      log(`${target.label} 跳过(版本不匹配,未找到已知代码块): ${file}`);
      return;
    }
    if (state.action === "skip") {
      if (applied > 0) {
        await writeFile(file, data);
        log(`${target.label} 已打补丁(${applied} 步): ${file}`);
        syntaxCheck(file, target.label);
      } else {
        log(`${target.label} 已是 v2,跳过: ${file}`);
      }
      return;
    }
    if (dryRun) { log(`[dry-run] ${target.label} 可从 ${state.name} 升级: ${file}`); return; }
    if (bak === void 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      bak = join(dirname(file), `${target.backupPrefix}${stamp}`);
      await copyFile(file, bak);
      log(`${target.label} 备份: ${bak}`);
    }
    const patched = data.replace(state.block.trim(), (state.replacement ?? target.patched).trim());
    if (patched === data) {
      log(`${target.label} ${state.name} 步骤块未命中,停止推进(避免假成功空转)`);
      break;
    }
    if (!patched.includes(target.mark)) {
      log(`${target.label} 补丁块未生效(替换失败),回滚`);
      await copyFile(bak, file);
      process.exit(1);
    }
    data = patched;
    applied += 1;
    log(`${target.label} 已应用 ${state.name} 步骤`);
  }
  if (applied > 0) {
    await writeFile(file, data);
    log(`${target.label} 已打补丁(${applied} 步): ${file}`);
    syntaxCheck(file, target.label);
  } else {
    log(`${target.label} 跳过(无可应用步骤)`);
  }
}

const dryRun = process.argv.includes("--dry-run");
const rollbackMode = process.argv.includes("--rollback");
if (rollbackMode) {
  for (const target of TARGETS) await rollbackOne(target);
  process.exit(0);
}
for (const target of TARGETS) await applyOne(target, dryRun);
log(dryRun ? "dry-run 完成" : "完成。请重启 DSH 生效。");
