#Requires -Version 5.1
<#
.SYNOPSIS
  Finish DSOaaS C: to D: cutover junction.

.DESCRIPTION
  Handles three states:
  1) Old path is a normal full folder -> rename/evacuate aside, then junction
  2) Old path is empty but locked -> tells you to close Cursor on C: / re-login
  3) Old path already a junction -> verify only

  Live stack must already be on D:\devsecops-platform.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File D:\devsecops-platform\bootstrap\finish-repo-junction-to-d.ps1 -Force
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [string] $LiveRoot = 'D:\devsecops-platform',
  [string] $OldRoot = 'C:\Users\MSAMS\._D\.projects\__SERVER__\devsecops-platform',
  [string] $AsideName = 'devsecops-platform.__on_C_before_junction',
  [switch] $DeleteAside,
  [switch] $KeepBackups,
  [switch] $Force
)

$ErrorActionPreference = 'Stop'

function Write-Step([string] $msg) {
  Write-Host "[finish-junction] $msg"
}

function Test-IsJunction([string] $path) {
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  $i = Get-Item -LiteralPath $path -Force
  return ($i.LinkType -eq 'Junction')
}

function Get-JunctionTarget([string] $path) {
  $i = Get-Item -LiteralPath $path -Force
  $t = $i.Target
  if ($t -is [array]) { $t = $t[0] }
  return [string]$t
}

Write-Step "LiveRoot = $LiveRoot"
Write-Step "OldRoot  = $OldRoot"

if (-not (Test-Path -LiteralPath (Join-Path $LiveRoot '.env'))) {
  throw "Live tree missing .env under $LiveRoot - abort."
}
if (-not (Test-Path -LiteralPath (Join-Path $LiveRoot '.vols\vault\unseal-keys'))) {
  throw "Live tree missing .vols\vault\unseal-keys under $LiveRoot - abort."
}

$parent = Split-Path -Parent $OldRoot
$aside = Join-Path $parent $AsideName

if (Test-IsJunction $OldRoot) {
  $target = Get-JunctionTarget $OldRoot
  Write-Step "Already a junction -> $target"
  if ($target.TrimEnd('\') -ne $LiveRoot.TrimEnd('\')) {
    throw "Junction points at unexpected target. Expected $LiveRoot"
  }
}
elseif (-not (Test-Path -LiteralPath $OldRoot)) {
  Write-Step 'OldRoot missing - creating junction...'
  if (-not $WhatIfPreference) {
    $linkCmd = 'mklink /J "' + $OldRoot + '" "' + $LiveRoot + '"'
    $p = Start-Process -FilePath cmd.exe -ArgumentList @('/c', $linkCmd) -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "mklink exit $($p.ExitCode)" }
  }
}
else {
  $kids = @(Get-ChildItem -LiteralPath $OldRoot -Force -ErrorAction SilentlyContinue)
  Write-Step ("OldRoot child_count=" + $kids.Count)

  if (-not $WhatIfPreference) {
    if (-not $Force -and -not $PSCmdlet.ShouldProcess($OldRoot, "Evacuate/junction to $LiveRoot")) {
      return
    }

    if (-not (Test-Path -LiteralPath $aside)) {
      New-Item -ItemType Directory -Path $aside -Force | Out-Null
    }

    foreach ($kid in $kids) {
      $dest = Join-Path $aside $kid.Name
      if (Test-Path -LiteralPath $dest) {
        Write-Step ("aside already has " + $kid.Name + " - skip")
      }
      else {
        Write-Step ("move " + $kid.Name)
        Move-Item -LiteralPath $kid.FullName -Destination $dest -Force
      }
    }

    try {
      Remove-Item -LiteralPath $OldRoot -Force -ErrorAction Stop
      Write-Step 'Removed empty OldRoot'
    }
    catch {
      Write-Host ''
      Write-Host 'LOCKED: Cursor (or another process) still holds the empty C: folder.' -ForegroundColor Yellow
      Write-Host 'Do this, then re-run this same command:' -ForegroundColor Yellow
      Write-Host '  1) File -> Open Folder -> D:\devsecops-platform' -ForegroundColor Yellow
      Write-Host '  2) Close any Cursor window still rooted on the old C: path' -ForegroundColor Yellow
      Write-Host '  3) Re-run:' -ForegroundColor Yellow
      Write-Host '     powershell -NoProfile -ExecutionPolicy Bypass -File D:\devsecops-platform\bootstrap\finish-repo-junction-to-d.ps1 -Force' -ForegroundColor Cyan
      Write-Host ''
      Write-Host 'A logon task DSOaaS-FinishJunctionPostBoot will also retry after you sign out/in.' -ForegroundColor Yellow
      throw ("Could not remove empty OldRoot: " + $_.Exception.Message)
    }

    $linkCmd = 'mklink /J "' + $OldRoot + '" "' + $LiveRoot + '"'
    $p = Start-Process -FilePath cmd.exe -ArgumentList @('/c', $linkCmd) -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "mklink exit $($p.ExitCode)" }
  }
}

if (-not $WhatIfPreference) {
  if (-not (Test-IsJunction $OldRoot)) {
    throw 'OldRoot is not a junction after operation.'
  }
  Write-Step ('Verified junction -> ' + (Get-JunctionTarget $OldRoot))
  foreach ($rel in @('.env', '.vols\gitlab', 'docker-compose.yml', 'bootstrap\watchdog.sh')) {
    $checkPath = Join-Path $OldRoot $rel
    if (-not (Test-Path -LiteralPath $checkPath)) {
      throw "Missing through junction: $checkPath"
    }
  }
  Write-Step 'Spot-checks through junction OK.'
  Unregister-ScheduledTask -TaskName 'DSOaaS-FinishJunctionPostBoot' -Confirm:$false -ErrorAction SilentlyContinue
}

if ($DeleteAside) {
  if (-not (Test-Path -LiteralPath $aside)) {
    Write-Step "No aside at $aside - skip delete."
  }
  elseif (-not $WhatIfPreference) {
    if (-not $PSCmdlet.ShouldProcess($aside, 'Delete C: aside copy')) { return }
    if ($KeepBackups) {
      $bakSrc = Join-Path $aside 'backups'
      $bakDst = Join-Path $parent 'devsecops-platform.backups-on-C'
      if (Test-Path -LiteralPath $bakSrc) {
        if (Test-Path -LiteralPath $bakDst) { throw "Backup park already exists: $bakDst" }
        Write-Step "Parking backups -> $bakDst"
        Move-Item -LiteralPath $bakSrc -Destination $bakDst
      }
    }
    Write-Step 'Deleting aside...'
    Remove-Item -LiteralPath $aside -Recurse -Force
    Write-Step 'Aside deleted.'
  }
}
else {
  if (Test-Path -LiteralPath $aside) {
    Write-Step "Aside kept at: $aside"
    Write-Step 'When ready: re-run with -DeleteAside -KeepBackups'
  }
}

Write-Step 'Done.'
