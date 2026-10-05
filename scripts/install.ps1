# 把 preset\ 下的每个子目录装到 %USERPROFILE%\.dsh\.agent-presets\<id>\
#
# DSH 没有公开的 agent 预设安装 API：dsh-agent-presets 只按
# ~/.dsh/.agent-presets/<id>/ 目录扫描发现预设。
#
# 预设 id **自动发现**：preset\chat\ → 装成 chat，preset\cyrene-work\ → cyrene-work。
# 以后再加预设只要在 preset\ 下新建目录，本脚本不用改。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Force
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Uninstall
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$SrcRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'preset'
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }

if (-not (Test-Path $SrcRoot)) {
    Write-Error "找不到预设源目录：$SrcRoot"
    exit 1
}

# 自动发现：每个含 agent.cordis.yml 的子目录就是一个预设。
$PresetIds = @(Get-ChildItem -Path $SrcRoot -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'agent.cordis.yml') } |
    Sort-Object Name | ForEach-Object { $_.Name })

if ($PresetIds.Count -eq 0) {
    Write-Error "错误：$SrcRoot 下没有找到任何预设（需要 <id>\agent.cordis.yml）"
    exit 1
}

Write-Host "预设源：$SrcRoot"
Write-Host "发现预设：$($PresetIds -join ' ')"

function Get-DirHash([string]$Path) {
    # 对目录内所有文件按相对路径排序后求内容哈希，用于判断"是否已是最新"
    $files = Get-ChildItem -Path $Path -Recurse -File | Sort-Object FullName
    $sb = New-Object System.Text.StringBuilder
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($Path.Length).TrimStart('\', '/')
        [void]$sb.Append($rel)
        [void]$sb.Append((Get-FileHash -Algorithm SHA256 -Path $f.FullName).Hash)
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '')
}

if ($Uninstall) {
    foreach ($id in $PresetIds) {
        $dest = Join-Path $DshHome ".agent-presets\$id"
        if (Test-Path $dest) {
            Remove-Item -Recurse -Force $dest
            Write-Host "已卸载预设：$dest"
        } else {
            Write-Host "无需卸载：$dest 不存在"
        }
    }
    exit 0
}

$Failed = 0
foreach ($id in $PresetIds) {
    $src  = Join-Path $SrcRoot $id
    $dest = Join-Path $DshHome ".agent-presets\$id"
    Write-Host ""
    Write-Host "── $id ──"
    Write-Host "目标位置：$dest"

    if (Test-Path $dest) {
        if ((Get-DirHash $src) -eq (Get-DirHash $dest)) {
            Write-Host "已是最新，无需改动。"
            continue
        }
        if (-not $Force) {
            Write-Host ""
            Write-Error @"
拒绝覆盖：$dest 已存在且与预设不同。
  这通常意味着你已经改过自己的预设（比如调了口吻）。
  确认要覆盖请加 -Force（会先备份）。
"@
            $Failed = 1
            continue
        }
        $Backup = "$dest.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Copy-Item -Recurse -Force $dest $Backup
        Write-Host "已备份原预设 → $Backup"
    }

    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Recurse -Force (Join-Path $src '*') $dest
    Write-Host "OK 已安装：$dest"
}

if ($Failed -ne 0) { exit 1 }

Write-Host ""
Write-Host "安装完成。在新建对话页的模式滑块里选："
Write-Host "  「纯文本对话模式」—— 只带联网搜索与表情包，不做编码 / Shell。"
Write-Host "  「昔涟工作模式」  —— 昔涟人设 + 全套文件 / Shell / 计划 / 子代理工具。"
Write-Host ""
Write-Host "提示：两者都用 complete: true 整份替换系统提示词，共享同一份长期记忆"
Write-Host "      （$DshHome\cyrene-memory.md）。"
