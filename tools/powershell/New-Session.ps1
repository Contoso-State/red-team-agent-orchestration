<#
.SYNOPSIS
    Scaffold a new Azure red team engagement session folder.

.DESCRIPTION
    Creates the full per-assessment session tree under ./engagements/<session> so every
    downstream tool has its output directory ready:

        <session>/
          inventory/          # resource inventory (Export-Inventory.ps1)
          findings/raw/        # per-agent findings .jsonl
          evidence/raw/        # gitignored raw evidence
          reports/             # findings.json, attack-paths.json, report.html
          engagement.yaml      # copied from engagement.example.yaml if absent

    Also records the path in ./engagements/.current-session and prints the value to
    export as REDTEAM_SESSION so Invoke-Preflight.ps1 / Export-Inventory.ps1 reuse it.

    Read-only with respect to Azure — only creates local files. The engagements/
    tree is gitignored; real target data must never be committed.

.PARAMETER Name
    Short engagement slug used in the folder name. Defaults to "session".

.PARAMETER SessionPath
    Explicit session folder. Overrides -Name. Defaults to
    ./engagements/<Name>-<yyyy-MM-dd-HHmmss>.

.EXAMPLE
    pwsh ./tools/powershell/New-Session.ps1 -Name acme-2026-q2
    $env:REDTEAM_SESSION = "<printed path>"
#>
[CmdletBinding()]
param(
    [string]$Name = "session",
    [string]$SessionPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'Common.ps1')
$repoRoot = Get-RepoRoot

if (-not $SessionPath) {
    $stamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
    $SessionPath = "engagements/$Name-$stamp"
}
if (-not [System.IO.Path]::IsPathRooted($SessionPath)) {
    $SessionPath = Join-Path $repoRoot $SessionPath
}

foreach ($sub in @("inventory", "findings/raw", "evidence/raw", "reports")) {
    $d = Join-Path $SessionPath $sub
    New-Item -ItemType Directory -Path $d -Force | Out-Null
}

# Seed engagement.yaml from the example if the session doesn't already have one.
$engagementFile = Join-Path $SessionPath "engagement.yaml"
$example = Join-Path $repoRoot "engagement.example.yaml"
if ((-not (Test-Path $engagementFile)) -and (Test-Path $example)) {
    Copy-Item $example $engagementFile
    Write-Host "Seeded engagement.yaml from engagement.example.yaml — fill in real scope." -ForegroundColor Yellow
}

# Record the active session.
Set-CurrentSession $SessionPath

Write-Host "Created session: $SessionPath" -ForegroundColor Green
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  `$env:REDTEAM_SESSION = `"$SessionPath`""
Write-Host "  pwsh ./tools/powershell/Invoke-Preflight.ps1 -EngagementFile `"$engagementFile`""
