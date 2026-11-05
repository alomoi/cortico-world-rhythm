@echo off
chcp 65001 >nul
setlocal
title 作息（Rhythm）离线安装

set "APP=%LOCALAPPDATA%\Programs\Coopanion"
if not exist "%APP%\Coopanion.exe" (
  echo [X] 没找到 Coopanion：%APP%
  echo     请先安装 Coopanion，或把本脚本放到正确的机器上。
  pause
  exit /b 1
)

set "TGZ=%~dp0cortico-world-rhythm-1.0.5-offline.tgz"
if not exist "%TGZ%" (
  echo [X] 没找到安装包：%TGZ%
  echo     请把 tgz 和本脚本放在同一个文件夹里。
  pause
  exit /b 1
)

set "EXT=%APP%\data\extensions"
set "STORE=%APP%\data\pnpm\store\v11"
set "PNPM=%APP%\resources\app\node_modules\pnpm\bin\pnpm.cjs"
set "ELECTRON_RUN_AS_NODE=1"

echo.
echo 正在把「作息」装进 Coopanion……
echo   包：%TGZ%
echo   目标：%EXT%
echo.

"%APP%\Coopanion.exe" "%PNPM%" add "%TGZ%" --ignore-workspace --store-dir "%STORE%" --config.minimumReleaseAge=0
if errorlevel 1 (
  echo.
  echo [X] 安装失败。可以把上面的输出发给开发者。
  pause
  exit /b 1
)

echo.
echo [OK] 安装完成。
echo   1. 打开 Coopanion 控制台 →「模块」；
echo   2. 找到「作息」，打开开关；
echo   3. 如果它已经在运行，重启「作息」模块（或整个应用）让新代码生效。
echo.
pause
