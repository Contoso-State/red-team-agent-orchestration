# Attack Surface (EASM) — Az CLI Assessment Runner

Agent: `azure-redteam-easm` · Checks: `checks/easm/checks.yaml`

All commands read-only and passive. Use management-plane data, Defender EASM inventory, and DNS
resolution only. **Never port-scan, probe, or brute-force.**

## CHK-EASM-DANGLING-DNS — Dangling DNS / subdomain takeover risk
```bash
az network dns zone list --query "[].{zone:name,rg:resourceGroup}" -o json
az network dns record-set list -g <rg> -z <zone> \
  --query "[?type=='Microsoft.Network/dnszones/CNAME' || type=='Microsoft.Network/dnszones/A'].{name:name,cname:CNAMERecord.cname,a:ARecords[].ipv4Address}" -o json
# For each CNAME/A target with an Azure service suffix, confirm a live owned resource serves it:
nslookup <target.azurewebsites.net>    # passive resolution only; NXDOMAIN/unowned => takeover risk
```

## CHK-EASM-UNKNOWN-ASSET — Exposed asset with no known owner
```bash
# Build the owned public footprint, then correlate Defender EASM / DNS hits against it.
az network public-ip list --query "[].{ip:ipAddress,assoc:ipConfiguration.id}" -o json
# Assets discovered (EASM/DNS) that don't correlate to an inventoried resource => unknown.
```

## CHK-EASM-PUBLIC-MGMT-PORT — Management/database port reachable from internet
```bash
# Resource Graph correlation of public IPs to permissive NSG rules.
az graph query -q "Resources
| where type == 'microsoft.network/networksecuritygroups'
| mv-expand rule = properties.securityRules
| where rule.properties.access == 'Allow' and rule.properties.direction == 'Inbound'
| where rule.properties.sourceAddressPrefix in ('*','Internet','0.0.0.0/0')
| extend ports = rule.properties.destinationPortRange
| where ports in ('22','3389','5985','1433','3306','5432','6443','*')
| project nsg=name, rule=rule.name, ports, resourceGroup" -o json
# Cross-reference with public IPs (network-exposure owns the per-NSG fix).
```

## CHK-EASM-DEFENDER-EASM-OBS — Defender EASM observations
```bash
# If a Defender EASM workspace exists (Microsoft.Easm/workspaces), read its inventory/observations.
az graph query -q "Resources | where type =~ 'microsoft.easm/workspaces' | project name, resourceGroup, location" -o json
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Easm/workspaces/<ws>?api-version=2023-04-01-preview"
# Flag open high/medium observations. (Data-plane EASM API is also GET-only.)
```

## CHK-EASM-PUBLIC-IP-UNUSED — Orphaned public IP
```bash
az network public-ip list \
  --query "[?ipConfiguration==null].{name:name,rg:resourceGroup,ip:ipAddress}" -o json
# Flag: public IPs with no ipConfiguration association.
```
