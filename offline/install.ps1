# 作息（Rhythm）离线安装脚本（PowerShell）
# 用法：右键「使用 PowerShell 运行」，或在终端执行：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = 'Stop'
$app = Join-Path $env:LOCALAPPDATA 'Programs\Coopanion'
if (-not (Test-Path -LiteralPath (Join-Path $app 'Coopanion.exe'))) {
  Write-Host "[X] 没找到 Coopanion：$app" -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

$tgz = Join-Path $PSScriptRoot 'cortico-world-rhythm-1.0.5-offline.tgz'
if (-not (Test-Path -LiteralPath $tgz)) {
  Write-Host "[X] 没找到安装包：$tgz" -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

$ext = Join-Path $app 'data\extensions'
$store = Join-Path $app 'data\pnpm\store\v11'
$pnpm = Join-Path $app 'resources\app\node_modules\pnpm\bin\pnpm.cjs'
$env:ELECTRON_RUN_AS_NODE = '1'

Write-Host ''
Write-Host '正在把「作息」装进 Coopanion……'
Write-Host "  包：$tgz"
Write-Host "  目标：$ext"
Write-Host ''

$proc = Start-Process -FilePath (Join-Path $app 'Coopanion.exe') -ArgumentList @(
  "`"$pnpm`"", 'add', "`"$tgz`"",
  '--ignore-workspace', '--store-dir', "`"$store`"", '--config.minimumReleaseAge=0'
) -NoNewWindow -Wait -PassThru

if ($proc.ExitCode -ne 0) {
  Write-Host ''
  Write-Host '[X] 安装失败。可以把上面的输出发给开发者。' -ForegroundColor Red
  Read-Host '按回车退出'
  exit $proc.ExitCode
}

Write-Host ''
Write-Host '[OK] 安装完成。' -ForegroundColor Green
Write-Host '  1. 打开 Coopanion 控制台 →「模块」；'
Write-Host '  2. 找到「作息」，打开开关；'
Write-Host '  3. 如果它已经在运行，重启「作息」模块（或整个应用）让新代码生效。'
Read-Host '按回车退出'
