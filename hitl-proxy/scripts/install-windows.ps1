#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install HITL Proxy Windows service (WinSW) + Electron tray UI at logon.
#>
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ProgramData = Join-Path $env:ProgramData "HITL Proxy"
$ServiceDir = Join-Path $ProgramData "service"
$DataDir = Join-Path $ProgramData "data"
$EnvFile = Join-Path $ProgramData "hitl.env"
$WinSwExe = Join-Path $ServiceDir "HitlProxyService.exe"
$WinSwXml = Join-Path $ServiceDir "HitlProxyService.xml"
# Prefer system Node - fnm multishell shims disappear when the shell exits.
$Node = $null
foreach ($candidate in @(
    "${env:ProgramFiles}\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe"
  )) {
  if (Test-Path $candidate) { $Node = $candidate; break }
}
if (-not $Node) {
  $Node = (Get-Command node -ErrorAction Stop).Source
}
Write-Host "Using node: $Node"

New-Item -ItemType Directory -Force -Path $ProgramData, $ServiceDir, $DataDir | Out-Null

if (-not (Test-Path $EnvFile)) {
  $sample = Join-Path $Root "sample.env"
  Copy-Item $sample $EnvFile
  $token = -join ((1..48) | ForEach-Object { "{0:x}" -f (Get-Random -Max 16) })
  (Get-Content $sample) `
    -replace "change-me-hitl-mcp-token", $token `
    -replace "# HITL_DATA_DIR=.*", "HITL_DATA_DIR=$DataDir" |
    Set-Content -Encoding UTF8 $EnvFile
  Write-Host "Created $EnvFile (edit HITL_MCP_TOKEN if desired)."
}

function Read-HitlEnv([string]$path) {
  $map = @{}
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $map[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
  }
  return $map
}

$envMap = Read-HitlEnv $EnvFile
$Port = if ($envMap["HITL_PORT"]) { $envMap["HITL_PORT"] } else { "3877" }
$HostBind = if ($envMap["HITL_HOST"]) { $envMap["HITL_HOST"] } else { "127.0.0.1" }
$Token = $envMap["HITL_MCP_TOKEN"]
$Public = if ($envMap["PUBLIC_BASE_URL"]) { $envMap["PUBLIC_BASE_URL"] } else { "http://127.0.0.1:$Port" }
$Data = if ($envMap["HITL_DATA_DIR"]) { $envMap["HITL_DATA_DIR"] } else { $DataDir }

Push-Location $Root
try {
  npm install
  npm run build
} finally {
  Pop-Location
}

if (-not (Test-Path $WinSwExe)) {
  $url = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
  Write-Host "Downloading WinSW..."
  Invoke-WebRequest -Uri $url -OutFile $WinSwExe -UseBasicParsing
}

$serverJs = Join-Path $Root "dist\server\index.js"
if (-not (Test-Path $serverJs)) {
  throw "Missing $serverJs - build failed"
}

$xml = @"
<service>
  <id>HitlProxy</id>
  <name>HITL Proxy</name>
  <description>HITL Proxy MCP/API service (localhost only). Stop this service to shut down HITL.</description>
  <executable>$Node</executable>
  <arguments>"$serverJs"</arguments>
  <workingdirectory>$Root</workingdirectory>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
  <onfailure action="restart" delay="5 sec"/>
  <env name="HITL_PORT" value="$Port"/>
  <env name="HITL_HOST" value="$HostBind"/>
  <env name="PUBLIC_BASE_URL" value="$Public"/>
  <env name="HITL_MCP_TOKEN" value="$Token"/>
  <env name="HITL_DATA_DIR" value="$Data"/>
  <env name="NODE_ENV" value="production"/>
</service>
"@
[System.IO.File]::WriteAllText($WinSwXml, $xml)

& $WinSwExe stop 2>$null
& $WinSwExe uninstall 2>$null
& $WinSwExe install
& $WinSwExe start

$ElectronCmd = Join-Path $Root "node_modules\electron\dist\electron.exe"
$MainCjs = Join-Path $Root "dist\electron\main.cjs"
$TaskName = "HITL Proxy UI"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# --tray: start minimized to tray (no dashboard window). Required for logon.
$arg = "`"$MainCjs`" --tray"
$action = New-ScheduledTaskAction -Execute $ElectronCmd -Argument $arg -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Delay so Explorer/shell tray is up; avoid race that exits Electron with code 1.
$trigger.Delay = "PT45S"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -Hidden `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null

# Clear only HITL Proxy Run-key leftovers (do not touch other Electron apps).
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
foreach ($name in @("HITL Proxy", "hitl-proxy", "HitlProxy", "electron.app.HITL Proxy")) {
  Remove-ItemProperty -Path $runKey -Name $name -ErrorAction SilentlyContinue
}

Start-Process -FilePath $ElectronCmd -ArgumentList $arg -WorkingDirectory $Root -WindowStyle Hidden

$stdio = (Join-Path $Root "dist\stdio\mcp-bridge.js") -replace "\\", "/"

Write-Host ""
Write-Host "HITL Proxy installed."
Write-Host "  Service: HitlProxy (services.msc)"
Write-Host "  UI: scheduled task '$TaskName' at logon (tray)"
Write-Host "  Config: $EnvFile"
Write-Host ""
Write-Host "Cursor MCP stdio:"
Write-Host "  command: node"
Write-Host "  args: $stdio"
Write-Host "  HITL_MCP_URL: http://127.0.0.1:$Port/mcp"
Write-Host "  HITL_MCP_TOKEN: (see $EnvFile)"
Write-Host ""
Write-Host "HTTP MCP: POST http://127.0.0.1:$Port/mcp with Bearer token"
