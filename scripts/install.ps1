# 把 preset/ 装到 %USERPROFILE%\.dsh\.agent-presets\chat\
#
# DSH 没有公开的 agent 预设安装 API：dsh-agent-presets 只按
# ~/.dsh/.agent-presets/<id>/ 目录扫描发现预设。
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

$PresetId  = 'chat'
$SrcDir    = Join-Path (Split-Path -Parent $PSScriptRoot) 'preset'
$DshHome   = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$DestDir   = Join-Path $DshHome ".agent-presets\$PresetId"

if (-not (Test-Path $SrcDir)) {
    Write-Error "找不到预设源目录：$SrcDir"
    exit 1
}

if ($Uninstall) {
    if (Test-Path $DestDir) {
        Remove-Item -Recurse -Force $DestDir
        Write-Host "已卸载预设：$DestDir"
    } else {
        Write-Host "无需卸载：$DestDir 不存在"
    }
    exit 0
}

Write-Host "预设源：$SrcDir"
Write-Host "目标位置：$DestDir"

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

if (Test-Path $DestDir) {
    if ((Get-DirHash $SrcDir) -eq (Get-DirHash $DestDir)) {
        Write-Host "已是最新，无需改动。"
        exit 0
    }
    if (-not $Force) {
        Write-Host ""
        Write-Error @"
拒绝覆盖：目标目录已存在且与预设不同。
  这通常意味着你已经改过自己的预设（比如调了口吻）。
  确认要覆盖请加 -Force（会先备份）。
"@
        exit 1
    }
    $Backup = "$DestDir.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
    Copy-Item -Recurse -Force $DestDir $Backup
    Write-Host "已备份原预设 → $Backup"
}

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $SrcDir '*') $DestDir

Write-Host ""
Write-Host "OK 预设已安装：$DestDir"
Write-Host "   在 DSH 界面右上角的模式选择器里选「纯文本对话模式」即可。"
Write-Host ""
Write-Host "提示：该预设使用 complete: true 整份替换系统提示词，"
Write-Host "      因此该模式下不提供文件 / Shell / 设备工具，只保留联网搜索与表情包。"
