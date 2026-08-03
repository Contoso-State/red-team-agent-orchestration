# AI & Foundry — Az CLI Assessment Runner

Agent: `azure-redteam-ai` · Checks: `checks/ai/checks.yaml`

All commands read-only. Never send inference/prompts, read key values, or download models/data.
Some AI Foundry surfaces are reached through `az rest` (GET only) against the management plane.

## CHK-AI-OPENAI-PUBLIC — Azure OpenAI / AI Services publicly accessible
```bash
az cognitiveservices account list \
  --query "[].{name:name,rg:resourceGroup,kind:kind,public:properties.publicNetworkAccess,defaultAction:properties.networkAcls.defaultAction}" -o json
# Flag: public=='Enabled' AND defaultAction!='Deny' (and no private endpoint).
```

## CHK-AI-OPENAI-LOCALAUTH — Key-based (local) auth enabled
```bash
az cognitiveservices account list \
  --query "[].{name:name,disableLocalAuth:properties.disableLocalAuth}" -o json
# Flag: disableLocalAuth != true.
```

## CHK-AI-OPENAI-NO-CONTENT-FILTER — Deployment content filter / abuse monitoring off
```bash
az cognitiveservices account deployment list --name <account> -g <rg> \
  --query "[].{name:name,model:properties.model.name,raiPolicy:properties.raiPolicyName}" -o json
# Flag: raiPolicyName empty or a known-permissive custom policy.
```

## CHK-AI-FOUNDRY-CONN-EXPOSED / CHK-AI-FOUNDRY-CONN-KEYAUTH — Foundry connections
```bash
# Enumerate hubs/projects (ML workspaces) then their connections (management plane, GET).
az ml workspace list --query "[].{name:name,rg:resourceGroup,kind:kind,public:public_network_access}" -o json
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.MachineLearningServices/workspaces/<ws>/connections?api-version=2024-04-01"
# For each connection: inspect target (category/properties.target) and authType.
# Flag CONN-EXPOSED: target resource has public network access (cross-ref data-protection).
# Flag CONN-KEYAUTH: properties.authType in {ApiKey, SAS, AccountKey, UsernamePassword}.
```

## CHK-AI-IDENTITY-OVERPRIV — AI resource managed identity over-privileged
```bash
az cognitiveservices account show --name <account> -g <rg> --query "identity" -o json
# Take principalId, then enumerate its role assignments (cross-ref rbac.md):
az role assignment list --assignee <principalId> --all \
  --query "[].{role:roleDefinitionName,scope:scope}" -o json
# Flag: Owner/Contributor at RG/subscription, or broad Key Vault Secrets access.
```

## CHK-AI-AML-PUBLIC-WORKSPACE — Azure ML workspace publicly accessible without managed network isolation
```bash
# Automated ARG check (this predicate): public workspace with no managed VNet isolation.
az ml workspace list \
  --query "[].{name:name,rg:resourceGroup,public:public_network_access,managedNet:managed_network.isolation_mode}" -o json
# Flag: public=='Enabled' and managed_network.isolation_mode is missing or 'Disabled'.

# Optional manual data-plane follow-up (NOT part of the automated check — requires per-workspace
# data-plane access): review attached datastores for account-key/SAS credentials.
az ml datastore list --workspace-name <ws> -g <rg> \
  --query "[].{name:name,type:type,credType:credentials.type}" -o json
# Advisory: prefer identity-based datastore access over AccountKey/Sas.
```
