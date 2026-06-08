# Storage & Key Vault — Az CLI Assessment Runner

Agent: `azure-redteam-data` · Checks: `checks/storage/checks.yaml`

All commands read-only. Assess configuration/metadata only — never read blob data or secret values.

## CHK-STOR-PUBLIC-BLOB — Account allows public blob access
```bash
az storage account list \
  --query "[].{name:name,rg:resourceGroup,allowBlobPublicAccess:allowBlobPublicAccess}" -o json
# Flag: allowBlobPublicAccess==true.
```

## CHK-STOR-ANON-CONTAINER — Container with anonymous access
```bash
az storage container list --account-name <acct> --auth-mode login \
  --query "[?properties.publicAccess!=null].{name:name,access:properties.publicAccess}" -o json
# Flag: publicAccess in (blob, container).
```

## CHK-STOR-PUBLIC-NETWORK — Public network access without firewall
```bash
az storage account show --name <acct> -g <rg> \
  --query "{publicNetworkAccess:publicNetworkAccess,defaultAction:networkRuleSet.defaultAction}" -o json
# Flag: publicNetworkAccess=='Enabled' and networkRuleSet.defaultAction=='Allow'.
```

## CHK-STOR-SHARED-KEY — Shared Key auth allowed
```bash
az storage account show --name <acct> -g <rg> \
  --query "{allowSharedKeyAccess:allowSharedKeyAccess}" -o json
# Flag: allowSharedKeyAccess != false.
```

## CHK-STOR-NO-HTTPS-ONLY — Secure transfer disabled
```bash
az storage account show --name <acct> -g <rg> \
  --query "{httpsOnly:enableHttpsTrafficOnly,minTls:minimumTlsVersion}" -o json
# Flag: enableHttpsTrafficOnly==false or minimumTlsVersion < TLS1_2.
```

## CHK-STOR-KV-ACCESS-POLICY-MODEL — Key Vault uses legacy access policies
```bash
az keyvault list --query "[].{name:name,rg:resourceGroup}" -o json
az keyvault show --name <vault> \
  --query "{rbac:properties.enableRbacAuthorization}" -o json
# Flag: enableRbacAuthorization==false.
```

## CHK-STOR-KV-PUBLIC-NETWORK — Key Vault public network access
```bash
az keyvault show --name <vault> \
  --query "{publicNetworkAccess:properties.publicNetworkAccess,defaultAction:properties.networkAcls.defaultAction}" -o json
# Flag: publicNetworkAccess=='Enabled' and networkAcls.defaultAction=='Allow'.
```

## CHK-STOR-KV-NO-PURGE-PROTECTION — Soft delete / purge protection disabled
```bash
az keyvault show --name <vault> \
  --query "{softDelete:properties.enableSoftDelete,purgeProtection:properties.enablePurgeProtection}" -o json
# Flag: enableSoftDelete==false or enablePurgeProtection != true.
```
