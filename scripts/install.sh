#!/usr/bin/env bash
# Linux / macOS 的入口 —— 真正的逻辑在 scripts/install.mjs（跨平台、同一份行为）。
#
# 为什么只剩一行 exec：安装会写 <DSH_HOME>/.agent-presets/ 和 profile 的
# cordis.patch.yml，属于"Profile 变更"。这类写入要有一次性计划、精确确认、前置哈希、
# 原子提交、健康检查和回滚 —— 两套实现（bash + node）迟早会漂移，所以只保留 Node 那份。
#
# 需要 Node 22+（与 package.json 的 engines 一致）。
#
# 用法（参数原样传给 install.mjs）：
#   scripts/install.sh --dry-run     # 只打印计划
#   scripts/install.sh --yes         # 非交互确认
#   scripts/install.sh --force       # 覆盖已有且不同的预设
#   scripts/install.sh --rollback    # 按 journal 恢复到安装前
#   scripts/install.sh --uninstall   # 卸载
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install.mjs" "$@"
