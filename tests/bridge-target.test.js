/**
 * bridge/target.js path-safety tests.
 *
 * Run: node --test tests/bridge-target.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeTarget, deployedFile } from "../bridge/target.js";

test("assertSafeTarget: 接受合法的 node_modules/@deepseek-ai/lib/index.js 路径", () => {
  const ok = "/home/user/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js";
  assert.equal(assertSafeTarget(ok), ok);
});

test("assertSafeTarget: 拒绝 node_modules 之外的目标", () => {
  assert.throws(() => assertSafeTarget("/tmp/evil/lib/index.js"), /not inside node_modules\/@deepseek-ai/);
  assert.throws(() => assertSafeTarget("/home/user/dsh/lib/index.js"), /not inside node_modules\/@deepseek-ai/);
});

test("assertSafeTarget: 拒绝非 @deepseek-ai 作用域", () => {
  assert.throws(
    () => assertSafeTarget("/home/user/dsh/node_modules/@other/lib/index.js"),
    /not inside node_modules\/@deepseek-ai/,
  );
});

test("assertSafeTarget: 拒绝非 lib/index.js 路径", () => {
  assert.throws(
    () => assertSafeTarget("/home/user/dsh/node_modules/@deepseek-ai/dsh-session/src/index.js"),
    /expected .*\/lib\/index\.js/,
  );
});

test("deployedFile: DSH_ROOT 环境变量覆盖为 fake 部署根", () => {
  const prev = process.env.DSH_ROOT;
  try {
    process.env.DSH_ROOT = "/tmp/fake-dsh";
    const viaSymlink = deployedFile(
      "../../../@deepseek-ai/dsh-session/lib/index.js",
      "../../../node_modules/@deepseek-ai/dsh-session/lib/index.js",
    );
    assert.equal(viaSymlink, "/tmp/fake-dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js");
  } finally {
    if (prev === undefined) delete process.env.DSH_ROOT;
    else process.env.DSH_ROOT = prev;
  }
});
