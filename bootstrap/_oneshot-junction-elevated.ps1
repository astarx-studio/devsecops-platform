#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$log = 'D:\devsecops-platform\bootstrap\_oneshot-junction.log'
function Write-Log([string]$m) {
  Add-Content -Path $log -Value ('[{0}] elevated {1}' -f (Get-Date -Format o), $m)
}

Add-Type -Namespace Win32 -Name Native2 -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
public static extern bool MoveFileEx(string lpExistingFileName, string lpNewFileName, int dwFlags);
"@

$MOVEFILE_DELAY_UNTIL_REBOOT = 4
$old = 'C:\Users\MSAMS\._D\.projects\__SERVER__\devsecops-platform'
$live = 'D:\devsecops-platform'
$oldLong = '\\?\' + $old

try {
  Write-Log 'start'
  if (-not (Test-Path -LiteralPath $old)) {
    Write-Log 'old missing - create junction only'
  } else {
    $i = Get-Item -LiteralPath $old -Force
    if ($i.LinkType -eq 'Junction') {
      Write-Log ('already ' + ($i.Target -join ','))
      exit 0
    }
    # evacuate leftovers
    $aside = 'C:\Users\MSAMS\._D\.projects\__SERVER__\devsecops-platform.__on_C_before_junction'
    if (-not (Test-Path -LiteralPath $aside)) { New-Item -ItemType Directory -Path $aside | Out-Null }
    Get-ChildItem -LiteralPath $old -Force -ErrorAction SilentlyContinue | ForEach-Object {
      $d = Join-Path $aside $_.Name
      if (-not (Test-Path -LiteralPath $d)) {
        Move-Item -LiteralPath $_.FullName -Destination $d -Force
        Write-Log ('moved ' + $_.Name)
      }
    }
    try {
      Remove-Item -LiteralPath $old -Force -ErrorAction Stop
      Write-Log 'rmdir_ok'
    }
    catch {
      Write-Log ('rmdir_fail: ' + $_.Exception.Message)
      $ok = [Win32.Native2]::MoveFileEx($oldLong, $null, $MOVEFILE_DELAY_UNTIL_REBOOT)
      if (-not $ok) {
        $ok2 = [Win32.Native2]::MoveFileEx($old, $null, $MOVEFILE_DELAY_UNTIL_REBOOT)
        if (-not $ok2) {
          $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
          throw "MoveFileEx failed win32=$err"
        }
      }
      Write-Log 'scheduled_delete_reboot'
      # Still try create junction at a temp name? After reboot old is gone.
      $runner = 'D:\devsecops-platform\bootstrap\_postboot-junction.ps1'
      @'
$old = "C:\Users\MSAMS\._D\.projects\__SERVER__\devsecops-platform"
$live = "D:\devsecops-platform"
$log = "D:\devsecops-platform\bootstrap\_oneshot-junction.log"
function L($m){ Add-Content $log ("[{0}] postboot {1}" -f (Get-Date -Format o), $m) }
Start-Sleep 3
if (Test-Path -LiteralPath $old) {
  $i = Get-Item -LiteralPath $old -Force
  if ($i.LinkType -eq "Junction") { L "already"; exit 0 }
  Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $old) { L "still exists"; exit 1 }
cmd /c "mklink /J `"$old`" `"$live`""
if ($LASTEXITCODE -ne 0) { L "mklink $LASTEXITCODE"; exit 1 }
L "JUNCTION_OK"
Unregister-ScheduledTask -TaskName "DSOaaS-FinishJunctionPostBoot" -Confirm:$false -ErrorAction SilentlyContinue
'@ | Set-Content -Path $runner -Encoding ASCII
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory 'D:\'
      $trigger = New-ScheduledTaskTrigger -AtLogOn
      Unregister-ScheduledTask -TaskName 'DSOaaS-FinishJunctionPostBoot' -Confirm:$false -ErrorAction SilentlyContinue
      Register-ScheduledTask -TaskName 'DSOaaS-FinishJunctionPostBoot' -Action $action -Trigger $trigger -Force | Out-Null
      Write-Log 'NEED_REBOOT'
      exit 2
    }
  }

  if (Test-Path -LiteralPath $old) { throw 'old still present' }
  cmd /c "mklink /J `"$old`" `"$live`""
  if ($LASTEXITCODE -ne 0) { throw "mklink $LASTEXITCODE" }
  Write-Log 'JUNCTION_OK'
  exit 0
}
catch {
  Write-Log ('FAIL: ' + $_.Exception.Message)
  exit 1
}
