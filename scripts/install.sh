#!/usr/bin/env bash
# 把 preset/ 下的每个子目录装到 ~/.dsh/.agent-presets/<id>/
#
# DSH 没有公开的 agent 预设安装 API：dsh-agent-presets 只按
# ~/.dsh/.agent-presets/<id>/ 目录扫描发现预设（见其源码 USER_PRESET_DIR）。
# 所以预设必须由脚本拷贝到位，插件本身不做这件事。
#
# 预设 id **自动发现**：preset/chat/ → 装成 chat，preset/cyrene-work/ → cyrene-work。
# 以后再加预设只要在 preset/ 下新建目录，本脚本不用改。
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)/preset"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

FORCE=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help)
      sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -d "$SRC_ROOT" ]; then
  echo "错误：找不到预设源目录 $SRC_ROOT" >&2
  exit 1
fi

# 自动发现：每个含 agent.cordis.yml 的子目录就是一个预设。
PRESET_IDS=()
for d in "$SRC_ROOT"/*/; do
  [ -f "$d/agent.cordis.yml" ] || continue
  PRESET_IDS+=("$(basename "$d")")
done
if [ "${#PRESET_IDS[@]}" -eq 0 ]; then
  echo "错误：$SRC_ROOT 下没有找到任何预设（需要 <id>/agent.cordis.yml）" >&2
  exit 1
fi

echo "预设源：$SRC_ROOT"
echo "发现预设：${PRESET_IDS[*]}"

if [ "$UNINSTALL" -eq 1 ]; then
  for id in "${PRESET_IDS[@]}"; do
    dest="$DSH_HOME/.agent-presets/$id"
    if [ -d "$dest" ]; then
      rm -rf "$dest"
      echo "已卸载预设：$dest"
    else
      echo "无需卸载：$dest 不存在"
    fi
  done
  exit 0
fi

FAILED=0
for id in "${PRESET_IDS[@]}"; do
  src="$SRC_ROOT/$id"
  dest="$DSH_HOME/.agent-presets/$id"
  echo ""
  echo "── $id ──"
  echo "目标位置：$dest"

  if [ -d "$dest" ]; then
    if diff -rq "$src" "$dest" >/dev/null 2>&1; then
      echo "已是最新，无需改动。"
      continue
    fi
    if [ "$FORCE" -ne 1 ]; then
      echo "" >&2
      echo "拒绝覆盖：$dest 已存在且与预设不同。" >&2
      echo "  这通常意味着你已经改过自己的预设（比如调了口吻）。" >&2
      echo "  确认要覆盖请加 --force（会先备份到 $dest.bak.<时间戳>）。" >&2
      FAILED=1
      continue
    fi
    backup="$dest.bak.$(date +%Y%m%d%H%M%S)"
    cp -r "$dest" "$backup"
    echo "已备份原预设 → $backup"
  fi

  mkdir -p "$dest"
  cp -r "$src/." "$dest/"
  echo "✅ 已安装：$dest"
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo ""
echo "安装完成。在新建对话页的模式滑块里选："
echo "  「纯文本对话模式」—— 只带联网搜索与表情包，不做编码 / Shell。"
echo "  「昔涟工作模式」  —— 昔涟人设 + 全套文件 / Shell / 计划 / 子代理工具。"
echo ""
echo "提示：两者都用 complete: true 整份替换系统提示词，共享同一份长期记忆"
echo "      （<DSH_HOME>/cyrene-memory.md）。"
