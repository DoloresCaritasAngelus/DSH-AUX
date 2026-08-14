# 会话删除时清理附件图片 — 设计

> 2026-08-14 用户提出:主会话被删除(不包括归档)时,该会话发给子代理的图片一并删除。
> 与现有的 `/aux gc-images [days]`(定期手动 GC)并存,作为更精准的"事件驱动 GC"。

## 目标

用户在主会话里粘贴图片 → image-bridge 落盘到 `~/.dsh/attachments/v1/objects/` → 用户删除该会话(非归档)→ **该会话产生的图片自动删除**。

## 机制(已确认)

1. **感知删除**:DSH 的 `session/disposed` 事件在会话离开 store 时发出(用户删除 → `agent.dispose()` → 移除 session → 发事件)。
2. **区分"用户删除" vs "进程退出/归档"**:
   - 用户删除:单个会话 dispose
   - 进程退出:所有会话同时 dispose → **跳过**(不能误删)
   - 归档:归档是否触发 dispose?需验证(若不触发则天然排除;若触发,归档的会话图片会被删——需确认归档语义)
3. **附件归属**:image-bridge 的 `persistImagesToPaths` 落盘时,把"会话 id → 图片路径列表"记录到一个映射文件(`~/.dsh/attachments/v1/session-images.json`)。
4. **删除条件**:某会话 dispose 时,取其图片列表,对每张图检查**是否被其他会话引用**(扫映射文件);无引用才删。

## 实现位置

在 dsh-aux 插件里:
- 监听 `session/disposed`(host 侧,经 `ctx.on("session/disposed", ...)` 或注入 sessions 服务)
- image-bridge 补丁已存在(它改写消息),但**映射记录**需补进补丁,或在 dsh-aux 的 `_runVision`/bridge 落盘处记录

## 与现有 GC 的关系

| 机制 | 触发 | 精准度 | 保留 |
|---|---|---|---|
| `/aux gc-images [days]` | 手动,按时间 | 粗(可能删仍在用的) | ✅ 保留 |
| 会话删除清理(本设计) | 事件驱动,按归属 | 精确(只删无引用) | ✅ 新增 |

## 风险与对策

- **误删共享图**:两张会话共用一张图(content-addressed 只存一份)→ 检查引用后才删 ✅
- **进程退出误触发**:多会话同时 dispose → 跳过 ✅
- **归档语义未确认**:需实测归档是否触发 session/disposed;若触发,加"归档标记"排除
- **映射文件与真实文件不一致**(崩溃/手改):删除前 stat 存在性,不存在则清理映射条目

## 实现路径(已验证)

1. **删除信号**:`session/disposed`(用户删除会话 → `agent.dispose()` → session 离开 store → 事件)。**归档不触发**(workspace.archiveSession 是 client 侧操作,不动 host session store)——天然满足"归档保留"。
2. **归属推导(免改 bridge 补丁)**:dsh-aux 监听 `session/disposed` 时,扫描该会话事件日志中的 `aux/llm-call` 记录——vision 调用的事件里没有路径,但可从会话的 user/message 事件(image block 的 attachment ref)拿到 attachmentId,或从 `_runVision` 的调用参数推导。**更稳的做法**:dsh-aux 在 `_runVision` 执行时把 "会话 id → attachmentId 列表" 记入一个持久化映射(`~/.dsh/attachments/v1/session-images.json`),dispose 时查映射。
3. **删除条件**:该会话的每张图,检查是否被其他会话引用(扫映射);无引用才删文件 + 清理映射条目。
4. **进程退出防护**:多个会话同时 dispose → 跳过(进程退出场景,非用户删除)。

## 已验证

1. ✅ `session/disposed` 可订阅:多个官方包(dsh-host-apiproxy / dsh-session-persistence / dsh-session-projection-cache / dsh-session-telemetry)都用 `ctx.on("session/disposed", ...)`——dsh-aux host 插件同模式即可。
2. ✅ 归档不触发 dispose(workspace.archiveSession 是 client 层操作,不动 host session store)→ 归档会话的图片天然保留。
3. ⚠️ dispose 时 session 对象能否读 events:官方订阅者在 dispose 时读 session(如 projection-cache 清理行),大概率可读;实现时验证。归属映射(json 文件)是更稳的方案,不依赖 dispose 后 events 可用性。

## 实施清单(待做)

## 实施状态:已实现(2026-08-14)

1. ✅ dsh-aux host 插件构造时 `ctx.on("session/disposed", handler)`(_onSessionDisposed)
2. ✅ `_runVision` 解析图片后记录归属:内存 Map + 防抖写 `~/.dsh/attachments/v1/session-images.json`(tmp + rename 原子写)
3. ✅ dispose handler:取该会话 attachmentId → 扫映射确认无其他会话引用 → 删对象文件 + .ext 硬链接 → 更新映射
4. ✅ 多会话同时 dispose(进程退出)→ 跳过(_disposalBurst 检测)
5. ✅ 测试 45 项全过:含"会话删除清理"用例(无引用删、共享保留、双会话删除后清空)

> 生效需重启 DSH。真实触发验证(用户删除会话 → 图片被清)在重启后由用户操作确认。
