import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

test("/aux patch --json: handlePatchCommand 返回结构化步骤(stub execFileAsync)", async () => {
  // handlePatchCommand 在每次调用时才 promisify(childProcess.execFile),
  // 因此无论 commands.js 是否已被其他测试文件导入,这里替换 cp.execFile 都能生效。
  // 这比“先删测试掩盖问题”更稳:保留对真实 JSON 结构的回归覆盖。
  const require = createRequire(import.meta.url);
  const cp = require("node:child_process");
  const originalExecFile = cp.execFile;
  const calls = [];
  cp.execFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    const script = String(args[0] || "")
      .split(/[\\/]/)
      .pop();
    if (script === "apply-patch.mjs") {
      callback(null, { stdout: "apply output\n", stderr: "" });
    } else if (script === "self-heal.mjs") {
      callback(null, { stdout: "self-heal output\n", stderr: "" });
    } else {
      callback(new Error("unexpected script: " + args[0]));
    }
  };
  try {
    const { handlePatchCommand } = await import("../dsh-aux/src/commands.js");
    const result = await handlePatchCommand(void 0, true);
    assert.equal(result.kind, "success");
    const data = JSON.parse(result.text);
    assert.equal(typeof data.ok, "boolean");
    assert.equal(data.restartRequired, false);
    assert.ok(Array.isArray(data.steps), "应返回 steps 数组");
    assert.equal(data.steps.length, 2);
    assert.deepEqual(
      data.steps.map((s) => s.name),
      ["apply-patch", "self-heal"],
    );
    assert.ok(data.steps.every((s) => s.ok === true && typeof s.output === "string"));
    assert.deepEqual(data.remaining, []);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.args[0].endsWith(".mjs")));
    // 脚本必须用仓库内的绝对路径启动;仅靠相对路径在 cwd=dshRoot 时会在
    // 部署根下寻找 bridge/*.mjs,导致真实部署找不到文件。
    assert.ok(calls.every((c) => c.args[0].startsWith("/") && c.args[0].includes("/bridge/")));
    assert.ok(
      calls.every((c) => existsSync(c.args[0])),
      "bridge script should exist on disk",
    );
    // handlePatchCommand 应把真实 DSH 根传给子进程,避免误打仓库内旧测试依赖。
    assert.ok(calls.every((c) => c.options && c.options.cwd && typeof c.options.cwd === "string"));
    assert.ok(calls.every((c) => c.options && c.options.env && typeof c.options.env.DSH_ROOT === "string"));
  } finally {
    cp.execFile = originalExecFile;
  }
});
