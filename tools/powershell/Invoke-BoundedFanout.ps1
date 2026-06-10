<#
.SYNOPSIS
    Bounded, exposure-prioritized fan-out for per-resource (data-plane) checks.

.DESCRIPTION
    The expensive tail of a large-estate assessment is the set of checks that must
    call `az` once per resource (Defender plan state, Key Vault network/access model,
    storage data-plane settings, per-resource diagnostic settings, ...). Run UNBOUNDED,
    that loop melts under ARM/ARG throttling and blows the time budget on a subscription
    with thousands of resources.

    This helper is the single choke point every such loop runs through. It:

      * Ranks candidates by EXPOSURE so the highest-risk resources are assessed first
        within any budget (public/internet-facing/privileged/prod-tagged go first).
      * SAMPLES the long tail: at most -SamplePerType resources of each type get a
        per-resource call; the remainder is recorded as `sampled` (a documented
        coverage decision, never a silent gap).
      * Enforces a hard CALL BUDGET (-MaxResourceCalls) and a soft TIME BUDGET
        (-TimeBudgetMin); work not reached is recorded as `skipped-by-budget`.
      * Runs the per-resource check with a CONCURRENCY cap and exponential BACKOFF on
        HTTP 429 / ARM-ARG throttling.

    It returns the check results AND a coverage record per candidate
    (assessed / sampled / skipped-by-budget / failed), so the coverage matrix and the
    report can state exactly what was and was not inspected.

    Read-only: the -Check script block must only run read-only `az`/MCP calls. The
    repository guardrails hook still enforces the az/azd allowlist regardless.

    Values map 1:1 to the engagement `scale:` block (see schemas/engagement.schema.json
    and knowledge/scaling.md): SamplePerType, MaxResourceCalls, TimeBudgetMin,
    PrioritizeExposed, Concurrency.

.PARAMETER Resources
    Candidate resources to check — typically the NARROWED, ARG-filtered set for one
    check, NOT the whole inventory. Each item should have at least an `id`; `type`,
    `tags`, and an optional pre-computed `exposureRank` (higher = more exposed) refine
    ranking. Flags like `publicIp` / `internetFacing` are honored when present.

.PARAMETER Check
    Script block invoked once per scheduled resource. Receives the resource object as
    its single argument ($args[0]) and returns a result object (or $null for "clean").
    Must be read-only.

.PARAMETER Concurrency
    Max concurrent per-resource calls. Keep low enough to stay under ARM/ARG throttling
    across all fanned-out agents. Default 8.

.PARAMETER SamplePerType
    Max resources of a single type to subject to a per-resource call. 0 = no cap (full).

.PARAMETER MaxResourceCalls
    Hard ceiling on total per-resource calls across this invocation. 0 = unlimited.

.PARAMETER TimeBudgetMin
    Soft wall-clock budget in minutes. Checked between concurrency chunks; work not yet
    started past the budget is recorded as skipped-by-budget. 0 = no limit.

.PARAMETER PrioritizeExposed
    Rank candidates by exposure before sampling/scheduling so the riskiest resources are
    assessed first within any budget. Recommended for large estates.

.PARAMETER MaxRetries
    Max backoff retries on throttling errors per resource. Default 5.

.PARAMETER OutFile
    Optional path to write the full result object (results + coverage + stats) as JSON.

.EXAMPLE
    $cands = Get-Content inv.json | ConvertFrom-Json |
        Where-Object { $_.type -eq 'microsoft.storage/storageaccounts' }
    $r = ./tools/powershell/Invoke-BoundedFanout.ps1 -Resources $cands -PrioritizeExposed `
        -SamplePerType 50 -MaxResourceCalls 500 -Concurrency 8 -Check {
            param($res)
            $sa = az storage account show --ids $res.id -o json | ConvertFrom-Json
            if ($sa.allowBlobPublicAccess) {
                [pscustomobject]@{ resource_id = $res.id; issue = 'public-blob-access' }
            }
        }
    $r.results    # only the resources with issues
    $r.coverage   # one row per candidate: assessed / sampled / skipped-by-budget / failed
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][object[]]$Resources,
    [Parameter(Mandatory)][scriptblock]$Check,
    [int]$Concurrency = 8,
    [int]$SamplePerType = 0,
    [int]$MaxResourceCalls = 0,
    [int]$TimeBudgetMin = 0,
    [switch]$PrioritizeExposed,
    [int]$MaxRetries = 5,
    [string]$OutFile
)

$ErrorActionPreference = "Stop"

# Resource types commonly reachable from the internet — used only as a fallback
# exposure signal when the caller hasn't supplied an explicit exposureRank.
$internetReachable = @(
    'microsoft.network/publicipaddresses', 'microsoft.network/applicationgateways',
    'microsoft.network/loadbalancers', 'microsoft.network/frontdoors', 'microsoft.cdn/profiles',
    'microsoft.apimanagement/service', 'microsoft.web/sites', 'microsoft.web/staticsites',
    'microsoft.app/containerapps', 'microsoft.containerservice/managedclusters',
    'microsoft.network/bastionhosts', 'microsoft.network/virtualnetworkgateways'
)

function Get-ExposureRank {
    param([object]$Resource)
    # Caller-provided rank always wins.
    if ($null -ne $Resource.exposureRank) { return [double]$Resource.exposureRank }
    $score = 0.0
    if ($Resource.internetFacing) { $score += 60 }
    if ($Resource.publicIp) { $score += 40 }
    $t = ("" + $Resource.type).ToLowerInvariant()
    if ($internetReachable -contains $t) { $score += 50 }
    # Tag / name signals for production + privilege.
    $tagText = ""
    if ($Resource.tags) { try { $tagText = ($Resource.tags | ConvertTo-Json -Compress).ToLowerInvariant() } catch { } }
    if ($tagText -match 'prod') { $score += 20 }
    if (("" + $Resource.name + $Resource.id).ToLowerInvariant() -match 'prod') { $score += 10 }
    if ($tagText -match 'privileg|admin|pci|crown') { $score += 15 }
    return $score
}

# --- 1. Rank ---------------------------------------------------------------
$ranked = if ($PrioritizeExposed) {
    $Resources |
        Select-Object *, @{ n = '__rank'; e = { Get-ExposureRank $_ } } |
        Sort-Object -Property __rank -Descending
} else {
    $Resources
}

# --- 2. Sample per type + 3. apply call budget -> scheduled vs skipped ------
$perType = @{}
$scheduled = [System.Collections.Generic.List[object]]::new()
$coverage = [System.Collections.Generic.List[object]]::new()

foreach ($r in $ranked) {
    $type = ("" + $r.type).ToLowerInvariant()
    if (-not $perType.ContainsKey($type)) { $perType[$type] = 0 }

    if ($SamplePerType -gt 0 -and $perType[$type] -ge $SamplePerType) {
        $coverage.Add([pscustomobject]@{ resource_id = $r.id; type = $type; status = 'sampled'; reason = "per-type sample cap ($SamplePerType) reached" })
        continue
    }
    if ($MaxResourceCalls -gt 0 -and $scheduled.Count -ge $MaxResourceCalls) {
        $coverage.Add([pscustomobject]@{ resource_id = $r.id; type = $type; status = 'skipped-by-budget'; reason = "max_resource_calls ($MaxResourceCalls) reached" })
        continue
    }
    $perType[$type]++
    $scheduled.Add($r)
}

Write-Host ("Bounded fan-out: {0} candidate(s) -> {1} scheduled, {2} deferred (sampled/budget). Concurrency {3}." -f `
    $Resources.Count, $scheduled.Count, ($coverage.Count), $Concurrency) -ForegroundColor Cyan

# --- 4. Execute in concurrency-capped chunks, honoring the time budget ------
$checkStr = $Check.ToString()
$results = [System.Collections.Generic.List[object]]::new()
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$budgetHit = $false

for ($i = 0; $i -lt $scheduled.Count; $i += $Concurrency) {
    if ($TimeBudgetMin -gt 0 -and $sw.Elapsed.TotalMinutes -ge $TimeBudgetMin) {
        for ($j = $i; $j -lt $scheduled.Count; $j++) {
            $rr = $scheduled[$j]
            $coverage.Add([pscustomobject]@{ resource_id = $rr.id; type = ("" + $rr.type).ToLowerInvariant(); status = 'skipped-by-budget'; reason = "time_budget_min ($TimeBudgetMin) reached" })
        }
        $budgetHit = $true
        break
    }

    $end = [math]::Min($i + $Concurrency, $scheduled.Count)
    $chunk = $scheduled[$i..($end - 1)]

    $chunkOut = $chunk | ForEach-Object -ThrottleLimit $Concurrency -Parallel {
        $item = $_
        $check = [scriptblock]::Create($using:checkStr)
        $maxRetries = $using:MaxRetries
        $attempt = 0
        while ($true) {
            try {
                $res = & $check $item
                [pscustomobject]@{ id = $item.id; type = ("" + $item.type); ok = $true; result = $res }
                break
            } catch {
                $m = "" + $_.Exception.Message
                $throttled = $m -match '429|TooManyRequests|Rate ?limit|throttl|Retry-After|RateLimiting'
                $attempt++
                if (-not $throttled -or $attempt -gt $maxRetries) {
                    [pscustomobject]@{ id = $item.id; type = ("" + $item.type); ok = $false; error = $m }
                    break
                }
                $delay = [math]::Min(60, [math]::Pow(2, $attempt)) + (Get-Random -Minimum 0 -Maximum 1000) / 1000.0
                Start-Sleep -Seconds $delay
            }
        }
    }

    foreach ($o in $chunkOut) {
        $type = ("" + $o.type).ToLowerInvariant()
        if ($o.ok) {
            if ($null -ne $o.result) { $results.Add($o.result) }
            $coverage.Add([pscustomobject]@{ resource_id = $o.id; type = $type; status = 'assessed'; reason = $null })
        } else {
            $coverage.Add([pscustomobject]@{ resource_id = $o.id; type = $type; status = 'failed'; reason = $o.error })
        }
    }
}
$sw.Stop()

# --- 5. Assemble + (optionally) persist ------------------------------------
$statusCounts = $coverage | Group-Object status | ForEach-Object { @{ $_.Name = $_.Count } }
$stats = [ordered]@{
    candidates        = $Resources.Count
    scheduled         = $scheduled.Count
    assessed          = ($coverage | Where-Object status -eq 'assessed').Count
    sampled           = ($coverage | Where-Object status -eq 'sampled').Count
    skipped_by_budget = ($coverage | Where-Object status -eq 'skipped-by-budget').Count
    failed            = ($coverage | Where-Object status -eq 'failed').Count
    findings          = $results.Count
    elapsed_seconds   = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    time_budget_hit   = $budgetHit
}

Write-Host ("Done: {0} assessed, {1} sampled, {2} skipped-by-budget, {3} failed -> {4} result(s) in {5}s." -f `
    $stats.assessed, $stats.sampled, $stats.skipped_by_budget, $stats.failed, $stats.findings, $stats.elapsed_seconds) `
    -ForegroundColor Green

$out = [pscustomobject]@{
    results  = @($results)
    coverage = @($coverage)
    stats    = $stats
}

if ($OutFile) {
    $dir = Split-Path -Parent $OutFile
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $out | ConvertTo-Json -Depth 12 | Set-Content -Path $OutFile
    Write-Host "Wrote $OutFile" -ForegroundColor Green
}

return $out
