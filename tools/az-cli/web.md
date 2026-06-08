# Web & Static Sites — Az CLI Assessment Runner

Agent: `azure-redteam-web` · Checks: `checks/web/checks.yaml`

All commands read-only — assess configuration only. Never send attack traffic, crawl, or fuzz.
Several edge surfaces are read via `az rest` (GET only) on the management plane.

## CHK-WEB-FRONTDOOR-NO-WAF — Front Door / CDN front end without Prevention-mode WAF
```bash
az afd profile list --query "[].{name:name,rg:resourceGroup,sku:sku.name}" -o json
az network front-door waf-policy list -g <rg> \
  --query "[].{name:name,mode:policySettings.mode,enabled:policySettings.enabledState}" -o json
# Flag: front end with no associated policy, or policy mode == 'Detection'.
```

## CHK-WEB-APPGW-NO-WAF — Application Gateway without WAF / Detection mode
```bash
az network application-gateway list \
  --query "[].{name:name,tier:sku.tier,wafMode:webApplicationFirewallConfiguration.firewallMode,wafEnabled:webApplicationFirewallConfiguration.enabled}" -o json
# Flag: tier != 'WAF_v2', or firewallMode == 'Detection', or wafEnabled != true.
```

## CHK-WEB-STATIC-WEBSITE-EXPOSED — Storage static website reachable directly
```bash
az storage account list --query "[].{name:name,rg:resourceGroup,public:publicNetworkAccess}" -o json
az storage blob service-properties show --account-name <acct> --auth-mode login \
  --query "staticWebsite" -o json
# Flag: staticWebsite.enabled==true on an account reachable directly (cross-ref storage.md).
```

## CHK-WEB-SWA-ROUTE-NO-AUTH — Static Web App protected route without auth
```bash
az staticwebapp list --query "[].{name:name,rg:resourceGroup,defaultHostname:defaultHostname}" -o json
# Review staticwebapp.config.json routes for allowedRoles on protected paths (config-based).
```

## CHK-WEB-APIM-OPEN-GATEWAY — API Management publicly exposed without restriction
```bash
az apim list \
  --query "[].{name:name,rg:resourceGroup,public:publicNetworkAccess,vnetType:virtualNetworkType}" -o json
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<apim>/apis?api-version=2022-08-01" \
  --query "value[].{name:name,subRequired:properties.subscriptionRequired}" -o json
# Flag: public Enabled + vnetType in {None,External} + APIs with subscriptionRequired==false.
```

## CHK-WEB-TLS-WEAK — Weak TLS / no HTTPS redirect at the edge
```bash
az network application-gateway list \
  --query "[].{name:name,sslPolicy:sslPolicy.minProtocolVersion,httpListeners:httpListeners[].protocol}" -o json
# Flag: minProtocolVersion < TLSv1_2, or an HTTP listener with no redirect rule.
# Front Door custom domains: check tlsSettings.minimumTlsVersion via az afd custom-domain show.
```

## CHK-WEB-ORIGIN-DIRECT-REACH — Origin reachable directly, bypassing the edge
```bash
# App Service origin: confirm access restrictions limit traffic to Front Door.
az webapp config access-restriction show --name <app> -g <rg> -o json
# Flag: no rule restricting to AzureFrontDoor.Backend service tag or X-Azure-FDID header.
```
