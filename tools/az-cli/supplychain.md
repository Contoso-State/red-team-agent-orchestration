# DevOps & Supply Chain — Az CLI Assessment Runner
# Agent: `azure-redteam-supplychain` · Checks: `checks/supplychain/checks.yaml`
#
# Reads the CI/CD and external-trust surface: workload identity federation (OIDC), pipeline
# service principals, ACR build automation, Automation Accounts, and Logic App automation.
# Requires `Reader` (+ `Application.Read.All` / `Directory.Read.All` for app/SP and FIC).
# All commands are read-only and metadata-only — no runbook source, no callback URLs, no secrets.

## CHK-SUP-APP-FIC-BROAD-TRUST — App registration FIC + privilege
```bash
az ad app list --all --query "[].{appId:appId,displayName:displayName}" -o json
az ad app federated-credential list --id <appId> -o json   # issuer, subject, audiences
az role assignment list --assignee <appId> --all -o json
# Flag: broad subject (refs/heads/* , pull_request, repo without branch/environment) AND the
# app holds Owner/Contributor/User Access Administrator/Key Vault admin/AcrPush. No privilege => review.
```

## CHK-SUP-UAMI-FIC-BROAD-TRUST — User-assigned MI FIC + privilege
```bash
az identity list -o json
az identity federated-credential list --identity-name <name> -g <rg> -o json
az role assignment list --assignee <principalId> --all -o json
# Flag: broad/unpinned federated subject AND privileged role assignments on the identity.
```

## CHK-SUP-CICD-SP-BROAD-ROLE — CI/CD-like SP with broad role
```bash
az ad sp list --all --query "[].{id:id,appId:appId,displayName:displayName}" -o json
az role assignment list --assignee <spId> --scope "/subscriptions/<subId>" -o json
# Flag: SP with a FIC and/or deployment-style name holding Owner/Contributor at subscription scope.
```

## CHK-SUP-DEPLOY-IDENTITY-STATIC-SECRET — Deployment identity using a static secret
```bash
az ad app credential list --id <appId> -o json    # metadata only: endDateTime, NOT the secret
az ad app federated-credential list --id <appId> -o json
az role assignment list --assignee <appId> --all -o json
# Flag: app with deployment RBAC has active client secrets/certs (esp. long-lived) when it
# could use OIDC federation instead. Record metadata only — never the secret value.
```

## CHK-SUP-ACR-ADMIN-OR-UNTRUSTED-TASK — ACR admin user / unreviewed build task
```bash
az acr show -n <registry> --query "{name:name,adminUserEnabled:adminUserEnabled}" -o json
az acr task list -r <registry> -o json
az acr task show -r <registry> -n <task> -o json     # source context + base-image triggers
# Flag: adminUserEnabled == true, OR task source repo outside the approved allowlist, OR
# base-image-update trigger from an unreviewed registry. External source => 'requires review'.
```

## CHK-SUP-AUTOMATION-PRIV-IDENTITY — Automation Account privileged identity
```bash
az automation account list -o json
az automation runbook list --automation-account-name <acct> -g <rg> -o json   # metadata only
az role assignment list --assignee <identityPrincipalId> --all -o json
# Flag: Automation identity (system/user-assigned or RunAs) with privileged RBAC AND published
# runbooks with enabled webhooks/schedules/hybrid workers. Do NOT attempt to read runbook
# source or retrieve webhook URLs (not available read-only).
```

## CHK-SUP-LOGICAPP-OPEN-TRIGGER — Logic App open HTTP trigger / API connections
```bash
az resource list --resource-type Microsoft.Logic/workflows -o json
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<subId>/resourceGroups/<rg>/providers/Microsoft.Logic/workflows/<name>?api-version=2019-05-01" -o json
az resource list --resource-type Microsoft.Web/connections -o json
# Flag: workflow has a Request/HTTP trigger with no accessControl IP restriction or auth,
# and/or sensitive API connections exist. Do NOT call listCallbackUrl (POST) — metadata only.
```

## CHK-SUP-PLAINTEXT-SECRETS-IN-DEPLOYMENT — Secrets in deployment/automation surfaces
```bash
# Automation Account variables — flag unencrypted variables (metadata only):
az automation variable list --automation-account-name <acct> -g <rg> \
  --query "[].{name:name,encrypted:isEncrypted}" -o json
# Deployment parameter shape (type, not value):
az deployment group list -g <rg> -o json
az deployment group show -g <rg> -n <deployment> --query "properties.parameters" -o json
# App / Function settings — key + KV-reference shape only (never echo the value):
az webapp config appsettings list --name <app> -g <rg> \
  --query "[].{name:name,isKeyVaultRef:starts_with(value,'@Microsoft.KeyVault')}" -o json
# Flag: isEncrypted==false on an Automation variable, a plaintext deployment parameter
# that should be secureString/KV reference, or a secret-shaped app setting that is NOT
# an @Microsoft.KeyVault(...) reference. Record location only — redact every value.
```

## CHK-SUP-NO-IMAGE-SCAN-ENFORCED — Image scanning not enforced in deploy path
```bash
az security pricing show -n Containers -o json     # registry/image scanning sub-plan
az policy assignment list --scope "/subscriptions/<subId>" \
  --query "[].{name:name,policy:policyDefinitionId}" -o json   # image-scan / gating policies
# ACR quarantine policy (read-only) — only scanned images become pullable when enabled:
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<subId>/resourceGroups/<rg>/providers/Microsoft.ContainerRegistry/registries/<registry>?api-version=2023-07-01" -o json
# Flag: Containers plan / image scanning not enabled, OR no policy gates
# 'Container registry images should have vulnerability findings resolved' / blocks
# unscanned images, OR quarantinePolicy disabled. (Plan on/off owned by logging.)
```
