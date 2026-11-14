$ErrorActionPreference = 'Stop'
$runner = 'D:\devsecops-platform\bootstrap\_postboot-junction.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory 'D:\'
$trigger = New-ScheduledTaskTrigger -AtLogOn
Unregister-ScheduledTask -TaskName 'DSOaaS-FinishJunctionPostBoot' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'DSOaaS-FinishJunctionPostBoot' -Action $action -Trigger $trigger -Force | Out-Null
Write-Host 'TASK_OK'
Get-ScheduledTask -TaskName 'DSOaaS-FinishJunctionPostBoot' | Select-Object TaskName, State
