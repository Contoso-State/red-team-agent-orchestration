# Compute — Az CLI Assessment Runner

Agent: `azure-redteam-compute` · Checks: `checks/compute/checks.yaml`

All commands read-only. Never exec into VMs/containers or use run-command.

## CHK-COMP-AKS-PUBLIC-API — AKS API server publicly reachable
```bash
az aks list \
  --query "[].{name:name,rg:resourceGroup,privateCluster:apiServerAccessProfile.enablePrivateCluster,authorizedRanges:apiServerAccessProfile.authorizedIpRanges}" -o json
# Flag: enablePrivateCluster != true AND no authorizedIpRanges.
```

## CHK-COMP-AKS-LOCAL-ADMIN — AKS local accounts enabled (no Entra RBAC)
```bash
az aks list \
  --query "[].{name:name,disableLocalAccounts:disableLocalAccounts,aadProfile:aadProfile}" -o json
# Flag: disableLocalAccounts != true or aadProfile.enableAzureRBAC != true.
```

## CHK-COMP-AKS-NO-NETPOL — AKS without network policy
```bash
az aks list \
  --query "[].{name:name,networkPolicy:networkProfile.networkPolicy}" -o json
# Flag: networkPolicy null/none.
```

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

## CHK-COMP-ACR-ADMIN-USER — Container registry admin user enabled
```bash
az acr list --query "[].{name:name,adminUserEnabled:adminUserEnabled,publicNetworkAccess:publicNetworkAccess}" -o json
# Flag: adminUserEnabled==true.
```

## CHK-COMP-ACR-PUBLIC-ANON — Registry public network / anonymous pull
```bash
az acr list \
  --query "[].{name:name,rg:resourceGroup,publicNetworkAccess:publicNetworkAccess,anonymousPull:anonymousPullEnabled,networkRuleSet:networkRuleSet.defaultAction}" -o json
# Flag: publicNetworkAccess=='Enabled' with networkRuleSet defaultAction 'Allow', or anonymousPullEnabled==true.
```

## CHK-COMP-AKS-NO-ENTRA-RBAC — AKS not using Entra ID + Azure RBAC for Kubernetes
```bash
az aks list \
  --query "[].{name:name,rg:resourceGroup,enableRBAC:enableRbac,aad:aadProfile,azureRBAC:aadProfile.enableAzureRBAC}" -o json
# Flag: enableRbac != true, OR aadProfile is null, OR aadProfile.enableAzureRBAC != true.
```

## CHK-COMP-CONTAINER-PRIVILEGED-INGRESS — Container workload publicly exposed
```bash
# Container Apps: external ingress without IP restrictions.
az containerapp list \
  --query "[].{name:name,rg:resourceGroup,external:properties.configuration.ingress.external,ipRules:properties.configuration.ingress.ipSecurityRestrictions}" -o json
# Container Instances: public IP with open ports.
az container list \
  --query "[?ipAddress.type=='Public'].{name:name,rg:resourceGroup,ip:ipAddress.ip,ports:ipAddress.ports}" -o json
# Flag: external ingress with no ipSecurityRestrictions, or a container group with a public IP.
```

## CHK-COMP-AKS-RBAC-CLUSTER-ADMIN-SPRAWL — In-cluster K8s RBAC cluster-admin sprawl
```bash
# Pull a (non-admin) kubeconfig read-only, then enumerate in-cluster RBAC. NEVER list admin creds for mutation.
az aks get-credentials --name <cluster> -g <rg> --overwrite-existing   # user kubeconfig (Entra-gated)
# Who holds cluster-admin (and other privileged ClusterRoles) via bindings:
kubectl get clusterrolebindings -o json \
  --query "items[?roleRef.name=='cluster-admin'].{binding:metadata.name,subjects:subjects}"
# Wildcard ClusterRoles (verbs/resources == '*') excluding system: roles:
kubectl get clusterroles -o json   # inspect rules[].verbs / rules[].resources for '*'
# Bindings exposed to everyone:
kubectl get clusterrolebindings -o json   # flag subjects name == system:authenticated / system:unauthenticated
# Optional accelerator (read-only): kubectl rbac-tool who-can '*' '*'  /  kubectl rbac-tool who-can get secrets
# Flag: cluster-admin bound to non break-glass subjects, wildcard custom ClusterRoles, or binds to system:authenticated.
```

## CHK-COMP-AKS-NO-POD-SECURITY — Pod Security Standards not enforced / privileged pods
```bash
# Namespace-level Pod Security Admission enforcement labels:
kubectl get ns -L pod-security.kubernetes.io/enforce -L pod-security.kubernetes.io/warn
# Privileged / host-namespaced / root pods currently running:
kubectl get pods -A -o json   # inspect spec.securityContext + containers[].securityContext
#   privileged==true | hostNetwork/hostPID/hostIPC==true | hostPath volumes | runAsNonRoot!=true
# Optional accelerator (read-only): kubescape scan framework nsa  /  kubesec scan <manifest.yaml>
# Flag: non-system namespace without enforce=baseline|restricted, OR any privileged/host/root pod.
```

## CHK-COMP-AKS-NODE-MI-EXPOSURE — Workload Identity off; pods inherit node MI via IMDS
```bash
az aks list \
  --query "[].{name:name,rg:resourceGroup,oidc:oidcIssuerProfile.enabled,workloadId:securityProfile.workloadIdentity.enabled,kubeletIdentity:identityProfile.kubeletidentity.objectId}" -o json
# Cross-reference the node/kubelet MI's Azure role assignments (read-only):
az role assignment list --assignee <kubeletIdentity-objectId> --all -o json
# Flag: oidc != true OR workloadIdentity != true while kubelet identity holds role assignments (no NetworkPolicy to 169.254.169.254).
```

## CHK-COMP-AKS-OUTDATED-VERSION — Unsupported / outdated Kubernetes version
```bash
az aks list \
  --query "[].{name:name,rg:resourceGroup,controlPlane:currentKubernetesVersion,nodePools:agentPoolProfiles[].{pool:name,ver:orchestratorVersion,img:nodeImageVersion}}" -o json
# Supported version window for the region:
az aks get-versions --location <region> --query "values[].version" -o json
# Flag: control plane below oldest supported minor, or a node pool orchestratorVersion trailing control plane / latest patch.
```

## CHK-COMP-ACR-NO-DEFENDER-SCAN — Defender for Containers / registry scanning not enabled
```bash
# Subscription-level Defender for Containers plan:
az security pricing show -n Containers --query "{name:name,tier:pricingTier}" -o json
# Registry vulnerability-assessment findings (if plan enabled):
az security assessment list --query "[?contains(displayName,'container') || contains(displayName,'registry')].{name:displayName,status:status.code}" -o json
az acr list --query "[].{name:name,rg:resourceGroup,sku:sku.name}" -o json
# Optional offline accelerator (read-only): trivy image <login-server>/<repo>@sha256:<digest>
# Flag: Containers pricingTier == Free/absent, or registries lacking vulnerability-assessment coverage.
```

## CHK-COMP-ACR-NO-CONTENT-TRUST — Content trust / quarantine / immutability not enabled
```bash
az acr config content-trust show --registry <registry> -o json    # status: enabled/disabled
az acr show --name <registry> \
  --query "{sku:sku.name,policies:policies}" -o json               # trustPolicy / quarantinePolicy status
az acr repository show --name <registry> --repository <repo> \
  --query "{changeableAttributes:changeableAttributes}" -o json     # tag/manifest immutability
# Flag: trustPolicy != enabled, quarantinePolicy != enabled, or mutable tags on a Premium registry.
```

## CHK-COMP-CONTAINER-IMAGE-VULN — Deployed images with critical/high CVEs or mutable tags
```bash
# Defender container image vulnerability findings:
az security assessment list \
  --query "[?contains(displayName,'image') && contains(displayName,'vulnerab')].{name:displayName,status:status.code}" -o json
# Images currently referenced by running workloads (read-only):
kubectl get pods -A -o jsonpath="{range .items[*]}{.metadata.namespace}{'/'}{.metadata.name}{'\t'}{range .spec.containers[*]}{.image}{' '}{end}{'\n'}{end}"
# Container Apps / Instances image references:
az containerapp list --query "[].{name:name,images:properties.template.containers[].image}" -o json
az container list --query "[].{name:name,images:containers[].properties.image}" -o json
# Optional offline accelerator (read-only): trivy image --severity HIGH,CRITICAL <image@sha256:digest>
# Flag: a referenced digest maps to a CRITICAL/HIGH finding, or a workload uses a mutable tag (e.g. :latest).
```
