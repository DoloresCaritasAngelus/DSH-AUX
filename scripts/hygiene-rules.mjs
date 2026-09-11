/**
 * 脱密规则单一真相源 —— 三条公开信道共用一张表。
 *
 * 同一个"什么不许出现在公开面"的规则集服务三个出口:
 *   1. 文件扫描 — `ci-doc-hygiene`,覆盖 `git ls-files` 的全部文本文件;
 *   2. 提交信息扫描 — 同一个脚本,范围 `origin/main..HEAD`;
 *   3. PR 描述 / 标题扫描 — `pr-body-hygiene`,经 gh 取回正文。
 *
 * 第 3 条是后补的:前两条闸早已齐备,而 PR 描述既不在 `git ls-files` 里、也不在
 * 提交历史里,于是成了唯一没有闸的公开信道 —— 历史上正是一次 PR 描述把私有台账
 * 路径、本机环境与过程叙述写了出去。规则齐备不等于信道接上,这张表就是把两者
 * 接在一起的那根线。
 *
 * 两张表的严格程度不同,这是有意的:
 *   - 文件扫描有白名单 —— 有些文件本来就该提到私有台账(并注明不随仓库分发);
 *   - 消息类扫描无白名单 —— 提交信息与 PR 描述只允许描述 diff 可见的变更语义,
 *     凡是需要引用私有工作区才能读懂的内容,一律留在私有笔记里。
 *
 * 本文件自身在 `ci-doc-hygiene` 的 SKIP 名单里:规则表必须写出被拦截的字面量,
 * 否则无法自解释。这是唯一的豁免面。
 */

/** 文件扫描规则。`allow` 命中时该规则对该文件放行。 */
export const FILE_RULES = [
  {
    name: "aux-notes 私有工作区引用",
    re: /aux-notes\//,
    allow: [/^\.gitignore$/, /^CONTRIBUTING\.md$/, /^\.github\//, /^\.agents\//],
  },
  {
    name: "私有台账文件名",
    re: /02-patch-ledger/,
    allow: [/^\.gitignore$/, /^CONTRIBUTING\.md$/, /^\.github\//, /^\.agents\//],
  },
  {
    name: "私有交接/计划文档名",
    re: /HANDOFF|EXECUTION-PLAN|maintenance-debt|version-support-plan|04-glossary|u1-readme/,
  },
  { name: "内部蓝图章节引用", re: /蓝图 §/ },
  { name: "本机绝对路径 /home/<user>", re: /\/home\/(?!user\b|\.\.\/?\.?)/ },
  { name: "Windows 盘符路径", re: /[A-Z]:\\(?![ntr0])/ },
];

/**
 * 消息类扫描规则(提交信息 / PR 标题与描述)。比文件扫描更严,无白名单。
 *
 * 最后两条来自一次真实的 PR 描述泄漏:过程叙述("复审提出""终审""实测")与
 * 内部环境名同样进入公开面,却既不是路径也不是凭据,靠肉眼很容易放过。
 *
 * 关于 `\.local/`(2026-09-11 首轮自证后移除):它原本被当作私有工作区标记,但
 * `~/.local/share/dsh` 是 DSH 自身的安装位置之一(见 `dsh-aux/src/bridge-locate.js`
 * 的候选列表),`$HOME/.local/bin` 是通用 CLI 安装位置 —— 两者都是可以在公开文档里
 * 出现的正当路径。绝对家目录路径由「本机绝对路径」规则覆盖,不需要这条粗糙的前缀。
 */
export const MESSAGE_RULES = [
  { name: "私有工作区引用", re: /aux-notes\/|HANDOFF|EXECUTION-PLAN/ },
  { name: "内部蓝图编号引用", re: /蓝图 §|04-glossary|A1[6-9] §/ },
  { name: "本机绝对路径 /home/<user>", re: /\/home\/(?!user\b|\.\.\/?\.?)/ },
  { name: "Windows 盘符路径", re: /[A-Z]:\\(?![ntr0])/ },
  { name: "会话归属式提法", re: /等用户指示|用户确认[后了对]?再|本地未推送/ },
  { name: "会话叙事/事故叙述", re: /事故|AI (起草|未与维护者)|对齐意图|已决定接受/ },
  { name: "内部环境名", re: /沙盒/ },
  { name: "评审过程叙述", re: /终审|复审意见|评审意见|维护者(实测|确认)/ },
];

/**
 * 逐行扫描文本,返回命中列表。
 *
 * @param {string} text 待扫描文本。
 * @param {{name: string, re: RegExp, allow?: RegExp[]}[]} rules 规则表。
 * @param {string|null} file 文件名;给出时应用该规则的 `allow` 白名单。
 * @returns {{line: number, rule: string, text: string}[]} 命中项(行号从 1 起)。
 */
export function scanText(text, rules, file = null) {
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const rule of rules) {
      if (file !== null && rule.allow?.some((re) => re.test(file))) continue;
      if (rule.re.test(lines[i])) {
        hits.push({ line: i + 1, rule: rule.name, text: lines[i].trim().slice(0, 100) });
      }
    }
  }
  return hits;
}
