# Changelog

## 未发布 (Unreleased)

### 修复

- **设置页诊断面板:漏译文案与提示误报**:面板用拼键查表渲染,缺键时会把键名原样显示 —— 实测看到 `status.reason.force-aux-vision-overrides-route` 这类字符串;补齐 5 个缺失键(3 个 reason + 2 个 action)并新增覆盖率闸,防止再次漂移。另外把「forceAuxVision 覆盖 visionRoute」这类**配置后果说明**从「需处理」里分出来:它是用户有意选择的一组配置,不是缺陷;计入待办会训练读者忽略面板。现以 note 呈现并单独计数。

### 修复

- **设置页「平台状态」面板恢复可用**:`aux/platform-status` 事件的载荷里,`imageLifecycle.blockedReason` 在**删除就绪**(即一切正常)时是`undefined`,而 DSH 拒绝写入含 `undefined` 的会话事件(`carries non-JSON-serializable data`);写入路径又把该异常静默吞掉,于是事件一条也写不出去、设置页始终显示「无法获取平台状态」。原先的过滤只清**顶层** undefined,嵌套的照样进载荷 —— 现改为深度清理,并给写入路径补上可诊断输出(`DSH_AUX_DEBUG_PUBLISH=1` 时打印跳过或失败原因)。该缺陷自 0.4.5 起存在,影响所有部署。

### 修复

- **系统提示词不再宣传被开关关掉的工具**:`## 辅助模型工具(dsh-aux)` 一节与 Bootstrap 预步骤提醒原先无条件列出 `vision_analyze` /`web_extract` / `compress_text`。把某个工具的平台开关切成 `native` 后它已从模型目录消失,提示词却照旧宣传 —— 模型会去找不存在的工具。现按各工具的真实暴露度逐条生成:全部关掉时整节不注入,预步骤提醒为空时不发消息。

- **锚点回退文案改为纯事实**:早期 v4 在视觉工具不可用时写「（当前没有可用的视觉工具,无法查看此图）」——这同样是把一个此刻不存在的工具概念塞进上下文。现回退为空串,只保留「第 N/共 M 张 + attachmentId」的事实。已装早期 v4 的部署由新增的行级升级态 `anchor-factual` 原地更新(该行不含版本标记,skip 态认不出它,因此必须单列且排在 skip 之前)。

### 修复

- **图片锚点不再声称不可用的视觉工具**:桥接写入的锚点文本原先无条件写着「可用 `vision_analyze` 的 attachmentId 参数查看」;平台开关把该工具切成 `native` 后工具从模型目录消失,文案却照旧声称可用,模型会去找一个不存在的工具。现改为向 AUX 询问工具的真实暴露度(`auxLlm.visionToolAvailable()`,委托既有的 `isToolExposed`),不可用时给出「当前没有可用的视觉工具」的实话文案;旧 AUX 或取值失败一律按可用处理(保持既有文本)。已装旧补丁的部署由新增的 `method-v3-upgrade` 升级态原地更新,且排在 skip 之前。

- **新增补丁的平台开关约束闸**:`tests/bridge-switch-constraints.test.js` 为每个补丁钉住「切回 `native` 时如何让路」(读开关短路 / 委托会读开关的 AUX 服务 / 纯增量 schema),新增补丁必须在此登记其让路方式。

### 修复

- **平台开关切 `native` 后,图片准入闸不再残留失效**:`dsh-api-session-controller` 的图片能力门控补丁此前**无条件删除**官方准入闸(不看平台开关),于是 `imageBridge` 切成 `native` 后 agent-loop 的改写停止、闸却仍处移除态 —— 纯文本主模型不再收到原生的明确拒绝,图片会直接流向 provider。现改为**条件生效**:桥接开启时让行,关闭(或插件未挂载)时官方闸重新生效。已装旧补丁的部署由新增的升级态原地更新;`image-bridge` 的补丁检测改为版本容忍,避免旧标记被误报为未打补丁。

## 0.4.6 (2026-09-11) — DSH 0.1.5-rc.2 兼容

### 兼容性

- **主支支持线更新为 `0.1.5-rc.2`**:`peerDependencies`、`dsh-aux/package.json`、CI compat 矩阵、
  README / TESTING / PROJECT 的声明与徽章同步(此前停在 `0.1.5-alpha.1`)。
- **补丁面在 rc.1 → rc.2 之间零位移**:7 个 bridge 宿主包在该区间只有 `package.json` 版本号
  变更(40 文件 / +40 / -40),无源码改动,故 P1-P13 锚点无需重切。`alpha.1 → rc.2` 区间只有两处
  源码变化:`dsh-api-session-controller`(新增 `reveal` 文件管理器动作与 `workspaceDesktop()`,与
  图片能力门控无关)与 `dsh-session`(新增官方事件类型 `deliverables/presented`、`subagent/catalog`,
  与 `aux/*` 词条不冲突)。rc.1 用户可与 rc.2 共用同一 AUX 版本。
- **测试基线**:581 → **597**(新增五个闸:三个脚本的回归测试 + doctor 版本判定 + 仓库脚本可达性)。

### 工程

- **DSH 版本单一真相源**:新增 `compat.json`(DSH 版本 / 包版本 / 测试基线 / 快照日期)与
  `scripts/sync-compat.mjs`,把原先散落在 `package.json`(devDependencies + overrides)、CI 矩阵、
  `doctor` 支持范围、README 徽章与正文、`TESTING` / `PROJECT` / `PROJECT.AI` / PR 模板 / `AI.md` /
  `status.js` 的 23 处版本与数字收敛为「改一处、其余同步」。规则带锚点,文档被改写即报错
  (退出码 2)而非静默跳过;CI 新增 `sync-compat --check` 闸。
- **包清单共用**:`scripts/dsh-packages.mjs` 集中 devDependencies / overrides / 各支持线的额外依赖 /
  宿主包源码路径映射,`install-dsh-version.mjs` 与 `compat-delta.mjs` 共用一份,新增支持线时
  漏登记会明确报错(而非装出一套混合版本)。
- **`scripts/compat-delta.mjs`**:用 `git diff` 判定「某次 DSH 版本变动是否触及补丁宿主包源码」,
  三态结论 —— 0 锚点不可能位移 / 1 需逐个复核 / 2 宿主包映射过期或环境错误(映射过期不再给出
  「安全」结论)。
- **`scripts/compat-evidence.mjs`**:一次跑完版本断言、self-heal dry-run、`apply-patch --dry-run`、
  `doctor` 与(可选)全量测试,输出可直接贴进 PR / CHANGELOG 的兼容性证据块。
- **`doctor` 版本判定修复**:支持范围此前停在 `0.1.2` 线,导致 `0.1.5` 部署恒报「不在主支支持范围」;
  现直接读 `compat.json`,与支持声明同源。

## 0.4.5 (2026-09-09) — DSH 0.1.5-alpha.1 兼容 + 图片生命周期 + vision 原生交付

### 文档与工程

- **文档树索引与 CI 闸**:`docs/README.md` 成为 `docs/` 的唯一索引与规则页,含五词状态表
  (✅ 活跃 / 🟡 部分被取代 / 🔵 已实现(保留作回执) / ⬜ 历史 / 🗄 已归档)、每篇的状态头
  (状态 + 最后核实 + 🔻 易腐烂标注)与 `docs/archive/**` 的退役头(退役原因 / 取代者 / 复盘点);
  已实现的设计迁入 `docs/archive/`。新增、移动、退役文档必须同步索引,否则
  `scripts/ci-docs-index.mjs` 在 CI 中阻塞。
- **上游功能请求文档**:新增 `docs/design/upstream-requests.md` 与中文版,按对插件生态的代价
  记录三条请求(受支持的请求投影缝 / 附件列举与回收 seam / 插件自有会话事件类型的准入)
  与一条低优先级装饰项(消息图片画廊)。
- **PROJECT 单一真相**:`PROJECT.AI.md` 由 `PROJECT.md` 生成(`scripts/gen-project-ai.mjs`,
  CI 以 `--check` 把关),事实只在 `PROJECT.md` 维护一份,代理视图不再手改。
- **安装指南对齐 0.1.5 线**:`dsh-aux/AI.md` 的支持线、工具清单与自愈说明更新到
  `0.1.5-alpha.1` 单版本,并写明 self-heal 会打 P12/P13、补丁写入后需重启 DSH 生效。
- **未纳入本版**:Phase 4 前端 UX(消息图片画廊角标 / 设置页分区 / `/aux models` 能力探测)
  已归档到 `archive/phase4-ui-2026-09-09`,不随本版发布。

### 评审复核后的修复(2026-09-09)

- **图片删除 fail-closed 全覆盖**:`deletionReady` 此前只覆盖会话清理;现集中为
  `assertDeletionReady` 并接入 `/aux image delete`、孤儿回收与 `/aux gc-images`
  (含 `--force`),冻结期返回 `DELETION_FROZEN`(可重试);`gc-images` 跳过 `.trash`、
  按引用/固化过滤,固化清单读失败即拒绝删除。
- **回收站窗口按入站计龄**:`.trash` 条目名内时间戳为权威,7 天窗口不再因对象原始
  mtime 过期而退化为 0;`sweepTrash` 只清本模块条目,外来文件保留并计数。
- **多图 `vision_analyze` 补顶层 `mode`**:`images[]` 返回值此前缺 schema 必填的顶层
  `mode`,真实 DSH 输出校验(`ToolOutputError`)会让整批结果作废;现取批次交付决策,
  并用真实返回喂 schema 的测试锁住(全成功/单元素/部分失败/native)。
- **fetch 钉扎隔离与有界超时**:直连请求改用独立连接(`agent: false`),钉扎"按连接"
  成立(并关闭 Node ≥22.21 的 env-proxy 全局路由,避免钉扎被静默旁路);新增**无条件** connect/首字节与空闲 deadline(默认 15s/45s,可配,`<=0` 关闭),
  无代理部署不再无界挂起;严格模式解析为空时 fail-closed;`NO_PROXY` 括号 IPv6 归一。
- **补丁引擎整体回滚**:步骤块中途失配不再落半补丁(整体回滚 + 退出码 1);`--rollback`
  只认本工具备份;anchor-text 升级判定改用块匹配;self-heal 告警覆盖"步骤块未命中";
  `tests/bridge.test.js` 的部署包探测改为显式 opt-in。
- **文档与 CI 口径**:测试基线快照收敛、`TESTING.md` 清单补齐、`ci-doc-hygiene` 新增
  "发布段非空正文"闸与变异测试、`install-dsh-version` 版本矩阵收敛并注明只切换 `package.json`。

### 0.1.5 会话迁移放行(P12/P13)

- **P12 — AUX 事件进冻结词表**:DSH 0.1.5 的 v0→v1 会话迁移用冻结词表
  (`dsh-session-format-v0-to-v1` 的 `RELEASED_V0_EVENT_DISPOSITIONS`)校验历史事件,
  未知类型连 `ignorable: true` 都不放行、多余载荷成员直接拒(源工件不变),含
  `aux/*` 事件的旧会话因此打不开。`bridge/self-heal.mjs` 新增 P12:按
  `dsh-aux/src/event-shapes.js` 的登记表为四个 AUX 事件补 disposition 与透传 case,
  键集取"已发布形态 ∪ 当前形态"的并集;逐项幂等、备份 + `node --check` 门。
- **P13 — 官方写端缺口临时放行**:同一文件里一并放行官方历史写法——
  `permission/preset` 的 `origin`(0.1.1-rc.1)、abort cause 的 `stack`(0.1.3 线)、
  官方 `thinking/language`、provider 扩展的 `assistant/chunk finish.replayState`。
  每项先探测上游是否已收编,已收编即跳过(自退役);`DSH_AUX_NO_OFFICIAL_ADMISSIONS=1`
  只保留 P12。`/aux status` 的补丁台账新增 P12/P13 两行。
- **写端闸**:新增 `dsh-aux/src/event-shapes.js`(事件 × 允许字段单一真相)与
  `tests/event-shapes.test.js`(扫描全部写入点断言字段已登记);`events.js` 在写入前
  对未登记字段告警一次,避免"加了字段、下次 DSH 升级才发现旧会话读不出来"。
- **测试**:新增 `tests/event-shapes.test.js`、`tests/format-admissions.test.js`
  (不记裸总数,基线见 `TESTING.md` 并以实跑为准)。

### 修复

- **用户消息图片查找失效(P0)**:`user/message` 事件的 `data` 就是扁平 `UserMessage`
  (官方 `packages/core/session/src/types.ts:297`;读取归一化见 `index.ts:335`),而图片提取
  统一按 `event.data?.message` 读取 ⇒ 对用户粘贴的图恒返回空。影响三条:`vision_analyze` 的
  `attachmentId` 入口找不到、图片库归属登记不到(被判 orphan)、会话卡片角标退化。现按事件
  类型归一化(`user/message` → `event.message ?? event.data`;`tool/result` →
  `data.message ?? event.message`),并保留派生 live 形状的容错;`agent/inbox/spliced` 的
  `inserted` 明确不计入(随后会成为 `user/message`,计入会重复)。新增
  `tests/user-message-image.test.js`,并把 6 个测试文件中自造的嵌套 `data.message`
  fixture 校正为真实会话日志形状。

### vision 打磨与路由链(Phase 3)

- **失败分类与自动重试**:多图分析中单张图片失败时,限流/超时/连接类失败在工具内**自动重试一次**;
  仍失败则返回结构化 `error: { code, message, retryable }` 与指令式文案(说明原因、可否重试、下一步),
  不再是一句陈述句;工具描述写明失败条目会给出原因与可否重试。错误码沿用 AUX 既有分类并附
  DSH `LlmError` 映射(有意分歧:DSH 对 5xx `SERVER` 会重试,AUX 的 `other` 不重试)。
- **直连路径 IP 钉扎**:`imageUrl` / `web_extract` / `web_crawl` 的直连请求改为把 SSRF 校验**同一次解析**
  得到的公网地址钉到连接(`node:http(s)` + `lookup`),重定向逐跳同样钉扎;SNI 与 Host 保持,
  代理 CONNECT 路径不变。此前校验与 `fetch` 各解析一次 DNS,存在 rebinding 窗口。
- **多级降级链**:新增 `aux.tasks.<task>.models` 有序数组(主选 → 备1 → 备2 …),复用冷却跳过与
  图像能力门;非空时单数 `provider/model` 被忽略(`/aux status` 给出警告);链尾仍按
  `fallbackToMain` / `visionFallbackToMain` 考虑主模型;`/aux model` 写入单元素链,
  设置页新增"降级链"多行控件;`aux/llm-call` 事件记录 `candidates` / `selectedIndex`。
- **`imagePath` 魔数嗅探**:无扩展名(含点文件)按 PNG/JPEG/GIF87a/89a/RIFF-WEBP 签名判定格式,
  与官方 `read_image` 对齐;未知非空扩展名在读取前拒绝;扩展名与字节不符时给出"声明 X / 字节 Y"的明确文案。
- **动图契约对齐**:删除 vision system prompt 中"描述动图时序"的承诺(附件归一化只保留首帧),
  工具描述写明"动图仅分析首帧"。
- **`vision_analyze` 会话卡片**:客户端注册 `tool.call.toolview` 的 `key: 'vision_analyze'` 行,
  显示 `【图N/共M】` 角标(消息内编号,与桥接文本同源)+ 缩略图 + 结论,失败项只出文本;
  输出新增 `imageOrdinal`(消息级 / 调用级),`presentationMeta` 增加同序 `ordinals`。
- **测试**:新增 `tests/image-path-media.test.js`、`tests/fetch-pinning.test.js`、
  `tests/route-chain.test.js`、`tests/vision-ordinal.test.js`、`tests/vision-toolview.test.js`
  (不记裸总数,基线见 `TESTING.md` 并以实跑为准)。

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

## 0.4.4 (2026-09-06) — vision_analyze 轨迹回显

- **`vision_analyze` 轨迹回显**(轨迹可见性增强,不改变分析行为):
  - 成功的视觉分析把消费的持久图片 ref 原样带回工具结果,官方 render 管线随即产出 text+image 块:
    轨迹视图从此能看到辅助模型实际分析过的图片(`imagePath` / `imageUrl` 场景此前在轨迹里完全不可见);
  - 纯文本主模型安全:tool result 中的 image block 由官方 LLM runtime 投影为稳定占位文本后才进入模型上下文;
    image-capable 主模型则可在后续轮次直接回看图片;
  - 输出 schema 严格锁定 ref 形状(与官方 `read_image` 的 image block 逐字段一致,不多不少),失败项不携带图片;
  - 前向声明 `presentationMeta`(统一 attachments 数组;当前无官方消费者,为未来工具图片卡片预留);
  - 测试基建:新增 `@deepseek-ai/dsh-tool-fs` devDependency 作为形状基准,回显块与当期 DSH 版本的真实 `read_image` render 逐字段对照;
    新增 `tests/vision-echo.test.js`(schema 锁形/官方形状对齐/Session 加载边)。
- **仓库治理与文档结构**(面向贡献者/维护者,不影响插件行为):
  - 文档分层:根目录文档收敛为 10 篇(README×2、PROJECT×2、CHANGELOG、TESTING、CONTRIBUTING、CREDITS、SECURITY、CODE_OF_CONDUCT);专项设计迁入 `docs/design/`,v0.1 时代过程文档(PRD/评审/上游提案)归档至 `docs/archive/` 并附归档索引;
  - `CONTRIBUTIONS.md` 更名 `CREDITS.md`(借鉴致谢,消除与 CONTRIBUTING 的命名混淆),npm 包内副本并入生成器单源机制;
  - 引入 ESLint + Prettier + EditorConfig(仅 devDependencies,运行时零依赖不变),CI 新增 lint 与格式检查门禁;
  - 治理文档:新增 `SECURITY.md`(私密漏洞报告渠道)与 `CODE_OF_CONDUCT.md`;新增 `docs/known-issues.md` 公开已知问题(KI-1:commandcode MiMo 视觉);
  - PR 模板增强:新增一句话摘要、兼容性与风险(影响版本 / 用户升级动作 / 回滚方式)、测试证据与截图要求;自审清单补凭据检查与包内副本生成器项;
  - 流程固化:发布统一走 `release/vX.Y.Z` 分支 + PR;版本命名统一 `vX.Y.Z` / `vX.Y.Z-fix.N` / `vX.Y.Z-legacy`。

## 0.4.3 (2026-09-04) — DSH 0.1.2-rc.1 兼容

- **DSH 0.1.2-alpha.4+ / rc.1 Session API 兼容**:
  - 新增 `dsh-aux/src/session-utils.js`,提供 `sessionEvents()` 兼容 helper:
    新版 DSH 走 `session.snapshotEvents()`,旧版 alpha.2/alpha.3 走 `session.events`。
  - 迁移 `bootstrap` 晋升判断、`/aux history`、`/aux debug @this`、`/aux status`
    最近调用、`vision_analyze attachmentId` 定位、`image locate` live-session
    读取,避免新版 DSH 因缺少 `.events` getter 而失效。
- **P7 session ignorable 补丁双版本支持**:
  - 新增 `bridge/orig-session-append-alpha4-block.txt` 与
    `bridge/patched-session-append-alpha4-block.txt`,覆盖 alpha.4+/rc.1 的
    `seq: SessionSeq(...)` append 实现。
  - `patch-session-ignorable.mjs` / `self-heal.mjs` 会按部署源码自动选择
    alpha.2/3 旧块或 alpha.4+/rc.1 新块。
- **兼容范围扩展**:
  - 主支支持范围从 `0.1.2-alpha.2 ~ 0.1.2-alpha.3` 扩展到
    `0.1.2-alpha.2 ~ 0.1.2-rc.1`。
  - `scripts/install-dsh-version.mjs` 支持 alpha.4 / alpha.5 / rc.1。
  - CI compat 矩阵新增 `0.1.2-alpha.4` / `0.1.2-alpha.5` / `0.1.2-rc.1`。
  - `doctor` 支持范围同步。
- **测试**:
  - 新增 `tests/session-compat.test.js`:锁定旧 `.events` 与新版
    `snapshotEvents()` 两种 Session 形态下的 bootstrap/history/debug/resolve
    读取。
  - `tests/image-locate.test.js` 新增新版 live-session `snapshotEvents()` 用例。
  - 全量基线从 360 增至 370。

## 0.4.2-FIX1 (2026-09-03) — 图库日期分组修复 + 启动模式/事件提示

- **图库日期分组修复**:
  - 日期分组不再使用“昨天/本周/本月/今年/往年”这类随日历瞬间变化、容易把不同日期吞进同一组的粗粒度桶。
  - 改为渐进粒度:今天按 6 小时桶 → 近 30 天按具体日期 → 当年超过 30 天按自然月 → 往年按年份。
  - 日期/月份标签跟随 DSH 界面语言(中/英);跨年日期与月份标签带年份避免歧义。
- **启动模式提示**:
  - README 快速开始新增警告:请使用真实启动脚本(`~/dsh/start-dsh.sh` / `npx @deepseek-ai/dsh web`)启动 DSH,不要使用 `pnpm dsh --profile web` 这类从 TS 源码树启动的开发模式;dsh-aux 桥接补丁打在 `lib/` 构建产物上,源码模式不会加载补丁。
- **fullToolTrace 事件提示**:
  - 设置页 `fullToolTrace` 开关下方新增说明:开启会写入 `aux/debug` 会话事件;若 dsh-session ignorable 补丁缺失,事件不会写入,应先重打补丁并重启。

## 0.4.2 (2026-09-03) — 图片库发布 + 诊断/补丁瘦身

- **一键打补丁可靠性**:
  - `/aux patch` 现在先探测真实 DSH 部署根,并以部署根为 `cwd` + 显式 `DSH_ROOT` 运行 `apply-patch` / `self-heal`,避免误打仓库内旧测试 `node_modules`。
  - `bridge-locate` 增加真实部署根权威模式:检测到部署根时只解析部署根下的官方包,不再 fallback 到仓库旧副本。
- **诊断 UI 补丁明细**:
  - `/aux status --json` 新增 `patchLedger` 数组,逐项列出 alpha 线必需补丁的目标包、状态(installed/missing/unknown)与描述。
  - 设置页「诊断与修复」新增补丁清单表,可看到每个补丁状态与目标包。
- **补丁瘦身/退役(主支只保留 alpha.2/alpha.3)**:
  - `bridge/apply-patch.mjs` 移除 `dsh-host-apiproxy`(admit/selectModel) 与 rc.8 专用 original 锚点。
  - `bridge/self-heal.mjs` 移除 rc.6 settings 补丁 P9/P10。
  - 新增 `bridge/retired/` 休眠目录,保存退役补丁与块文件供未来参考;legacy 分支仍完整保留旧支持。
  - `imageBridgeStatus` 简化为 alpha 架构检测(agent-loop + session-controller)。
  - 仓库根 devDependencies 与 overrides 升到 `0.1.2-alpha.3`,移除 `dsh-host-apiproxy`。
  - `doctor` / `target.js` / `install-dsh-version` 收窄到 `0.1.2-alpha.2` / `0.1.2-alpha.3`。
- **项目文档**:
  - 新增 `PROJECT.md`(人类友好)与 `PROJECT.AI.md`(AI/代理友好)长期项目总览,并在 README 文档地图同步。
- **图片库(IMAGE-LIBRARY)**:
  - 服务端: `retention.js` / `image-library.js` / `image-actions.js`,管理 image-retention.json、聚合对象库/归属/记忆、安全删除与孤儿回收。
  - 命令: `/aux images` 与 `/aux image delete|gc-orphans|retain|unretain`。
  - 投影/事件: `aux-image-library` 投影 + `aux/image-library` ignorable 事件。
  - 客户端: 侧边栏“图库”入口 + 浮层面板(网格/缩略图/搜索/过滤/复选/批量/详情/会话跳转)。
  - 新增 `/aux image locate <attachmentId> [--session <id>] [--json]`:定位图片最近出现的 `user/message` seq 与 `vision_analyze` tool/call callId/callSeq,供详情页“去对话/去轨迹”跳转。
  - 客户端体验改进:小/中/大缩略图档位真实生效且不再固定裁成正方形;详情改为居中大弹窗(可拖拽/缩放、记忆分块折叠、元数据可读);打开面板优先读 `aux-image-library` 投影,不再默认在聊天流刷 JSON。
  - 图库新增分组/排序视图:支持按日期(今天 6 小时桶 → 近 30 天逐日 → 当年按月 → 往年按年)或按会话分组;分组时显示可折叠粘性组头(组名 + 数量),支持组内排序与独立组间排序;重复图片在所属会话组内均出现,孤儿组始终置顶。
  - 图库新增“已归档”状态:归档会话的图片不再被误判为孤儿,统计/筛选/会话分组中单独显示“已归档”;有 live owner 时缩略图优先从 live 会话读取,仅归档引用时保留占位并展示归档标记。
  - 图库支持鼠标拖拽框选多张图片(支持 Shift/Ctrl 追加选择),批量操作更顺手。
  - 图库维护:抽取公共对象扫描到 `images/fs-utils.js`、统一 retention 读写到 `retention.js`、修正 `locate --session` 参数边界、新增图库快照契约测试。
  - 图库删除安全:只有被会话引用的图片才走 `--force`(二次确认文案显示引用数);无引用图片直接普通删除;批量栏提示“含过滤外 N 项”。
  - 测试基线 356 -> 360。

## 0.4.1-FIX1 (2026-09-01) — alpha.3 设置页/状态芯片修复

> **兼容性变更**：本版本起不再支持 DSH 0.1.0-rc.6 ~ 0.1.1-rc.2。
> 旧版 DSH 用户请使用永久分支 `legacy/dsh-0.1.0-rc.6-to-0.1.1-rc.2` 或 Release `v0.4.1-legacy`。


- **Web 设置页修复**:
  - 适配 DSH 0.1.2-alpha.x 移除 `connection.api` 的变更,设置页不再白屏。
  - 供应商/模型/思考档位改为读取 `remote.session.modelCatalog()`。
  - 移除重复的 `settings.plugin.item` 注册,避免 Plugins 页重复出现 AUX。
- **状态芯片/桥接状态修复**:
  - `bridge-locate` 优先从 DSH 部署根解析补丁目标,修复读取到工作区未打补丁副本导致的事件不记录、状态误报。

- **DSH 0.1.2-alpha.3 兼容**:
  - CI 兼容矩阵新增 `0.1.2-alpha.3`。
  - alpha.3 为小幅修复版:`dsh-agent-loop` / `dsh-tool-subagent` / `dsh-session` / `dsh-settings` / `dsh-tool-skill` / `dsh-workflow-worker-thread` 等 lib 无变化。
  - `dsh-api-session-controller` 有内部重构,但 prompt 图片门控补丁锚点不变。
  - README / TESTING 平台支持范围更新到 `0.1.2-alpha.3`。
- **alpha.3 部署修复**:
  - `self-heal` / `doctor` 现在会把探测到的 `DSH_ROOT` 写入环境变量,子脚本不再因目标包缺失而解析到 `node_modules` 外的 unsafe 路径。
  - `dsh-api-session-controller` 在 alpha.3 中缺失时,`apply-patch` 与 `patch-settings-allowlist` 能安全跳过旧 `dsh-host-apiproxy` 目标。
  - 设置注册迁移为 `ctx.inject(["settings"], ...)`,与官方 agent-loop 一致,修复 alpha.3 下设置页可能不显示 AUX 配置的问题。

## 0.4.1(2026-08-31)— DSH 0.1.2-alpha.2 兼容 + 稳定加固

> 本版本重点：全面兼容 DSH 0.1.2-alpha.2，同时保留 0.1.0-rc.6 最低支持；
> 修复图片生命周期持久化问题；完善 CI 矩阵与协作流程。

- **生命周期持久化加固**:
  - `session-images.json` 增加 `.bak` 上一份好快照:主文件损坏时自动回退,损坏文件隔离保留(`.corrupt-*`),不再被下一次保存静默覆盖。
  - `image-memory.json` 损坏时隔离旧文件并继续追加,新记忆能落盘,不再静默吞写。
  - `cleanupSessionImages` 移除空 session 条目;共享图片的已删除 owner 会被及时摘除,多个会话共享的图片在最后一个引用删除后能被回收。
  - `ensureSessionImagesLoaded` 读取失败不再标记 loaded,瞬时错误可重试。
  - cleanup 判断“是否被其他会话引用”时同时看内存 + 磁盘 map,消除 debounce 窗口内共享图片被误删的竞态;`SIGTERM/SIGINT` 时 flush 未落盘的 ownership 写入。
  - `AsyncSemaphore.release()` 增加重复释放保护(`active <= 0` 直接返回),防止 active 被减成负数导致并发超放。
- 新增 `tests/lifecycle-durability.test.js`(11 项)与 AsyncSemaphore 回归测试;测试基线 305 → 314。
- **CI 完善**:
  - 新增 DSH 包级兼容矩阵(`0.1.0-rc.6` / `0.1.0-rc.7` / `0.1.0-rc.8` / `0.1.1-rc.1` / `0.1.1-rc.2` / `0.1.2-alpha.2`),通过 `scripts/install-dsh-version.mjs` 临时切换 `@deepseek-ai/*` 版本并加 overrides,无需容器化完整 DSH。
  - 新增 `scripts/ci-fake-dsh.mjs`:构造 fake DSH 根,做 bridge 补丁 dry-run / 实际补丁 + self-heal + doctor 冒烟。
  - `bridge/target.js` 支持 `DSH_ROOT` 环境变量,补丁脚本可在 CI/fake 部署根下解析目标。
  - `patch-session-ignorable` 白名单步骤改为可选:干净 rc.7+ 包没有 thinking/language 锚点时跳过,由 self-heal P8 兜底,不再硬失败。
  - 新增全仓 JS/MJS 语法检查与 shell 语法检查。
  - 记录:`0.1.2-alpha.1` 只有 GitHub release、无 npm 包,因此不进入 npm 矩阵;源码差异已纳入研究。
- 测试基线 314 → 319(新增 `deployedFile` DSH_ROOT 回归、AsyncSemaphore 旧句柄回归、image-memory `{}` 兼容、cleanup 内存 pending 等)。
- **PR #7 review 修复**:
  - `recordAttachmentOwnership` 捕获瞬时读取错误,避免 fire-and-forget 产生 unhandled rejection。
  - `cleanupSessionImages` 合并内存 pending 视图,删除仅内存存在的已删 session,避免后续 debounce save 复活。
  - 信号 flush 后改为 re-raise 信号,不再由插件直接 `process.exit(0)`。
  - `AsyncSemaphore.acquire()` 改为 tokenized release,旧 release 句柄不能释放新持有者的许可。
  - `image-memory` 对空对象 `{}` 宽容,不隔离为 corrupt。
  - corrupt 隔离文件名增加 UUID 后缀,避免同毫秒冲突。
  - 四个 README 测试基线同步到 319。
- **DSH 0.1.2-alpha.2 兼容**:
  - 保留 `0.1.0-rc.6` 最低支持;CI 绿门矩阵覆盖 rc.6 / rc.7 / rc.8 / 0.1.1-rc.1 / rc.2 / 0.1.2-alpha.2。
  - `0.1.1-rc.2` 官方移除了 selectModel 图片门控,`apply-patch` 增加 `native-rc2` 跳过态,`imageBridgeStatus` 识别原生 v3。
  - `0.1.2-alpha.2` 移除 `settingsNamespace` / `installSettingsSection` / `dsh-llm.deepFreeze`:改为 namespace import + `ctx.settings.installSection` 双兼容,本地实现 `deepFreeze`。
  - `dsh-tool-subagent` request 在 alpha.2 改为 `requestedChildAgentOptions`,补丁增加 `original-alpha2` 状态,合并 AUX 路由与官方子代理模型选择。
  - `scripts/install-dsh-version.mjs` 支持版本例外(npm 未按同版本发布的包,如 `dsh-host-apiproxy` 在 alpha.2 仍为 rc.2)与新增 controller devDependencies。
  - peerDependencies 增加 `|| ^0.1.2-alpha.2`,`dsh-client-runtime` 标记 optional。
- **SKILL/流程沉淀**:
  - 新增 `aux-review-verify`:外部 review 报告验证纪律(不盲信、分类、子代理交叉验证、自己跑关键命令)。
  - `aux-github-workflow` 补 token/凭据纪律与 PR review 后续修复流程。
  - `aux-dsh-follow` / `aux-patch-discipline` 补 DSH 版本兼容矩阵接入流程与当前未适配版本记录。

## 0.4.0(2026-08-22)— 平台化开关 + SKILL 模式 + 状态/UX 升级

- **工具/桥接三态开关**:`native` / `aux` / `compat`(compat 预留);关闭时工具从模型目录隐藏,桥接走原生;补丁不受开关影响。
- **SKILL 模式**:`native` / `audit` / `report` / `report-ondemand`;`report-ondemand` 支持 `includeOriginal` 取原文;`auto` 预留。
- **配置 schema**:新增 `aux.enabled`、`aux.skill.mode`、`aux.debug`(fullToolTrace / maxDebugEventBytes / debugEventsInHistory / redactSecrets),默认保守。
- **imageBridge 运行时门控**:补丁仍在,但 `imageBridge=native` 时不改写图片/不建硬链接。
- **内容真相/debug**:`fullToolTrace=true` 时,辅助调用写入 `aux/debug` 会话事件(ignorable,不进模型上下文);新增 `/aux debug [N]` 查看,并支持 `/aux debug <目标>` 跨会话读取(@this / session id / id 前缀 / cwd 片段)。
- **一键打补丁**:新增 `/aux patch` 命令(重跑 apply-patch + self-heal);设置页「平台开关」组提供“一键打补丁”按钮,通过 `/aux patch` 触发。
- **状态图标 UI / host→client 状态通道**:新增 `/aux status --json` 结构化状态(工具/桥接逐项 mode/state/reason/patch/action + 核心保护 + 事件记录 + restartRequired);设置页新增「诊断与修复」面板、状态点、补丁徽标与悬停原因。
- **设置页补丁状态展示**:每个工具/桥接显示可用状态与补丁状态;`unavailable` 项列出原因,可一键打补丁或提示配置。
- **重启生效提示**:运行中打补丁后,`/aux status --json` 返回 `restartRequired:true`;设置页「诊断与修复」面板显示“补丁已写入,重启 DSH 后生效”。
- **非标准安装路径补丁检测**:新增 `dsh-aux/src/bridge-locate.js`,统一用 `require.resolve` + 多级相对路径解析 DSH 包;修复源码树/自定义布局下 bridge 状态误报 `unknown` 的问题;`unknown` 文案改为“请运行 install.sh 或确认安装方式”。
- **一键安装全部补丁 + 结构化失败信息**:`/aux patch --json` 返回 `{ ok, restartRequired, steps[] }`;设置页按钮改为“一键安装当前 DSH 所需全部补丁”,失败时展示每个步骤的错误输出;补丁后自动刷新状态。
- **状态命令只读化**:`/aux status` 不再触发 `reconcileSessionImages`,避免持久化列表暂时不可用时状态查看变成删附件副作用。
- **状态图标最终交互**:`unavailable` 行可点击跳转到「诊断与修复」并高亮对应 issue;修复中显示 `fixing`;失败后保留 `unavailable` 并在 issue 内展示错误。
- **`/aux status` 统一重构**:人类可读输出改为消费 `collectPlatformStatus()`,消除两套状态推导,降低漂移风险。
- **低优先级打磨**:`configure` issue 改为可点击跳转对应设置组;任务字段/子代理字段补齐 `label htmlFor` + 控件 `id`;状态命令失败文案中英文化。
- **补丁未装强制 native**:补丁缺失时 `aux` 选项禁用,UI 显示“当前按 native 处理”,保存时也会把 `aux` 落成 `native`。
- **非命令状态通道**:新增 `aux/platform-status` 隐藏事件 + `aux-platform` 投影;设置页通过 `sessions.history` 只读读取状态,不再执行 `/aux status --json`,消除会话命令卡片污染。
- **子代理设置优化**:general / vision 分为独立卡片排版;子代理 general/vision 新增 `reasoningEffort`(思考强度)配置,并透传到子代理路由。
- **PR 前审查修复**:修复同进程打补丁后写入非 ignorable 事件的风险、强制 native 保存、任务 reasoningEffort 孤立、redactSecrets 开关、group 渲染等问题;新增 README 命令表与投影/路由测试。
- 测试基线更新为 305。

## 0.3.3(2026-08-21)— 设置页 UI 重构 + reasoningEffort + 双语

- **设置页 UI 重构**:分组可折叠卡片(工具任务 / 桥接任务 / 子代理 / 全局),每个任务两列网格布局。
- **思考档位(reasoningEffort)**:每个任务可配置;设置页下拉选项来自当前 provider/model 的 `reasoning.efforts`;`AuxLlmRequest` 支持 per-call 覆盖;不传则沿用 provider 默认。
- **字段级重置**:每个已覆盖字段显示「重置」按钮,一键回到继承默认。
- **中英双语**:设置页跟随 DSH 语言(zh/en)。
- 测试基线更新为 291。

## 0.3.2(2026-08-21)— DSH 0.1.1-rc.1 兼容

- **DSH 0.1.1-rc.1 源码适配**:从 `deepseek-ai/deepseek-harness` tag
  `dsh-v0.1.0-rc.8` → `dsh-v0.1.1-rc.1` 做源码级 diff,核心变化是
  session-projection 注册 API(`schema/view` → `stateSchema/wire`)。
  dsh-aux 的 `aux-status` 投影改为**双 API 兼容**(feature-detect
  `sessionProjections.stateOf`),rc.6/7/8 继续用旧形态,0.1.1-rc.1 用新形态。
- **版本判定修正**:`bridge/target.js` 的 `isRc7OrNewer` 现在能正确识别
  `0.1.1-rc.1`(旧实现只看 rc 号,会把 0.1.1-rc.1 误判为 rc.1 老版本);
  同时覆盖稳定 0.1.x/0.2.x 新线。
- **peerDependencies 扩展**:15 个 DSH 官方 peer 依赖从 `^0.1.0-rc.6` 改为
  `>=0.1.0-rc.6 <0.2.0 || ^0.1.1-rc.1`,同时覆盖 rc.6/7/8 与 0.1.1-rc.1。
- **doctor 版本检查**:支持范围更新为 rc.6 / rc.7 / rc.8 / 0.1.1-rc.1。
- **补丁验证**:在临时 0.1.1-rc.1 部署上 `apply-patch.mjs --dry-run`
  P1-P6/P11 全部锚点匹配;P7 append 块匹配;P8 白名单插入点存在;
  settings 补丁随版本判定跳过(rc.1 原生动态设置)。
- **保持 rc.6/7/8 兼容**:行为变化全部走 feature-detection,不破坏旧版。

## 0.3.1(2026-08-20)— /aux 子命令识别修复 + 新增溯源命令 + 技能预审桥接

- **修复 `/aux status` / `/aux history` 等带参子命令被当成普通聊天发送**。
  根因:DSH 客户端对"未声明 `input` 提示的裸命令"只认无参裸行
  (`/aux` 单独回车),带参整行 `matchEnter` 直接落空回默认输入槽。这是官方
  设计——`/goal`、`/plan`、`/preset`、`/echo` 等带参命令都通过声明
  `input: { hint }` 让 `desc.input !== undefined` 走 leading-claim 执行路径。
  现在 dsh-aux 注册 `/aux` 时补上了 `input.hint`(列出全部子命令),
  裸 `/aux` 与 `/aux <subcommand> ...` 均正确执行。
- 依据:`deepseek-harness/master` 的
  `packages/client/ui-commands/src/client/service.ts` `matchEnter` 判定表。
- **新增 `/aux history [N]` 与 `/aux history full [N]`**:把既有的事件溯源
  基础设施(AUX_CALL_EVENT 会话事件)显式暴露成命令——
  `history` 简要溯源(默认最近 10 次,新→旧),`history full` 全部溯源
  (完整字段:路由/耗时/降级/error/输入输出 chars/purpose)。与
  `/aux status` 里「每任务最新一次」互补。
- **技能预审桥接(skill-audit)**:新增 `skill` 辅助任务路由,配置
  `aux.tasks.skill.provider/model` 后,原生 `skill` 工具结果会被 `tools/post-execute`
  桥接拦截:辅助模型精读 SKILL.md + 当前任务上下文(显式 `task` 参数 + 会话最近消息),
  返回「如何应用 / 适用性评估 / 已知坑与🔻易腐烂旧断言 / 执行建议 / 置信度」预审报告。
  主模型同时看到原始 SKILL.md + 报告,可对照辩证审视;未配置 skill 辅助模型时
  native 直通不拦截;辅助调用失败时回退原生结果。
  配套补丁:`dsh-tool-skill` schema 增加可选 `task` 参数(新增 P11 维护债),
  设置页新增「技能预审 (skill)」区块,`/aux test skill` 可自检。
- **README 单一真相**:npm 发布用的 `dsh-aux/README.md`(.en)不再是第二份
  人工维护文档,改为仓库根 README 的**生成快照**——新增
  `scripts/gen-package-readme.mjs`(`prepack` 自动再生成,`--check` 供 CI),并
  加回归测试防漂移(285 项全过)。消除"两套 README"文档债。
- **DSH rc.7 升级适配 + 启动自愈**:本地升级 rc.7 后全量重打 P1-P8(P9/P10 rc.7
   原生跳过);修复 install.sh 包名校验正则、agent-loop patched 块缺 mark、
   apply-patch 单步/未写盘缺陷;新增 `bridge/self-heal.mjs`(symlink + 补丁 +
   白名单 aux/llm-call 幂等自愈)并接入 `~/dsh/start-dsh.sh`,npm 升级后重启即
   自愈,不再丢 symlink/补丁/自定义事件白名单。
- **推送前加固**:`install.sh` 现在会幂等把启动自愈 hook 写进 `start-dsh.sh`
   (标记+备份+`--no-start-hook`);`self-heal.mjs` 补 symlink 父目录 mkdir 与逐步骤
   容错;`apply-patch.mjs` 循环加 no-op 守卫;新增 `TESTING.md` 测试活文档。
- **GitHub 安装更新体验**:新增 `update.sh`(`git pull` + 重跑 `install.sh` 一键更新);
  新增 `scripts/doctor.mjs` 健康检查(部署根/symlink/profile/补丁/P7/P8/自愈 hook/版本兼容);
  `install-start-hook.mjs` 支持更多启动脚本写法(`dsh web`、`pnpm dsh web` 等);
  `self-heal.mjs` 在补丁锚点不匹配/无法自愈时输出醒目 ⚠️ 提示;`/aux status`
  在补丁缺失时顶部显示「请运行 ./update.sh」警告。
- **DSH rc.8 支持**:已完成 rc.8 实机升级与补丁验证(P1-P8/P11 全打,P9/P10 跳过);
  多版本支持矩阵见 `PROJECT.md` 的版本策略。

## 0.3.0(2026-08-17)— 子代理辅助模型桥接(subagent bridge)

- **透明接管原生 `subagent` 工具**:主模型看到的仍是 `subagent`,补丁在
  execute 里读取 `ctx.auxLlm.subagentRoute()` 并注入 `agentOptions` 与
  `toolFilter`。foreground / background / continuable 全部覆盖。
- **模式**:
  - `native`(默认):不拦截,原生行为;
  - `manual`:子代理统一用 `general` 模型;
  - `vision-aware`:任务需要视觉 → `vision` 模型,否则 → `general` 模型。
- **判定**:新增可选参数 `requires_vision`(`auto/true/false`);`auto` 用
  关键词启发式(可配置 `visionKeywords`),不确定时保守落到 `general`。
- **兜底链**:`prepareTools`(默认开)在子代理**已有 allow 白名单**时并入
  `vision_analyze` 等 AUX 工具(无 allow 则保持目录开放,避免过滤掉
  bash/read 破坏 Anchored/Standard bootstrap);子代理模型自己看图失败后可
  调用 `vision_analyze` → AUX 视觉辅助模型兜底。
- **设置页**:新增「子代理辅助模型」区块(mode / includeWorkflow / general /
  vision / prepareTools / visionKeywords)。
- **workflow 子代理桥接**:`dsh-workflow-worker-thread` 的 `startChild()`
  也读取 `ctx.auxLlm.subagentRoute()`(经 `subagentIncludeWorkflow` 门控),
  让 `workflow` 里 `agent()` 批量扇出的并行子代理同样走
  native / manual / vision-aware;显式 `agent(prompt,{provider,model})`
  优先于 AUX 路由。`/aux status` 新增独立 `workflow-bridge` 状态。
- `retryVisionWithAux` 作为保留配置(schema 已留,暂未暴露到设置页,功能后续实现)。
- **零系统提示词改动**:不注入系统提示词,兼容极简 / Anchored Standard。
- `/aux status` 显示 `subagent-bridge` 与 `workflow-bridge` 模式与补丁状态。
- 新增 `src/subagent-route.js`(纯函数)、`src/subagent-bridge.js`(补丁检测)、
  `tests/subagent-route.test.js`;`bridge/apply-patch.mjs` 新增
  `dsh-tool-subagent` 两个补丁目标(schema + request)与
  `dsh-workflow-worker-thread` 一个补丁目标(startChild)。

## 0.2.0(2026-08-17)— 视觉路由策略开关

- **forceAuxVision(设置页开关,默认关)**:开启后,即使主模型原生支持图片,
  image-bridge 也会把图片改写为 `vision_analyze`,统一走 AUX 视觉辅助模型。
  适合“主模型很贵、辅助视觉模型更便宜/更合适”的用法。
- **visionFallbackToMain(设置页开关,默认开)**:关闭后,视觉辅助模型失败时
  直接失败,不再回退到主模型(避免纯文本主模型回退后同样失败、或用户不想
  用昂贵主模型跑视觉)。
- **image-bridge v3 升级**:`apply-patch.mjs` 支持从旧 v2 自动升级到
  `forceAuxVision` 版本;`/aux status` 的 `v3` 同时覆盖模型切换与强制视觉。
- 新增 `forceAuxVision` / `visionFallbackToMain` 两个配置字段并同步到设置页。

## 0.1.9(2026-08-17)— image-bridge v3:含图会话可切换纯文本模型

- **修复模型切换**:含图片的会话无法切换到纯文本模型(`selectModel` 拒绝
  `inputModalities` 不含 image 的新模型)。根因是 DSH 旧门控不知道 dsh-aux
  的 image-bridge v2 已在模型输入边界把图片改写为 `vision_analyze` 路径文本。
- **补丁新增第三目标**:`bridge/apply-patch.mjs` 现在同时打
  `dsh-host-apiproxy selectModel`,移除“图片会话必须选图像模型”的旧门控。
- **避免错误绕过**:不要再通过“给纯文本模型强行标记 image 能力”来切换;那会让
  bridge 误以为模型原生支持图片,把 image block 原样发给真实不支持的模型,
  导致供应商 `429 invalid_request_error`。
- **状态上报**:`/aux status` 的 image-bridge 状态升级为 `v3`,并区分
  `v2`(旧 bridge 已装但切换仍受限)与 `v3`(切换已放开)。
- 新增 `bridge/orig-select-model-block.txt` / `bridge/patched-select-model-block.txt`;
  测试保持全绿(106 项)。

## 0.1.8(2026-08-16)— 低/中优先级质量加固

- **路由可观测性**:无路由失败也会记录 `aux/llm-call` 事件;`shouldFallback` 从死代码变为实际使用。
- **自定义任务**:`registerTask` 注册的任务现在出现在 `/aux status`,并可通过 `/aux model` 查看(写入仍不支持)。
- **压缩引擎**:
  - `compressWithPlan` 支持透传 `singleCallMaxChars` / `maxRounds` / `maxSegments`;
  - `maxRounds < 3` 时自动禁用分层压缩;
  - `maxOutputChars` 强制正整数;
  - 单行超长文本保持完整行,不再因硬切破坏 `\n` 重组。
- **抓取与视觉**:
  - 非 OK/异常路径统一释放 HTTP body;
  - `vision_analyze` 多图改为 allSettled,单图失败不再丢弃全部结果。
- **图片生命周期**:
  - `session-images.json` 所有写盘(含 cleanup 整体读改写)串行化;
  - GC 增加 `lstat` 复核,降低符号链接 TOCTOU;
  - `onSessionDisposed` 改用显式 shutdown 标志,批量删除不再被误判为关机。
- **测试稳定性**:固定 sleep 改为轮询等待;新增 15 项回归测试;总测试 161 项。
- **安装器与补丁加固**:
  - 新增 `bridge/target.js`,统一校验补丁目标必须位于 `node_modules/@deepseek-ai/.../lib/index.js`,防止相对路径逃逸写入任意文件;
  - `install.sh` 增加 profile 名与包名白名单校验,补丁写入改为位置参数传递,消除 heredoc 注入;
  - `imagePath` 明确依赖宿主 `fs` 服务的路径沙箱,插件层不重复实现/绕过该边界;新增 2 项边界测试,验证插件始终使用 `fs.resolve` 的结果且不绕过宿主拒绝。

## 0.1.7(2026-08-16)— compress_text 场景化压缩与质量加固

- **场景感知**:自动识别代码/日志/文档/通用,支持 `mode` 软提示与 `preserve` 结构化保留规则;混合内容走增强版通用模式。
- **输出预算**:新增 `maxOutputChars` 参数,优先于 `targetRatio` 控制输出大小。
- **多轮/分层压缩**:超长输入自动分段压缩后合并;超过 200K 字符自动启用“骨架→精炼”分层压缩;单段失败自动重试/再切分,仍失败保留原文并标记 `degraded`。
- **压缩元数据**:返回 `strategy`、`confidence`、`rounds`、`segments`、`degraded`、`warnings`。
- 输入安全上限提升到 500K 字符;新增 30 项 compression 测试。

## 0.1.6(2026-08-16)— 安全加固与源码拆分

- **SSRF 防护(默认开启)**:`web_extract` 与 `vision_analyze` 的 `imageUrl` 现在默认
  拒绝内网/环回/云元数据地址(`localhost`、`127.0.0.1`、`10.x`、`192.168.x`、
  `169.254.169.254`、`*.local` 等),且只允许 `http/https`;新增插件配置
  `allowInternalUrls: true` 可显式放行本机/内网抓取。新增 DNS 解析检查,
  可拦截 `localtest.me` 这类解析到内网地址的绕过手法;原生 fetch 回退路径
  改为手动跟随重定向,每一跳在发出请求前都做 SSRF 校验。
- 维护定时器改为 `unref`,避免测试进程被 5 分钟对账定时器挂住无法退出。
- **Prompt 注入缓解**:`web_extract` / `compress_text` 的系统提示明确将网页正文与
  待压缩文本视为不可信数据,禁止执行其中嵌入的指令;`guideText` 文档标注为受信任
  插件配置,只应从可信来源复制。
- **并发硬上限**:每个任务的 `maxConcurrency` 即使配置得更大,实际按 **10** 封顶,
  避免误配导致对辅助模型并发轰炸。
- **源码结构拆分**:`src/index.js` 从约 2000 行降到约 570 行,只保留 Service 装配与
  路由调度;配置/事件/投影/Bootstrap/命令/抓取/工具/图片生命周期/桥接拆分到独立模块,
  并补充源码结构文档,方便社区贡献者定位。
- 测试增至 100 项(aux)。

## 0.1.5(2026-08-16)— 命名空间脱敏、文档双语与隐私改进

- **包名去官方化**:从 `@deepseek-ai/dsh-aux` 改为 `@dolorescaritasangelus/dsh-aux`,避免冒充 DeepSeek 官方命名空间;同步更新 client 插件 id、文档、bridge 路径解析与测试
- **Git 历史脱敏**:重写全部提交,移除本机绝对路径;GitHub 历史与 tag 已强制更新
- **文档体验**:重写根 README 与插件包 README,新增英文版与中英文切换;加入 AUX 可爱向自我介绍与 SeekMaid 桌宠形象图;增加 TOC、FAQ、相关项目
- 修正安装方式说明:未发布 npm 时使用 `file:` 本地源码安装,移除不可用的 `git+https://...` 直装命令
- 修复 `bridge/` 脚本硬编码本地绝对路径,改为按部署形态相对解析;新增 `bridge/NOTICE`,为 DeepSeek Harness 原始代码摘录补充 MIT 声明
- **隐私改进**:设置页新增「在对话界面显示辅助模型状态芯片」开关;关闭后注销 `aux-status` 投影,不再向 Web/第三方暴露。`aux-status` 投影数据最小化,仅保留 `task / ok / fallbackUsed / durationMs`,不再暴露 provider/model/errorCode/inputChars/outputChars

## 0.1.4(2026-08-16)— 压缩桥接图片降级与 Bootstrap 预设引导

- **修复 `/compact` 与自动压缩在含图会话中因图片不可用而失败**:
  压缩回放消息中的 image block 若附件对象已被 GC/清理(读回报
  `Attachment object is missing.`),或所有可选压缩路由均不支持图片输入,
  dsh-aux 现在会把图片降级为文本占位后继续交给 AUX 压缩
  - 路由支持图片且附件可读时,image block 原样保留,视觉信息仍可进入摘要;
  - 附件缺失/损坏或候选路由纯文本时,以 `[图片: name (type, WxH) — 未纳入压缩摘要]`
    占位,避免整个压缩任务失败
- 新增 2 项回归测试(图片附件缺失降级、候选路由均不支持图片时直接文本化)
- **Bootstrap 预设(极简 / Anchored Standard)引导**:
  - **首轮绝不注入任何 AUX 上下文/提示词**(包括含图首轮),保留极简 / Anchored
    Standard 对 V4F/V4P 的锚定;
  - **极简模式**:首个持久 `tool/call` 前,dsh-aux 从 assembled 工具目录中过滤掉
    自己的三个工具(`vision_analyze` / `web_extract` / `compress_text`),保持极简
    两工具暴露;首个 `tool/call` 后目录开放,AUX 工具出现,并与 Anchored Standard
    一样通过 `agent/pre-step` 注入一次晋升提醒;
  - **Anchored Standard**:首个持久 `tool/call` 后目录开放,通过 `agent/pre-step`
    注入一次提示:“首轮 AUX 工具不可用;后续看图请直接使用 vision_analyze,
    不要创建子代理”;
  - systemPrompt 的 `aux:tools-guide` 在 complete persona 下本就不生效,因此改用
    pre-step 通道覆盖 Minimal / Anchored Standard。
- 新增 4 项回归测试(引导逻辑、minimal 首轮过滤/晋升后开放、pre-step 实际注入一次、首轮含图也不注入)

## 0.1.3(2026-08-16)— 会话压缩桥接与事件检测修复

- 新增 `compaction` 辅助任务:设置页与 `/aux model compaction` 可配置专用会话压缩模型
- 新增 compaction-bridge:配置 `compaction` 任务后,原生 `dsh-compaction-basic`
  的摘要调用改走 `ctx.auxLlm`,复用 AUX 的超时/并发/冷却/降级/事件记录
- 修复场景:会话含图片、摘要模型被路由到纯文本版本时,自动/手动压缩不可用
- `ctx.auxLlm` 请求支持可选 `tools`,供 compaction bridge 回放工具 schema
- `/aux status` 显示 compaction-bridge 状态
- compaction-bridge 失败时不再 fallback 到原生摘要,直接抛出 AUX 真实错误
  (AUX 调用内部已包含主模型 fallback,二次 fallback 只会掩盖根因)
- 文档注明原生 `dsh-compaction-basic` 为单次全量摘要;超大输入请调大
  `compaction.timeoutMs`(实测 shadowed 449K tokens 可单次成功)
- **会话事件白名单冲突**: 持久化读链(KNOWN_SESSION_EVENT_TYPES)拒绝
  白名单外的插件自定义事件(含 `aux/llm-call`),带该类事件的会话历史整体
  加载失败。`bridge/patch-session-ignorable.mjs` 补齐 dsh-session `append`
  的 `ignorable` 写入入口(官方 SessionEvent envelope 预留通道)+ 白名单
  放行旧日志;dsh-aux 的事件均以 `ignorable: true` 标记写入
- **传播性保护**: 未打 dsh-session ignorable 补丁的部署(GitHub 直接装插件)
  自动检测并在缺补丁时**降级不写事件**(+ 一次警告),防止无标记插件事件
  污染会话日志导致历史不可读;`/aux status` 显示「会话事件记录」状态
- **修复事件记录检测失效**: `_sessionEventsSupported()` 的候选路径原为
  `../dsh-session`(从 src/index.js 只到 dsh-aux/ 目录,永远解析失败),
  导致重启后所有 `aux/llm-call` 事件写入被永久降级禁用。现改为
  `sessionPatchCandidates()` 多候选检测(symlink 部署 / realpath 源码树 /
  上级 node_modules),任一候选命中补丁标记即启用;新增 3 项回归测试
- **修复 vision 等调用事件被静默丢弃**: 未传 `purpose` 的任务(如 vision)
  写入的事件 data 含 undefined 字段,dsh-session 的 JSON 快照(walkJsonValue)
  拒绝任何 undefined 属性值 → append 抛错被吞 → 事件丢失。现于事件构造前
  剥离 undefined 字段,防御所有调用方;新增回归测试
- 测试增至 81 项(aux)

## 0.1.2(2026-08-15)— 多图与修复

- vision_analyze 支持多图并行(images 数组,受任务并发信号量约束)
- **修复 image-memory 并发写竞态**:多图并行时 read-modify-write 丢条目(实测 5 丢 4),改为串行队列,新增回归测试
- 主 agent 引导段(aux:tools-guide):直接用 vision_analyze,不建子代理(guideText 可覆盖/禁用)
- vision prompt 增加 GIF 动画条件引导(不虚构静态图动作)
- COMPARISON.md 重写为最终结论版(移除过程性内容)

## 0.1.1(2026-08-15)— 修复与体验

- 修正文档:平台压缩/剪枝组件实为自动触发(高水位),无需手动启用
- vision_analyze 工具描述:同一图片相同问题可复用之前结果,避免重复分析
- settings 动态暴露机制说明、image-bridge 集成组件定位

## 0.1.0(2026-08-15)— 正式版

- 自 0.1.0-rc.6 转正;功能不变,修复归属缓存覆盖 bug、gc-images 符号链接防逃逸
- image-bridge 集成为安装组件(install.sh 一键),/aux status 显示其状态
- 文档完善:README 面向用户重写、AI.md 安装指南、CONTRIBUTIONS.md 致谢

## 0.1.0-rc.6(2026-08-15)— 初始版本

- 统一辅助 LLM 路由服务 `ctx.auxLlm`:任务分派、路由解析(显式配置 > 任务默认 > 主模型)、
  超时(默认 60s)、并发信号量(默认 2)、失败冷却(3 次/60s)、主模型降级、聚合错误 `AuxCallError`
- 三个辅助任务工具:`vision_analyze`(focus-hint 意图感知,question 必填)、
  `web_extract`(HTML 清洗 + 无 web provider 时回退全局 fetch)、`compress_text`
- 事件溯源:每次调用写 `aux/llm-call` 会话事件 + `aux-status` 投影
- `/aux` 命令:status / model / gc-images / vision / test / memory
- client 设置页 + composer 状态 chip(仅列 active 供应商)
- 会话图片生命周期管理:归属记录(session-images.json)+ 事件驱动清理 +
  冷会话定时对账 + 手动 GC;共享引用保留、归档不误删;图片记忆(image-memory.json)
- 图片能力门:发起前查 `resolveModelInfo`,空模态视为未知放行
- 测试:63 项(aux)+ 4 项(bridge 逻辑),node:test 零依赖
- 文档:PRD / README / AI.md(面向 AI 安装代理)/ CONTRIBUTIONS.md / COMPARISON.md /
  SESSION-ATTACHMENT-GC.md / VISION-AGENT.md

### 配套(仓库 bridge/ 目录,独立于插件本体)

- image-bridge v2:纯文本主模型粘贴图片可用且 UI 保留缩略图(两段式:admit 保留
  image block,agent-loop 模型输入边界按模态改写),幂等安装/回滚
- settings 白名单补丁:设置页可写 aux 配置
