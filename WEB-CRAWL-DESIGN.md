# web_crawl 设计稿(深度站点抓取)

> 状态:方案待审。承接 `WEB-EXTRACT-REVIEW.md` 的 **F1/F2**:web_extract 已落地
> 同源 BFS(`followLinks: "same-origin"` + 聚合摘要);web_crawl 把它升级为**独立
> 的深度站点抓取工具**——更宽的范围、每页粒度、站点礼貌与预算、渲染 provider 边界。

## 1. 背景与定位

- **web_extract 现状**:单页摘要;`followLinks:"same-origin"` 做同源 BFS + 一次
  聚合摘要 + `pages` 元数据。它是**摘要代理**,不是通用抓取器。
- **web_crawl 目标**:从种子 URL 抓整个文档站/仓库文档集,产出**结构化站点视图**
  (页面清单、每页/整体摘要),供知识库、索引、问答直接消费;支持跨站点白名单、
  robots/礼貌、预算、渲染型页面。
- **与 web_search 的分工**:`web_search`(dsh 原生)= 检索→链接列表;
  `web_crawl` = 从种子 URL 出发深度抓取。未来可把 web_search 结果作为种子喂给 crawl
  (见打开问题)。

## 2. 核心决策

1. **共享抓取核心,禁止代码漂移**:web_extract 的 `fetchPage`(seam-first + 逐跳
   SSRF + 码点截断)、`extractPageLinks`、BFS/去重/预算逻辑**抽出**到独立模块
   (如 `src/crawl/fetch-page.js` / `src/crawl/queue.js` / `src/crawl/links.js`)。
   - web_extract 改为消费共享核心,`followLinks` 委托 `web_crawl` 的
     `scope:"same-origin"` + 聚合模式(行为与现在完全一致,全量测试保持绿)。
   - 新增能力只落在共享核心 + 新工具上,不复制抓取逻辑。
2. **范围(scope)可配置**:
   - `"same-origin"`(默认):与现在一致(scheme+host+port)。
   - `"domain"`(v1 可选):同注册域(`docs.example.com` ↔ `example.com`)。
     需 Public Suffix List(PSL);Node 无内置,应做成**可选依赖**或内置精简后缀表,
     避免 `co.uk` 之类误判(打开问题)。
   - `"hosts"`(v1 可选):显式白名单主机数组,配多种子(如"文档站 + API 参考子站")。
   - 种子与白名单 URL 同样过 `assertSafeFetchUrl` 逐跳校验。
3. **输出粒度两种模式**(回应 web_extract 审查时你选的"一次聚合"):
   - **模式 A(默认,便宜)**:所有页面各自数据块喂**一次** aux 调用 → 整体
     `summary/keyPoints` + `pages:[{url,title?}]` 元数据(与 web_extract.followLinks 同构)。
   - **模式 B(v1 提供)**:`perPageSummaries: true` 时**每页一次** aux 调用 →
     `perPage:[{url, summary, keyPoints}]`,页面清单完整。成本 ≈ ×页面数,
     受 `perPageConcurrency` 与 `minIntervalMs` 约束。
   - 两种模式共用同一抓取核心,差异只在"调几次 aux / 拼什么 prompt"。
4. **站点礼貌与预算**:
   - `respectRobots: true`(默认):每主机只读一次 `robots.txt`,解析
     `Disallow/Allow`(路径前缀匹配,简单正则),被拒路径跳过并记 `skipped`。
   - `minIntervalMs`(默认 250):每主机两次请求最小间隔。
   - `maxPages`(默认 10)、`maxDepth`(默认 2)、`maxCharsPerPage`(默认 8000)、
     `maxTotalChars`(缺省 = `maxPages × maxCharsPerPage` 推导)。
   - `maxSeconds`(可选总时长);全程传播 `exec.signal` 可中止。
   - 链接扫描 raw 上限沿用 web_extract(`4×预算,32k–256k`)。
5. **渲染(SPA)边界**:`fetch({url, render})` seam 预留 `render:boolean`。
   - 静态 seam 忽略 `render`;headless seam(如 Playwright 后端)执行 JS → 渲染后
     HTML/text + 最终 URL。
   - **渲染 = 任意 JS 执行 = 信任边界抬升**:渲染页同样要逐跳 + 最终 URL SSRF 复审、
     范围/预算约束;headless 只在宿主侧或可信服务执行,需独立资源上限(内存/CPU/
     超时),并在 `warnings` 标注来源是渲染结果。
   - **v1 只做接口+文档,不实现 headless**(与 F2 结论一致)。
6. **sitemap 引导(可选)**:`useSitemap: true` 时尝试 `<种子>/sitemap.xml`
   (或 robots 里的 Sitemap),正则抽 `<loc>` 入种子队列;仍受 scope/预算/SSRF
   约束。v1 不递归 sitemap index。

## 3. 请求/输出约定

参数(v1):

```jsonc
{
  "url": "https://example.com/docs/",       // 必填,种子
  "scope": "same-origin",                    // same-origin | hosts
  "hosts": ["docs.example.com", "api.example.com"], // scope=hosts 时
  "seedUrls": ["https://api.example.com/ref"], // 额外 depth-0 种子(SSRF+scope 过滤)
  "maxPages": 10, "maxDepth": 2,             // 预算
  "maxCharsPerPage": 8000, "maxTotalChars": 0, // 0=按 maxPages 推导
  "maxPagesPerHost": 0,                      // 每主机页数上限,0=不限
  "maxSeconds": 60,                          // 0=不限
  "minIntervalMs": 250,
  "respectRobots": true,
  "useSitemap": true,
  "perPageSummaries": false,                 // false=模式A,true=模式B
  "perPageConcurrency": 1,
  "question": "列出所有可用的 API 端点"        // 可选,辅助 summary 聚焦
}
```

输出(v1,模式 A 形态):

```jsonc
{
  "root": "https://example.com/docs/",
  "scope": "same-origin",
  "pages":   [{ "url": "...", "chars": 812, "truncated": false, "title": "..." }],
  "fetched": 10, "skipped": 2, "blocked": 1,
  "totalChars": 9200, "truncated": false,
  "summary": "…(整体摘要)…", "keyPoints": ["…"],
  "perPage": [],                              // 模式 B 时填充
  "provider": "…", "model": "…",
  "warnings": ["robots.txt: /api 被 Disallow 跳过", "3 页为渲染结果"]
}
```

- `fetched` 实际抓取页数(`pages.length`),`skipped` 因 robots/范围/扩展名/去重跳过,
  `blocked` 因 SSRF/HTTP 错误拒绝。
- `title` 从 `<title>`/`<h1>` 正则抽取(尽力而为,缺失省略)。
- register 输出 schema 用 `additionalProperties:false` 全部说明。

## 4. 并发与工具安全语义

- web_extract 现有 `isConcurrencySafe: () => true`(池内并发)。web_crawl 的
  `isConcurrencySafe` 必须返回 **false**,或提供严格受控的 `perPageConcurrency` +
  `minIntervalMs`,防止对单域扇出轰炸。
- 抓取执行保持**顺序 BFS**(默认);模式 B 的每页摘要调用用 per-task 信号量 +
  每主机间隔兜底。

## 5. 配置面与注册

- 新增任务 key `web_crawl`:
  - `route.js`:加入 `AUX_TASKS`;`resolveConfig` 允许 `maxChars`(复用 M1 配置);
    新增 `minIntervalMs/maxPages` 等默认常量。
  - `config.js`:`AUX_SETTINGS_SCHEMA` 增 `web_crawl` 任务块;`projectSettings`
    passthrough;`TASK_LABELS` 加「站点抓取」。
  - `client.js`:设置页任务数组加 `web_crawl`(provider/model/timeout/并发)。
  - `register.js`:注册 `runWebCrawl`。
- 工具描述里明示能力边界:静态 HTML 优先,`render` 仅当有 headless seam;摘要代理
  ≠ 浏览器。

## 6. 阶段路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | **重构共享抓取核心**,web_extract 改消费新核心(`followLinks` 委托) | 行为不变,全量测试绿 |
| P1 | `web_crawl` 工具注册 + 模式 A + scope(`same-origin`/`hosts`)+ robots + minInterval + 预算 + 输出 schema | 新工具可深度抓取单站/白名单多站,SSRF/礼貌测试通过 |
| P2 | 模式 B per-page 摘要 + 受控并发 + sitemap 引导 | perPage 结构正确,成本可控 |
| P3 | 设置页/任务配置 `web_crawl` + README(中/英)文档 | 设置页可配,文档齐 |
| P4(未来)| domain/PSL + headless/渲染 provider + 每站资源上限 + web_search 联动 | 单列设计再审 |

## 7. 测试策略

- **抓取核心纯逻辑**(离线):队列/去重/预算/robots 前缀匹配/scope 过滤/每主机
  间隔/`maxSeconds`,注入假 fetch,零真网络。
- **web_extract 回归**:`followLinks` 委托后原 32 用例全部保持绿。
- **模式 A/B**:stub LLM 返回分节文本,断言 `perPage` 数 = 页面数、整体 summary 存在。
- **渲染 seam**:mock headless provider 返回渲染后 html,断言 SSRF/范围仍拦截、
  `warnings` 标注渲染来源。
- **礼貌**:断言同一主机请求间隔 ≥ `minIntervalMs`;robots Disallow 页未请求。

## 8. 打开问题(已决)

> 2026-08 拍板,全部按此执行:

1. **scope v1 = `same-origin` + `hosts` 白名单**。`domain`(PSL,同注册域)整体推迟到
   P4:sitemap 不引入新依赖、避免 `co.uk` 类误判;跨子站场景用 `hosts` 覆盖,
   文档站绝大多数单源。
2. **`respectRobots` 默认开启**,提供 `respectRobots:false` 逃生;失败/缺失 robots
   时按"允许"处理(乐观),不因 robots 解析错误阻断整站。
3. 确认后**直接进入实现**:P0 重构 → P1 工具落地,测试保持全绿。
4. 大站默认 `maxPages:10`、`maxDepth:2`、`maxCharsPerPage:8000`,
   `maxTotalChars` 缺省按 `maxPages × maxCharsPerPage` 推导。
5. 模式 B 默认固定 `perPageConcurrency:1`(顺序),后续再放开受限并发。
6. `web_crawl` 与 `web_search` 联动(以搜索结果作种子)留到 P4 评估,不做进 v1。

---

## 实施进度(2026-08)

### P0 完成(共享抓取核心重构)

- 新增 `src/crawl/text.js`(`codePointCount`/`truncateByChars`)、
  `src/crawl/fetch-page.js`(`readTextCapped`/`isProviderUnavailable`/
  `finishLocalFetch`/`fetchPage`)、`src/crawl/queue.js`(`crawlPages`/
  `crawlSite`/`RobotsPolicy`/`extractTitle`/预算)。
- `web_extract.js` 改消费共享核心并按需 `re-export` 文本辅助(`web_crawl` 同源
  委托路径行为不变)。全量测试保持绿。

### P1 完成(web_crawl 工具)

- 新增 `src/tools/web-crawl.js`(`runWebCrawl`,模式 A 聚合摘要)+ 注册
  `web_crawl` 工具(`isConcurrencySafe=false`、scope/hosts/robots/限流/预算参数、
  输出 `pages`/`fetched`/`skipped`/`blocked`/`warnings` 等)。
- `route.js`/`config.js`/`commands.js`:AUX_TASKS 增 `web_crawl`(可 `maxChars`
  配置、`/aux status`/`/aux model`/`/aux test web_crawl` 可用、设置 schema 声明)。
- 新增 `tests/web-crawl.test.js`(11 用例)。
- README(中/英)增 `web_crawl` 小节。
- 全量 `node --test tests/*.test.js`:**234 通过**。

### P2 完成(模式 B + sitemap + 受控并发)

- **模式 B**:`perPageSummaries:true` 时,每页一次辅助调用(`perPage:[{url,summary,keyPoints}]`),
  再对逐页摘要做一次轻量聚合调用得整体 `summary/keyPoints`;`mode` 字段标注
  `aggregate`/`per-page`;`perPageConcurrency` 控制并发(默认 1,顺序)。
- **sitemap 引导**:`useSitemap:true` 时每源尝试 `<origin>/sitemap.xml`,`<loc>`
  作为 depth-1 种子入队,仍受 scope/robots/预算约束;嵌套 sitemap index(.xml/.gz)
  跳过(不递归);跨域 loc 计入 skipped。
- `runWithConcurrency` 有界并发池(顺序保持)。

### P3 完成(设置页 + 文档)

- 设置页任务块加入 `web_crawl`(provider/model/timeout/并发 + maxChars);
  最近调用 chip 标签补「站点」。
- README(中/英)参数与模式说明同步。
- 新增测试(web-crawl.test.js 共 17 例)。全量 `node --test tests/*.test.js`:
  **240 通过**。

### P4(部分完成 + 明确延后)

已完成:
- **seedUrls 多种子**:额外 depth-0 种子(SSRF 前置校验 + scope 过滤),配合
  hosts scope 可跨主机抓取。
- **maxPagesPerHost 每站页数上限**:单主机页数封顶,超额计入 `skippedByHostCap`/
  `warnings`(每站资源上限的一部分;总量预算已由 maxCharsPerPage/maxTotalChars 覆盖)。

明确延后(需单列设计,不在 v1 强上):
- **domain/PSL**:项目主张「运行时零第三方依赖」;内置启发式同名注册域
  (单标签 TLD + 常用多标签后缀表)有 `co.uk` 类误判风险。延后到引入 PSL(或
  依赖 `tldts`)时再评估。跨子站场景当前用 `hosts` 白名单覆盖。
- **headless/渲染 provider**:任意 JS 执行 = 信任边界抬升,需独立 SSRF 与
  资源上限设计;当前 seam 已预留 `render` 位,未实现。
- **web_search 联动**:搜索结果多为跨源,无 domain scope 时价值有限;
  与 domain 一起延后评估。
- 测试:web-crawl.test.js 扩至 22 例;全量 `node --test tests/*.test.js`:**245 通过**。
