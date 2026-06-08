# Identity — Az CLI Assessment Runner

Agent: `azure-redteam-identity` · Checks: `checks/identity/checks.yaml`

Entra ID assessment relies on Microsoft Graph, reached via `az rest`/`az ad`. Requires
`Directory Reader` (record a coverage limitation if absent). All commands read-only.

## CHK-IDEN-GA-NO-MFA — Global Admins without MFA
```bash
# List Global Administrator role members; correlate with auth methods / CA coverage.
az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/directoryRoles" -o json
az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/directoryRoles/<roleId>/members" -o json
```

## CHK-IDEN-LEGACY-AUTH — Legacy authentication permitted
```bash
az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" -o json
# Flag: no enabled policy blocking legacy auth (clientAppTypes other/exchangeActiveSync).
```

## CHK-IDEN-APP-OVERPRIV-GRAPH — App with over-privileged Graph permissions
```bash
az ad app list --all -o json
az ad app permission list --id <appId> -o json
# Flag high-risk app roles: RoleManagement.ReadWrite.Directory, Directory.ReadWrite.All,
# Application.ReadWrite.All, AppRoleAssignment.ReadWrite.All.
```

## CHK-IDEN-STALE-APP-SECRET — Long-lived or expired app credentials
```bash
az ad app list --all --query "[].{appId:appId,displayName:displayName}" -o json
az ad app credential list --id <appId> -o json   # metadata only: endDateTime, NOT the secret
# Flag: endDateTime far in the future (>1yr) or already expired but still present.
```

## CHK-IDEN-GUEST-PRIVILEGED — Guest users holding privileged roles
```bash
az ad user list --query "[?userType=='Guest'].{id:id,upn:userPrincipalName}" -o json
# Cross-reference guest object IDs against privileged directory role members above.
```

## CHK-IDEN-NO-CA-POLICY — Missing baseline Conditional Access (MFA for admins)
```bash
az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" -o json
# Flag: no enabled policy requiring MFA for privileged roles / all admins.
```

## CHK-IDEN-EXCESS-GLOBAL-ADMINS — Too many Global Administrators
```bash
az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/directoryRoles" -o json
az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/directoryRoles/<gaRoleId>/members" -o json
# Flag: member count above engagement threshold (commonly > 5).
```
