param(
    [string]$Account,
    [string]$Topic,
    [datetime]$MeetingDate = (Get-Date),
    [string]$MeetingType = "Discovery",
    [string]$Attendees,
    [string]$DecisionNeeded,
    [string]$BestCaseOutcome,
    [string]$FallbackOutcome,
    [string]$ChangesSinceLastCall,
    [string]$PriorityPains,
    [string]$ProofRequired,
    [string]$EvidenceReady,
    [string]$LikelyObjections,
    [ValidateSet("None","Low","Medium","High")]
    [string]$CompetitiveRisk = "Medium",
    [ValidateSet("None","Low","Medium","High")]
    [string]$ExecutionRisk = "Medium",
    [string]$CustomerCommitment,
    [string]$MicrosoftCommitment,
    [string]$ArtifactsShared,
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

function Convert-ToBulletLines {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return @("- TBD")
    }

    $parts = @($Text.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
    if ($parts.Count -eq 0) {
        return @("- TBD")
    }
    return $parts | ForEach-Object { "- $_" }
}

function Convert-ToNumberedLines {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return @("1. TBD")
    }

    $parts = @($Text.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
    if ($parts.Count -eq 0) {
        return @("1. TBD")
    }

    $index = 1
    return $parts | ForEach-Object {
        $line = "$index. $_"
        $index++
        $line
    }
}

function Get-Slug {
    param([string]$Text)

    $slug = $Text.ToLowerInvariant()
    $slug = [regex]::Replace($slug, "[^a-z0-9]+", "-")
    $slug = [regex]::Replace($slug, "-{2,}", "-").Trim("-")
    if ([string]::IsNullOrWhiteSpace($slug)) {
        return "meeting"
    }
    return $slug
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$Account = Get-RequiredAnswer -Prompt "Account folder name (e.g., pheaa)" -CurrentValue $Account
$Topic = Get-RequiredAnswer -Prompt "Meeting topic/title" -CurrentValue $Topic
$Attendees = Get-OptionalAnswer -Prompt "Attendees (semicolon-separated)" -CurrentValue $Attendees
$DecisionNeeded = Get-RequiredAnswer -Prompt "Single decision needed from this call" -CurrentValue $DecisionNeeded
$BestCaseOutcome = Get-OptionalAnswer -Prompt "Best-case outcome by end of call" -CurrentValue $BestCaseOutcome
$FallbackOutcome = Get-OptionalAnswer -Prompt "Fallback outcome if decision deferred" -CurrentValue $FallbackOutcome
$ChangesSinceLastCall = Get-OptionalAnswer -Prompt "What changed since last call (semicolon-separated)" -CurrentValue $ChangesSinceLastCall
$PriorityPains = Get-OptionalAnswer -Prompt "Top pains for this call (semicolon-separated)" -CurrentValue $PriorityPains
$ProofRequired = Get-OptionalAnswer -Prompt "Proof required this call" -CurrentValue $ProofRequired
$EvidenceReady = Get-OptionalAnswer -Prompt "Evidence/artifacts already ready" -CurrentValue $EvidenceReady
$LikelyObjections = Get-OptionalAnswer -Prompt "Likely objections (semicolon-separated)" -CurrentValue $LikelyObjections
$CustomerCommitment = Get-OptionalAnswer -Prompt "Customer commitment needed (owner + date)" -CurrentValue $CustomerCommitment
$MicrosoftCommitment = Get-OptionalAnswer -Prompt "Microsoft commitment (owner + date)" -CurrentValue $MicrosoftCommitment
$ArtifactsShared = Get-OptionalAnswer -Prompt "Artifacts expected to be shared (semicolon-separated)" -CurrentValue $ArtifactsShared

$accountDir = Join-Path $repoRoot ("accounts\" + $Account)
if (-not (Test-Path $accountDir -PathType Container)) {
    throw "Account folder not found: $accountDir"
}

$topicSlug = Get-Slug $Topic
$dateStamp = $MeetingDate.ToString("yyyy-MM-dd")
$meetingDir = Join-Path $accountDir ("meetings\" + $dateStamp + "-" + $topicSlug)
New-Item -ItemType Directory -Path $meetingDir -Force | Out-Null

$meetingFile = Join-Path $meetingDir "meeting.md"
$transcriptFile = Join-Path $meetingDir "transcript.txt"
$parsedFile = Join-Path $meetingDir "parsed.md"
$postmortemFile = Join-Path $meetingDir "postmortem.md"

$changesLines = Convert-ToNumberedLines $ChangesSinceLastCall
$painLines = Convert-ToNumberedLines $PriorityPains
$objectionLines = Convert-ToBulletLines $LikelyObjections
$artifactLines = Convert-ToBulletLines $ArtifactsShared

$attendeesDisplay = if ([string]::IsNullOrWhiteSpace($Attendees)) { "TBD" } else { $Attendees }
$bestCaseDisplay = if ([string]::IsNullOrWhiteSpace($BestCaseOutcome)) { "TBD" } else { $BestCaseOutcome }
$fallbackDisplay = if ([string]::IsNullOrWhiteSpace($FallbackOutcome)) { "TBD" } else { $FallbackOutcome }
$proofDisplay = if ([string]::IsNullOrWhiteSpace($ProofRequired)) { "TBD" } else { $ProofRequired }
$evidenceDisplay = if ([string]::IsNullOrWhiteSpace($EvidenceReady)) { "TBD" } else { $EvidenceReady }
$customerCommitmentDisplay = if ([string]::IsNullOrWhiteSpace($CustomerCommitment)) { "TBD" } else { $CustomerCommitment }
$microsoftCommitmentDisplay = if ([string]::IsNullOrWhiteSpace($MicrosoftCommitment)) { "TBD" } else { $MicrosoftCommitment }

$meetingLines = @()
$meetingLines += "# Meeting Packet - $dateStamp - $Topic"
$meetingLines += ""
$meetingLines += "## Meeting Info"
$meetingLines += "- **Date:** $dateStamp"
$meetingLines += "- **Account:** $Account"
$meetingLines += "- **Type:** $MeetingType"
$meetingLines += "- **Attendees:** $attendeesDisplay"
$meetingLines += ""
$meetingLines += "## Decision & Outcome"
$meetingLines += "- **Single decision needed:** $DecisionNeeded"
$meetingLines += "- **Best-case outcome:** $bestCaseDisplay"
$meetingLines += "- **Fallback outcome:** $fallbackDisplay"
$meetingLines += ""
$meetingLines += "## Current State Delta"
$meetingLines += $changesLines
$meetingLines += ""
$meetingLines += "## Priority Pains"
$meetingLines += $painLines
$meetingLines += ""
$meetingLines += "## Proof Required"
$meetingLines += "- **Proof to show:** $proofDisplay"
$meetingLines += "- **Evidence ready:** $evidenceDisplay"
$meetingLines += ""
$meetingLines += "## Objections & Risk"
$meetingLines += "- **Likely objections:**"
$meetingLines += $objectionLines
$meetingLines += "- **Competitive risk:** $CompetitiveRisk"
$meetingLines += "- **Execution risk:** $ExecutionRisk"
$meetingLines += ""
$meetingLines += "## Commitments"
$meetingLines += "- **Customer commitment needed:** $customerCommitmentDisplay"
$meetingLines += "- **Microsoft commitment:** $microsoftCommitmentDisplay"
$meetingLines += ""
$meetingLines += "## Agenda"
$meetingLines += "1. Confirm desired decision and success criteria"
$meetingLines += "2. Review changed conditions and risk blockers"
$meetingLines += "3. Walk through technical proof and open objections"
$meetingLines += "4. Lock owners, dates, and next milestone"
$meetingLines += ""
$meetingLines += "## Live Notes"
$meetingLines += ""
$meetingLines += "## Action Items"
$meetingLines += "| Owner | Action | Due Date |"
$meetingLines += "|-------|--------|----------|"
$meetingLines += "| TBD | TBD | TBD |"
$meetingLines += ""
$meetingLines += "## Next Steps"
$meetingLines += "- TBD"
$meetingLines += ""
$meetingLines += "## Artifacts Expected This Call"
$meetingLines += $artifactLines

$meetingContent = ($meetingLines -join "`r`n")

Set-Content -Path $meetingFile -Value $meetingContent -Encoding UTF8

if (-not (Test-Path $transcriptFile)) {
    Set-Content -Path $transcriptFile -Value "# Paste raw transcript here`r`n" -Encoding UTF8
}

if (-not (Test-Path $parsedFile)) {
    $parsedContent = @(
"# Parsed Transcript - $dateStamp - $Topic",
"",
"## Decisions",
"- TBD",
"",
"## Action Items",
"| Owner | Action | Due Date |",
"|-------|--------|----------|",
"| TBD | TBD | TBD |",
"",
"## Risks & Objections",
"- TBD",
"",
"## Follow-up Questions",
"- TBD",
"",
"## Product / Workload Mentions",
"- TBD"
) -join "`r`n"
    Set-Content -Path $parsedFile -Value $parsedContent -Encoding UTF8
}

if (-not (Test-Path $postmortemFile)) {
    $postmortemContent = @(
"# Postmortem - $dateStamp - $Topic",
"",
"## Intended vs Actual Outcome",
"- **Intended:** $DecisionNeeded",
"- **Actual:** TBD",
"",
"## What Went Well",
"- TBD",
"",
"## What Missed",
"- TBD",
"",
"## Risk Signals Observed",
"- TBD",
"",
"## Stakeholder Map Changes",
"- TBD",
"",
"## Adjustments for Next Call",
"- TBD"
) -join "`r`n"
    Set-Content -Path $postmortemFile -Value $postmortemContent -Encoding UTF8
}

Write-Output "Created meeting package:"
Write-Output "  $meetingFile"
Write-Output "  $transcriptFile"
Write-Output "  $parsedFile"
Write-Output "  $postmortemFile"
