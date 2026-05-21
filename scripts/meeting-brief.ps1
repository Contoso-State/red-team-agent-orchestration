param(
    [Parameter(Mandatory = $true)]
    [string]$Account,
    [int]$Last = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-AccountPath {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$AccountInput
    )

    $slug = $AccountInput.ToLowerInvariant()
    $slug = [regex]::Replace($slug, "[^a-z0-9]+", "-")
    $slug = [regex]::Replace($slug, "-{2,}", "-").Trim("-")
    if ([string]::IsNullOrWhiteSpace($slug)) {
        throw "Invalid account: $AccountInput"
    }
    return (Join-Path $RepoRoot ("accounts\" + $slug))
}

function Find-LineValue {
    param(
        [string[]]$Lines,
        [string]$Prefix
    )
    $match = $Lines | Where-Object { $_ -like "$Prefix*" } | Select-Object -First 1
    if ($null -eq $match) { return "TBD" }
    return $match.Substring($Prefix.Length).Trim()
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$accountDir = Resolve-AccountPath -RepoRoot $repoRoot -AccountInput $Account

if (-not (Test-Path $accountDir -PathType Container)) {
    throw "Account folder not found: $accountDir"
}

$readmePath = Join-Path $accountDir "README.md"
if (-not (Test-Path $readmePath -PathType Leaf)) {
    throw "README.md not found: $readmePath"
}

$meetingsPath = Join-Path $accountDir "meetings"
if (-not (Test-Path $meetingsPath -PathType Container)) {
    throw "meetings folder not found: $meetingsPath"
}

$readmeLines = @(Get-Content -Path $readmePath -Encoding UTF8)
$accountTitle = ($readmeLines | Where-Object { $_ -like "# Account:*" } | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($accountTitle)) {
    $accountTitle = "# Account: $Account"
}

$industry = Find-LineValue -Lines $readmeLines -Prefix "- **Industry:**"
$dealStage = Find-LineValue -Lines $readmeLines -Prefix "- **Deal Stage:**"
$region = Find-LineValue -Lines $readmeLines -Prefix "- **Region:**"

$meetingDirs = @(Get-ChildItem -Path $meetingsPath -Directory | Sort-Object Name -Descending | Select-Object -First $Last)

$briefPath = Join-Path $accountDir "brief.md"
$lines = @()
$lines += "# Account Brief"
$lines += ""
$lines += "## Account"
$lines += "- $accountTitle"
$lines += "- **Industry:** $industry"
$lines += "- **Region:** $region"
$lines += "- **Deal Stage:** $dealStage"
$lines += ""
$lines += "## Recent Meetings"
$lines += "| Date | Topic | Intended Decision | Actual Outcome | Folder |"
$lines += "|------|-------|-------------------|----------------|--------|"

if ($meetingDirs.Count -eq 0) {
    $lines += "| TBD | TBD | TBD | TBD | TBD |"
}
else {
    foreach ($meetingDir in $meetingDirs) {
        $name = $meetingDir.Name
        $date = if ($name -match '^(\d{4}-\d{2}-\d{2})-') { $Matches[1] } else { "TBD" }
        $topic = if ($name -match '^\d{4}-\d{2}-\d{2}-(.+)$') { $Matches[1].Replace("-", " ") } else { $name }
        $topic = (Get-Culture).TextInfo.ToTitleCase($topic)

        $meetingFile = Join-Path $meetingDir.FullName "meeting.md"
        $postmortemFile = Join-Path $meetingDir.FullName "postmortem.md"

        $decision = "TBD"
        if (Test-Path $meetingFile -PathType Leaf) {
            $decisionLine = Get-Content $meetingFile -Encoding UTF8 | Where-Object { $_ -like "- **Single decision needed:** *" } | Select-Object -First 1
            if (-not [string]::IsNullOrWhiteSpace($decisionLine)) {
                $decision = $decisionLine.Replace("- **Single decision needed:**", "").Trim()
            }
        }

        $actual = "TBD"
        if (Test-Path $postmortemFile -PathType Leaf) {
            $actualLine = Get-Content $postmortemFile -Encoding UTF8 | Where-Object { $_ -like "- **Actual:** *" } | Select-Object -First 1
            if (-not [string]::IsNullOrWhiteSpace($actualLine)) {
                $actual = $actualLine.Replace("- **Actual:**", "").Trim()
            }
        }

        $relFolder = "accounts\" + (Split-Path $accountDir -Leaf) + "\meetings\" + $meetingDir.Name
        $lines += "| $date | $topic | $decision | $actual | $relFolder |"
    }
}

$lines += ""
$lines += "## Current Focus"
$lines += "- Update this section after each call with the top 3 priorities for the next interaction."

$content = ($lines -join "`r`n")
Set-Content -Path $briefPath -Value $content -Encoding UTF8

Write-Output "Updated account brief: $briefPath"
