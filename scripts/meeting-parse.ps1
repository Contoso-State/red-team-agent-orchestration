param(
    [Parameter(Mandatory = $true)]
    [string]$MeetingFolder
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function To-Bullets {
    param([string[]]$Items)

    if (($null -eq $Items) -or ($Items.Count -eq 0)) {
        return @("- TBD")
    }
    return @($Items | ForEach-Object { "- $_" })
}

function Resolve-MeetingFolder {
    param(
        [Parameter(Mandatory = $true)][string]$Folder,
        [Parameter(Mandatory = $true)][string]$RepoRoot
    )

    if ([System.IO.Path]::IsPathRooted($Folder)) {
        return $Folder
    }
    return (Join-Path $RepoRoot $Folder)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedFolder = Resolve-MeetingFolder -Folder $MeetingFolder -RepoRoot $repoRoot

if (-not (Test-Path $resolvedFolder -PathType Container)) {
    throw "Meeting folder not found: $resolvedFolder"
}

$transcriptFile = Join-Path $resolvedFolder "transcript.txt"
if (-not (Test-Path $transcriptFile -PathType Leaf)) {
    throw "transcript.txt not found: $transcriptFile"
}

$parsedFile = Join-Path $resolvedFolder "parsed.md"
$meetingFile = Join-Path $resolvedFolder "meeting.md"

$meetingHeader = if (Test-Path $meetingFile -PathType Leaf) {
    (Get-Content $meetingFile -Encoding UTF8 | Select-Object -First 1)
}
else {
    "# Meeting"
}

$lines = @(Get-Content -Path $transcriptFile -Encoding UTF8)

$decisions = New-Object System.Collections.Generic.List[string]
$actions = New-Object System.Collections.Generic.List[string]
$risks = New-Object System.Collections.Generic.List[string]
$questions = New-Object System.Collections.Generic.List[string]
$productMentions = New-Object System.Collections.Generic.HashSet[string]

$productKeywords = @(
    "Defender for Cloud",
    "Defender for Servers",
    "Defender XDR",
    "Microsoft Sentinel",
    "Microsoft Entra",
    "Microsoft Intune",
    "Microsoft Purview",
    "Security Copilot",
    "Azure Arc",
    "Azure Bastion",
    "PIM",
    "JIT",
    "KQL"
)

foreach ($lineRaw in $lines) {
    $line = $lineRaw.Trim()
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }

    if ($line -match '^(Decision|Decided|Outcome)\s*[:\-]\s*(.+)$') {
        [void]$decisions.Add($Matches[2].Trim())
    }
    elseif ($line -match '^(Action|Next Step|Todo|To-Do)\s*[:\-]\s*(.+)$') {
        [void]$actions.Add($Matches[2].Trim())
    }
    elseif ($line -match '^(Risk|Concern|Objection)\s*[:\-]\s*(.+)$') {
        [void]$risks.Add($Matches[2].Trim())
    }
    elseif ($line -match '^(Question|Q)\s*[:\-]\s*(.+)$') {
        [void]$questions.Add($Matches[2].Trim())
    }

    foreach ($keyword in $productKeywords) {
        if ($line.IndexOf($keyword, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            [void]$productMentions.Add($keyword)
        }
    }
}

$actionRows = @("| Owner | Action | Due Date |", "|-------|--------|----------|")
if ($actions.Count -gt 0) {
    foreach ($action in $actions) {
        $actionRows += "| TBD | $action | TBD |"
    }
}
else {
    $actionRows += "| TBD | TBD | TBD |"
}

$contentLines = @()
$contentLines += "# Parsed Transcript"
$contentLines += ""
$contentLines += "## Source Meeting"
$contentLines += "- $meetingHeader"
$contentLines += ""
$contentLines += "## Decisions"
$contentLines += @(To-Bullets -Items $decisions.ToArray())
$contentLines += ""
$contentLines += "## Action Items"
$contentLines += $actionRows
$contentLines += ""
$contentLines += "## Risks & Objections"
$contentLines += @(To-Bullets -Items $risks.ToArray())
$contentLines += ""
$contentLines += "## Follow-up Questions"
$contentLines += @(To-Bullets -Items $questions.ToArray())
$contentLines += ""
$contentLines += "## Product / Workload Mentions"
$contentLines += @(To-Bullets -Items @($productMentions))

$content = ($contentLines -join "`r`n")
Set-Content -Path $parsedFile -Value $content -Encoding UTF8

Write-Output "Updated parsed notes: $parsedFile"
