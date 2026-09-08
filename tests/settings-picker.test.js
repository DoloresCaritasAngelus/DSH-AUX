/**
 * T2 (Phase 4): the reworked settings page. Loads the shipped bundle under a
 * fake module loader plus a hook-capable mini React and asserts the section
 * layout, progressive disclosure, the shared model picker (grouping,
 * multi-select, chain ordering, capability marks) and that no existing switch
 * or task field was dropped.
 *
 * Run: node --test tests/settings-picker.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

// ── mini React (positional hooks + effects + function components) ───────────
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
    useCallback(fn, deps) {
      return react.useMemo(() => fn, deps);
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
  function mount(component, props) {
    instances.clear();
    mounted = { component, props };
    let tree = renderOnce();
    return {
      get tree() {
        return tree;
      },
      async act() {
        for (let round = 0; round < 20; round += 1) {
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

function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, out);
  return out;
}
const byClass = (tree, className) => findAll(tree, (node) => node.props?.className === className);
const byId = (tree, id) => findAll(tree, (node) => node.props?.id === id);
function texts(node, out = []) {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (node === null || typeof node !== "object") return out;
  for (const child of node.children ?? []) texts(child, out);
  return out;
}

const { react: testReact, mount } = createReact();
let bundle = null;
async function loadBundle() {
  if (bundle !== null) return bundle;
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        bundle = definition.factory((name) => {
          if (name === "react") return testReact;
          throw new Error("unexpected require: " + name);
        });
      },
    },
  };
  await import("../dsh-aux/src/client.js");
  return bundle;
}

const MODELS = {
  groups: [
    {
      id: "prov-a",
      name: "Prov A",
      models: [
        { id: "vision-model", name: "Vision Model" },
        { id: "text-model", name: "Text Model" },
      ],
    },
    { id: "prov-b", name: "Prov B", models: [{ id: "other-model", name: "Other Model" }] },
  ],
};

function makeHost(settingsValue) {
  const registrations = [];
  const commands = [];
  const api = {
    settings: {
      async describe() {
        return { ok: true, value: { namespaces: [{ ns: "aux", value: settingsValue, revision: 1 }], writable: true } };
      },
      async mutate() {
        return { ok: true, value: { revision: 2, value: settingsValue } };
      },
    },
    llm: {
      async providers() {
        return {
          ok: true,
          value: {
            providers: [
              { provider: "prov-a", displayName: "Prov A", active: true },
              { provider: "prov-b", displayName: "Prov B", active: true },
            ],
          },
        };
      },
      async models() {
        return { ok: true, value: MODELS };
      },
    },
    sessions: {
      async list() {
        return { ok: true, value: { items: [] } };
      },
    },
  };
  const ctx = {
    get(key) {
      if (key === "connection") return { api };
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
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  const runAuxCommand = async (line) => {
    commands.push(line);
    if (line.startsWith("/aux models")) {
      return {
        kind: "success",
        text: JSON.stringify({
          routes: [
            { provider: "prov-a", model: "vision-model", name: "Vision Model", imageCapable: true },
            { provider: "prov-a", model: "text-model", name: "Text Model", imageCapable: false },
            { provider: "prov-b", model: "other-model", name: "Other Model", imageCapable: null },
          ],
        }),
      };
    }
    return { kind: "success", text: "{}" };
  };
  return { ctx, registrations, commands, api, runAuxCommand };
}

async function mountSettings(settingsValue = {}) {
  const bundleExports = await loadBundle();
  const host = makeHost(settingsValue);
  bundleExports.apply(host.ctx);
  const entry = host.registrations.find((item) => item.options.name === "settings.section");
  assert.ok(entry, "settings.section 应已注册");
  const view = mount(entry.component, {
    t: (key) => "T:" + key,
    api: host.api,
    runAuxCommand: host.runAuxCommand,
    sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
  });
  await view.act();
  await view.act();
  return { view, host };
}

test("分区: 六个分区,默认只展开概览", async () => {
  const { view } = await mountSettings({});
  const headers = byClass(view.tree, "ax-group-header");
  assert.equal(headers.length >= 6, true, "至少六个分区卡片");
  const open = headers.filter((node) => node.props["aria-expanded"] === true);
  assert.equal(open.length, 1, "默认只展开一个分区");
  const labels = texts(open[0]);
  assert.ok(labels.includes("T:section.overview"), "展开的应是概览: " + labels.join("|"));
  const all = texts(view.tree).filter((text) => text.startsWith("T:section."));
  for (const key of [
    "section.overview",
    "section.routing",
    "section.routing.tasks",
    "section.switches",
    "section.images",
    "section.debug",
    "section.advanced",
  ]) {
    assert.ok(all.includes("T:" + key), "缺少分区 " + key);
  }
});

test("渐进披露: 每个任务一行摘要,点编辑才展开", async () => {
  const { view } = await mountSettings({ tasks: { vision: { models: ["prov-a/vision-model", "prov-a/text-model"] } } });
  const summaries = byClass(view.tree, "ax-task-summary");
  assert.equal(summaries.length, 6, "六个任务都有一行摘要");
  const visionSummary = summaries.find((node) => texts(node).includes("T:task.vision"));
  assert.ok(visionSummary, "vision 摘要存在");
  assert.ok(
    texts(visionSummary).join("|").includes("prov-a/vision-model → prov-a/text-model"),
    "摘要显示降级链: " + texts(visionSummary).join("|"),
  );
  // 默认未展开:任务卡里没有模型选择器
  assert.equal(byId(view.tree, "ax-vision-models").length, 0, "默认不展开编辑器");
  const editButton = findAll(visionSummary, (node) => node.type === "button")[0];
  editButton.props.onClick();
  await view.act();
  assert.equal(byId(view.tree, "ax-vision-models").length, 1, "点编辑后出现模型选择器");
});

test("共享选择器: 供应商分组/已选计数/多选/链排序/删除/手动输入", async () => {
  const { view, host } = await mountSettings({ tasks: { vision: { models: ["prov-a/vision-model"] } } });
  const summary = byClass(view.tree, "ax-task-summary").find((node) => texts(node).includes("T:task.vision"));
  findAll(summary, (node) => node.type === "button")[0].props.onClick();
  await view.act();
  // 展开时懒拉能力目录
  assert.ok(
    host.commands.some((line) => line.startsWith("/aux models")),
    "展开时应拉 /aux models --json",
  );
  const picker = byId(view.tree, "ax-vision-models")[0];
  assert.ok(picker, "vision 任务的模型选择器应已渲染");
  const groups = byClass(picker, "ax-picker-group");
  assert.equal(groups.length, 2, "两个供应商分组");
  const heads = byClass(view.tree, "ax-picker-head");
  assert.equal(heads[0].props["aria-expanded"], true, "默认展开第一组");
  assert.equal(heads[1].props["aria-expanded"], false, "其余组折叠");
  assert.ok(
    texts(heads[0]).join("|").includes("T:picker.selected1/2"),
    "组头显示已选 n/共 m: " + texts(heads[0]).join("|"),
  );
  // 组内多选:勾选第二个模型 → 链变成两条
  const checkboxes = findAll(groups[0], (node) => node.type === "input" && node.props.type === "checkbox");
  checkboxes[1].props.onChange();
  await view.act();
  let chainRows = byClass(byId(view.tree, "ax-vision-models")[0], "ax-picker-row");
  assert.equal(chainRows.length, 2, "多选后链上有两条");
  assert.ok(texts(chainRows[1]).join("|").includes("prov-a/text-model"), "第二条是新选中的");
  // 链排序:把第二条上移
  const upButtons = findAll(chainRows[1], (node) => node.type === "button");
  upButtons[0].props.onClick();
  await view.act();
  chainRows = byClass(byId(view.tree, "ax-vision-models")[0], "ax-picker-row");
  assert.ok(texts(chainRows[0]).join("|").includes("prov-a/text-model"), "上移后顺序互换");
  // 删除第二条
  const removeButtons = findAll(chainRows[1], (node) => node.type === "button");
  removeButtons[2].props.onClick();
  await view.act();
  assert.equal(byClass(byId(view.tree, "ax-vision-models")[0], "ax-picker-row").length, 1, "删除后只剩一条");
  // 手动输入逃生口
  const visionPicker = () => byId(view.tree, "ax-vision-models")[0];
  const manualInput = findAll(visionPicker(), (node) => node.props?.placeholder === "T:picker.manual")[0];
  manualInput.props.onChange({ target: { value: "prov-b/other-model" } });
  await view.act();
  const addButton = findAll(
    visionPicker(),
    (node) => node.type === "button" && texts(node).includes("T:picker.add"),
  )[0];
  addButton.props.onClick();
  await view.act();
  assert.ok(
    texts(byClass(visionPicker(), "ax-picker-row")[1]).join("|").includes("prov-b/other-model"),
    "手动输入应追加到链尾",
  );
});

test("nativeRoutes: 复用同组件并标注 image 能力三态", async () => {
  const { view } = await mountSettings({
    nativeRoutes: ["prov-a/vision-model", "prov-a/text-model", "prov-b/other-model"],
  });
  const nativePicker = byId(view.tree, "ax-native-routes")[0];
  assert.ok(nativePicker, "nativeRoutes 应复用同一个选择器组件");
  const caps = findAll(
    nativePicker,
    (node) => typeof node.props?.className === "string" && node.props.className.startsWith("ax-picker-cap"),
  );
  const states = caps.map((node) => node.props.className);
  assert.ok(states.includes("ax-picker-cap ax-picker-cap-true"), "true 能力: " + JSON.stringify(states));
  assert.ok(states.includes("ax-picker-cap ax-picker-cap-false"), "false 能力(标黄)");
  assert.ok(states.includes("ax-picker-cap ax-picker-cap-null"), "null 能力(标灰)");
  assert.ok(texts(caps[1]).includes("T:picker.capability.false"), "能力文案来自词条");
});

test("功能不减: 九个平台开关与六个任务的字段都在", async () => {
  const { view } = await mountSettings({});
  const switchKeys = [
    "vision_analyze",
    "web_extract",
    "web_crawl",
    "compress_text",
    "imageBridge",
    "subagentBridge",
    "workflowBridge",
    "compactionBridge",
    "skillAudit",
  ];
  const switchLabels = findAll(
    view.tree,
    (node) => node.type === "select" && node.props?.["aria-label"] !== void 0,
  ).map((node) => node.props["aria-label"]);
  for (const key of switchKeys) {
    assert.ok(switchLabels.includes(key), "缺少开关 " + key + "; have " + switchLabels.join(","));
  }
  // 任务编辑器:逐个展开并检查字段 id
  const tasks = ["vision", "web_extract", "web_crawl", "compress", "compaction", "skill"];
  for (const task of tasks) {
    const summary = byClass(view.tree, "ax-task-summary").find((node) => texts(node).includes("T:task." + task));
    findAll(summary, (node) => node.type === "button")[0].props.onClick();
    await view.act();
    const ids = findAll(view.tree, (node) => node.props?.id !== void 0).map((node) => node.props.id);
    for (const key of ["provider", "model", "models"]) {
      assert.ok(ids.includes("ax-" + task + "-" + key), task + " 缺少字段 " + key);
    }
  }
  // 高级项(超时/并发/思考档位)在 advanced 分区
  const advanced = findAll(
    view.tree,
    (node) => node.type === "button" && texts(node).includes("T:section.advanced"),
  )[0];
  advanced.props.onClick();
  await view.act();
  const advancedIds = findAll(view.tree, (node) => node.props?.id !== void 0).map((node) => node.props.id);
  for (const task of tasks) {
    for (const key of ["timeoutMs", "maxConcurrency", "reasoningEffort"]) {
      assert.ok(advancedIds.includes("ax-" + task + "-" + key), "高级区缺少 " + task + "." + key);
    }
  }
});
