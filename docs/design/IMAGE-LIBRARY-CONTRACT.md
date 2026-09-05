# IMAGE-LIBRARY CONTRACT — 图片库服务端/客户端接口契约

> 状态：**已冻结（Phase 0）**
> 本文件是并行任务之间避免返工的接口约定。实现必须与本契约一致；若需改动，先更新本文件再改代码。
> 配套设计:`IMAGE-LIBRARY-DESIGN.md`。

---

## 1. 数据文件与键

### 1.1 新文件

`image-retention.json`（AUX 自有，位于 `<DSH_HOME>/attachments/v1/`）：

```json
{
  "version": 1,
  "retained": ["sha256:xxxx", "sha256:yyyy"]
}
```

### 1.2 既有文件（只读/复用）

- `session-images.json`：`{ sessionId: [attachmentId, ...] }`
- `image-memory.json`：`{ entries: [{ sessionId, attachmentId, question, summary, at }] }`

### 1.3 事件/投影键

- 事件类型：`aux/image-library`
- 投影 key：`aux-image-library`

---

## 2. ImageLibraryEntry / Snapshot（服务端与客户端共同形状）

```ts
interface ImageLibraryEntry {
  kind: 'image' | string;
  attachmentId: string;      // sha256:xxx
  hash: string;              // xxx
  mediaType?: string;        // image/png | jpeg | webp | gif 等（从扩展名/ref 推导，缺失允许）
  bytes?: number;
  mtimeMs?: number;
  ownerSessions: string[];
  ownerLiveSessions: string[];
  ownerArchivedSessions?: string[];
  referenceCount: number;
  shared: boolean;
  orphan: boolean;
  archived?: boolean;
  retained: boolean;
  memories: Array<{
    sessionId: string;
    question: string;
    summary: string;
    at: number;
  }>;
  firstSeenAt?: number;
  lastSeenAt?: number;
  readableBySessionId?: string;  // 可 readAttachment 的任一 owner session；孤儿/不可读时缺省
  fileName?: string;             // <hash>.png 等
}

interface ImageLibrarySnapshot {
  generatedAt: number;
  settings: {
    imageRetentionDays: number;
    imageAutoCleanEnabled: boolean;
  };
  counts: {
    total: number;
    orphan: number;
    archived: number;
    shared: number;
    retained: number;
    withMemory: number;
  };
  entries: ImageLibraryEntry[];
}
```

---

## 3. Retention API（`dsh-aux/src/images/retention.js`）

```js
imageRetentionPath(): string | undefined
loadRetained(): Promise<Set<string>>
saveRetained(retained: Set<string>): Promise<void>
setRetained(attachmentId: string, retained: boolean): Promise<{ retained: boolean }>
```

- 路径规则：`process.env.DSH_HOME || (process.env.HOME ? process.env.HOME + "/.dsh" : undefined)`，然后 `/attachments/v1/image-retention.json`
- 原子写：`<path>.tmp` + rename
- 损坏处理：`.corrupt-<ts>-<uuid>` 隔离，从空集合继续
- `setRetained(id, true)` 添加；`setRetained(id, false)` 删除

---

## 4. Image Library API（`dsh-aux/src/images/image-library.js`）

```js
collectImageLibrary(service): Promise<ImageLibrarySnapshot>
collectImageLibraryEntries(service, opts?): Promise<ImageLibraryEntry[]>
// opts: { filter?: 'all'|'orphan'|'archived'|'shared'|'retained'|'withMemory'; query?: string; limit?: number; offset?: number; sessionId?: string }
deriveObjectPath(attachmentId): string | undefined  // sha256: -> objects/<2>/<hash>
scanObjectFiles(root): Promise<Array<{ path, fileName, bytes, mtimeMs }>>
```

聚合规则：
- 从 `objects/` 扫描实际存在文件；每个 attachmentId 以去 `sha256:` 的 hash 为 identity。
- ownerSessions 来自 `session-images.json`（含 live + persisted 全集）。
- `ownerLiveSessions` 来自 `liveSessionIds(service)`（归档会话视为非 live）。
- `ownerArchivedSessions` 来自 workspace 归档集合。
- `orphan = ownerSessions.length === 0`。
- `archived = ownerSessions.length > 0 && ownerLiveSessions.length === 0 && ownerArchivedSessions.length > 0`。
- `shared = referenceCount > 1`。
- `retained` 来自 retention 集合。
- `memories` 从 `image-memory.json` 按 attachmentId 聚合（保留最近最多 20 条）。
- `readableBySessionId`：优先取 `ownerLiveSessions[0]`；仅归档/孤儿时不设置。
- 搜索 `query` 匹配：`attachmentId` / `hash` / `fileName` / 任一 `memories[].question` / `memories[].summary` / owner session id。
- `settings.imageRetentionDays` 默认 30；`imageAutoCleanEnabled` 默认 false（Phase 2 后接配置）。

---

## 5. Image Actions API（`dsh-aux/src/images/image-actions.js`）

```js
deleteImage(service, attachmentId, opts?: { force?: boolean }): Promise<{ ok: true; deleted: boolean; skipped?: string }>
deleteOrphans(service, opts?: { includeRetained?: boolean }): Promise<{ ok: true; deleted: string[]; skipped: string[]; freedBytes: number }>
removeFromOwnership(service, attachmentId): Promise<void>   // internal, 也可导出供测试
```

安全规则：
- `deleteImage`：
  - 默认若 `ownerSessions` 非空且非 force → 返回 `{ ok:false, error: 'REFERENCED' }`（throw 或返回错误结构由命令层决定，建议直接 throw 带 code）
  - force 时：先从所有 session ownership 移除该 id（调用 ownership 的队列化保存），再删对象文件 + 扩展名硬链接
  - 若该 id retained，force 删除时同时 `setRetained(id, false)`
- `deleteOrphans`：
  - 只处理 `orphan === true` 的附件
  - 默认跳过 retained；`includeRetained:true` 时一并删除
  - 删除对象文件 + 扩展名硬链接；返回成功/跳过列表
- 文件删除沿用 `gc.js` 的安全模式：只删真实 regular file，拒绝 symlink。

---

## 6. 命令接口（`/aux`）

```text
/aux images
/aux images --json [--filter all|orphan|archived|shared|retained|withMemory] [--query <q>] [--session <id>] [--limit N] [--offset N]
/aux image delete <attachmentId> [--force]
/aux image gc-orphans [--include-retained]
/aux image retain <attachmentId>
/aux image unretain <attachmentId>
```

命令返回遵循现有 `CommandResult`：`{ kind: 'success', text }`；`--json` 时 text 为 JSON 字符串。

`/aux image delete` 返回 JSON（`--json` 时）或人类可读文本：
```json
{ "ok": true, "deleted": "sha256:...", "freedBytes": 123 }
```
错误时 `kind:'error'` + text；带 `code` 建议：`REFERENCED` / `NOT_FOUND` / `RETAINED`。

---

## 7. 投影契约

- Host 侧在 service 启动、图片操作后、设置变更后发布 `aux/image-library` 事件，内容为 `ImageLibrarySnapshot`。
- 投影 `aux-image-library` 保存最近一份快照。
- 为避免事件过大：entries 上限默认 500；客户端需要完整列表时调用 `/aux images --json`。
- 客户端通过 `sessions.binding(sessionId).projections.faceOf('aux-image-library').getSnapshot()` 读取。

---

## 8. 测试 fixture

`tests/helpers/image-fixture.js`（新增）导出：

```js
createImageFixture(t)  // 创建临时 DSH_HOME，返回 { home, objectsRoot, sessionImagesPath, imageMemoryPath, writeObject(hash, { mediaType, bytes }), writeSessionImages(obj), writeMemory(entries) }
```

- 使用 `node:fs/promises` 与 `node:os.tmpdir()`。
- `writeObject` 自动创建 `objects/<前2>/<hash>` 与扩展名硬链接（可选）。
- fixture 在测试结束清理。
