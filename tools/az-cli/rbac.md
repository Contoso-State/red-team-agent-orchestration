# Authorization / RBAC — Az CLI Assessment Runner

Agent: `azure-redteam-authorization` · Checks: `checks/rbac/checks.yaml`

All commands read-only. Analyze role assignments, custom roles, and escalation primitives.

## CHK-RBAC-CUSTOM-ROLE-ASSIGN-WRITE — Custom role can write role assignments (self-escalation)
```bash
az role definition list --custom-role-only true -o json
# Flag any role whose Actions include Microsoft.Authorization/roleAssignments/write
# (and not balanced by a NotActions deny).
```

## CHK-RBAC-WILDCARD-ACTION — Custom role with wildcard action
```bash
az role definition list --custom-role-only true \
  --query "[?contains(to_string(permissions[].actions), '*')]" -o json
```

## CHK-RBAC-SUB-OWNER-SPRAWL — Excessive Owner/Contributor/UAA at subscription scope
```bash
az role assignment list --scope "/subscriptions/<subId>" --include-inherited \
  --query "[?roleDefinitionName=='Owner' || roleDefinitionName=='Contributor' || roleDefinitionName=='User Access Administrator']" -o json
```

## CHK-RBAC-SP-PRIVILEGED — Service principal with privileged role
```bash
az role assignment list --all \
  --query "[?principalType=='ServicePrincipal' && (roleDefinitionName=='Owner' || roleDefinitionName=='Contributor' || roleDefinitionName=='User Access Administrator')]" -o json
```

## CHK-RBAC-MI-RUNCOMMAND — Identity can run commands on VMs (Microsoft.Compute/.../runCommand/action)
```bash
az role definition list -o json
# Flag roles granting Microsoft.Compute/virtualMachines/runCommand/action assigned to non-owners,
# then list who holds them:
az role assignment list --all --role "<roleName>" -o json
```

## CHK-RBAC-AKS-CLUSTER-ADMIN — Identity can list AKS cluster-admin credentials
```bash
# Flag roles with Microsoft.ContainerService/managedClusters/listClusterAdminCredential/action.
az role definition list \
  --query "[?contains(to_string(permissions[].actions), 'listClusterAdminCredential')]" -o json
```

## CHK-RBAC-KV-ACCESSPOLICY-WRITE — Identity can rewrite Key Vault access policies
```bash
az role definition list \
  --query "[?contains(to_string(permissions[].actions), 'Microsoft.KeyVault/vaults/accessPolicies/write')]" -o json
```

## CHK-RBAC-CLASSIC-ADMIN — Classic administrators still present
```bash
az role assignment list --include-classic-administrators true \
  --query "[?contains(roleDefinitionName, 'Administrator')]" -o json
```

## CHK-RBAC-MI-PRIVILEGED-FROM-COMPUTE — Compute managed identity with a privileged control-plane role
```bash
# 1) Enumerate compute-attached managed-identity principal IDs (Resource Graph):
az graph query -q "resources | where type in~ ('microsoft.compute/virtualmachines','microsoft.compute/virtualmachinescalesets','microsoft.web/sites','microsoft.app/containerapps','microsoft.containerservice/managedclusters') | where isnotnull(identity) | project name, type, principalId=identity.principalId, userAssigned=identity.userAssignedIdentities" -o json
# 2) For each principalId, list its role assignments and flag broad-scope privileged roles:
az role assignment list --assignee <principalId> --all \
  --query "[?roleDefinitionName=='Owner' || roleDefinitionName=='Contributor' || roleDefinitionName=='User Access Administrator']" -o json
```

## CHK-RBAC-MI-DATA-PLANE-SECRETS — Compute managed identity with Key Vault / Storage data-plane roles
```bash
az role assignment list --assignee <principalId> --all \
  --query "[?contains(roleDefinitionName,'Key Vault') || contains(roleDefinitionName,'Storage Blob Data') || contains(roleDefinitionName,'Storage Queue Data')]" -o json
# Flag Key Vault Secrets User/Officer, Key Vault Crypto User, Storage Blob Data Contributor/Reader
# held by a compute-attached managed identity (secret/data read path post-compromise).
```

## CHK-RBAC-STANDING-PRIV-NO-PIM — Permanent privileged Azure role with no PIM-eligible schedule
```bash
# Active assignments at subscription scope:
az role assignment list --scope "/subscriptions/<subId>" --include-inherited \
  --query "[?roleDefinitionName=='Owner' || roleDefinitionName=='Contributor' || roleDefinitionName=='User Access Administrator']" -o json
# Eligible (PIM for Azure resources) assignments to compare against (read-only ARM GET):
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<subId>/providers/Microsoft.Authorization/roleEligibilityScheduleInstances?api-version=2020-10-01&\$filter=atScope()" -o json
# Flag active privileged assignments with NO matching eligible schedule (excl. break-glass).
```
