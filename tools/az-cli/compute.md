# Compute — Az CLI Assessment Runner

Agent: `azure-redteam-compute` · Checks: `checks/compute/checks.yaml`

Scope: VMs/VMSS, App Service, Functions. **All commands read-only. Never use run-command or exec.**
Containers & Kubernetes (AKS, ACR, Container Apps/Instances) are owned by the Azure Container &
Kubernetes Agent — see `tools/az-cli/container.md`.

## CHK-COMP-APPSVC-SECRETS-PLAINTEXT — Secrets in App Service settings
```bash
az webapp list --query "[].{name:name,rg:resourceGroup}" -o json
az webapp config appsettings list --name <app> -g <rg> \
  --query "[].name" -o json   # names only; flag secret-like keys not using Key Vault references
```

## CHK-COMP-APPSVC-NO-AUTH — App Service without authentication
```bash
az webapp auth show --name <app> -g <rg> -o json
# Flag: enabled != true on an app intended to be protected.
```

## CHK-COMP-APPSVC-FTP-DEBUG — FTP/remote debugging enabled
```bash
az webapp config show --name <app> -g <rg> \
  --query "{ftpsState:ftpsState,remoteDebugging:remoteDebuggingEnabled}" -o json
# Flag: ftpsState=='AllAllowed' or remoteDebuggingEnabled==true.
```

## CHK-COMP-VM-NO-DISK-ENCRYPTION — VM OS/data disk not encrypted
```bash
az vm list -o json
az vm encryption show --name <vm> -g <rg> -o json   # flag if not EncryptionAtRest/ADE enabled
```

## CHK-COMP-VM-PUBLIC-RUNCOMMAND — Internet-facing VM exposed to runCommand abuse
```bash
az vm list-ip-addresses -o json   # identify VMs with public IPs
az vm identity show --name <vm> -g <rg> -o json   # privileged MI on a public VM = pivot
# Cross-reference with rbac.md runCommand holders.
```
