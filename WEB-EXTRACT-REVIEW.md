# web_extract 审查报告 (设计 + 代码 + 测试)

> 由 3 个并行子代理审查(设计 / 代码 / 测试),合并排序。均为**发现项**,尚未实现修＜。

## 验证结论(不是 web_extract 的问题)

- workflow 子代理桥接**已生效**:3 个审查子代理会话头均为
  `opencode-go/deepseek-v4-flash`(= AUX `subagent.general`)。

## High — 必须处理

1. **H1(设计)provider 回退靠错误文本匹配,会失效**
   `dsh-aux/src/tools/web-extract.js:66,79-82`
   - `service.ctx.web.fetch` 若缺失/形状不对,抛出的 `TypeError` 不匹配
     `/no usable web provider|web provider/i`,回退永远不执行,`fetch` 可用也失败。
   - 修:先做能力探测(`const webFetch = service.ctx?.web?.fetch; typeof === "function"`),
     不再用正则匹配错误文本;并对 `fetchResult.body` 形状做防御。

2. **H2(安全)provider 路径没有逐跳 SSRF 校验**
   `dsh-aux/src/tools/web-extract.js:70-73`
   - `ctx.web.fetch` 若自动跟随重定向,`fetchResult.url` 可被跳过/缺失;
     中间跳回内网不会在请求前被拦——`fetchWithSsrf` 的逐跳防护只在回退路径生效。
   - 修:不信任事后 post-check。要么要求 provider 暴露每一跳并在请求前校验,
     要么把 provider 路径也接进逐跳逻辑;至少 `finalUrl` 缺失时拒绝。

3. **H3(正确性)截断会切开 UTF-16 代理对**
   `dsh-aux/src/tools/web-extract.js:17-31,92-94`
   - `text.slice(0, maxChars)` 按 UTF-16 码元切,emoji/CJK 边界会产生孤立
     代理项/`�`;`readTextCapped` 从未被测试。
   - 修:按**码点边界**截断(`[...text]`/`Array.from`/`codePointAt`),并在
     `reader` 结束前 flush decoder;补多字节边界测试。

4. **H4(测试/安全)关键分支无测试**
   - provider final-URL 后置检查(重定向回内网)无测试;
   - `fetchWithSsrf` 超过 `MAX_REDIRECTS` / 缺失 `Location` / 多跳成功 / 相对
     `Location` 均无测试;
   - `web_extract` aux 路线失败→主模型回退无测试(且文本任务不走图片能力门没锁证)。

## Medium

5. **M1 `maxChars` 默认写死,不能按部署配置**
   `web-extract.js:55`;`route.js:19` 的 `DEFAULT_MAX_INPUT_CHARS` 未使用。
   - 修:任务配置增加可选 `maxChars`,解析 `args.maxChars ?? merged.maxChars ?? 8000`。

6. **M2 截断冗余 + 无 truncated 元数据**
   `web-extract.js:11-32,89-94`;`register.js:56-66`
   - 标记字符串重复两处;provider 路径可能在已截断的文本上再截一次;
     输出无 `truncated` 标志/原始长度(对比 `compress_text` 有丰富元数据)。
   - 修:共享截断常量/辅助函数,输出加 `truncated: boolean`(可选 `chars`)。

7. **M3 `extractKeyPoints` 解析脆弱**
   `web-extract.js:35-48` + `prompt.js`
   - 只按行首 bullet/编号判断,极易误判(summary 以数字起行、key point 无 bullet 等)。
   - 修:prompt 输出带 `SUMMARY:` / `KEY POINTS:` 分节标签(或 JSON),按节解析并兜底修复。

8. **M4 provider 路径未在读取前应用 maxChars**(整页先缓冲/清洗再截断)
   `web-extract.js:66-78,92-94`
   - 大页面全量拉取清洗后才截断,违背上限的带宽/内存目的;回退路径却流式截断。
   - 修:在 `htmlToText` 前对原始内容应用 cap,或流式截断。

## Low

9. HTML 判定两条路径不一致(provider `body.kind==='html'` vs 回退 `content-type /html/i`)。
10. 回退路径不处理 charset(非 UTF-8 乱码)、不拒二进制、无 `Accept`/`User-Agent`。
11. `DEFAULT_MAX_INPUT_CHARS` 死代码;`maxChars` 校验先于 URL 校验。
12. `L2`(redirect 上限 off-by-one:实际 4 跳),`L3`(Teredo `2001::/32` 注释与实现不符),
    `L4`(单超大 chunk 内存突增),`L5`(null-body `text()` 全量缓冲),
    `L6`(非字符串 URL 抛原始 TypeError),`L7`(provider 3xx-as-final 不拒绝)。
13. DNS rebinding/TOCTOU 为文档化已知限制(`url-policy.js` 头部注明),未真正消除。
14. 无 robots/速率/按域并发策略;`isConcurrencySafe:true` 允许对单域扇出。
15. 错误消息形状多为松散正则断言,未 pin 死精确文本。

## 建议落地顺序

1. H1 + H2(provider 路径安全与回退) — 先做
2. H3 + M2(截断正确性 + 元数据)
3. M1 + M3(配置化 maxChars + 输出解析)
4. H4 + 其它 Low(补测试与边界)
