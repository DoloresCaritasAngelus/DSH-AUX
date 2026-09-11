/**
 * PR 描述脱密闸回归(pr-body-hygiene + 规则表单一真相)。
 *
 * 背景:文件与提交信息各有一道闸,但 PR 标题与描述既不在工作树里、也不在提交
 * 历史里 —— 它同样进入公网,却是唯一没有闸的公开信道。一次真实的 PR 描述把私有
 * 台账路径、内部环境名与评审过程叙述写了出去,而当时两道闸都是绿的。本测试钉住
 * 三件事:
 *
 *  1. **规则表单一真相**:文件扫描与 PR 描述扫描必须共用 `scripts/hygiene-rules.mjs`,
 *     任何一侧重新长出一份自己的规则表都要报错(闸齐备但信道没接上正是这次的病根);
 *  2. **典型泄漏样本必须命中**(样本按片段拼接构造:本测试文件自身同样被文件扫描
 *     闸覆盖,直接写出字面量等于让测试文件自己违规);
 *  3. **重构后提交信息扫描仍然生效**:在临时仓库里造一条违规提交信息 + 一个假的
 *     `origin/main` 引用,断言真实脚本非零退出。
 *
 * Run: node --test tests/pr-body-hygiene.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FILE_RULES, MESSAGE_RULES, scanText } from "../scripts/hygiene-rules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const CI_SCRIPT = join(REPO, "scripts/ci-doc-hygiene.mjs");
const CLI_SCRIPT = join(REPO, "scripts/pr-body-hygiene.mjs");
const RULES_SCRIPT = join(REPO, "scripts/hygiene-rules.mjs");
const REAL_CHANGELOG = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");

// 违规字面量一律拼接构造 —— 本文件也在文件扫描闸的覆盖范围内。
const PRIVATE_DIR = "aux" + "-notes/";
const LEDGER_NAME = "02" + "-patch-ledger";
const ABSOLUTE = "/ho" + "me/someone/workspace";
const WINDOWS_PATH = "E:" + "\\work\\x.md"; // 不用 \n 开头:规则刻意放过转义序列
const INNER_ENV = "沙" + "盒";

test("规则表单一真相:两个扫描器都从 hygiene-rules.mjs 导入,且不各自保留规则名", () => {
  const rules = readFileSync(RULES_SCRIPT, "utf8");
  const scanners = {
    "ci-doc-hygiene": readFileSync(CI_SCRIPT, "utf8"),
    "pr-body-hygiene": readFileSync(CLI_SCRIPT, "utf8"),
  };

  for (const [name, source] of Object.entries(scanners)) {
    assert.match(source, /from "\.\/hygiene-rules\.mjs"/, `${name} 必须从规则表模块导入`);
  }
  // 以**模式源串**为准,且只看代码行:说明性注释里提到规则名或样例是无害的,
  // 模式被复制一份才是真的分叉。
  const codeOnly = (source) =>
    source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
  for (const rule of [...FILE_RULES, ...MESSAGE_RULES]) {
    assert.ok(rules.includes(rule.re.source), `规则表缺少模式:"${rule.name}"`);
    for (const [name, source] of Object.entries(scanners)) {
      assert.ok(
        !codeOnly(source).includes(rule.re.source),
        `${name} 不应再自带规则表(重复模式:"${rule.name}" → ${rule.re.source})`,
      );
    }
  }
});

test("公开可写的正当路径不得误报(DSH 安装位置 / 通用 CLI 位置)", () => {
  // 首轮自证时 `.local/` 前缀规则把 `$HOME/.local/bin/gh` 判成私有引用 ——
  // 而 `~/.local/share/dsh` 是 DSH 自身文档化的安装位置。规则已按此收窄。
  const draft = [
    "`gh` 定位顺序为 `$GH_BIN` → `PATH` → `$HOME/.local/bin/gh`。",
    "部署根候选:`~/dsh`、`~/.local/share/dsh`、`/opt/dsh`。",
  ].join("\n");
  assert.deepEqual(scanText(draft, MESSAGE_RULES), []);
});

test("PR 描述泄漏样本必须命中(私有台账 / 本机路径 / 内部环境 / 评审过程)", () => {
  const draft = [
    `补丁台账见 ${PRIVATE_DIR}${LEDGER_NAME}.md。`,
    `在 ${ABSOLUTE} 下复现。`,
    `配置在 ${WINDOWS_PATH}。`,
    `两条都来自维护者在${INNER_ENV}里的实测。`,
    "见本 PR 的终审结论。",
  ].join("\n");
  const hits = scanText(draft, MESSAGE_RULES);
  const rules = new Set(hits.map((hit) => hit.rule));
  // 规则名同样按片段拼接:其中一条规则的名字里就带着本机路径前缀,
  // 直接写出来会让本文件自己命中文件扫描闸(闸抓到过这一点)。
  for (const expected of [
    "私有工作区引用",
    "本机绝对路径 /ho" + "me/<user>",
    "Windows 盘符路径",
    "内部环境名",
    "评审过程叙述",
  ]) {
    assert.ok(rules.has(expected), `未命中规则 "${expected}";实际命中:${[...rules].join(" / ")}`);
  }
});

test("正常 PR 描述零命中(闸不得误报)", () => {
  const draft = [
    "## 一句话摘要",
    "",
    "修掉切回 native 后图片准入闸仍然处于移除态的问题。",
    "",
    "## 测试与验证",
    "",
    "- [x] `node --test tests/*.test.js` 全量通过(# pass 597 / # fail 0)",
  ].join("\n");
  assert.deepEqual(scanText(draft, MESSAGE_RULES), []);
});

test("CLI --stdin:泄漏草稿非零退出并点名规则", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-aux-prbody-"));
  try {
    const result = spawnSync(process.execPath, [CLI_SCRIPT, "--stdin"], {
      cwd: dir,
      input: `台账在 ${PRIVATE_DIR}${LEDGER_NAME}.md\n`,
      encoding: "utf8",
    });
    assert.equal(result.status, 1, "泄漏草稿必须非零退出");
    assert.match(result.stderr, /PR-BODY-HYGIENE \[私有工作区引用\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --stdin:干净草稿退出 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-aux-prbody-ok-"));
  try {
    const result = spawnSync(process.execPath, [CLI_SCRIPT, "--stdin"], {
      cwd: dir,
      input: "## 一句话摘要\n\n修复代理回退不校验 scheme。\n",
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `应通过,stderr:\n${result.stderr}`);
    assert.match(result.stdout, /脱密检查通过/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * 建一个只有 CHANGELOG + README 的临时 git 仓库,并在 `origin/main` 之上追加一条提交。
 * @param {string} message 追加提交的信息。
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
function runCommitScan(message) {
  const dir = mkdtempSync(join(tmpdir(), "dsh-aux-msgscan-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "CHANGELOG.md"), REAL_CHANGELOG);
    writeFileSync(join(dir, "README.md"), "# fixture\n");
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "chore: base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(dir, "README.md"), "# fixture 2\n");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", message);
    const result = spawnSync(process.execPath, [CI_SCRIPT], { cwd: dir, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("重构后提交信息扫描仍生效:违规提交信息 → 非零退出", () => {
  const result = runCommitScan(`fix: 同步 ${PRIVATE_DIR}${LEDGER_NAME}.md`);
  assert.notEqual(result.status, 0, "违规提交信息必须阻塞");
  assert.match(result.stderr, /\(commit message\) \[私有工作区引用\]/);
});

test("重构后提交信息扫描仍生效:干净提交信息 → 通过", () => {
  const result = runCommitScan("fix(fetch): 代理只接受 HTTP(S) 端点");
  assert.equal(result.status, 0, `应通过,stderr:\n${result.stderr}`);
  assert.match(result.stdout, /文档脱密检查通过/);
});
