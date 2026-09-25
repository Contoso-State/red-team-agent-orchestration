<#
.SYNOPSIS
    Preflight validation for an Azure red team engagement.

.DESCRIPTION
    Confirms the authenticated Azure identity, validates effective RBAC against the
    roles required by the engagement, and reports coverage limitations. Read-only.

    Run this before any assessment. It does not modify anything.

.PARAMETER EngagementFile
    Path to the engagement.yaml scope file. Defaults to .\engagement.yaml.

.PARAMETER SessionPath
    The per-assessment session folder all output is written under. Defaults to the
    $env:REDTEAM_SESSION value, or a new ./engagements/<timestamp> folder if unset.
    Reuse the same SessionPath for Export-Inventory.ps1 to keep one session together.

.EXAMPLE
    pwsh ./tools/powershell/Invoke-Preflight.ps1 -EngagementFile ./engagement.yaml
#>
[CmdletBinding()]
param(
    [string]$EngagementFile = "./engagement.yaml",
    [string]$SessionPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'Common.ps1')
# Validate scope before any account or resource read.
$target = Read-EngagementTarget $EngagementFile
$account = Get-ScopedAccount $target

# Resolve caller in the target tenant, not the CLI's unrelated default tenant.
# Token stays in process memory; only identity claims are used or persisted.
$token = Invoke-AzJson -Arguments @('account', 'get-access-token', '--subscription', $target.subscriptionId)
try {
    $payload = $token.accessToken.Split('.')[1].Replace('-', '+').Replace('_', '/')
    $payload = $payload.PadRight($payload.Length + ((4 - $payload.Length % 4) % 4), '=')
    $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
} catch { throw 'Could not decode scoped caller identity; token withheld.' }
finally { $token = $null; $payload = $null }
if ($claims.tid -ne $target.tenantId -or $claims.oid -notmatch '^[0-9a-fA-F-]{36}$') { throw 'Could not verify target-tenant caller identity.' }
if ($account.user.type -eq 'user') {
    $principalName = @($claims.upn, $claims.preferred_username, $claims.unique_name) | Where-Object { $_ } | Select-Object -First 1
    if ($principalName -and $principalName -ne $account.user.name) { throw 'Token caller does not match scoped account identity.' }
}
$assignments = @(Invoke-AzJson -Arguments @('role', 'assignment', 'list', '--assignee', $claims.oid, '--fill-principal-name', 'false', '--include-inherited', '--all', '--subscription', $target.subscriptionId))
# This preflight verifies ARM read capability only, not data-plane or Graph access.
# Match immutable built-in IDs, never names (custom roles can reuse display names).
$direct = @($assignments | Where-Object { $_.principalId -eq $claims.oid -and ($_.scope -eq "/subscriptions/$($target.subscriptionId)" -or $_.scope -like '/providers/Microsoft.Management/managementGroups/*' -or $_.scope -eq '/') })
$roleIds = @($direct | ForEach-Object { ($_.roleDefinitionId -split '/')[-1] })
$builtIns = @{
    'Reader' = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
    'Security Reader' = '39bc4728-0917-49c7-9d2c-d95423bc2eb4'
    'Log Analytics Reader' = '73c42c96-874c-492b-b04d-ab87d138a893'
    'Key Vault Reader' = '21090545-7ca7-4776-b22c-e363652d74d2'
}
$privilegedReader = ($roleIds -contains '8e3af657-a8ff-443c-a75c-2fe8c4bcb635') -or ($roleIds -contains 'b24988ac-6180-42a0-ab88-20f7382dd24c')
if ($privilegedReader) { Write-Warning 'Caller has privileged ARM access. Assessment commands must remain read-only; no data-plane capabilities inferred.' }
$limitations = @()
foreach ($role in @($target.requiredRoles) + @($target.optionalRoles)) {
    $verified = ($builtIns.ContainsKey($role) -and $roleIds -contains $builtIns[$role]) -or ($privilegedReader -and $role -in @('Reader', 'Security Reader'))
    if (-not $verified) {
        $limitations += [pscustomobject]@{ scope = 'rbac'; reason = "ARM read capability for '$role' not verified from direct subscription-wide built-in assignments; group, custom-role, Graph and data-plane capabilities require separate validation."; required = ($target.requiredRoles -contains $role) }
    }
}
$SessionPath = Resolve-SessionPath $SessionPath
foreach ($sub in @('inventory', 'findings/raw', 'evidence/raw', 'reports')) {
    New-Item -ItemType Directory -Path (Join-Path $SessionPath $sub) -Force | Out-Null
}
ConvertTo-JsonArrayFile -Items $limitations -Path (Join-Path $SessionPath 'inventory/coverage-limitations.json')
if (@($limitations | Where-Object required).Count) { throw 'Required RBAC coverage unverified. See inventory/coverage-limitations.json; preflight is not complete.' }
Set-CurrentSession $SessionPath
Write-Host "Preflight complete for $($account.id) in tenant $($account.tenantId). Optional gaps: $($limitations.Count)."
