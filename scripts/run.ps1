# Runs one of this plugin's .mjs scripts inside Coopanion's bundled Node.
#
# Coopanion.exe is a GUI-subsystem binary: calling it with `&` returns at once and
# captures nothing. Everything here therefore goes through Start-Process -Wait with
# redirected stdio, and the exit code is passed back to the caller.
#
# Usage (from the plugin directory):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run.ps1 check.mjs
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run.ps1 check.mjs --write
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run.ps1 smoke.mjs
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$projectRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $env:LOCALAPPDATA 'Programs\Coopanion'
$exe = Join-Path $appRoot 'Coopanion.exe'
$frameworkRoot = Join-Path $appRoot 'resources\app'
$runtime = Join-Path $frameworkRoot 'build\cortico\src\extensions\runtime.ts'
$scriptPath = Join-Path $projectRoot "scripts\$Script"

if (-not (Test-Path -LiteralPath $exe)) { throw "Coopanion.exe not found: $exe" }
if (-not (Test-Path -LiteralPath $runtime)) { throw "framework runtime not found: $runtime" }
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "script not found: $scriptPath" }

$outFile = [System.IO.Path]::GetTempFileName()
$errFile = [System.IO.Path]::GetTempFileName()

$env:ELECTRON_RUN_AS_NODE = '1'
# --import takes a module specifier, not a Windows path: an absolute path like
# C:\... would be read as a URL with scheme "c:". Hand Node a file:// URL there.
# The entry script stays a plain path: percent-encoding inside a URL gets mangled
# again by Start-Process' argument quoting when the path contains CJK characters.
$runtimeUrl = ([System.Uri]$runtime).AbsoluteUri
# tsx is resolved from the framework's own node_modules, hence -WorkingDirectory below.
$arguments = @('--import', 'tsx', '--import', "`"$runtimeUrl`"", "`"$scriptPath`"")
foreach ($item in $Rest) { $arguments += "`"$item`"" }

$process = Start-Process -FilePath $exe -ArgumentList $arguments `
  -WorkingDirectory $frameworkRoot -NoNewWindow -Wait -PassThru `
  -RedirectStandardOutput $outFile -RedirectStandardError $errFile

$out = Get-Content -LiteralPath $outFile -Encoding utf8
$err = Get-Content -LiteralPath $errFile -Encoding utf8
Remove-Item -LiteralPath $outFile, $errFile -Force

if ($out) { $out | Write-Output }
if ($err) { $err | ForEach-Object { [Console]::Error.WriteLine($_) } }
exit $process.ExitCode
