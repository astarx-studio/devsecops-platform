#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"

$ProgramData = Join-Path $env:ProgramData "HITL Proxy"
$ServiceDir = Join-Path $ProgramData "service"
$WinSwExe = Join-Path $ServiceDir "HitlProxyService.exe"
$TaskName = "HITL Proxy UI"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "HITL|hitl-proxy|HitlProxy" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (Test-Path $WinSwExe) {
  & $WinSwExe stop
  & $WinSwExe uninstall
}

Write-Host "HITL Proxy service/task removed. Config/data left in $ProgramData (delete manually if desired)."
