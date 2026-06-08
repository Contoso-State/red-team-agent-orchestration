<#
.SYNOPSIS
    Build the shared resource inventory for an Azure red team engagement.

.DESCRIPTION
    Uses Azure Resource Graph to enumerate all resources in the in-scope
    subscriptions and writes inventory/resources.jsonl plus a type summary.
    Read-only. Requires the Resource Graph extension (auto-installed by az).

.PARAMETER Subscriptions
    One or more subscription IDs to enumerate. Defaults to the current subscription.

.EXAMPLE
    pwsh ./tools/powershell/Export-Inventory.ps1 -Subscriptions "<sub-id>"
#>
[CmdletBinding()]
param(
    [string[]]$Subscriptions
)

$ErrorActionPreference = "Stop"
$invDir = "./inventory"
if (-not (Test-Path $invDir)) { New-Item -ItemType Directory -Path $invDir | Out-Null }

if (-not $Subscriptions) {
    $current = az account show --only-show-errors | ConvertFrom-Json
    $Subscriptions = @($current.id)
}

Write-Host "Enumerating resources via Azure Resource Graph..." -ForegroundColor Cyan
Write-Host "Subscriptions: $($Subscriptions -join ', ')"

$query = @"
Resources
| project id, name, type, resourceGroup, subscriptionId, location, kind, tags
| order by type asc
"@

# Page through results (ARG returns up to 1000 rows per page)
$all = @()
$skip = 0
do {
    $page = az graph query -q $query `
        --subscriptions $Subscriptions `
        --first 1000 --skip $skip `
        --only-show-errors | ConvertFrom-Json
    if ($page.data) { $all += $page.data }
    $skip += 1000
} while ($page.data.Count -eq 1000)

# Write JSONL inventory
$jsonlPath = "$invDir/resources.jsonl"
$all | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 10 } | Set-Content $jsonlPath
Write-Host "Wrote $($all.Count) resources to $jsonlPath" -ForegroundColor Green

# Write subscription metadata
$subMeta = foreach ($s in $Subscriptions) {
    $info = az account show --subscription $s --only-show-errors | ConvertFrom-Json
    [pscustomobject]@{ id = $info.id; name = $info.name; state = $info.state }
}
$subMeta | ConvertTo-Json -Depth 4 | Set-Content "$invDir/subscriptions.json"

# Type summary
Write-Host "`nResource counts by type:" -ForegroundColor Cyan
$all | Group-Object type | Sort-Object Count -Descending |
    Select-Object Count, Name | Format-Table -AutoSize

Write-Host "Inventory complete. Proceed with assessment (/assess)." -ForegroundColor Cyan
