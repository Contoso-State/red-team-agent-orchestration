<#
.SYNOPSIS
    Preflight validation for an Azure red team engagement.

.DESCRIPTION
    Confirms the authenticated Azure identity, validates effective RBAC against the
    roles required by the engagement, and reports coverage limitations. Read-only.

    Run this before any assessment. It does not modify anything.

.PARAMETER EngagementFile
    Path to the engagement.yaml scope file. Defaults to .\engagement.yaml.

.EXAMPLE
    pwsh ./tools/powershell/Invoke-Preflight.ps1 -EngagementFile ./engagement.yaml
#>
[CmdletBinding()]
param(
    [string]$EngagementFile = "./engagement.yaml"
)

$ErrorActionPreference = "Stop"

function Write-Section($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

# --- Verify Azure CLI is present and authenticated ---
Write-Section "Identity"
try {
    $account = az account show --only-show-errors | ConvertFrom-Json
} catch {
    throw "Not authenticated. Run 'az login' first."
}
Write-Host "Signed in as : $($account.user.name)"
Write-Host "Identity type: $($account.user.type)"
Write-Host "Tenant       : $($account.tenantId)"
Write-Host "Subscription : $($account.name) ($($account.id))"

# --- Load engagement scope ---
Write-Section "Engagement Scope"
if (-not (Test-Path $EngagementFile)) {
    throw "Engagement file '$EngagementFile' not found. Copy engagement.example.yaml to engagement.yaml."
}
Write-Host "Loaded scope file: $EngagementFile"
# Note: full YAML parsing left to the agent; this script validates identity + RBAC.

# --- Validate effective RBAC for required capabilities ---
Write-Section "RBAC Preflight"

$requiredRoles = @{
    "Reader"               = "Resource enumeration (all agents)"
    "Security Reader"      = "Defender recommendations (Data, Logging)"
    "Log Analytics Reader" = "Log queries (Logging Coverage)"
    "Key Vault Reader"     = "Key Vault metadata (Data Protection)"
}

$assignments = az role assignment list --assignee $account.user.name --all --only-show-errors |
    ConvertFrom-Json
$heldRoles = $assignments | Select-Object -ExpandProperty roleDefinitionName -Unique

$limitations = @()
foreach ($role in $requiredRoles.Keys) {
    if ($heldRoles -contains $role) {
        Write-Host ("[ OK ] {0,-22} - {1}" -f $role, $requiredRoles[$role]) -ForegroundColor Green
    } else {
        Write-Host ("[GAP ] {0,-22} - {1}" -f $role, $requiredRoles[$role]) -ForegroundColor Yellow
        $limitations += [pscustomobject]@{
            scope  = "rbac"
            reason = "Missing role '$role' - $($requiredRoles[$role])"
        }
    }
}

# --- Emit coverage limitations ---
Write-Section "Coverage Limitations"
$invDir = "./inventory"
if (-not (Test-Path $invDir)) { New-Item -ItemType Directory -Path $invDir | Out-Null }

if ($limitations.Count -gt 0) {
    $limitations | ConvertTo-Json -Depth 4 | Set-Content "$invDir/coverage-limitations.json"
    Write-Host "$($limitations.Count) limitation(s) written to inventory/coverage-limitations.json" -ForegroundColor Yellow
} else {
    "[]" | Set-Content "$invDir/coverage-limitations.json"
    Write-Host "No permission gaps detected." -ForegroundColor Green
}

Write-Section "Preflight Complete"
Write-Host "Identity validated. Proceed with reconnaissance (/recon)." -ForegroundColor Cyan
