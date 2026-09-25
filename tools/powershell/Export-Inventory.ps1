<#
.SYNOPSIS
    Build the shared resource inventory for an Azure red team engagement.

.DESCRIPTION
    Uses Azure Resource Graph to enumerate all resources in the in-scope
    subscriptions and writes engagements/<session>/inventory/resources.json (canonical
    array) plus resources.jsonl, subscriptions.json, and a summary.json type rollup.
    Read-only. Requires the Resource Graph extension (auto-installed by az).

.PARAMETER Subscriptions
    Optional single subscription ID; must match EngagementFile. No default-account fallback.

.PARAMETER SessionPath
    The per-assessment session folder all output is written under. Defaults to the
    $env:REDTEAM_SESSION value, or a new ./engagements/<timestamp> folder if unset.
    Pass the same SessionPath used by Invoke-Preflight.ps1 to keep one session together.

.EXAMPLE
    pwsh ./tools/powershell/Export-Inventory.ps1 -Subscriptions "<sub-id>" -SessionPath ./engagements/example-2026-q2-2026-06-15-141200
#>
[CmdletBinding()]
param(
    [string[]]$Subscriptions,
    [string]$EngagementFile = "./engagement.yaml",
    [string]$SessionPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'Common.ps1')
$target = Read-EngagementTarget $EngagementFile
if ($Subscriptions -and ($Subscriptions.Count -ne 1 -or $Subscriptions[0] -ne $target.subscriptionId)) { throw 'Subscriptions must match the single engagement subscription.' }
$Subscriptions = @($target.subscriptionId)
$account = Get-ScopedAccount $target
$SessionPath = Resolve-SessionPath $SessionPath
$invDir = Join-Path $SessionPath 'inventory'

Write-Host "Enumerating resources via Azure Resource Graph..." -ForegroundColor Cyan
Write-Host "Subscriptions: $($Subscriptions -join ', ')"

# Single-line query string — multi-line/here-string KQL can be silently mangled by
# the shell -> az boundary (where/project pipeline dropped). Keep it on one line.
$query = "Resources | project id, name, type, resourceGroup, subscriptionId, location, kind, tags | order by type asc"

# Page through results (ARG returns up to 1000 rows per page)
$all = @()
$skip = 0
do {
    $page = Invoke-AzJson -Arguments @('graph', 'query', '-q', $query, '--subscriptions', $target.subscriptionId, '--first', '1000', '--skip', "$skip")
    if ($null -eq $page.data -or $page.data -isnot [array]) { throw 'Malformed ARG page; inventory incomplete.' }
    foreach ($row in $page.data) {
        if ($row.subscriptionId -ne $target.subscriptionId -or $row.id -notlike "/subscriptions/$($target.subscriptionId)/*") { throw 'ARG returned an out-of-scope resource.' }
    }
    if ($skip -ge 49000 -and $page.data.Count -eq 1000) { throw 'Inventory pagination cap reached; refusing to publish partial inventory.' }
    if ($page.data) { $all += $page.data }
    $skip += 1000
} while ($page.data.Count -eq 1000)

New-Item -ItemType Directory -Path $invDir -Force | Out-Null

# Write inventory: a canonical JSON array (resources.json) for downstream tooling,
# a JSONL stream (resources.jsonl) for line-oriented processing, and a type summary.
$jsonPath = "$invDir/resources.json"
$jsonlPath = "$invDir/resources.jsonl"
ConvertTo-JsonArrayFile -Items $all -Path $jsonPath -Depth 10
$all | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 10 } | Set-Content $jsonlPath
Write-Host "Wrote $($all.Count) resources to $jsonPath (+ resources.jsonl)" -ForegroundColor Green

# Write subscription metadata
$subMeta = @([pscustomobject]@{ id = $account.id; name = $account.name; state = $account.state })
ConvertTo-JsonArrayFile -Items @($subMeta) -Path "$invDir/subscriptions.json" -Depth 4

# Type summary — persisted to summary.json and printed
$summary = $all | Group-Object type | Sort-Object Count -Descending |
    ForEach-Object { [pscustomobject]@{ type = $_.Name; count = $_.Count } }
ConvertTo-JsonArrayFile -Items @($summary) -Path "$invDir/summary.json" -Depth 4
Write-Host "`nResource counts by type:" -ForegroundColor Cyan
$summary | Select-Object count, type | Format-Table -AutoSize

Set-CurrentSession $SessionPath
Write-Host "Inventory complete. Proceed with assessment (/assess)." -ForegroundColor Cyan
