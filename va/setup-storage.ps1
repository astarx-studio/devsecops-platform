#Requires -Version 5.1
<#
.SYNOPSIS
  Put the VA stack's bind-mounted data on another drive.

.DESCRIPTION
  Makes <repo>\va\.vols a junction to -DataRoot (default C:\dsoaas-va\vols), the same
  way <repo>\backups points to C:\dsoaas-backups. Compose keeps using ./.vols.

  Safe to re-run:
    - junction already points at DataRoot  -> verified, nothing changed
    - va\.vols missing                     -> created as a junction
    - va\.vols is a real folder, empty     -> replaced by the junction
    - va\.vols is a real folder with data  -> stops; move the data yourself first
    - junction points somewhere else       -> stops

  Also writes the marker file the launcher checks (launcher\.va-storage), so scans
  cannot run with data landing on the wrong drive.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File D:\devsecops-platform\va\setup-storage.ps1
#>
[CmdletBinding()]
param(
  [string] $DataRoot = 'C:\dsoaas-va\vols'
)

$ErrorActionPreference = 'Stop'
$link = Join-Path $PSScriptRoot '.vols'

function Write-Step([string] $msg) { Write-Host "[va-storage] $msg" }

function Get-LinkTarget([string] $path) {
  $t = (Get-Item -LiteralPath $path -Force).Target
  if ($t -is [array]) { $t = $t[0] }
  return ([string] $t).TrimEnd('\')
}

Write-Step "link   = $link"
Write-Step "target = $DataRoot"

New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null

if (Test-Path -LiteralPath $link) {
  $item = Get-Item -LiteralPath $link -Force
  if ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink') {
    $target = Get-LinkTarget $link
    if ($target -ine $DataRoot.TrimEnd('\')) {
      throw "$link already links to '$target', not '$DataRoot'. Remove the link (rmdir, not rm -r) or pass -DataRoot '$target'."
    }
    Write-Step "junction already in place"
  }
  else {
    if (Get-ChildItem -LiteralPath $link -Force | Select-Object -First 1) {
      throw "$link is a real folder with data in it. Stop the va stack, move its contents to $DataRoot, delete the empty folder, then re-run."
    }
    Remove-Item -LiteralPath $link -Force
    New-Item -ItemType Junction -Path $link -Target $DataRoot | Out-Null
    Write-Step "replaced empty folder with junction"
  }
}
else {
  New-Item -ItemType Junction -Path $link -Target $DataRoot | Out-Null
  Write-Step "junction created"
}

$launcher = Join-Path $DataRoot 'launcher'
New-Item -ItemType Directory -Force -Path $launcher | Out-Null
$marker = Join-Path $launcher '.va-storage'
Set-Content -LiteralPath $marker -Value "VA data root: $DataRoot`nCreated by va/setup-storage.ps1" -Encoding ascii

# Prove the junction resolves to the data root from the repo side.
if (-not (Test-Path -LiteralPath (Join-Path $link 'launcher\.va-storage'))) {
  throw "Marker is not visible through $link; the junction is not working."
}
$drive = (Get-Item -LiteralPath $DataRoot).PSDrive
Write-Step ("ok. {0}: has {1:N0} GB free" -f $drive.Name, ($drive.Free / 1GB))
