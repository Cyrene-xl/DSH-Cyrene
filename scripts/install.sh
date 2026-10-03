#!/usr/bin/env bash
# 把 preset/ 装到 ~/.dsh/.agent-presets/chat/
#
# DSH 没有公开的 agent 预设安装 API：dsh-agent-presets 只按
# ~/.dsh/.agent-presets/<id>/ 目录扫描发现预设（见其源码 USER_PRESET_DIR）。
# 所以预设必须由脚本拷贝到位，插件本身不做这件事。
#
# 行为约定：
#   - 目标已存在且内容相同 → 报"已是最新"，退出 0
#   - 目标已存在且内容不同 → 默认拒绝覆盖并退出 1，提示加 --force
#   - 目标不存在 → 直接安装
#
# 用法：
#   scripts/install.sh            # 首次安装
#   scripts/install.sh --force    # 覆盖已有预设（会先备份）
#   scripts/install.sh --uninstall
set -euo pipefail

PRESET_ID="chat"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/preset"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DEST_DIR="$DSH_HOME/.agent-presets/$PRESET_ID"

FORCE=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help)
      sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -d "$SRC_DIR" ]; then
  echo "错误：找不到预设源目录 $SRC_DIR" >&2
  exit 1
fi

if [ "$UNINSTALL" -eq 1 ]; then
  if [ -d "$DEST_DIR" ]; then
    rm -rf "$DEST_DIR"
    echo "已卸载预设：$DEST_DIR"
  else
    echo "无需卸载：$DEST_DIR 不存在"
  fi
  exit 0
fi

echo "预设源：$SRC_DIR"
echo "目标位置：$DEST_DIR"

if [ -d "$DEST_DIR" ]; then
  if diff -rq "$SRC_DIR" "$DEST_DIR" >/dev/null 2>&1; then
    echo "已是最新，无需改动。"
    exit 0
  fi
  if [ "$FORCE" -ne 1 ]; then
    echo "" >&2
    echo "拒绝覆盖：目标目录已存在且与预设不同。" >&2
    echo "  这通常意味着你已经改过自己的预设（比如调了口吻）。" >&2
    echo "  确认要覆盖请加 --force（会先备份到 $DEST_DIR.bak.<时间戳>）。" >&2
    exit 1
  fi
  BACKUP="$DEST_DIR.bak.$(date +%Y%m%d%H%M%S)"
  cp -r "$DEST_DIR" "$BACKUP"
  echo "已备份原预设 → $BACKUP"
fi

mkdir -p "$DEST_DIR"
cp -r "$SRC_DIR/." "$DEST_DIR/"

echo ""
echo "✅ 预设已安装：$DEST_DIR"
echo "   在 DSH 界面右上角的模式选择器里选「纯文本对话模式」即可。"
echo ""
echo "提示：该预设使用 complete: true 整份替换系统提示词，"
echo "      因此该模式下不提供文件 / Shell / 设备工具，只保留联网搜索与表情包。"
