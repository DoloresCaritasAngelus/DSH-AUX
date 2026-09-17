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

/**
 * Optional stateful render harness. Most tests below only assert one rendered
 * tree, so hooks stay inert by default; the interaction tests install this
 * harness to get real hook state, dependency-aware effects and re-render.
 */
let harness = null;

/** Minimal React: createElement returns a plain tree node. There is no
 * reconciler, so a function element is rendered in place and only host
 * elements (string types) survive into the tree. */
const fakeReact = {
  createElement(type, props, ...children) {
    const flat = children.flat(Infinity).filter((child) => child !== null && child !== void 0 && child !== false);
    if (typeof type === "function") return type({ ...(props ?? {}), children: flat });
    return {
      type,
      props: props ?? {},
      children: flat,
    };
  },
  useState(value) {
    const initial = typeof value === "function" ? value() : value;
    if (harness === null) return [initial, () => {}];
    const index = harness.stateIndex++;
    if (!(index in harness.state)) harness.state[index] = initial;
    return [
      harness.state[index],
      (next) => {
        // A late promise can settle after the harness was closed; ignore it.
        if (harness === null) return;
        const current = harness.state[index];
        const settled = typeof next === "function" ? next(current) : next;
        // React bails out when the value is identical; without this an effect that
        // re-sets the same value would re-render forever in this harness.
        if (Object.is(settled, current)) return;
        harness.state[index] = settled;
        harness.rerender();
      },
    ];
  },
  useEffect(fn, deps) {
    if (harness === null) return;
    const index = harness.effectIndex++;
    const previous = harness.effectSlots[index];
    const nextDeps = deps === void 0 ? null : deps;
    const changed =
      previous === void 0 ||
      nextDeps === null ||
      previous.deps === null ||
      previous.deps.length !== nextDeps.length ||
      nextDeps.some((dep, i) => !Object.is(dep, previous.deps[i]));
    if (!changed) return;
    if (typeof previous?.cleanup === "function") previous.cleanup();
    // Record the new deps BEFORE running the effect: an effect that sets state
    // re-enters this render, and React would not re-run it from the stale deps.
    harness.effectSlots[index] = { deps: nextDeps, cleanup: void 0 };
    const cleanup = fn();
    harness.effectSlots[index] = { deps: nextDeps, cleanup: typeof cleanup === "function" ? cleanup : void 0 };
  },
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

/** Let settled promises and their state updates run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Render a component with live hook state, then re-render on every state change.
 *
 * @returns the current tree (via `.tree`), plus `.close()` to restore the
 *   inert hook behaviour for the tests that follow.
 */
function mount(component, props) {
  const slots = { state: [], effectSlots: [], stateIndex: 0, effectIndex: 0, rerender: null };
  let tree = null;
  const render = () => {
    slots.stateIndex = 0;
    slots.effectIndex = 0;
    tree = component(props);
  };
  slots.rerender = render;
  harness = slots;
  render();
  return {
    get tree() {
      return tree;
    },
    close() {
      harness = null;
    },
  };
}

let bundle = null;
/** Minimal react-dom: the lightbox portals through it when it is available. */
const fakeReactDom = {
  createPortal: (node) => node,
};

function loadBundle() {
  if (bundle !== null) return bundle;
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        bundle = definition.factory((name) => {
          if (name === "react") return fakeReact;
          if (name === "react-dom") return fakeReactDom;
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
async function applyBundle() {
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
  return registrations;
}

async function registerToolview() {
  const registrations = await applyBundle();
  return registrations.find((r) => r.options.name === "tool.call.toolview");
}

async function registerGallery() {
  const registrations = await applyBundle();
  return registrations.find((r) => r.options.name === "aux.tool.call.images");
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

/** Match one class token inside a multi-class className. */
function findByClassToken(node, token, out = []) {
  if (node === null || typeof node !== "object") return out;
  if ((node.props?.className ?? "").split(/\s+/).includes(token)) out.push(node);
  for (const child of node.children ?? []) findByClassToken(child, token, out);
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

test("注册: 键为 vision_analyze,子槽是包私有的 aux.tool.call.images", async () => {
  const entry = await registerToolview();
  assert.ok(entry, "应注册 tool.call.toolview 条目");
  assert.equal(entry.options.key, "vision_analyze");
  assert.deepEqual(entry.options.children, { "aux.tool.call.images": { kind: "single", scope: "session" } });
  assert.equal(typeof entry.component, "function");
});

test("注册: 画廊组件注册进同一个私有槽,不占用官方 tool.call.images", async () => {
  const gallery = await registerGallery();
  assert.ok(gallery, "应注册 aux.tool.call.images 画廊条目");
  assert.equal(typeof gallery.component, "function");
  const registrations = await applyBundle();
  const declaredByOthers = registrations
    .flatMap((r) => Object.keys(r.options.children ?? {}))
    .filter((name) => !name.startsWith("aux."));
  assert.deepEqual(declaredByOthers, [], "AUX 不得声明任何官方槽名");
});

test("画廊: 有 peek 缓存时同步出图,点击上抛打开请求", async () => {
  const gallery = await registerGallery();
  const loads = [];
  const loadImage = (attachment) => {
    loads.push(attachment.attachmentId);
    return Promise.resolve("blob:" + attachment.attachmentId);
  };
  loadImage.peek = (attachment) => "cached:" + attachment.attachmentId;
  const tree = gallery.component({
    t,
    images: [{ attachment: REF_A }, { attachment: REF_B }],
    loadImage,
    align: "start",
  });
  const thumbs = findClass(tree, "ax-tv-image");
  assert.equal(thumbs.length, 2, "每张图一个缩略图");
  const srcs = thumbs.map((node) => node.children.find((c) => c.type === "img")?.props?.src);
  assert.deepEqual(srcs, ["cached:" + REF_A.attachmentId, "cached:" + REF_B.attachmentId], "peek 命中时首帧就有图");
  assert.equal(typeof thumbs[0].props.onClick, "function", "缩略图应可点开");
});

test("交互: 点缩略图开光箱,点大图不关闭,点遮罩才关闭", async () => {
  const gallery = await registerGallery();
  globalThis.document = { addEventListener: () => {}, removeEventListener: () => {} };
  const loadImage = () => Promise.resolve("blob:full");
  loadImage.peek = () => "cached:full";
  const view = mount(gallery.component, {
    t,
    images: [{ attachment: REF_A }],
    loadImage,
    align: "start",
  });
  try {
    const thumbs = findClass(view.tree, "ax-tv-image");
    assert.equal(thumbs.length, 1, "先有一个缩略图");
    thumbs[0].props.onClick();
    const box = findClass(view.tree, "ax-tv-lightbox");
    assert.equal(box.length, 1, "点缩略图应打开光箱");
    assert.ok(findClass(view.tree, "ax-tv-lightboxImage").length === 1, "光箱里应有原图");
    // 关闭处理绝不能挂在包含 <img> 的容器上:否则点大图会冒泡关闭刚打开的预览。
    assert.equal(box[0].props.onClick, void 0, "容器不得携带点击关闭");
    assert.equal(findClass(view.tree, "ax-tv-lightboxImage")[0].props.onClick, void 0, "点大图不得关闭");
    const mask = findClass(view.tree, "ax-tv-lightboxMask");
    assert.equal(typeof mask[0].props.onClick, "function", "遮罩负责关闭");
    mask[0].props.onClick();
    assert.equal(findClass(view.tree, "ax-tv-lightbox").length, 0, "点遮罩应关闭");
  } finally {
    view.close();
    delete globalThis.document;
  }
});

test("交互: Esc 关闭光箱", async () => {
  const gallery = await registerGallery();
  const listeners = [];
  globalThis.document = {
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: () => {},
  };
  const loadImage = () => Promise.resolve("blob:full");
  loadImage.peek = () => "cached:full";
  const view = mount(gallery.component, {
    t,
    images: [{ attachment: REF_A }],
    loadImage,
    align: "start",
  });
  try {
    findClass(view.tree, "ax-tv-image")[0].props.onClick();
    assert.equal(findClass(view.tree, "ax-tv-lightbox").length, 1);
    const onKeyDown = listeners.find((entry) => entry.type === "keydown");
    assert.equal(typeof onKeyDown?.fn, "function", "光箱应挂 keydown 监听");
    onKeyDown.fn({ key: "Escape" });
    assert.equal(findClass(view.tree, "ax-tv-lightbox").length, 0, "Esc 应关闭光箱");
  } finally {
    view.close();
    delete globalThis.document;
  }
});

test("交互: 加载失败可点击重试,第二次成功出图", async () => {
  const gallery = await registerGallery();
  let calls = 0;
  const loadImage = () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error("reader failed")) : Promise.resolve("blob:retry");
  };
  const view = mount(gallery.component, {
    t,
    images: [{ attachment: REF_A }],
    loadImage,
    align: "start",
  });
  try {
    await flush();
    const failed = findByClassToken(view.tree, "ax-tv-imageFail");
    assert.equal(failed.length, 1, "首次失败应出可重试占位");
    assert.equal(calls, 1, "失败不应自行重跑");
    failed[0].props.onClick();
    await flush();
    assert.equal(calls, 2, "点重试应重新加载");
    const rendered = findClass(view.tree, "ax-tv-image");
    assert.equal(rendered.length, 1, "成功后应回到缩略图");
    assert.ok(
      rendered[0].children.some((child) => child.type === "img"),
      "成功后应渲染图片",
    );
  } finally {
    view.close();
  }
});

test("画廊: 无图或缺少 loadImage 时不渲染", async () => {
  const gallery = await registerGallery();
  assert.equal(gallery.component({ t, images: [], loadImage: () => {} }), null);
  assert.equal(gallery.component({ t, images: [{ attachment: REF_A }] }), null);
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
  assert.equal(calls[0].name, "aux.tool.call.images");
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
