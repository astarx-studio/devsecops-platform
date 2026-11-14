$ErrorActionPreference = 'Stop'
& "$PSScriptRoot\finish-repo-junction-to-d.ps1" -Force -Confirm:$false
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
