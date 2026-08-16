#!/bin/bash
# dsh-aux 一键安装:插件接线 + image-bridge 补丁集成 + settings 白名单
#
# image-bridge 是 dsh-aux 的集成组件(非可选):它让纯文本主模型也能直接
# 粘贴图片(UI 保留缩略图),安装 dsh-aux 时一并装上。
#
# 用法:
#   ./install.sh                          # 自动探测 DSH 部署根与 web profile
#   ./install.sh --dsh-root /path/to/dsh  # 指定部署根
#   ./install.sh --profile web            # 指定 profile(默认 web)
#   ./install.sh --dry-run                # 只打印将执行的操作
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DSH_ROOT=""
PROFILE="web"
DRY=false
while [ $# -gt 0 ]; do
  case "$1" in
    --dsh-root) DSH_ROOT="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --dry-run) DRY=true; shift ;;
    --help|-h) sed -n '1,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# 只允许安全 profile 名,防止路径穿越写入 ~/.dsh/profiles/..
case "$PROFILE" in
  *[!A-Za-z0-9_-]*) echo "错误: --profile 只允许字母/数字/下划线/连字符" >&2; exit 1 ;;
esac

# 1. 探测部署根(含 node_modules/@deepseek-ai 的目录)
if [ -z "$DSH_ROOT" ]; then
  for candidate in "$HOME/dsh" "$HOME/.local/share/dsh" "/opt/dsh"; do
    if [ -d "$candidate/node_modules/@deepseek-ai" ]; then DSH_ROOT="$candidate"; break; fi
  done
fi
if [ -z "$DSH_ROOT" ] || [ ! -d "$DSH_ROOT/node_modules" ]; then
  echo "错误: 未找到 DSH 部署根,请用 --dsh-root /path/to/dsh 指定" >&2
  exit 1
fi

PACKAGE_NAME="$(node -p "require('$HERE/dsh-aux/package.json').name")"
# 包名必须符合 npm scoped 包格式,防止注入到 profile 补丁。
case "$PACKAGE_NAME" in
  @[A-Za-z0-9_-]+/[A-Za-z0-9_-]+) ;;
  *) echo "错误: 包名格式不合法: $PACKAGE_NAME" >&2; exit 1 ;;
esac
NODE_MODULES="$DSH_ROOT/node_modules"
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"

echo "== dsh-aux 一键安装 =="
echo "  部署根: $DSH_ROOT"
echo "  包名:   $PACKAGE_NAME"
echo "  profile: $PROFILE"
echo

run() {
  echo ">> $*"
  if [ "$DRY" = false ]; then "$@"; fi
}

# 2. 插件符号链接
TARGET="$NODE_MODULES/$PACKAGE_NAME"
if [ -L "$TARGET" ] || [ -d "$TARGET" ]; then
  echo "  插件已存在: $TARGET(跳过链接)"
else
  run ln -s "$HERE/dsh-aux" "$TARGET"
fi

# 3. profile 补丁层注册
mkdir -p "$PROFILE_DIR"
if grep -q "id: aux" "$PATCH_FILE" 2>/dev/null; then
  echo "  补丁层已注册 aux(跳过)"
else
  # 用位置参数传递 PATCH_FILE/PACKAGE_NAME,避免外层 shell 拼接注入。
  run bash -c 'cat >> "$1" <<EOF

# dsh-aux: auxiliary model system (host plane row)
- insert:
    - id: aux
      name: "$2"
EOF' _ "$PATCH_FILE" "$PACKAGE_NAME"
fi

# 4. image-bridge 补丁(集成组件,幂等,v1 自动升级 v2)
echo "  [image-bridge] 应用核心包补丁(幂等)..."
run node "$HERE/bridge/apply-patch.mjs"

# 4.5 会话事件 ignorable 补丁(插件自定义事件可安全读回,白名单不拒绝)
echo "  [session-ignorable] 应用 dsh-session ignorable 补丁(append 支持 ignorable + 白名单放行 aux/llm-call)..."
run node "$HERE/bridge/patch-session-ignorable.mjs"

# 5. settings 动态暴露补丁(设置页可写 aux 配置,插件原生能力)
echo "  [settings-dynamic-expose] 应用 dsh-settings 补丁(注册时声明 exposedToWeb)..."
run node "$HERE/bridge/patch-settings-dynamic-expose.mjs"
echo "  [settings-allowlist] 应用 api-proxy 动态暴露补丁(v2,从 listExposed 合并)..."
run node "$HERE/bridge/patch-settings-allowlist.mjs"

echo
echo "完成。请重启 DSH 生效。"
echo "验证: /aux status 应显示 image-bridge: 已集成(v2:UI 保留缩略图)"
