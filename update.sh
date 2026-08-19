#!/bin/bash
# dsh-aux GitHub 安装更新脚本
#
# 用法:
#   ./update.sh               # 拉取最新代码 + 重新接线(推荐)
#   ./update.sh --no-pull     # 只重新接线,不拉取(适用于已手动 git pull / 下载 zip)
#   ./update.sh --dry-run     # 只打印将执行的操作
#
# 背景:GitHub 安装用户更新 dsh-aux 时,只 git pull 不够——新增的 bridge
# 补丁/自愈 hook 需要重新跑 install.sh 才会写到 DSH 部署里。本脚本把
# 「拉代码 + 重跑 install.sh」合成一条命令,降低更新漏步风险。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PULL=true
DRY=false
INSTALL_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) PULL=false; shift ;;
    --dry-run) DRY=true; shift ;;
    --dsh-root) INSTALL_ARGS+=(--dsh-root "$2"); shift 2 ;;
    --profile) INSTALL_ARGS+=(--profile "$2"); shift 2 ;;
    --no-start-hook) INSTALL_ARGS+=(--no-start-hook); shift ;;
    --help|-h) sed -n '1,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

echo "== dsh-aux 更新 =="
echo "  仓库目录: $HERE"

if [ "$PULL" = true ]; then
  if [ -d "$HERE/.git" ]; then
    echo ">> git pull --ff-only"
    if [ "$DRY" = false ]; then
      git -C "$HERE" pull --ff-only
    else
      echo "  [dry-run] 跳过实际 pull"
    fi
  else
    echo "  WARN: 未检测到 .git,跳过 git pull(若是 zip 安装请手动更新源码)"
  fi
else
  echo "  --no-pull,跳过拉取"
fi

echo ">> 重新运行 install.sh 接线(幂等)"
if [ "$DRY" = false ]; then
  "$HERE/install.sh" "${INSTALL_ARGS[@]}"
else
  echo "  [dry-run] 将执行: $HERE/install.sh ${INSTALL_ARGS[*]}"
fi

echo
echo "完成。请重启 DSH 生效。"
