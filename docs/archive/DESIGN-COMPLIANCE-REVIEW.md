# web_extract / web_crawl 设计意图符合度审查

> 审查对象:dsh-aux 插件。基线测试全量通过(`node --test tests/*.test.js` = **247 通过,0 失败**)。
> 本文逐项比对 `WEB-EXTRACT-REVIEW.md` 与 `WEB-CRAWL-DESIGN.md` 的决议与实现。
> **注(后续修订)**:本表基于修复前代码。其主发现 **P0-a**(followLinks 双引擎、未委托
> `crawlSite`)及 M1/M3、L1–L5 已在后续修复中落地——`crawlPages` 已删除,`followLinks`
> 现直接委托 `crawlSite(scope:"same-origin")`,与 web_crawl 共享 robots/限流/预算。
> 见 `WEB-EXTRACT-REVIEW.md`「第二轮:线上验证 + 3 并行子代理复核」。

---

## 一、web_extract 项对照表

| 设计项 | 设计决议(来源) | 实现状态 | 评价 |
|---|---|---|---|
| **H1** seam 能力探测 + 窄匹配回退 | 先 `typeof service.ctx?.web?.fetch === "function"` 能力探测;失败只在无可用 provider 时回退;回退匹配必须窄(`no usable web provider`)以免吞掉自家报错 | `crawl/fetch-page.js:104` 先做 `typeof webFetch === "function"`;`isProviderUnavailable`(58-65)用 code(`WEB_PROVIDER_UNAVAILABLE/CONFIGURED_MISSING/AMBIGUOUS`)+ 精确文本 `no usable web provider` 窄匹配;非 provider 失败直接 `throw`(150 行) | ✅ 完全落地;精确窄匹配,F1/H1 回归测试覆盖 |
| **H1a** seam 报错读 `this`(线上解绑 bug) | seam fetch 依赖 `this.fetchProviders`,不能解绑裸调 | `fetch-page.js:108` 用 `webFetch.call(web, {...}, signal)` 保持 receiver;`web-extract-fixes.test.js:337` 有「防解绑回归」用例(断言 `this.fetchProviders`) | ✅ 已修复并有回归锁 |
| **H2** provider 路径逐跳 SSRF | 缺 `finalUrl` 拒绝;`finalUrl` 复审 SSRF;provider 返回 3xx 视为未解决重定向,交给 `fetchWithSsrf` 逐跳重跟随;`body` 形状防御;残余「provider 自动跟随内网后谎报 url」为可信边界,文档化 | `fetch-page.js`:缺 url 拒绝(123-125)、`result.url` 复审(126)、3xx 走本地逐跳(113-119)、body.kind 防御(127-130) | ✅ 落地;H2 三个测试用例补齐(缺 url / 3xx 重跟随 / 3xx 重跟随到内网被拒) |
| **H3** 码点边界截断 | `truncateByChars` 按码点截断不切代理对;`readTextCapped` 流式(码元阈值中止 + 最终码点截断);flush decoder | `crawl/text.js` 两函数都按码点;`fetch-page.js:31-52` 流式读取 + `decoder.decode()` flush(49 行) | ✅ 落地;码点/代理对/空串测试齐全 |
| **M1** maxChars 配置面 | `args.maxChars ?? 合并配置 ?? 默认 8000`,仅 `web_extract`/`web_crawl` 允许该键 | `route.js`:`DEFAULT_MAX_CHARS=8000`、`resolveConfig` 仅这两任务放行 `maxChars`(59 行)、`mergeTaskConfig/taskMaxChars`;`config.js` 设置 schema 声明;`web-extract.js:33-39` 三优先级解析 | ✅ 落地;resolveMaxChars 测试齐全 |
| **M2** chars/truncated 元数据 + 统一截断 | 输出加 `truncated`/`chars`(码点数);移除双重截断 | `web-extract.js` 单页(`chars`/`truncated`)与递归(`pages[].chars/truncated` + 顶层 `truncated`);`register.js` schema 同步 | ✅ 落地;注册 schema 含字段说明 |
| **M3** SUMMARY/KEY POINTS 分节解析 + 兜底 | prompt 分节输出(中英标签都收),`extractKeyPoints` 分节解析 + 旧 bullet 启发式兜底 | `prompt.js:139-185`:分节(SUMMARY/总结/摘要 + KEY POINTS/要点/关键点)→ 兜底启发式(165-184) | ✅ 落地;中文标签/内联/无 KEY POINTS/兜底用例齐全 |
| **H5** 数据块(nonce)+ Question 分离 | 页面正文包进随机 nonce 的 `<<<UNTRUSTED PAGE DATA…>>>…<<<END…>>>`,与 Question 物理分离;提示重申数据块内指令无效 | `prompt.js:100-132`(`wrapUntrustedPageData` 带随机 nonce,`webExtractUserMessage`/`Multi` 把问题放数据块外);系统提示(80-83)声明 | ✅ 落地;H5 注入结构测试齐全;多页各页独立数据块 |
| **F1** followLinks / maxPages / maxDepth | 同源 BFS、去重、扩展名/协议过滤、每页每跳 SSRF、maxChars 累计预算;输出 `pages/totalChars/truncated`;单页语义不变 | `web-extract.js` 现**委托 `crawlSite(scope:"same-origin")`**(`crawlPages` 已删除);`register.js` 参数/schema;F1 全流程、maxDepth、累计预算测试 | ✅ 功能落地(见修订注:已从独立引擎改为委托共享引擎) |
| **F2** 局限文档(静态 HTML/不执行 JS) | README(中/英)明示能力边界 + 递归预算说明 | `README.md:108-116`、`README.en.md` 均有「不执行 JS、静态 HTML 摘要代理」 | ✅ 落地 |

---

## 二、web_crawl 项对照表(含 §8 拍板项)

| 设计项 | 设计决议 | 实现状态 | 评价 |
|---|---|---|---|
| **P0** 共享抓取核心,禁止代码漂移 | `fetchPage`(seam-first+SSRF+码点截断)、`extractPageLinks`、BFS/去重/预算抽到 `src/crawl/`;**web_extract 的 `followLinks` 委托 web_crawl 的 `scope:"same-origin"` + 聚合模式**(行为与现在一致,全量测试绿) | 抽到 `src/crawl/text.js/fetch-page.js/queue.js`;`followLinks` 现**直接委托 `crawlSite(scope=="same-origin")`**,唯一爬取引擎(发布前版本曾保留独立 `crawlPages`,已删除) | ✅ 已修(见修订注):单引擎,符合「禁止代码漂移」 |
| **P1** scope same-origin/hosts | §8①:`domain`(PSL)推迟;v1 = `same-origin` + `hosts` 白名单,种子须在 hosts 内 | `crawlSite`(166-196):`hosts` 要求种子 host 在名单内(187-189),规格上 `domain` 走同源兜底;`runWebCrawl` 显式拒绝 `domain`(83-85) | ✅ 公共入口落地;见**发现 P0-b**(`crawlSite` 自身对未知 scope 不防御) |
| **P1** respectRobots 默认开 + 乐观失败 | §8②:默认开启;失败/缺失 robots 按“允许”处理;robots 解析错误不阻断整站 | `queue.js:100,221-227`(`respectRobots !== false` 默认 true;404/失败 `RobotsPolicy([])` 乐观放行);被拒路径 `skippedByRobots` | ✅ 落地;robots 404/拒绝测试齐全 |
| **P1a** robots 被劫持为 HTML(线上 bug) | HTML 响应视为「无可用 robots 策略」(乐观放行),不作为全站 Disallow | `fetchRobots`(86-107):`text/html` 或文本里出现 `<html/!doctype/body/head>` → 返回空策略 | ✅ 已修复并有回归测试(web-crawl.test.js:120) |
| **P1** minIntervalMs(默认 250) | 每主机两次请求最小间隔 | `crawlSite`(301-307)按 `host` 记 `lastAt` 并 sleep | ✅ 落地 |
| **P1** 各类预算 | `maxPages`(10)/`maxDepth`(2)/`maxCharsPerPage`(8000)/`maxTotalChars`(缺省推导 `maxPages×perPage`)/`maxSeconds`;全程传播 signal 可中止 | `crawlSite`(167-181,198,219,271):预算解析、`totalBudget` 推导、deadline、`signal` 传 `fetchPage` | ✅ 落地;`maxPages`/`maxDepth`/累计预算/`maxSeconds` 均有处理 |
| **P1** isConcurrencySafe=false | §4:web_crawl 必须返回 false,或严格受控并发 | `register.js:132`:`isConcurrencySafe: () => false` | ✅ 落地;测试断言(web-crawl.test.js:249) |
| **P1** 输出 pages/fetched/skipped/blocked/warnings | §3:`skipped` 含 robots/scope/扩展名/去重,`blocked` 为 SSRF/HTTP 错误;`warnings` 汇总 | `crawlSite` 返回 `skippedByRobots/Scope/HostCap/blocked`;`web-crawl.js:196` 汇总 `skipped`、135-139 生成 `warnings` | ✅ 落地;注册 schema 逐字段声明 |
| **P2** 模式 A/B | 模式 A 一次聚合;模式 B `perPageSummaries:true` 每页一次 → 一次聚合;`mode` 标注 `aggregate`/`per-page` | `web-crawl.js:146-184` 分支;`perPage`/`mode` 输出;成本=每页+1 次调用 | ✅ 落地;A/B 测试齐全(N 次 + 1 聚合) |
| **P2** perPageConcurrency | §8⑤:默认固定 1(顺序),后续再放开受限并发;§4 与 isConcurrencySafe=false 二选一兜底 | 默认 1,暴露 `perPageConcurrency` 参数;`runWithConcurrency`(58-71)有界并发池,**只并发辅助 LLM 调用,不并发网络抓取**(网络仍在 crawlSite 顺序 BFS) | ✅ 与 §4“或”分支一致且安全(并发不放大网络扇出) |
| **P2** sitemap 语义(嵌套 index 跳过 / 跨域计入 skipped) | §2.6 + P2:v1 不递归 sitemap index;跨域 loc 计 skipped | `seedSitemap`(233-268):`.xml/.gz` 跳过(252)、`matchAllowed` 不符计 `skippedByScope`(259-262),作为 depth-1 入队 | ✅ 落地;三个 sitemap 测试(补种/默认不请求/嵌套+跨域)齐全 |
| **P4a** seedUrls / maxPagesPerHost | P4(部分):seedUrls=额外 depth-0 种子(SSRF+scope 过滤);maxPagesPerHost 每站封顶,超额计 `skippedByHostCap`/warnings | `crawlSite` 种子入队(203-209)、SSRF 在前(web-crawl.js:112)、scope/robots 门控;`maxPagesPerHost`(294-299)计 `skippedByHostCap`,`web-crawl.js:138` 写 warnings | ✅ 落地;P4a 六条测试齐全 |
| **P4(延后)** domain/PSL、headless/渲染、web_search 联动 | 明确延后,需单列设计;`render` 位预留 | README/设计稿写明延后;seam 未实现 `render` | ✅ 按决议延后(不算未落地) |
| **P3** 设置页 / 命令 / 文档 | 设置页 `web_crawl` 块、TASK_LABELS「站点抓取」、`/aux test web_crawl`、README | `config.js:49-55`(schema)、`TASK_LABELS.web_crawl="站点抓取"`、`client.js:86/227`(设置页)、`commands.js:235`(`/aux test web_crawl`)、README 中/英 | ✅ 全部落地 |

---

## 三、发现项(偏离 / 未防住 / 设计稿自身问题)

### 设计意图被误读 / 部分偏离

**P0-a ⚠️「禁止代码漂移」只实现了一半(`crawlPages` 与 `crawlSite` 并存)**
设计 §2.1 明确要求 web_extract 的 `followLinks` **委托 web_crawl 的 `scope:"same-origin"` + 聚合模式(行为与现在完全一致)**。实现里 `web-extract.js:96` 调用的是 `crawlPages`(`queue.js:129`),一个与 `crawlSite` 并行的独立 BFS 引擎,而不是 `crawlSite({ scope:"same-origin" })`。fetch/文本/重定向层确实共享了,但**队列/去重/累计预算/深度遍历的逻辑在两处重复**。更值得注意的是:**`crawlSite` 有 robots/minInterval/maxPagesPerHost 等礼貌与预算能力,`crawlPages` 全部没有**。因此同样是从种子 URL 开始的同源 BFS,`web_extract.followLinks` 与 `web_crawl` 的站点礼貌行为不一致。
- 影响:行为等价(测试绿),但设计「委托同一引擎、防漂移」的意图未完全落地;且升级 `web_crawl` 打磨某个能力时,容易忘记把 `web_extract.followLinks` 同步一遍。
- 建议:让 `web_extract.followLinks` 真正走 `crawlSite(scope:"same-origin")`(可加一个 `label:"web_extract"` 参数保留错误语义 + 输出 `rateLimit:false`),删掉 `crawlPages` 或在 `crawlPages` 之上封一层 `crawlSite` 的 same-origin 简化调用。

**P0-b ⚠️ `crawlSite` 自身对未知 scope 不防御**
`runWebCrawl` 在公共入口拦掉了 `domain`/非法 scope,但 `crawlSite`(`queue.js:185-196`)对传入 `scope:"domain"`(或任意非法值)会静默当作 same-origin——`allowedHosts` 保持 null 走同源。若将来有第二调用方绕过 `runWebCrawl` 直接调 `crawlSite`(如 web_extract 委托路径),`domain` 语义会被静默吞掉、不会报错。属「别入口防御、引擎不防御」的低危不一致,与 H1 强调的「防御不留死角」同思路,建议在 `crawlSite` 对 scope 取值做一次白名单校验。

### 同类残余风险(以两个已修 bug 为线索)

**C-1 ⚠️ web_extract.followLinks 与 web_crawl 的双 BFS 被授予了不同的并发/礼貌语义**
- `web_crawl`:`isConcurrencySafe=false` + `crawlSite` 内 `minIntervalMs` 限流,防单域扇出(README 明示)。
- `web_extract.followLinks`(同源 BFS,可一次拉 maxPages=3 页):`isConcurrencySafe:true`(`register.js:81`),且 `crawlPages` **无 robots、无 minIntervalMs、无每主机封顶**。
- 风险:在池内并发的场景下,多个 web_extract.followLinks 可对同一源同时扇出,且该路径**完全绕过 robots**。这正是 WEB-EXTRACT-REVIEW Low #14 指出的「无速率/按域并发策略,isConcurrencySafe:true 允许对单域扇出」——F1 把 BFS 加进了 web_extract,却**没有把 web_crawl 造的礼貌能力还给 web_extract**,等于把 Low #14 从「单页」扩散到了「同源递归」。这与“robots/限流只在一条路径生效、另一条平行路径裸奔”属于和 robots-hijack 同类的不对称防护。
- 建议:让 web_extract.followLinks 也走 `crawlSite` 的限流/robots(随 P0-a 一并解决),或至少把 followLinks 的 `isConcurrencySafe` 降为按调用方可控、并加 `minIntervalMs` 默认。

**C-2 ℹ️ robots 防护仅存在于 `crawlSite`;`crawlPages`(web_extract.followLinks)不读 robots**
同上:robots 只在 web_crawl 生效。若语义上「summary 代理优先抓全」可接受,则建议在 README/`web_extract` 描述里明示“followLinks 不遵守 robots”，避免与 web_crawl 行为不一致造成误解。

**C-3 ℹ️ sitemap/robots 请求不被 `minIntervalMs` 覆盖**
`crawlSite` 的 `seedSitemap`(`fetchWithSsrf` 抓 sitemap.xml)与 `fetchRobots`(robots.txt)都属于对 origin 的真实网络请求,但都不经过 `lastFetchByHost` 限流(它们发生在第 289 行的 politeness 检查之前)。单看单次 crawl 影响很小(每源各 1 次),但严格按「每主机两次请求最小间隔」的口径这是个小缺口。低危。

**C-4 ℹ️ robots 读取的截断边界**
`fetchRobots` 用 `readTextCapped(…, 16_384)` 读取,再对(可能截断的)文本做 HTML 判定。极端情况下一个 >16K 码元的**纯文本** robots 若前部不含 HTML 标记、后半段含有,会被当作 robots 解析而非 HTML——但那是乐观放行方向(不产生误封),属安全侧;且真实 robots.txt 远小于 16K。仅记录,不构成风险。

### 设计稿自身的遗漏 / 矛盾(供下一版修订)

1. **§2.1 的“委托”与“共享核心”措辞不一致**:一面说“web_extract.followLinks 委托 web_crawl 的 same-origin 聚合”,一面又说“共享核心 + 新工具落下,不复制抓取逻辑”。实现选择了一条“共享 fetch 层、双 BFS 引擎”的折中,而这正好落在两段措辞的灰色地带。设计稿没有把「同源 BFS 是否也由 crawlSite 承担」写死到能约束实现的程度——建议下一版明确:同源 BFS 也必须由 `crawlSite` 承载,`crawlPages` 删除。
2. **没定义 web_extract.followLinks 的站点礼貌语义**:设计只对 `web_crawl` 提 robots/`minIntervalMs`/`isConcurrencySafe=false`,漏了 web_extract.followLinks(同样是 BFS)该不该有 robots/限流。这直接造成发现 C-1。
3. **`perPageSummaries` 的 `totalChars` 语义**:设计 §3 输出里 `totalChars` 写的是抓取侧总量;实现模式 B 里 `totalChars` 被覆盖为“逐页摘要码点之和”(聚合调用输入)。逻辑自洽且 README 有说明,但设计稿未写清模式 B 下 `totalChars` 是指“抓取字符”还是“送模型的字符”,容易造成前后不一致。属措辞遗漏。
4. **`maxChars` 复用语义**:设计 §5 说 web_crawl `resolveConfig` 允许 `maxChars`(复用 M1 配置),但没说它到底当**单页预算**还是**总预算**。实现取 `web_crawl.maxChars` 作 `maxCharsPerPage` 默认(web-crawl.js:37),README 也这样定义。合理,但设计稿没锁死,算轻度歧义。

---

## 四、结论

- **web_extract 的 H1/H2/H3/H5/M1/M2/M3/F1/F2 全部按决议落地**,且每个关键分支都有回归测试锁证;两个已知 bug(seam `this` 解绑、robots 被劫持为 HTML)已修复并有回归用例,未发现这两个类别的遗漏点。
- **web_crawl 的 P1/P2/P3/P4a 及 §8 拍板项全部落地**,`isConcurrencySafe=false`、robots 默认开、sitemap 语义、seedUrls/maxPagesPerHost 均有测试。
- **主要偏离**是 P0 的“禁止代码漂移 / followLinks 委托同一引擎”只做了一半:`crawlPages` 与 `crawlSite` 两套 BFS 并存,使 web_extract.followLinks 缺失 robots/限流,且仍标 `isConcurrencySafe:true`——这是目前最值得跟进的一处(发现 P0-a/C-1)。
- 次要问题:`crawlSite` 对未知 scope 不防御(P0-b)、sitemap/robots 请求未纳入 `minIntervalMs`(C-3)、模式 B 下 `totalChars` 语义设计稿未写清。

(审查过程未改动任何代码与测试;全量基线 247 通过。)

---
*本次审查基于真实代码(`src/crawl/text.js`、`fetch-page.js`、`queue.js`、`tools/web-extract.js`、`tools/web-crawl.js`、`tools/register.js`、`prompt.js`、`fetch.js`、`url-policy.js`、`route.js`、`config.js`)与测试(web-extract-fixes / web-crawl / aux)。*
