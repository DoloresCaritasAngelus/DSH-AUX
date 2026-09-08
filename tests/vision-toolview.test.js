/**
 * P5.6: the AUX client plugin registers a keyed `tool.call.toolview` entry for
 * `vision_analyze` and renders every call state. Loads the shipped browser
 * bundle under a fake module loader + minimal React so registration and
 * rendering are asserted without a browser.
 *
 * Run: node --test tests/vision-toolview.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

/** Minimal React: createElement returns a plain tree node. */
const fakeReact = {
  createElement(type, props, ...children) {
    return {
      type,
      props: props ?? {},
      children: children.flat(Infinity).filter((child) => child !== null && child !== void 0 && child !== false),
    };
  },
  useState(value) {
    return [typeof value === "function" ? value() : value, () => {}];
  },
  useEffect() {},
  useMemo(fn) {
    return fn();
  },
  useRef() {
    return { current: null };
  },
  cloneElement(element, extra) {
    return { ...element, props: { ...element.props, ...extra } };
  },
};

let bundle = null;
function loadBundle() {
  if (bundle !== null) return bundle;
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        bundle = definition.factory((name) => {
          if (name === "react") return fakeReact;
          throw new Error("unexpected require: " + name);
        });
      },
    },
  };
  return import("../dsh-aux/src/client.js").then(() => bundle);
}

const DICT = {
  "toolview.title": "图像分析",
  "toolview.running": "分析中…",
  "toolview.failed": "分析失败",
};
const t = (key) => DICT[key] ?? key;

/** Apply the bundle to a stub context and return the captured registrations. */
async function registerToolview() {
  const exports = await loadBundle();
  const registrations = [];
  const ctx = {
    get: () => void 0,
    inject: (names, fn) => fn({ locale: void 0 }),
    effect: (fn) => {
      const dispose = fn();
      return () => {};
    },
    slots: {
      inject: (name, fn) => fn(),
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  exports.apply(ctx);
  const entry = registrations.find((r) => r.options.name === "tool.call.toolview");
  return entry;
}

const REF_A = { attachmentId: "sha256:" + "11".repeat(32), mediaType: "image/png", bytes: 8, width: 2, height: 2 };
const REF_B = { attachmentId: "sha256:" + "22".repeat(32), mediaType: "image/jpeg", bytes: 9, width: 3, height: 3 };

/** Collect every string rendered inside the tree. */
function texts(node, out = []) {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (node === null || typeof node !== "object") return out;
  for (const child of node.children ?? []) texts(child, out);
  return out;
}

function findClass(node, className, out = []) {
  if (node === null || typeof node !== "object") return out;
  if (node.props?.className === className) out.push(node);
  for (const child of node.children ?? []) findClass(child, className, out);
  return out;
}

function render(entry, block, renderSlotCalls = []) {
  const tree = entry.component({
    t,
    toolName: "vision_analyze",
    block,
    renderSlot: (name, props) => {
      renderSlotCalls.push({ name, props });
      return { type: "gallery", props: {}, children: [] };
    },
    loadImage: () => {},
    openFile: () => {},
  });
  return tree;
}

test("注册: 键为 vision_analyze,并声明 tool.call.images 子槽", async () => {
  const entry = await registerToolview();
  assert.ok(entry, "应注册 tool.call.toolview 条目");
  assert.equal(entry.options.key, "vision_analyze");
  assert.deepEqual(entry.options.children, { "tool.call.images": { kind: "single", scope: "session" } });
  assert.equal(typeof entry.component, "function");
});

test("渲染: 消息图片角标【图N/共M】+ 缩略图槽 + 结论", async () => {
  const entry = await registerToolview();
  const calls = [];
  const tree = render(
    entry,
    {
      kind: "tool-result",
      isError: false,
      content: [
        { type: "text", text: "【图2】A red button" },
        { type: "image", attachment: REF_A },
      ],
      meta: {
        attachments: [REF_A, REF_B],
        ordinals: [
          { scope: "message", index: 2, total: 4 },
          { scope: "call", index: 3, total: 3 },
        ],
      },
    },
    calls,
  );
  const badges = findClass(tree, "ax-tv-badge").map((node) => texts(node).join(""));
  assert.deepEqual(badges, ["【图2/共4】", "【图3】"], "消息级带总数,调用级不带");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "tool.call.images");
  assert.equal(calls[0].props.align, "start");
  assert.deepEqual(calls[0].props.images, [{ attachment: REF_A }, { attachment: REF_B }]);
  assert.ok(
    texts(tree).some((text) => text.includes("A red button")),
    "结论文本应渲染",
  );
});

test("渲染: 失败项只出文本,不派发图片槽", async () => {
  const entry = await registerToolview();
  const calls = [];
  const tree = render(
    entry,
    {
      kind: "tool-result",
      isError: true,
      content: [{ type: "text", text: "【图1】分析失败(限流,可重试)。" }],
    },
    calls,
  );
  assert.equal(calls.length, 0, "失败项不得派发图片槽");
  assert.equal(findClass(tree, "ax-tv-badge").length, 0, "失败项无角标");
  assert.ok(texts(tree).some((text) => text.includes("分析失败")));
});

test("渲染: 运行中与全部失败的 settled 结果都有行壳", async () => {
  const entry = await registerToolview();
  const running = render(entry, {
    name: "vision_analyze",
    argsRaw: "{}",
    turn: 1,
    step: 1,
    time: 0,
    callId: "c1",
    subCalls: [],
  });
  assert.ok(texts(running).includes("图像分析"));
  assert.ok(texts(running).includes("分析中…"));
  assert.equal(findClass(running, "ax-tv-badge").length, 0);

  const calls = [];
  const allFailed = render(
    entry,
    {
      kind: "tool-result",
      isError: false,
      content: [{ type: "text", text: "【图1】分析失败(超时,不可重试)。" }],
      meta: { attachments: [], ordinals: [] },
    },
    calls,
  );
  assert.equal(calls.length, 0, "无附件时不派发图片槽");
  assert.ok(texts(allFailed).some((text) => text.includes("分析失败")));
});
