<#
.SYNOPSIS
    Shared helpers for the red team PowerShell tools (dot-source this file).

.DESCRIPTION
    Centralizes repo-root and session resolution so New-Session.ps1,
    Invoke-Preflight.ps1, and Export-Inventory.ps1 agree on a single active
    session and behave the same regardless of the caller's working directory.

    Dot-source from a sibling script:
        . (Join-Path $PSScriptRoot 'Common.ps1')
#>

function Get-RepoRoot {
    # Common.ps1 lives in <repo>/tools/powershell, so the repo root is two levels up.
    (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Get-CurrentSessionFile {
    Join-Path (Get-RepoRoot) 'engagements/.current-session'
}

function Resolve-SessionPath {
    <#
        Resolution order (first match wins):
          1. explicit -SessionPath argument
          2. $env:REDTEAM_SESSION
          3. engagements/.current-session (the recorded active session)
          4. a new ./engagements/<timestamp> folder
        Relative paths are anchored to the repo root so output never depends on cwd.
    #>
    param([string]$SessionPath)

    $repoRoot = Get-RepoRoot
    if (-not $SessionPath) { $SessionPath = $env:REDTEAM_SESSION }
    if (-not $SessionPath) {
        $marker = Get-CurrentSessionFile
        if (Test-Path $marker) {
            $recorded = (Get-Content $marker -Raw).Trim()
            if ($recorded) { $SessionPath = $recorded }
        }
    }
    if (-not $SessionPath) { $SessionPath = "engagements/$(Get-Date -Format 'yyyy-MM-dd-HHmmss')" }

    if (-not [System.IO.Path]::IsPathRooted($SessionPath)) {
        $SessionPath = Join-Path $repoRoot $SessionPath
    }
    return $SessionPath
}

function Set-CurrentSession {
    param([Parameter(Mandatory)][string]$SessionPath)
    $marker = Get-CurrentSessionFile
    New-Item -ItemType Directory -Path (Split-Path $marker) -Force | Out-Null
    Set-Content -Path $marker -Value $SessionPath -NoNewline
}

function ConvertTo-JsonArrayFile {
    <# Serialize a collection as a JSON ARRAY (PowerShell unrolls single/zero-element
       pipelines, so force an array and handle the empty case explicitly). #>
    param([object[]]$Items, [Parameter(Mandatory)][string]$Path, [int]$Depth = 10)
    if ($null -eq $Items -or $Items.Count -eq 0) {
        Set-Content -Path $Path -Value '[]'
    } else {
        ConvertTo-Json -InputObject @($Items) -Depth $Depth | Set-Content -Path $Path
    }
}
