/**
 * T1 (Phase 4): the AUX message-image gallery. Loads the shipped browser
 * bundle under a fake module loader plus a minimal React runtime with hook
 * state and effects, so registration (negative-priority shadowing of the
 * shipped entry), the ordinal badge, the preview arm, loading/error/retry and
 * the lightbox are all asserted without a browser.
 *
 * Run: node --test tests/message-images.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

// ── minimal React: positional hook state, effects, function components ──────
function createReact() {
  const instances = new Map();
  let current = null;
  let pendingEffects = [];
  let dirty = false;
  let mounted = null;

  function hooksFor(path) {
    let instance = instances.get(path);
    if (instance === void 0) {
      instance = { hooks: [], index: 0 };
      instances.set(path, instance);
    }
    instance.index = 0;
    return instance;
  }

  const react = {
    createElement(type, props, ...children) {
      return {
        type,
        props: props ?? {},
        children: children.flat(Infinity).filter((child) => child !== null && child !== void 0 && child !== false),
      };
    },
    useState(initial) {
      const instance = current;
      const slot = instance.index++;
      if (!(slot in instance.hooks)) instance.hooks[slot] = typeof initial === "function" ? initial() : initial;
      return [
        instance.hooks[slot],
        (value) => {
          const next = typeof value === "function" ? value(instance.hooks[slot]) : value;
          if (Object.is(next, instance.hooks[slot])) return;
          instance.hooks[slot] = next;
          dirty = true;
        },
      ];
    },
    useEffect(effect, deps) {
      const instance = current;
      const slot = instance.index++;
      const record = instance.hooks[slot] ?? { deps: void 0, cleanup: void 0 };
      instance.hooks[slot] = record;
      const changed =
        deps === void 0 ||
        record.deps === void 0 ||
        deps.length !== record.deps.length ||
        deps.some((dep, index) => !Object.is(dep, record.deps[index]));
      if (changed) {
        pendingEffects.push(() => {
          if (typeof record.cleanup === "function") record.cleanup();
          record.cleanup = effect() ?? void 0;
          record.deps = deps;
        });
      }
    },
    useRef(initial) {
      const instance = current;
      const slot = instance.index++;
      if (!(slot in instance.hooks)) instance.hooks[slot] = { current: initial };
      return instance.hooks[slot];
    },
    useMemo(fn, deps) {
      const instance = current;
      const slot = instance.index++;
      const record = instance.hooks[slot];
      if (
        record === void 0 ||
        deps === void 0 ||
        record.deps === void 0 ||
        deps.length !== record.deps.length ||
        deps.some((dep, index) => !Object.is(dep, record.deps[index]))
      ) {
        instance.hooks[slot] = { value: fn(), deps };
      }
      return instance.hooks[slot].value;
    },
    cloneElement(element, extra) {
      return { ...element, props: { ...element.props, ...extra } };
    },
  };

  function expand(node, path) {
    if (node === null || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const instance = hooksFor(path + ":" + (node.type.name || "component"));
      const previous = current;
      current = instance;
      const rendered = node.type({ ...node.props, children: node.children });
      current = previous;
      return expand(rendered, path + ":" + (node.type.name || "component"));
    }
    return { ...node, children: node.children.map((child, index) => expand(child, path + "/" + index)) };
  }

  function renderOnce() {
    dirty = false;
    pendingEffects = [];
    const tree = expand(react.createElement(mounted.component, mounted.props), "root");
    const effects = pendingEffects;
    pendingEffects = [];
    for (const effect of effects) effect();
    return tree;
  }

  /** Mount one component; returns helpers over the latest tree. */
  function mount(component, props) {
    // Hook state is positional: every mount starts from a clean slate.
    instances.clear();
    mounted = { component, props };
    let tree = renderOnce();
    return {
      get tree() {
        return tree;
      },
      /** Re-render until no state change is pending, then return the tree. */
      async act() {
        for (let round = 0; round < 20; round += 1) {
          // Drain microtasks (load resolution / rejection) before deciding.
          await new Promise((resolve) => setImmediate(resolve));
          if (!dirty) break;
          tree = renderOnce();
        }
        tree = renderOnce();
        return tree;
      },
    };
  }

  return { react, mount };
}

// ── tree helpers ────────────────────────────────────────────────────────────
function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, out);
  return out;
}
function byClass(tree, className) {
  return findAll(tree, (node) => node.props?.className === className);
}
function texts(node, out = []) {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (node === null || typeof node !== "object") return out;
  for (const child of node.children ?? []) texts(child, out);
  return out;
}

// ── fake module loader + slot registry ──────────────────────────────────────
const SLOT = "conversation.message.images";

/** Register the shipped attachment gallery the way the official plugin does. */
function officialEntry() {
  return {
    options: { name: SLOT },
    component: function ShippedGallery() {
      return null;
    },
    disposed: false,
  };
}

const { react: testReact, mount: testMount } = createReact();
let clientBundle = null;

/** Load the shipped bundle once (ESM caches it) under the fake module loader. */
async function loadClient() {
  if (clientBundle !== null) return clientBundle;
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        clientBundle = definition.factory((name) => {
          if (name === "react") return testReact;
          throw new Error("unexpected require: " + name);
        });
      },
    },
  };
  await import("../dsh-aux/src/client.js");
  return clientBundle;
}

/** Apply the bundle to a fresh fake host; records the image-gallery entries. */
async function loadBundle(settingsValue, { remote = false } = {}) {
  const bundle = await loadClient();
  const entries = [officialEntry()];
  const registrations = [];
  const state = { value: settingsValue };
  const listeners = [];
  const settings = {
    async describe() {
      return { ok: true, value: state.value };
    },
  };
  const ctx = {
    get(key) {
      if (key === "connection") return { api: { settings } };
      // Deterministic labels: the real locale seat may resolve to either
      // language depending on the host's navigator.language.
      if (key === "locale") return { translate: (ns, messageKey) => "T:" + messageKey };
      return void 0;
    },
    inject: (names, fn) => fn({ locale: void 0 }),
    effect: (fn) => {
      fn();
      return () => {};
    },
    slots: {
      inject(name, fn) {
        return fn();
      },
      register(options, component) {
        // Mirror the shipped single-slot rule: same priority throws.
        const occupant = entries.find(
          (entry) =>
            entry.options.name === options.name &&
            (entry.options.priority ?? 0) === (options.priority ?? 0) &&
            entry.disposed === false,
        );
        if (occupant !== void 0) {
          throw new Error('single slot "' + options.name + '" already has a registration');
        }
        const entry = { options, component, disposed: false };
        entries.push(entry);
        if (options.name === SLOT) registrations.push(entry);
        return () => {
          entry.disposed = true;
        };
      },
    },
    ...(remote
      ? {
          remote: {
            $on(event, handler) {
              listeners.push({ event, handler });
            },
          },
        }
      : {}),
  };
  bundle.apply(ctx);
  return {
    entries,
    registrations,
    mount: testMount,
    setSettings(value) {
      state.value = value;
    },
    fireSettings() {
      for (const listener of listeners) listener.handler();
    },
  };
}

const REF = {
  attachmentId: "sha256:" + "11".repeat(32),
  mediaType: "image/png",
  bytes: 8,
  width: 4,
  height: 4,
  name: "a.png",
};
const REF2 = {
  attachmentId: "sha256:" + "22".repeat(32),
  mediaType: "image/png",
  bytes: 8,
  width: 4,
  height: 4,
  name: "b.png",
};

/** A user message node carrying the given durable images, in order. */
function userNode(refs) {
  return {
    kind: "user",
    seq: 1,
    time: 1,
    content: refs.map((attachment) => ({ type: "image", attachment })),
    source: { kind: "user" },
  };
}
function useTrajectoryOf(nodes) {
  return (selector) =>
    selector({
      eventNodes: nodes,
      eventLocations: new Map(),
      requests: [],
      callSchemas: new Map(),
      partial: null,
      runningCalls: [],
    });
}
function loaderFor(url, options = {}) {
  const load = (attachment) =>
    options.reject === true
      ? Promise.reject(new Error("boom"))
      : Promise.resolve(typeof url === "function" ? url(attachment) : url);
  if (options.peek !== void 0) load.peek = () => options.peek;
  return load;
}

// ── tests ───────────────────────────────────────────────────────────────────
const AUX_SETTINGS = { enabled: { messageImages: "aux" } };

test("注册: 键为 conversation.message.images,priority -1 影子官方 priority 0", async () => {
  const { entries, registrations } = await loadBundle(AUX_SETTINGS);
  await Promise.resolve();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].options.name, SLOT);
  assert.equal(registrations[0].options.priority, -1, "必须负 priority,否则 single 槽抛错");
  const shipped = entries.find((entry) => entry.options.priority === void 0 || entry.options.priority === 0);
  assert.ok(shipped, "官方 priority 0 条目必须仍在(退役后回退)");
  assert.equal(shipped.disposed, false);
  assert.equal(entries.filter((entry) => entry.options.name === SLOT).length, 2, "官方 + AUX 两条");
});

test("开关: 默认 native 不注册任何条目", async () => {
  const { entries, registrations } = await loadBundle({ enabled: {} });
  await Promise.resolve();
  assert.deepEqual(registrations, [], "native 不得注册");
  assert.equal(entries.filter((entry) => entry.options.name === SLOT).length, 1, "只剩官方条目");
});

test("开关: 运行中切换会注册/注销(退役机制)", async () => {
  const host = await loadBundle({ enabled: {} }, { remote: true });
  await Promise.resolve();
  assert.equal(host.registrations.length, 0, "初始 native 不注册");

  host.setSettings({ enabled: { messageImages: "aux" } });
  host.fireSettings();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.registrations.length, 1, "切到 aux 后注册");
  assert.equal(host.registrations[0].disposed, false);

  host.setSettings({ enabled: {} });
  host.fireSettings();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.registrations[0].disposed, true, "关掉后 AUX 条目释放,官方图库自动回来");
  assert.equal(
    host.entries.filter((entry) => entry.options.name === SLOT && entry.disposed === false).length,
    1,
    "该槽只剩官方条目",
  );
});

test("角标: 用户消息按消息内序号渲染 第N/共M", async () => {
  const { registrations, mount } = await loadBundle(AUX_SETTINGS);
  await Promise.resolve();
  const Gallery = registrations[0].component;
  const view = mount(Gallery, {
    images: [{ attachment: REF2 }],
    loadImage: loaderFor("blob:one"),
    align: "end",
    useTrajectory: useTrajectoryOf([userNode([REF, REF2, REF, REF])]),
  });
  await view.act();
  assert.deepEqual(
    texts(view.tree).filter((text) => text.includes("第")),
    ["第2/共4"],
  );
});

test("角标: align start(assistant markdown)与预览臂都不编号", async () => {
  const { registrations, mount } = await loadBundle(AUX_SETTINGS);
  await Promise.resolve();
  const Gallery = registrations[0].component;
  const start = mount(Gallery, {
    images: [{ attachment: REF }],
    loadImage: loaderFor("blob:one"),
    align: "start",
    useTrajectory: useTrajectoryOf([userNode([REF, REF2])]),
  });
  await start.act();
  assert.deepEqual(
    texts(start.tree).filter((text) => text.includes("第")),
    [],
  );

  const preview = mount(Gallery, {
    images: [{ preview: { url: "blob:preview", name: "pending.png" } }],
    loadImage: loaderFor("blob:one"),
    align: "end",
    useTrajectory: useTrajectoryOf([userNode([REF])]),
  });
  await preview.act();
  assert.deepEqual(
    texts(preview.tree).filter((text) => text.includes("第")),
    [],
    "预览臂无 attachmentId ⇒ 无角标",
  );
  assert.equal(byClass(preview.tree, "ax-mi-frame").length, 1, "预览臂仍要出缩略图");
  const img = findAll(preview.tree, (node) => node.type === "img")[0];
  assert.equal(img.props.src, "blob:preview");
});

test("角标: 歧义(同一 id 命中多条消息)或缺少 useTrajectory 时不显示", async () => {
  const { registrations, mount } = await loadBundle(AUX_SETTINGS);
  await Promise.resolve();
  const Gallery = registrations[0].component;
  const ambiguous = mount(Gallery, {
    images: [{ attachment: REF }],
    loadImage: loaderFor("blob:one"),
    align: "end",
    useTrajectory: useTrajectoryOf([userNode([REF]), userNode([REF, REF2])]),
  });
  await ambiguous.act();
  assert.deepEqual(
    texts(ambiguous.tree).filter((text) => text.includes("第")),
    [],
  );

  const noHook = mount(Gallery, { images: [{ attachment: REF }], loadImage: loaderFor("blob:one"), align: "end" });
  await noHook.act();
  assert.deepEqual(
    texts(noHook.tree).filter((text) => text.includes("第")),
    [],
  );
  assert.equal(byClass(noHook.tree, "ax-mi-frame").length, 1, "缩略图不受影响");
});

test("不降级: peek 首帧、加载中、失败重试、点击开 lightbox、aria 标签", async () => {
  const { registrations, mount } = await loadBundle(AUX_SETTINGS);
  await Promise.resolve();
  const Gallery = registrations[0].component;

  // peek 首帧:同步就有 src,不显示加载中
  const peeked = mount(Gallery, {
    images: [{ attachment: REF }],
    loadImage: loaderFor("blob:loaded", { peek: "blob:cached" }),
    align: "end",
    useTrajectory: useTrajectoryOf([userNode([REF])]),
  });
  assert.equal(
    findAll(peeked.tree, (node) => node.type === "img")[0].props.src,
    "blob:cached",
    "peek 缓存必须先出首帧",
  );
  await peeked.act();
  assert.equal(findAll(peeked.tree, (node) => node.type === "img")[0].props.src, "blob:loaded");

  // 加载中:未 resolve 时显示加载文案
  let resolveLoad;
  const pending = (attachment) =>
    new Promise((resolve) => {
      resolveLoad = resolve;
    });
  const loading = mount(Gallery, { images: [{ attachment: REF }], loadImage: pending, align: "end" });
  assert.equal(byClass(loading.tree, "ax-mi-loading").length, 1, "未 resolve 时显示加载态");
  assert.deepEqual(texts(loading.tree), ["T:messageImages.loading"]);
  resolveLoad("blob:late");
  await loading.act();
  assert.equal(findAll(loading.tree, (node) => node.type === "img")[0].props.src, "blob:late");

  // 失败 + 重试:第一次失败 → 错误按钮;点击后第二次成功
  let attempts = 0;
  const flaky = (attachment) => {
    attempts += 1;
    return attempts === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("blob:retry");
  };
  const failed = mount(Gallery, { images: [{ attachment: REF }], loadImage: flaky, align: "end" });
  await failed.act();
  const errorButton = byClass(failed.tree, "ax-mi-error")[0];
  assert.ok(errorButton, "失败要出重试按钮");
  assert.deepEqual(texts(errorButton), ["T:messageImages.loadFailed"]);
  assert.equal(errorButton.props.title, "T:messageImages.retry");
  errorButton.props.onClick();
  await failed.act();
  assert.equal(attempts, 2, "点击重试要重新加载");
  assert.equal(findAll(failed.tree, (node) => node.type === "img")[0].props.src, "blob:retry");

  // lightbox + aria
  const opened = mount(Gallery, {
    images: [{ attachment: REF }],
    loadImage: loaderFor("blob:one"),
    align: "end",
    useTrajectory: useTrajectoryOf([userNode([REF])]),
  });
  await opened.act();
  const frame = byClass(opened.tree, "ax-mi-frame")[0];
  assert.equal(frame.props["aria-label"], "T:messageImages.openNameda.png");
  assert.equal(frame.props.title, "T:messageImages.open");
  frame.props.onClick();
  await opened.act();
  const dialog = findAll(opened.tree, (node) => node.props?.role === "dialog")[0];
  assert.ok(dialog, "点击后应出现 lightbox");
  assert.equal(dialog.props["aria-label"], "T:messageImages.lightbox");
  dialog.props.onClick();
  await opened.act();
  assert.equal(findAll(opened.tree, (node) => node.props?.role === "dialog").length, 0, "点击背景关闭");
});
