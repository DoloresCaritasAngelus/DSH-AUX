# Changelog

## 未发布 (Unreleased)

### 图片生命周期与 vision 原生交付

- **归属与误删防护**:新增 `session/event` 归属钩子(递归工具产物图)与 `session/created`
  恢复屏障(内存日志扫描,零磁盘 I/O);屏障未完成/失败时**全局拒绝删除**(fail-closed,
  `/aux status` 的 `imageLifecycle` 可观测,5 分钟对账重试成功后自动恢复);
  回收改为 `rename` 进 `objects/.trash/`(7 天恢复窗口,mtime 清扫)。
- **持久化兼容**:`sessionPersistence` 新老两代统一走 `listSessionSnapshots()` /
  `readSessionEvents()`(0.1.5 `list`/`open(id,'read').read()` + `close()`,旧代 `listSnapshots`/`inspect`),
  会话解析同时兼容 `snapshot.header.id` 与旧内联 `id/cwd`。
- **GC 债**:新增旁挂 `attachment-refs.json`(完整 ref,只服务 GC),删除改走官方
  `attachments.imageHostPath(ref)` 并清掉全部已知 `.ext` 硬链接;对象命名规则收进单一
  `images/object-path.js`;派生 `request-images/` 按总量上限(默认 256 MiB,`requestImagesMaxMiB` 可配)
  + mtime LRU 回收,并入 5 分钟对账与 `/aux gc-images` 输出。
- **vision 原生交付**:新增 `aux.visionRoute`(aux / native-when-capable / auto)与
  `aux.nativeRoutes` 白名单;`inputModalities` 只作否定门;native 跳过辅助调用、
  输出新增 `mode` 字段、交付失败显式提示改用 aux;交付复用 `aux/llm-call` 事件
  (`mode: 'native'`)以便 `/aux history` 追溯;设置页新增三个控件。

### DSH 0.1.5-alpha.1 兼容(主支单版本)

- **补丁重切(P1/P2/P7)**:
  - `dsh-agent-loop` 图像桥接锚点重切到 0.1.5 的同步五参 `buildRequest`:插入桥接方法并把签名改 async,
    桥接在冻结循环之后进行且仅在真的改写时 `deepFreeze` 产物,唯一调用点补 `await`;0.1.2 的 8 参链路保持原状。
  - `dsh-api-session-controller` 准入闸步骤块改为忽略行首缩进匹配(0.1.5 的 `using` 绑定多包一层 `try`
    使每行多一个前导 tab),同一份锚点块同时命中 0.1.2 与 0.1.5。
  - `dsh-session` append ignorable 新增 0.1.5 变体(post-event `validateSessionEventData` + 重入守卫);
    `patch-session-ignorable.mjs` 与 `self-heal.mjs` 两份变体表同步登记。
- **桥接投递文本**改为 `[本条消息第N张/共M张, attachmentId=<sha256:…>。可用 vision_analyze 的 attachmentId 参数查看]`:
  不再依赖 `.ext` 硬链接路径与扩展名判型;已打补丁的旧部署由新增 `anchor-text` 状态原地升级。
- **`apply-patch --dry-run` 结论保真**:dry-run 改为与真实应用同判据(先校验步骤块再判定可升级),
  不再把"检测命中但块不匹配"报成可升级;版本不匹配仍按设计返回退出码 0(由 CI/自愈的文本门禁承担信号)。
- **兼容矩阵**:主支只支持 `0.1.5-alpha.1`;CI compat 矩阵、根 devDependencies 与 `TESTING.md` 基线同步切换;
  `0.1.2-alpha.2 ~ 0.1.2-rc.1` 冻结在 `legacy/dsh-0.1.2-alpha.2-to-0.1.2-rc.1`。
  peerDependencies 范围保持不变(兼容矩阵是支持声明,不是安装闸)。
- **测试**:新增 `tests/bridge-dry-run.test.js`、`tests/bridge-block-match.test.js`、
  `tests/agent-loop-anchor.test.js`、`tests/session-append-ignorable.test.js`;
  `tests/bridge.test.js` 的提取源改为仓库内补丁块(此前在 CI 中静默 skip)。
