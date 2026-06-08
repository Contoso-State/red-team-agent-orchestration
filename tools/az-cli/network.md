# Network — Az CLI Assessment Runner

Agent: `azure-redteam-network` · Checks: `checks/network/checks.yaml`

All commands read-only. Configuration-based exposure analysis — no active scanning/probing.

## CHK-NET-MGMT-PORT-INTERNET — RDP/SSH open to the internet
```bash
az network nsg list -o json
az network nsg rule list --nsg-name <nsg> -g <rg> \
  --query "[?direction=='Inbound' && access=='Allow' && (destinationPortRange=='22' || destinationPortRange=='3389' || destinationPortRange=='*') && (sourceAddressPrefix=='*' || sourceAddressPrefix=='Internet' || sourceAddressPrefix=='0.0.0.0/0')]" -o json
```

## CHK-NET-DB-PORT-INTERNET — Database ports exposed to the internet
```bash
az network nsg rule list --nsg-name <nsg> -g <rg> \
  --query "[?direction=='Inbound' && access=='Allow' && (sourceAddressPrefix=='*' || sourceAddressPrefix=='Internet') && (destinationPortRange=='1433' || destinationPortRange=='3306' || destinationPortRange=='5432' || destinationPortRange=='27017' || destinationPortRange=='6379')]" -o json
```

## CHK-NET-ANY-ANY-RULE — Permissive any/any allow rule
```bash
az network nsg rule list --nsg-name <nsg> -g <rg> \
  --query "[?access=='Allow' && (sourceAddressPrefix=='*' || sourceAddressPrefix=='0.0.0.0/0') && destinationPortRange=='*']" -o json
```

## CHK-NET-SUBNET-NO-NSG — Subnet without an NSG
```bash
az network vnet list -o json
az network vnet subnet list --vnet-name <vnet> -g <rg> \
  --query "[?networkSecurityGroup==null].{name:name,prefix:addressPrefix}" -o json
```

## CHK-NET-PEERING-CROSS-ENV — VNet peering bridging environments
```bash
az network vnet peering list --vnet-name <vnet> -g <rg> \
  --query "[].{name:name,remote:remoteVirtualNetwork.id,allowForwarded:allowForwardedTraffic,allowGateway:allowGatewayTransit}" -o json
# Flag peerings to VNets in other environments/subscriptions per engagement context.
```

## CHK-NET-DANGLING-DNS — Dangling DNS record (subdomain takeover)
```bash
az network dns zone list -o json
az network dns record-set list -z <zone> -g <rg> \
  --query "[?type=='Microsoft.Network/dnszones/CNAME' || type=='Microsoft.Network/dnszones/A']" -o json
# Flag records pointing to deallocated Azure resources (no live target).
```

## CHK-NET-PUBLIC-IP-UNEXPECTED — Unexpected public IP exposure
```bash
az network public-ip list \
  --query "[?ipConfiguration!=null].{name:name,ip:ipAddress,assoc:ipConfiguration.id}" -o json
```

## CHK-NET-WAF-MISSING — Internet-facing app without WAF
```bash
az network application-gateway list \
  --query "[].{name:name,tier:sku.tier,wafConfig:webApplicationFirewallConfiguration}" -o json
# Flag public App Gateways with tier != WAF_v2 or WAF disabled / detection-only.
```
