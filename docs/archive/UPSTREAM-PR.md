# 上游 PR 提案(Upstream PR Proposals)

> dsh-aux 在部署中发现的两个平台扩展点,均已在本地以补丁形式落地并验证
> (见 `bridge/` 目录,幂等 + 备份回滚)。以下为整理好的 upstream 建议,
> 供提交到 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
> 两份 PR 相互独立,可分别合入。

---

## PR 1:dsh-session — 自定义事件注册通道(SessionEvent.ignorable 写入入口)

**状态**:本地已实现并验证(`bridge/patch-session-ignorable.mjs`);测试覆盖
读回兼容与降级保护。

### 问题

- `dsh-session-persistence` 的 `assertEventsSupported()` 对
  `KNOWN_SESSION_EVENT_TYPES`(构建时生成的白名单)之外的事件类型**拒绝整个
  会话日志**(`SessionFormatUnsupportedError`)。
- 白名单由 `gen-persistence-catalog.ts` 生成,官方注释承认 out-of-repo 插件
  事件"没有注册通道(deferred work)"。插件(如 dsh-aux 的 `aux/llm-call`、
  thinking-zh 的 `thinking/language`)一写事件,整份日志就不可读。

### 方案(最小改动,信封字段已预留)

`SessionEvent` envelope **已经预留** `ignorable?: true` 字段(读回校验侧
`event["ignorable"] !== true` 即拒绝),只是 `append()` 没有写入入口。
补齐写入入口即可,无需改白名单:

```ts
// dsh-session/src(伪码):append 签名扩为可选第 4 参数
append(type: string, data: unknown, opts?: unknown, ignorable?: { ignorable?: boolean }): SessionEvent {
  const event = { type, seq: this._nextSeq++, time: Date.now(), data, ...(ignorable?.ignorable === true ? { ignorable: true } : {}) };
  // …原逻辑
}

// dsh-session-persistence/src:assertEventsSupported 已支持(无需改动)
//   KNOWN_SESSION_EVENT_TYPES.has(type) || event.ignorable === true → continue
```

### 为什么比"注册白名单"更好

| 维度 | ignorable 通道 | 集中式注册白名单 |
|---|---|---|
| 兼容性 | 旧日志若未标记仍会被拒(可用迁移/白名单兜底) | 需要构建时收集所有插件类型 |
| 插件演进 | 事件类型可随插件版本自由变化,无需平台发版 | 每次新事件类型都要平台发版 |
| 语义 | "未知但可跳过校验、事件保留、投影照常回放" | 全局枚举,类型即契约 |

### 兼容旧日志(可选,推荐)

补丁前已写入的未标记事件,读回仍会被拒。可把 dsh-aux 的 `aux/llm-call`
等已知插件类型加入生成白名单(当前本地补丁即如此,见 `patched-session-whitelist.txt`),
或提供一次性的日志迁移。

### 本地实现参考

- `bridge/orig-session-append.txt` → `bridge/patched-session-append.txt`(append 改动)
- `bridge/orig-session-whitelist.txt` → `bridge/patched-session-whitelist.txt`(白名单兜底)
- dsh-aux 侧消费者:`_recordEvent()` 以 `{ ignorable: true }` 写入;
  未检测到补丁时自动降级不写事件(保护会话日志),`/aux status` 可见状态。

---

## PR 2:dsh-settings + dsh-host-apiproxy — 插件 namespace 动态暴露给 Web 设置页

**状态**:本地已实现并验证(`bridge/patch-settings-dynamic-expose.mjs` +
`bridge/patch-settings-allowlist.mjs`)。

### 问题

- Web 设置页的读写边界是 `dsh-host-apiproxy` 的 `WEB_SETTINGS_NAMESPACES`
  硬编码白名单(另有 `PRODUCT_SETTINGS_NAMESPACES`)。
- 插件注册自己的 settings namespace(`settings.register()`)后,Host 侧可见,
  但 **Web 侧 settings.describe / settings.mutate 一律拒绝**;官方 api-proxy
  注释承认这是 deferred work。
- 结果:插件的设置页(section 挂在 client 侧)只能读不能写,或必须走命令行。

### 方案(声明式 opt-in,零集中清单)

1. `dsh-settings`:`register()` 的 hooks 增加可选 `exposedToWeb: boolean`;
   注册项记录该标志;新增 `listExposed(): string[]` 返回声明过的 namespace
   (注册序)。

```ts
// dsh-settings:register 内部
registrations.set(ns, { ns, exposedToWeb: hooks?.exposedToWeb === true, … });

// dsh-settings:新增
listExposed(): string[] {
  return [...this.registrations.values()].filter((r) => r.exposedToWeb).map((r) => r.ns);
}
```

2. `dsh-host-apiproxy`:`exposedNamespaces()` 合并动态结果,白名单保持
   平台原始内容:

```ts
function exposedNamespaces() {
  const exposed = modelProviderNamespaces();
  for (const ns of WEB_SETTINGS_NAMESPACES) exposed.add(ns);
  for (const ns of PRODUCT_SETTINGS_NAMESPACES) exposed.add(ns);
  for (const ns of settings.listExposed()) exposed.add(ns); // ← 新增
  return exposed;
}
```

### 收益

- 插件自己声明"我的设置该对 Web 开放",平台不再维护集中清单;
- 权限语义清晰:默认不暴露(与现状一致),显式 opt-in 才开放;
- dsh-aux 落地:注册 `aux` namespace 时声明 `exposedToWeb: true`,
  设置页读写 aux 配置成为插件原生能力。

### 本地实现参考

- `bridge/orig-settings-register.txt` → `bridge/patched-settings-register.txt`
- `bridge/orig-settings-list.txt` → `bridge/patched-settings-list.txt`
- `bridge/orig-settings-section.txt` → `bridge/patched-settings-section.txt`(hooks 透传)
- `bridge/patch-settings-allowlist.mjs`(api-proxy 合并,含 v1→v2 升级)
