$ErrorActionPreference = 'Stop'
Set-Location 'D:\'
$log = 'D:\devsecops-platform\bootstrap\_oneshot-junction.log'

function Write-Log([string]$m) {
  Add-Content -Path $log -Value ('[{0}] {1}' -f (Get-Date -Format o), $m)
}

# Win32 MoveFileEx - schedule delete of empty locked dir until reboot if needed
Add-Type -Namespace Win32 -Name Native -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
public static extern bool MoveFileEx(string lpExistingFileName, string lpNewFileName, int dwFlags);
"@

$MOVEFILE_DELAY_UNTIL_REBOOT = 4

try {
  Write-Log 'start-v2'
  $old = 'C:\Users\MSAMS\._D\.projects\__SERVER__\devsecops-platform'
  $live = 'D:\devsecops-platform'
  $asideName = 'devsecops-platform.__on_C_before_junction'
  $parent = Split-Path $old -Parent
  $aside = Join-Path $parent $asideName
  $pendingLink = Join-Path $parent 'devsecops-platform.__pending_junction_target.txt'

  $i = Get-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
  if ($null -ne $i -and $i.LinkType -eq 'Junction') {
    Write-Log ('already junction ' + ($i.Target -join ','))
    exit 0
  }

  # Ensure aside exists (children may already have been evacuated)
  if (-not (Test-Path -LiteralPath $aside)) {
    New-Item -ItemType Directory -Path $aside -Force | Out-Null
  }

  if ($null -ne $i) {
    # Evacuate any remaining children
    Get-ChildItem -LiteralPath $old -Force -ErrorAction SilentlyContinue | ForEach-Object {
      $dest = Join-Path $aside $_.Name
      if (Test-Path -LiteralPath $dest) {
        Write-Log ('skip existing in aside: ' + $_.Name)
      } else {
        Write-Log ('move ' + $_.Name)
        Move-Item -LiteralPath $_.FullName -Destination $dest -Force
      }
    }

    # Try immediate remove
    $removed = $false
    try {
      Remove-Item -LiteralPath $old -Force -ErrorAction Stop
      $removed = $true
      Write-Log 'removed_empty_old'
    }
    catch {
      Write-Log ('rmdir_blocked: ' + $_.Exception.Message)
      $ok = [Win32.Native]::MoveFileEx($old, $null, $MOVEFILE_DELAY_UNTIL_REBOOT)
      if (-not $ok) {
        $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "MoveFileEx DELAY_UNTIL_REBOOT failed win32=$err"
      }
      Write-Log 'scheduled_delete_on_reboot'
      Set-Content -Path $pendingLink -Value $live -Encoding ASCII
      # Register RunOnce / logon task to create junction after reboot
      $runner = @'
$old = "C:\Users\MSAMS\._D\.projects\__SERVER__\devsecops-platform"
$live = "D:\devsecops-platform"
$log = "D:\devsecops-platform\bootstrap\_oneshot-junction.log"
function L($m){ Add-Content $log ("[{0}] postboot {1}" -f (Get-Date -Format o), $m) }
Start-Sleep 5
if (Test-Path -LiteralPath $old) {
  $i = Get-Item -LiteralPath $old -Force
  if ($i.LinkType -eq "Junction") { L "already ok"; exit 0 }
  try { Remove-Item -LiteralPath $old -Force -ErrorAction Stop; L "removed leftover" } catch { L ("still present: "+$_.Exception.Message); exit 1 }
}
cmd /c "mklink /J `"$old`" `"$live`""
if ($LASTEXITCODE -ne 0) { L "mklink fail $LASTEXITCODE"; exit 1 }
L "JUNCTION_OK"
Unregister-ScheduledTask -TaskName "DSOaaS-FinishJunctionPostBoot" -Confirm:$false -ErrorAction SilentlyContinue
'@
      $runnerPath = 'D:\devsecops-platform\bootstrap\_postboot-junction.ps1'
      Set-Content -Path $runnerPath -Value $runner -Encoding ASCII
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`"" -WorkingDirectory 'D:\'
      $trigger = New-ScheduledTaskTrigger -AtLogOn
      Unregister-ScheduledTask -TaskName 'DSOaaS-FinishJunctionPostBoot' -Confirm:$false -ErrorAction SilentlyContinue
      Register-ScheduledTask -TaskName 'DSOaaS-FinishJunctionPostBoot' -Action $action -Trigger $trigger -Force | Out-Null
      Write-Log 'registered_postboot_task'
      Write-Log 'NEED_REBOOT_OR_RELOGIN'
      Write-Host 'NEED_REBOOT_OR_RELOGIN'
      exit 2
    }
  }

  if (Test-Path -LiteralPath $old) {
    throw "old path still exists: $old"
  }

  $linkCmd = 'mklink /J "' + $old + '" "' + $live + '"'
  $p = Start-Process -FilePath cmd.exe -ArgumentList @('/c', $linkCmd) -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    throw "mklink exit $($p.ExitCode)"
  }
  $j = Get-Item -LiteralPath $old -Force
  Write-Log ('LinkType=' + $j.LinkType + ' Target=' + ($j.Target -join ','))
  if (-not (Test-Path -LiteralPath (Join-Path $old '.env'))) {
    throw 'env missing through junction'
  }
  Write-Log 'JUNCTION_OK'
  Write-Host 'JUNCTION_OK'
  exit 0
}
catch {
  Write-Log ('FAIL: ' + $_.Exception.Message)
  Write-Host ('FAIL: ' + $_.Exception.Message)
  exit 1
}
