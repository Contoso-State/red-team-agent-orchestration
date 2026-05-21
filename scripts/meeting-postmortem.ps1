param(
    [string]$MeetingFolder,
    [string]$ActualOutcome,
    [string]$Wins,
    [string]$Misses,
    [string]$RiskSignals,
    [string]$StakeholderChanges,
    [string]$NextCallAdjustments,
    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RequiredAnswer {
    param(
        [Parameter(Mandatory=$true)][string]$Prompt,
        [string]$CurrentValue
    )
    if (-not [string]::IsNullOrWhiteSpace($CurrentValue)) {
        return $CurrentValue.Trim()
    }
    if ($NonInteractive) {
        throw "Missing required parameter: $Prompt"
    }
    while ($true) {
        $value = Read-Host $Prompt
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value.Trim()
        }
    }
}

function Get-OptionalAnswer {
    param(
        [Parameter(Mandatory=$true)][string]$Prompt,
        [string]$CurrentValue
    )
    if (-not [string]::IsNullOrWhiteSpace($CurrentValue)) {
        return $CurrentValue.Trim()
    }
    if ($NonInteractive) {
        return ""
    }
    $value = Read-Host $Prompt
    if ([string]::IsNullOrWhiteSpace($value)) {
        return ""
    }
    return $value.Trim()
}

function To-Bullets {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) {
        Write-Output "- TBD"
        return
    }
    $parts = @($Text.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
    if ($parts.Count -eq 0) {
        Write-Output "- TBD"
        return
    }
    $parts | ForEach-Object { "- $_" }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ([string]::IsNullOrWhiteSpace($MeetingFolder)) {
    if ($NonInteractive) {
        throw "Missing required parameter: MeetingFolder"
    }
    $MeetingFolder = Read-Host "Meeting folder (relative path under accounts\..., or absolute path)"
}

if ([string]::IsNullOrWhiteSpace($MeetingFolder)) {
    throw "MeetingFolder cannot be empty."
}

$resolvedFolder = $MeetingFolder
if (-not [System.IO.Path]::IsPathRooted($resolvedFolder)) {
    $resolvedFolder = Join-Path $repoRoot $MeetingFolder
}

if (-not (Test-Path $resolvedFolder -PathType Container)) {
    throw "Meeting folder not found: $resolvedFolder"
}

$meetingFile = Join-Path $resolvedFolder "meeting.md"
if (-not (Test-Path $meetingFile -PathType Leaf)) {
    throw "meeting.md not found in folder: $resolvedFolder"
}

$postmortemFile = Join-Path $resolvedFolder "postmortem.md"

$meetingHeader = (Get-Content $meetingFile -Encoding UTF8 | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($meetingHeader)) {
    $meetingHeader = "# Meeting"
}

$ActualOutcome = Get-RequiredAnswer -Prompt "Actual outcome from the call" -CurrentValue $ActualOutcome
$Wins = Get-OptionalAnswer -Prompt "What went well (semicolon-separated)" -CurrentValue $Wins
$Misses = Get-OptionalAnswer -Prompt "What missed (semicolon-separated)" -CurrentValue $Misses
$RiskSignals = Get-OptionalAnswer -Prompt "Risk signals observed (semicolon-separated)" -CurrentValue $RiskSignals
$StakeholderChanges = Get-OptionalAnswer -Prompt "Stakeholder map changes (semicolon-separated)" -CurrentValue $StakeholderChanges
$NextCallAdjustments = Get-OptionalAnswer -Prompt "Adjustments for next call (semicolon-separated)" -CurrentValue $NextCallAdjustments

$lines = @()
$lines += "# Postmortem"
$lines += ""
$lines += "## Source Meeting"
$lines += "- $meetingHeader"
$lines += ""
$lines += "## Intended vs Actual Outcome"
$lines += "- **Actual:** $ActualOutcome"
$lines += ""
$lines += "## What Went Well"
$lines += @(To-Bullets $Wins)
$lines += ""
$lines += "## What Missed"
$lines += @(To-Bullets $Misses)
$lines += ""
$lines += "## Risk Signals Observed"
$lines += @(To-Bullets $RiskSignals)
$lines += ""
$lines += "## Stakeholder Map Changes"
$lines += @(To-Bullets $StakeholderChanges)
$lines += ""
$lines += "## Adjustments for Next Call"
$lines += @(To-Bullets $NextCallAdjustments)

$content = ($lines -join "`r`n")

Set-Content -Path $postmortemFile -Value $content -Encoding UTF8
Write-Output "Updated postmortem: $postmortemFile"
