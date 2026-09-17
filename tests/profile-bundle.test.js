/**
 * ④ profile bundle 接线:让 AUX 走官方 bundle 机制被 profile 选中,而不是只靠
 * cordis.patch.yml 的 insert 行 —— 后者能加载,但插件管理器只枚举 bundle,
 * 于是插件页看不到 AUX,也无法在页面上启停 / 卸载。
 *
 * Run: node --test tests/profile-bundle.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bundleSpec,
  describePlan,
  ensureBundleWiring,
  ensureLegacyPatch,
  findWiredProfiles,
  normalizeEmptyOverlay,
  planProfileBundle,
  stripLegacyPatch,
} from "../bridge/profile-bundle.mjs";

const PKG = "@dolorescaritasangelus/dsh-aux";
const PKG_DIR = "/repo/dsh-aux";

/** A patch layer shaped like the real one: header, our entry, then a neighbour. */
const PATCH = [
  "# Your patch layer for this dsh profile.",
  "# a top-level YAML array of loader patch entries",
  "",
  "",
  "# dsh-aux: auxiliary model system (host plane row)",
  "# Source: ./dsh-aux (symlinked into the deployment node_modules).",
  "- insert:",
  "    - id: aux",
  '      name: "' + PKG + '"',
  "",
  "",
  "# dsh-search-tier: tiered search",
  "- insert:",
  "    - id: search-tier",
  "      name: '@deepseek-ai/dsh-search-tier'",
  "",
].join("\n");

function withProfile(files, run) {
  const dir = mkdtempSync(join(tmpdir(), "profile-bundle-"));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const manifest = (extra = {}) =>
  JSON.stringify(
    { name: "dsh-profile-web", private: true, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } }, ...extra },
    null,
    2,
  ) + "\n";

test("stripLegacyPatch: 只摘掉本条目与它的注释,头注释与相邻条目不动", () => {
  const res = stripLegacyPatch(PATCH, PKG);
  assert.equal(res.removed, true);
  assert.ok(!res.text.includes(PKG), "不应残留本包");
  assert.ok(res.text.includes("# Your patch layer for this dsh profile."), "文件头注释必须保留");
  assert.ok(res.text.includes("name: '@deepseek-ai/dsh-search-tier'"), "相邻条目必须保留");
  assert.ok(res.text.includes("# dsh-search-tier: tiered search"), "相邻条目的注释必须保留");
  assert.ok(!res.text.includes("dsh-aux"), "本条的注释也应一并摘掉");
});

test("stripLegacyPatch: 摘掉唯一条目后,补丁层必须仍是顶层数组", () => {
  // 只剩注释的文件 YAML 解析成 null,DSH 会直接拒绝启动:
  // "overlay ... must be a top-level YAML array of loader patch entries"。
  const only = "# 只有我们这一条\n- insert:\n    - id: aux\n      name: '" + PKG + "'\n";
  const res = stripLegacyPatch(only, PKG);
  assert.equal(res.removed, true);
  assert.equal(res.emptied, true);
  assert.ok(/^\[\]\s*$/m.test(res.text), "必须留一个显式空数组");
});

test("normalizeEmptyOverlay: 有条目或已是空数组时不动", () => {
  assert.equal(normalizeEmptyOverlay("- id: x\n").changed, false);
  assert.equal(normalizeEmptyOverlay("[]\n").changed, false);
  assert.equal(normalizeEmptyOverlay("# 只剩注释\n").changed, true);
});

test("planProfileBundle: 修复上一轮留下的空补丁层", () => {
  const wired =
    JSON.stringify(
      {
        name: "dsh-profile-web",
        private: true,
        dependencies: { [PKG]: bundleSpec(PKG_DIR) },
        dsh: { profile: { bundles: [PKG] } },
      },
      null,
      2,
    ) + "\n";
  withProfile({ "package.json": wired, "cordis.patch.yml": "# 只剩注释\n" }, (dir) => {
    const report = planProfileBundle({ profileDir: dir, packageName: PKG, packageDir: PKG_DIR });
    assert.equal(report.patchChanged, true);
    assert.ok(/^\[\]\s*$/m.test(readFileSync(join(dir, "cordis.patch.yml"), "utf8")));
  });
});

test("stripLegacyPatch: 不含本包时原样返回", () => {
  const other = "- insert:\n    - id: other\n      name: 'other-pkg'\n";
  const res = stripLegacyPatch(other, PKG);
  assert.equal(res.removed, false);
  assert.equal(res.text, other);
});

test("ensureBundleWiring: 补 dependencies 与 bundles,且幂等", () => {
  const data = JSON.parse(manifest());
  const first = ensureBundleWiring(data, { packageName: PKG, packageDir: PKG_DIR });
  assert.equal(first.changed, true);
  assert.equal(data.dependencies[PKG], bundleSpec(PKG_DIR));
  assert.deepEqual(data.dsh.profile.bundles, ["@deepseek-ai/dsh-base", PKG]);
  const second = ensureBundleWiring(data, { packageName: PKG, packageDir: PKG_DIR });
  assert.equal(second.changed, false, "第二次不应再报改动");
  assert.deepEqual(data.dsh.profile.bundles, ["@deepseek-ai/dsh-base", PKG], "不应重复追加");
});

test("planProfileBundle: 缺 dsh.profile 时补齐结构并写盘", () => {
  withProfile({ "package.json": JSON.stringify({ name: "p", private: true }, null, 2) + "\n" }, (dir) => {
    const report = planProfileBundle({ profileDir: dir, packageName: PKG, packageDir: PKG_DIR });
    assert.equal(report.manifestChanged, true);
    const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    assert.equal(written.dependencies[PKG], bundleSpec(PKG_DIR));
    assert.deepEqual(written.dsh.profile.bundles, [PKG]);
    const again = planProfileBundle({ profileDir: dir, packageName: PKG, packageDir: PKG_DIR });
    assert.equal(again.manifestChanged, false);
    assert.equal(again.patchChanged, false);
  });
});

test("planProfileBundle: 接成 bundle 的同时移除旧的 patch 注入", () => {
  withProfile({ "package.json": manifest(), "cordis.patch.yml": PATCH }, (dir) => {
    const report = planProfileBundle({ profileDir: dir, packageName: PKG, packageDir: PKG_DIR });
    assert.equal(report.manifestChanged, true);
    assert.equal(report.patchChanged, true);
    const patch = readFileSync(join(dir, "cordis.patch.yml"), "utf8");
    assert.ok(!patch.includes(PKG), "patch 注入必须移除");
    assert.ok(patch.includes("search-tier"), "相邻条目必须保留");
    assert.equal(describePlan(report).includes("已移除 patch 注入"), true);
  });
});

test("planProfileBundle: --dry-run 不写盘", () => {
  withProfile({ "package.json": manifest(), "cordis.patch.yml": PATCH }, (dir) => {
    const before = readFileSync(join(dir, "package.json"), "utf8");
    const report = planProfileBundle({ profileDir: dir, packageName: PKG, packageDir: PKG_DIR, dryRun: true });
    assert.equal(report.dryRun, true);
    assert.equal(report.manifestChanged, true);
    assert.equal(report.patchChanged, true);
    assert.equal(readFileSync(join(dir, "package.json"), "utf8"), before, "dry-run 不得改文件");
    assert.equal(readFileSync(join(dir, "cordis.patch.yml"), "utf8"), PATCH, "dry-run 不得改补丁");
  });
});

test("planProfileBundle: 全新部署没有 profile 时,兜底写 patch(等 DSH 建好 profile 再迁移)", () => {
  withProfile({}, (dir) => {
    const profileDir = join(dir, "profiles", "web");
    const plain = planProfileBundle({ profileDir, packageName: PKG, packageDir: PKG_DIR });
    assert.equal(plain.skipped, "no-manifest");
    assert.equal(existsSync(join(profileDir, "cordis.patch.yml")), false, "没有兜底开关就不写任何东西");

    const withFallback = planProfileBundle({
      profileDir,
      packageName: PKG,
      packageDir: PKG_DIR,
      legacyFallback: true,
    });
    assert.equal(withFallback.skipped, "no-manifest");
    assert.equal(withFallback.legacyWritten, true);
    const patch = readFileSync(join(profileDir, "cordis.patch.yml"), "utf8");
    assert.ok(patch.includes("id: aux"));
    assert.ok(patch.includes(PKG));
    assert.equal(ensureLegacyPatch(profileDir, PKG), false, "兜底本身也要幂等");
  });
});

test("findWiredProfiles: 清单或补丁提到本包才算数", () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-home-"));
  try {
    const wired = join(home, "profiles", "web");
    const legacy = join(home, "profiles", "headless");
    const unrelated = join(home, "profiles", "other");
    for (const dir of [wired, legacy, unrelated]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(wired, "package.json"), manifest({ dependencies: { [PKG]: bundleSpec(PKG_DIR) } }));
    writeFileSync(join(wired, "cordis.patch.yml"), "");
    writeFileSync(join(legacy, "package.json"), JSON.stringify({ name: "legacy" }) + "\n");
    writeFileSync(join(legacy, "cordis.patch.yml"), "- insert:\n    - id: aux\n      name: '" + PKG + "'\n");
    writeFileSync(join(unrelated, "package.json"), JSON.stringify({ name: "other" }) + "\n");
    const found = findWiredProfiles(home, PKG)
      .map((dir) => dir.split("/").pop())
      .sort();
    assert.deepEqual(found, ["headless", "web"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
