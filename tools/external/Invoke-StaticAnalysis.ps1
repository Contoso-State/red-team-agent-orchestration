<#
.SYNOPSIS
    Invoke-StaticAnalysis — run OFFLINE static analysis (Semgrep) over website code that was
    pulled read-only from an in-scope Azure resource, for the External Vulnerability Agent (EVA).

.DESCRIPTION
    This is the extended, OPT-IN, OFFLINE feature. It sends NO traffic to any target. It only
    reads files already retrieved into the engagement's static working directory and runs a
    pattern/dataflow analyzer over them. Retrieved code is NEVER built, installed, or executed.

    Hard gate — ALL must be true before this runs:
      * engagement.yaml -> mode: external-active-testing
      * external_testing.enabled: true
      * external_testing.authorization.attested_by AND attestation_id set
      * external_testing.static_analysis.enabled: true   (separate opt-in)

    Scope: the source tree MUST live under the active session's static dir
        engagements/<session>/static/...
    which is gitignored (engagements/* is ignored), so retrieved code never enters the repo.

    Defense in depth: this wrapper does not send network traffic, so the egress guardrail is not
    involved — the safety here is (1) the static_analysis gate and (2) confining the analyzed
    path to the session static dir + offline-only execution of Semgrep.

.PARAMETER Source
    Path to the retrieved code tree to analyze. Must resolve to a location UNDER
    engagements/<session>/static/. Required.

.PARAMETER Cwd
    Repository root (where engagement.yaml and engagements/ live). Defaults to current dir.

.PARAMETER Session
    Session directory name or path under engagements/. Defaults to the active session recorded
    in engagements/.current-session.

.PARAMETER Config
    One or more Semgrep configs/rule packs. Defaults to the OWASP + secrets packs.

.PARAMETER ExtraArgs
    Additional arguments passed through to semgrep.

.PARAMETER DryRun
    Print the exact command that would run, but do not execute it.

.EXAMPLE
    pwsh tools/external/Invoke-StaticAnalysis.ps1 -Source engagements/<session>/static/myapp

.EXAMPLE
    pwsh tools/external/Invoke-StaticAnalysis.ps1 -Source engagements/<session>/static/myapp -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [string]$Cwd = '.',

    [string]$Session,

    [string[]]$Config = @('p/owasp-top-ten', 'p/secrets'),

    [string[]]$ExtraArgs = @(),

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Fail([string]$msg) {
    Write-Error "Invoke-StaticAnalysis refused to run: $msg"
    exit 2
}

$repoRoot = (Resolve-Path -LiteralPath $Cwd).Path

# --- Resolve the active session ---------------------------------------------------------
if (-not $Session) {
    $marker = Join-Path $repoRoot 'engagements/.current-session'
    if (-not (Test-Path -LiteralPath $marker)) {
        Fail "no active session (engagements/.current-session is missing). Run New-Session.ps1 first."
    }
    $Session = (Get-Content -LiteralPath $marker -Raw).Trim()
}
if ([System.IO.Path]::IsPathRooted($Session)) {
    $sessionDir = (Resolve-Path -LiteralPath $Session).Path
} elseif ($Session -match '[\\/]') {
    $sessionDir = (Resolve-Path -LiteralPath (Join-Path $repoRoot $Session)).Path
} else {
    $sessionDir = Join-Path $repoRoot (Join-Path 'engagements' $Session)
}

# --- Re-check the authorization gate locally --------------------------------------------
$engagementYaml = Join-Path $repoRoot 'engagement.yaml'
if (-not (Test-Path -LiteralPath $engagementYaml)) {
    Fail "engagement.yaml not found at repo root; static analysis requires an authorized engagement."
}
$yamlText = Get-Content -LiteralPath $engagementYaml -Raw

$mode = $null
if ($yamlText -match '(?m)^\s*mode:\s*[''"]?([\w-]+)') { $mode = $Matches[1] }
if ($mode -ne 'external-active-testing') {
    Fail "engagement mode is '$mode'; static analysis requires mode: external-active-testing."
}

# Pull the external_testing block (best-effort, no YAML dependency).
$etBlock = ''
$lines = $yamlText -split "`r?`n"
$capture = $false
foreach ($line in $lines) {
    if ($line -match '^external_testing\s*:') { $capture = $true; continue }
    if ($capture) {
        if ($line -match '^\S' -and $line.Trim() -ne '') { break }
        $etBlock += "$line`n"
    }
}
if ($etBlock -notmatch '(?m)^\s*enabled:\s*[''"]?(true|yes|on|1)\b') {
    Fail "external_testing.enabled is not true in engagement.yaml."
}
if ($etBlock -notmatch '(?m)^\s*attested_by:\s*[''"]?\S') {
    Fail "external_testing.authorization.attested_by is not set in engagement.yaml."
}
if ($etBlock -notmatch '(?m)^\s*attestation_id:\s*[''"]?\S') {
    Fail "external_testing.authorization.attestation_id is not set in engagement.yaml."
}

# Separate opt-in: the static_analysis sub-block must itself be enabled.
$saBlock = ''
$saLines = $etBlock -split "`r?`n"
$saCapture = $false
$saIndent = -1
foreach ($line in $saLines) {
    if ($line -match '^(\s*)static_analysis\s*:') { $saCapture = $true; $saIndent = $Matches[1].Length; continue }
    if ($saCapture) {
        if ($line.Trim() -eq '') { continue }
        $indent = ($line -replace '\S.*$', '').Length
        if ($indent -le $saIndent) { break }
        $saBlock += "$line`n"
    }
}
if ($saBlock -notmatch '(?m)^\s*enabled:\s*[''"]?(true|yes|on|1)\b') {
    Fail "external_testing.static_analysis.enabled is not true — this OFFLINE feature is opt-in and off by default."
}

# --- Confine the source tree to the session static dir ----------------------------------
if (-not (Test-Path -LiteralPath $Source)) {
    Fail "source path '$Source' does not exist. Retrieve code read-only into engagements/<session>/static/ first."
}
$srcPath = (Resolve-Path -LiteralPath $Source).Path
$staticRoot = (Resolve-Path -LiteralPath $sessionDir).Path
$staticRoot = Join-Path $staticRoot 'static'
$srcNorm = $srcPath.TrimEnd('\', '/')
$rootNorm = $staticRoot.TrimEnd('\', '/')
if ($srcNorm -ne $rootNorm -and -not $srcNorm.StartsWith($rootNorm + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Fail "source must live under '$staticRoot' (the gitignored session static dir). Got '$srcPath'."
}

# --- Build the OFFLINE semgrep invocation -----------------------------------------------
$findingsDir = Join-Path $sessionDir 'findings/raw'
if (-not (Test-Path -LiteralPath $findingsDir)) { New-Item -ItemType Directory -Force -Path $findingsDir | Out-Null }
$outFile = Join-Path $findingsDir 'eva-sast.json'

$cfgArgs = @()
foreach ($c in $Config) { $cfgArgs += @('--config', $c) }

# --metrics off keeps it fully offline (no telemetry). We never build/install/run the code.
$inv = @('semgrep') + $cfgArgs + @('--json', '--output', $outFile, '--metrics', 'off', '--error', '--timeout', '120') + $ExtraArgs + @($srcPath)

Write-Host "OFFLINE static analysis (no network traffic)" -ForegroundColor Cyan
Write-Host "Source: $srcPath" -ForegroundColor DarkGray
Write-Host "Output: $outFile" -ForegroundColor DarkGray

if (-not (Get-Command 'semgrep' -ErrorAction SilentlyContinue)) {
    Write-Warning "'semgrep' is not installed / not on PATH. Showing the command instead (install: pipx install semgrep):"
    $DryRun = $true
}

$display = ($inv | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
if ($DryRun) {
    Write-Host "DRYRUN: $display"
    exit 0
}
Write-Host "RUN: $display" -ForegroundColor Green
& $inv[0] @($inv[1..($inv.Count - 1)])
