@echo off
REM 把 preset\ 装到 %USERPROFILE%\.dsh\.agent-presets\chat\
REM 用法：install.bat            首次安装
REM       install.bat --force    覆盖已有预设（会先备份）
REM       install.bat --uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 (
  echo.
  echo 安装失败，请查看上方错误信息。
  pause
  exit /b 1
)
pause
