# AI 安装指南:dsh-aux(Auxiliary Model System for DSH)

> 本文档面向 **AI 代理**(Claude / Cursor / OpenCode / 任何能读文件并执行命令的 agent)。
> 目标:把 dsh-aux 插件安装到用户的 DeepSeek Harness(DSH)并**验证安装成功**。
> 请按顺序逐步执行:先检测,再安装,最后验证。任何一步失败,先看 §4 常见问题。

## 0. 你需要知道的

- **dsh-aux 是双端插件**:host 端提供 `ctx.auxLlm` 路由服务 + 三个工具
  (`vision_analyze` / `web_extract` / `compress_text`)与 `/aux` 命令;
  client 端提供 Web 设置页与 composer 状态 chip。
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
grep -rn "dsh-aux" ~/.dsh/profiles/*/cordis.patch.yml 2>/dev/null
```

判定:若符号链接存在且 patch 有注册行 → 已安装,直接跳到 §3 验证;
否则继续 §2。

## 2. 安装

### 方式 A:一键安装脚本(推荐,含集成组件)

如果拿到的是完整仓库(含 `install.sh` 与 `bridge/`):

```sh
./install.sh                 # 插件接线 + image-bridge 补丁 + settings 白名单,幂等
```

### 方式 B:dsh plugin 命令(仅插件本体)

```sh
dsh plugin --profile web add <NAME>                 # 从 npm
# 或本地/远程源码目录:
dsh plugin --profile web add file:/path/to/dsh-aux
dsh plugin --profile web add git+https://github.com/<user>/dsh-aux.git
```

方式 B 之后,请**补装集成组件**(纯文本主模型发图必需;有仓库时):

```sh
cd <仓库>/bridge
node apply-patch.mjs                 # image-bridge(v2,幂等)
node patch-settings-allowlist.mjs    # 设置页可写 aux(可选但推荐)
```

检查输出无 error;成功后跳到 §3。

### 方式 B:手动(命令不可用、profile 无 pnpm 环境、或源码目录时)

```sh
DSH_ROOT=<第 1 步找到的部署根,含 node_modules>
mkdir -p "$DSH_ROOT/node_modules"
ln -sfn /path/to/dsh-aux "$DSH_ROOT/node_modules/<NAME>"
# 找到 profile(默认 web),在 cordis.patch.yml 末尾追加(不存在则创建):
PROFILE_DIR=~/.dsh/profiles/web
mkdir -p "$PROFILE_DIR"
cat >> "$PROFILE_DIR/cordis.patch.yml" <<'EOF'

# dsh-aux: auxiliary model system (host plane row)
- insert:
    - id: aux
      name: '<NAME>'
EOF
```

> 注意:insert 的 `name` 必须与包名完全一致(含 scope);`id` 保持 `aux` 稳定。

## 3. 验证(必须全部通过)

```sh
# 3.1 模块可解析
node --input-type=module -e "const m = await import('<NAME>'); console.log(typeof m.apply, Array.isArray(m.inject))"
# 期望输出:function true

# 3.2 组合配置含插件行(host 已接线)
dsh --profile web --dump-config 2>/dev/null | grep -A1 "id: aux" | head -4
# 期望:包含 name: '<NAME>'

# 3.3 重启后(请用户重启 DSH,或询问用户是否由你重启):
#   - 会话工具列表出现 vision_analyze / web_extract / compress_text
#   - 输入 /aux status 有输出(路由与最近调用)
#   - Web 设置页出现「辅助模型」区块
#   - 发一张图片,模型能调用 vision_analyze 描述它(纯文本主模型经
#     image-bridge 集成组件;多模态模型原生看图)
#   - /aux status 显示 image-bridge 状态(已集成/缺失)
```

## 4. 常见问题(故障排查)

| 现象 | 原因 | 处理 |
|---|---|---|
| import 报 MODULE_NOT_FOUND | 符号链接未建/路径错 | 核对 `DSH_ROOT` 与 `<NAME>`,重建链接 |
| `--dump-config` 无 aux 行 | insert 未生效 / YAML 语法错 / id 冲突 | 检查 cordis.patch.yml 缩进与 `name` 完全一致;确保插在顶层数组 |
| 工具未注册、/aux 无响应 | 补丁层改了但未重启 | 重启 DSH(host 插件改动必须重启) |
| client 设置页不显示 | client bundle 未加载 | 确认 package.json 的 `dsh.client` 声明存在且 platform 为 web |
| 重启后报插件加载错误 | 版本不匹配 | 检查 DSH 版本 ≥ 0.1.0-rc.6;查看启动日志(`~/dsh/dsh-web.log`) |
| 发图报 MODEL_DOES_NOT_SUPPORT_IMAGES | 纯文本主模型 + 未装 bridge 补丁 | 可选:安装 `bridge/` 补丁(见 §6),或换多模态主模型 |

## 5. 卸载

```sh
# 1) 删符号链接
rm "$DSH_ROOT/node_modules/<NAME>"
# 2) 删 patch 行(删除 cordis.patch.yml 中 id: aux 的 insert 块)
# 3) 重启 DSH
# 可选:清理图片归属记录文件 ~/.dsh/attachments/v1/session-images.json(不影响附件本体)
```

## 6. 集成组件与配套

- **image-bridge(集成组件,默认安装)**:让纯文本主模型粘贴图片可用,且用户消息
  显示图片缩略图。机制:admit 保留 image block(UI 显示),agent-loop 在模型输入
  边界按模态改写为路径文本(多模态模型原生看图)。安装:install.sh 已包含;
  单独重装:`cd <repo>/bridge && node apply-patch.mjs`(幂等,可 --dry-run / --rollback)。
  `npm update` 后需重跑;`/aux status` 会报告状态。
- **会话事件注册通道(必装)**:dsh-aux 向会话写 `aux/llm-call` 事件;DSH
  持久化读链对白名单外事件拒绝整个日志(官方无插件事件注册通道)。install.sh
  中的 `bridge/patch-session-ignorable.mjs` 补齐 append 的 `ignorable` 写入
  入口并放行白名单。**未装时插件自动降级为不写事件**(保护会话日志),
  `/aux status` 显示"会话事件记录:已停用"。`npm update` 后重跑。
- **settings 白名单补丁**(install.sh 一并应用):Web 设置页可写 aux 配置
  (不打补丁时可用 `/aux model` 命令等效)。
- **会话删除**:DSH 原生无删除会话功能,配合社区插件(如 dsh-plugin-session-delete);
  删除会话时 dsh-aux 会自动清理其无引用图片。

## 7. 给安装完成后的用户提示

- 配置辅助模型:Web → 设置 → 辅助模型(只列 active 供应商),或 `/aux model <task> provider/model`
- `/aux status` 查看各任务路由;失败自动降级主模型(可关 `fallbackToMain`)
- 删除会话时图片自动清理;手动回收旧附件:`/aux gc-images [days]`
