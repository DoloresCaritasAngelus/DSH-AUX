/**
 * Tests for dsh-aux image retention persistence.
 *
 * Run: 在仓库根目录执行 node --test tests/image-retention.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import { createImageFixture } from "./helpers/image-fixture.js";
import { imageRetentionPath, loadRetained, saveRetained, setRetained } from "../dsh-aux/src/images/retention.js";

/** Set DSH_HOME to a fixture home for the duration of one test callback. */
async function withHome(home, fn) {
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    return await fn();
  } finally {
    if (oldHome === void 0) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
  }
}

test("image retention: absent file loads as an empty Set", async () => {
  const fixture = await createImageFixture();
  try {
    await withHome(fixture.home, async () => {
      assert.equal(imageRetentionPath(), fixture.imageRetentionPath);
      const retained = await loadRetained();
      assert.ok(retained instanceof Set);
      assert.equal(retained.size, 0);
    });
  } finally {
    await fixture.cleanup();
  }
});

test("image retention: save/load round-trip persists the retained Set", async () => {
  const fixture = await createImageFixture();
  try {
    await withHome(fixture.home, async () => {
      const ids = new Set(["sha256:a".padEnd(66, "a"), "sha256:b".padEnd(66, "b")]);
      await saveRetained(ids);

      const loaded = await loadRetained();
      assert.deepEqual([...loaded].sort(), [...ids].sort());

      const raw = JSON.parse(await fsPromises.readFile(fixture.imageRetentionPath, "utf8"));
      assert.equal(raw.version, 1);
      assert.deepEqual([...raw.retained].sort(), [...ids].sort());
    });
  } finally {
    await fixture.cleanup();
  }
});

test("image retention: setRetained add and remove persist", async () => {
  const fixture = await createImageFixture();
  const id = "sha256:" + "c".repeat(64);
  try {
    await withHome(fixture.home, async () => {
      assert.deepEqual(await setRetained(id, true), { retained: true });
      assert.ok((await loadRetained()).has(id));

      const diskAfterAdd = JSON.parse(await fsPromises.readFile(fixture.imageRetentionPath, "utf8"));
      assert.ok(diskAfterAdd.retained.includes(id));

      assert.deepEqual(await setRetained(id, false), { retained: false });
      assert.ok(!(await loadRetained()).has(id));

      const diskAfterRemove = JSON.parse(await fsPromises.readFile(fixture.imageRetentionPath, "utf8"));
      assert.ok(!diskAfterRemove.retained.includes(id));
    });
  } finally {
    await fixture.cleanup();
  }
});

test("image retention: corrupt file returns empty Set and quarantines the file", async () => {
  const fixture = await createImageFixture();
  try {
    await fsPromises.writeFile(fixture.imageRetentionPath, "{ not valid json", "utf8");
    await withHome(fixture.home, async () => {
      const retained = await loadRetained();
      assert.ok(retained instanceof Set);
      assert.equal(retained.size, 0);

      const v1Entries = await fsPromises.readdir(fixture.v1);
      assert.ok(
        v1Entries.some((name) => name.startsWith("image-retention.json.corrupt-")),
        "a .corrupt-* quarantine file should exist, got: " + v1Entries.join(", "),
      );
      assert.ok(!v1Entries.includes("image-retention.json"), "original corrupt file should be moved aside");
    });
  } finally {
    await fixture.cleanup();
  }
});

test("image retention: missing DSH_HOME no-ops without throwing", async () => {
  const fixture = await createImageFixture();
  const id = "sha256:" + "d".repeat(64);
  const oldHome = process.env.DSH_HOME;
  const oldUserHome = process.env.HOME;
  try {
    delete process.env.DSH_HOME;
    delete process.env.HOME;
    assert.equal(imageRetentionPath(), void 0);
    assert.deepEqual(await loadRetained(), new Set());
    await saveRetained(new Set([id]));
    assert.deepEqual(await setRetained(id, true), { retained: false });
    assert.deepEqual(await setRetained(id, false), { retained: false });
  } finally {
    if (oldHome === void 0) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    if (oldUserHome === void 0) delete process.env.HOME;
    else process.env.HOME = oldUserHome;
    await fixture.cleanup();
  }
});
