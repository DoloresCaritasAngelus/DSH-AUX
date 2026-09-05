import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PAIRS, isInSync } from "../scripts/gen-package-readme.mjs";

/**
 * 文档单一真相回归:包内 README(dsh-aux/README.*)必须等于根
 * README(README.*)经生成器产生的副本。不同步 = 测试失败,提示先跑
 * `npm run gen-package-readme`。测试只调生成器(不重复实现复制逻辑)。
 */
test("单一真相: 包内 README 与根 README 单一真相同步", async () => {
  assert.ok(PAIRS.length >= 2, "应覆盖 README.md 与 README.en.md 两对");
  for (const p of PAIRS) {
    const rootText = await readFile(p.root, "utf8");
    let destText = null;
    try {
      destText = await readFile(p.dest, "utf8");
    } catch {
      destText = null;
    }
    assert.ok(destText !== null, `缺少生成副本: ${p.dest}\n先跑 npm run gen-package-readme`);
    assert.equal(
      isInSync(rootText, destText, p.banner),
      true,
      `包内 README 与根不同步: ${p.dest}\n先跑 npm run gen-package-readme 再提交`,
    );
  }
});

test("单一真相: 生成副本带「生成快照」banner(编辑防护)", async () => {
  const { readFile: rf } = await import("node:fs/promises");
  const dest = PAIRS[0].dest;
  const text = await rf(dest, "utf8");
  assert.match(text, /generated snapshot of the repo-root/, "副本应声明为根 README 的生成快照");
});
