$log = 'D:\devsecops-platform\bootstrap\_oneshot-junction.log'
function Write-Log([string]$m) {
  Add-Content -Path $log -Value ('[{0}] logon {1}' -f (Get-Date -Format o), $m)
}

$old = 'C:\Users\MSAMS\._D\.projects\__SERVER__\devsecops-platform'
$live = 'D:\devsecops-platform'
$emptyAlt = 'C:\Users\MSAMS\._D\.projects\__SERVER__\devsecops-platform.__empty_locked'
$aside = 'C:\Users\MSAMS\._D\.projects\__SERVER__\devsecops-platform.__on_C_before_junction'

try {
  Write-Log 'start'
  if (Test-Path -LiteralPath $old) {
    $i = Get-Item -LiteralPath $old -Force
    if ($i.LinkType -eq 'Junction') {
      Write-Log ('already ' + ($i.Target -join ','))
      Unregister-ScheduledTask -TaskName 'DSOaaS-FinishJunctionPostBoot' -Confirm:$false -ErrorAction SilentlyContinue
      exit 0
    }
    if (-not (Test-Path -LiteralPath $aside)) {
      New-Item -ItemType Directory -Path $aside | Out-Null
    }
    Get-ChildItem -LiteralPath $old -Force -ErrorAction SilentlyContinue | ForEach-Object {
      $d = Join-Path $aside $_.Name
      if (-not (Test-Path -LiteralPath $d)) {
        Move-Item -LiteralPath $_.FullName -Destination $d -Force
      }
    }
    Remove-Item -LiteralPath $old -Force -ErrorAction Stop
    Write-Log 'removed_old'
  }
  if (Test-Path -LiteralPath $emptyAlt) {
    Remove-Item -LiteralPath $emptyAlt -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $old) {
    throw 'old still exists'
  }
  cmd /c "mklink /J `"$old`" `"$live`""
  if ($LASTEXITCODE -ne 0) {
    throw "mklink $LASTEXITCODE"
  }
  Write-Log 'JUNCTION_OK'
  Unregister-ScheduledTask -TaskName 'DSOaaS-FinishJunctionPostBoot' -Confirm:$false -ErrorAction SilentlyContinue
  exit 0
}
catch {
  Write-Log ('WAIT: ' + $_.Exception.Message)
  exit 1
}
