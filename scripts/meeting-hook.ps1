param(
    [ValidateSet("pre","post")]
    [string]$Mode,
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

if ([string]::IsNullOrWhiteSpace($Mode)) {
    if ($NonInteractive) {
        throw "Missing required parameter: Mode (pre|post)"
    }
    $Mode = Read-Host "Mode (pre|post)"
}

$prepScript = Join-Path $PSScriptRoot "meeting-prep.ps1"
$postScript = Join-Path $PSScriptRoot "meeting-postmortem.ps1"

switch ($Mode.ToLowerInvariant()) {
    "pre" {
        & $prepScript `
            -Account $Account `
            -Topic $Topic `
            -MeetingDate $MeetingDate `
            -MeetingType $MeetingType `
            -Attendees $Attendees `
            -DecisionNeeded $DecisionNeeded `
            -BestCaseOutcome $BestCaseOutcome `
            -FallbackOutcome $FallbackOutcome `
            -ChangesSinceLastCall $ChangesSinceLastCall `
            -PriorityPains $PriorityPains `
            -ProofRequired $ProofRequired `
            -EvidenceReady $EvidenceReady `
            -LikelyObjections $LikelyObjections `
            -CompetitiveRisk $CompetitiveRisk `
            -ExecutionRisk $ExecutionRisk `
            -CustomerCommitment $CustomerCommitment `
            -MicrosoftCommitment $MicrosoftCommitment `
            -ArtifactsShared $ArtifactsShared `
            -NonInteractive:$NonInteractive
        break
    }
    "post" {
        & $postScript `
            -MeetingFolder $MeetingFolder `
            -ActualOutcome $ActualOutcome `
            -Wins $Wins `
            -Misses $Misses `
            -RiskSignals $RiskSignals `
            -StakeholderChanges $StakeholderChanges `
            -NextCallAdjustments $NextCallAdjustments `
            -NonInteractive:$NonInteractive
        break
    }
    default {
        throw "Unknown mode: $Mode"
    }
}
