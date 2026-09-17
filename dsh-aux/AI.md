# AI 安装指南:dsh-aux(Auxiliary Model System for DSH)

> 本文档面向 **AI 代理**(Claude / Cursor / OpenCode / 任何能读文件并执行命令的 agent)。
> 目标:把 dsh-aux 插件安装到用户的 DeepSeek Harness(DSH)并**验证安装成功**。
> 请按顺序逐步执行:先检测,再安装,最后验证。任何一步失败,先看 §4 常见问题。

## 0. 你需要知道的

- **dsh-aux 是双端插件**:host 端提供 `ctx.auxLlm` 路由服务 + 四个工具
  (`vision_analyze` / `web_extract` / `web_crawl` / `compress_text`)与 `/aux` 命令;
  client 端提供 Web 设置页与 composer 状态 chip。
- **支持线**:DSH `0.1.5-rc.2`(主支单版本);`0.1.2-alpha.2 ~ 0.1.2-rc.1` 请用
  `legacy/dsh-0.1.2-alpha.2-to-0.1.2-rc.1` 分支或 `v0.4.4-legacy` Release。
- **安装 = 三步**:① 把包放进 DSH 能解析的 node_modules;② 在 profile 补丁层
  注册一行;③ 重启 DSH。
- **零配置即可用**:装完不配任何模型也能工作(辅助任务自动用会话主模型)。
- 包名以 `package.json` 的 `name` 字段为准(可能是 `dsh-aux` 或
  `@dolorescaritasangelus/dsh-aux`),下面用 `<NAME>` 占位,请先读取该字段。

## 1. 环境检测

```sh
# DSH 部署根(通常其一)
ls -d ~/dsh ~/.local/share/dsh /opt/dsh 2>/dev/null
# 找真正的部署目录(含 node_modules/@deepseek-ai 的)
find ~ -maxdepth 3 -type d -name "@deepseek-ai" -path "*/node_modules/*" 2>/dev/null | head -5
# profile 目录
ls ~/.dsh/profiles/ 2>/dev/null
# 是否已安装 / 已注册
find <DSH_ROOT>/node_modules -maxdepth 2 -name "dsh-aux" 2>/dev/null
grep -rn "dsh-aux" ~/.dsh/profiles/*/package.json 2>/dev/null   # bundle 接入(插件页可见)
grep -rn "dsh-aux" ~/.dsh/profiles/*/cordis.patch.yml 2>/dev/null # 旧的补丁注入
```

判定:若符号链接存在、且 profile 的 `dsh.profile.bundles` 已含本包 → 已安装,
直接跳到 §3 验证;符号链接在但只有 patch 行 → 能加载但**插件页看不到**,重跑
install.sh 即可迁移;两者都没有 → 继续 §2。

## 2. 安装

### 方式 A:一键安装脚本(推荐,含集成组件)

如果拿到的是完整仓库(含 `install.sh` 与 `bridge/`):

```sh
./install.sh                 # 插件接线 + image-bridge 补丁 + 自愈,幂等
```

### 方式 B:dsh plugin 命令(仅插件本体)

```sh
# 本地源码目录(推荐):
dsh plugin --profile web add "file:/path/to/dsh-aux"
```

方式 B 之后,请**补装集成组件**(纯文本主模型发图必需;有仓库时):

```sh
cd <仓库>/bridge
node apply-patch.mjs                 # image-bridge / skill 补丁(幂等)
# 设置页可写 aux 在当前 DSH 0.1.5-alpha.1 线是原生能力,不再需要 rc.6 settings 白名单补丁
```

检查输出无 error;成功后跳到 §3。

### 方式 C:手动(命令不可用、profile 无 pnpm 环境、或源码目录时)

```sh
DSH_ROOT=<第 1 步找到的部署根,含 node_modules>
mkdir -p "$DSH_ROOT/node_modules"
ln -sfn /path/to/dsh-aux "$DSH_ROOT/node_modules/<NAME>"
# 找到 profile(默认 web),把本包接成它的 bundle(有仓库时用脚本,幂等):
PROFILE_DIR=~/.dsh/profiles/web
node <仓库>/bridge/profile-bundle.mjs --profile-dir "$PROFILE_DIR" --legacy-fallback
# (部署根与 profile 家目录不在一起时,用 DSH_AUX_PROFILE_HOME 指定 profile 家目录 —— install.sh 与启动自愈都认它)
```

脚本会写两处 —— `dependencies[<NAME>] = "file:<仓库>/dsh-aux"` 与
`dsh.profile.bundles += <NAME>` —— 并移除可能残留的旧 `cordis.patch.yml`
insert 行(两层各插一行同 id 会重复)。

两种边界要留意:

- **profile 目录还不存在**(DSH 从未跑过):加 `--legacy-fallback` 才会退回写那条旧
  patch 行;等 DSH 建好 profile 后,启动自愈会把它迁移成 bundle。不加这个开关就什么
  都不写。
- **依赖在、但 bundle 没选**:那是用户在插件页把它**停用**了 —— 脚本与启动自愈都会
  保持现状,不会把它悄悄打开;要恢复请在插件页打开。

> 注意:手工写时 `name` 必须与包名完全一致(含 scope);`id` 保持 `aux` 稳定。
> 只有 bundle 接入的插件才出现在 DSH 的插件页(Plugins),也只有它能在页面上启停 ——
> 页面上停用后,启动自愈不会再把它打开。

## 3. 验证(必须全部通过)

```sh
# 3.1 模块可解析
node --input-type=module -e "const m = await import('<NAME>'); console.log(typeof m.apply, Array.isArray(m.inject))"
# 期望输出:function true

# 3.2 组合配置含插件行(host 已接线)
dsh --profile web --dump-config 2>/dev/null | grep -A1 "id: aux" | head -4
# 期望:包含 name: '<NAME>'

# 3.3 重启后(请用户重启 DSH,或询问用户是否由你重启):
#   - 会话工具列表出现 vision_analyze / web_extract / web_crawl / compress_text
#   - 输入 /aux status 有输出(路由与最近调用)
#   - Web 设置页出现「辅助模型」区块
#   - 侧栏「插件」页能看到 dsh-aux,并能开关 / 卸载它(只有 bundle 接入才会列出)
#   - 发一张图片,模型能调用 vision_analyze 描述它(纯文本主模型经
#     image-bridge 集成组件;多模态模型原生看图)
#   - /aux status 显示 image-bridge 状态(已集成/缺失)
#   - /aux status 的补丁台账含 P12/P13(0.1.5 会话迁移放行;补丁写入后需重启 DSH 生效)
#   - /aux status 显示 compaction-bridge 状态;配置 `/aux model compaction ...`
#     后原生自动/手动压缩会走 AUX 辅助模型
#   - 若会话使用「极简」或「Anchored Standard」预设:首轮不会出现 vision_analyze,
#     首个 tool/call 后才会开放——这是预期行为,不要把它当安装失败
```

## 4. 常见问题(故障排查)

| 现象 | 原因 | 处理 |
|---|---|---|
| import 报 MODULE_NOT_FOUND | 符号链接未建/路径错 | 核对 `DSH_ROOT` 与 `<NAME>`,重建链接 |
| `--dump-config` 无 aux 行 | bundle 未选中 / patch 行未生效 / YAML 语法错 | 核对 `dsh.profile.bundles` 含本包,或(旧式)patch 行 `name` 与包名完全一致 |
| 插件页没有 dsh-aux | 只做了 patch 注入,没有 bundle 接入 | 重跑 `install.sh`,或 `node bridge/profile-bundle.mjs --profile-dir <profile>` |
| 工具未注册、/aux 无响应 | 改动写在配置里但未重启 | 重启 DSH(host 插件改动必须重启) |
| client 设置页不显示 | client bundle 未加载 | 确认 package.json 的 `dsh.client` 声明存在且 platform 为 web |
| 重启后报插件加载错误 | 版本不匹配 | 检查 DSH 版本 = `0.1.5-rc.2`(主支单版本);`0.1.2-alpha.2 ~ 0.1.2-rc.1` 用 legacy 分支;查看启动日志(`~/dsh/dsh-web.log`) |
| 发图报 MODEL_DOES_NOT_SUPPORT_IMAGES | 纯文本主模型 + 未装 bridge 补丁 | 可选:安装 `bridge/` 补丁(见 §6),或换多模态主模型 |

## 5. 卸载

```sh
# 1) 删符号链接
rm "$DSH_ROOT/node_modules/<NAME>"
# 2) 从 profile 的 dsh.profile.bundles 移除本包(并删 dependencies 里那条
#    file: 依赖);若当初是 patch 注入,则删 cordis.patch.yml 里 id: aux 的块。
#    用插件页卸载同样可行(bundle 接入时)。
# 3) 重启 DSH
# 可选:清理图片归属记录文件 ~/.dsh/attachments/v1/session-images.json(不影响附件本体)
```

## 6. 集成组件与配套

- **image-bridge(集成组件,默认安装)**:让纯文本主模型粘贴图片可用,且用户消息
  显示图片缩略图。机制:admit 保留 image block(UI 显示),agent-loop 在模型输入
  边界按模态改写为 attachmentId 锚点文本(含「本条消息第N张/共M张」,多模态模型原生看图),
  selectModel 允许含图会话切换
  到纯文本模型(v3)。安装:install.sh 已包含;
  单独重装:`cd <repo>/bridge && node apply-patch.mjs`(幂等,可 --dry-run / --rollback)。
  `npm update` 后需重跑;`/aux status` 会报告状态。
- **skill-audit(集成组件,默认安装)**:配置 `skill` 辅助模型后,原生 `skill`
  工具调用会先由辅助模型精读 SKILL.md + 当前任务,返回预审报告(如何应用 /
  适用性 / 已知坑 / 🔻易腐烂旧断言 / 执行建议)。主模型同时看到原始 SKILL.md
  与报告,可对照辩证审视;未配置时 native 直通。配套补丁:`dsh-tool-skill`
  schema 增加可选 `task` 参数。设置:设置页「技能预审 (skill)」或
  `/aux model skill provider/model`;`/aux test skill` 自检。
- **会话事件注册通道(必装)**:dsh-aux 向会话写 `aux/llm-call` 事件;DSH
  持久化读链对白名单外事件拒绝整个日志(官方无插件事件注册通道)。install.sh
  中的 `bridge/patch-session-ignorable.mjs` 补齐 append 的 `ignorable` 写入
  入口并放行白名单。**未装时插件自动降级为不写事件**(保护会话日志),
  `/aux status` 显示"会话事件记录:已停用"。`npm update` 后重跑。DSH 0.1.5 起会话迁移用
  冻结词表校验历史事件,启动自愈会补 **P12**(放行 `aux/*` 事件)与 **P13**(放行官方历史写法,
  上游收编后自退役);补丁写入后**重启 DSH 生效**,`/aux status` 的补丁台账列出两行。
- **settings 可写性**:当前 DSH 0.1.5-alpha.1 线原生支持设置页读写 aux 配置,不再需要
  rc.6 的 settings 白名单补丁(旧补丁见 `bridge/retired/` 与 legacy 分支)。
- **会话删除**:DSH 原生无删除会话功能,配合社区插件(如 dsh-plugin-session-delete);
  删除会话时 dsh-aux 会自动清理其无引用图片。

## 7. 给安装完成后的用户提示

- 配置辅助模型:Web → 设置 → 辅助模型(只列 active 供应商),或 `/aux model <task> provider/model`
- `/aux status` 查看各任务路由;失败自动降级主模型(可关 `fallbackToMain`)
- 删除会话时图片自动清理;手动回收旧附件:`/aux gc-images [days]`
