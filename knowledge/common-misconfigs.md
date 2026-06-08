# Common Azure Misconfigurations

A field reference of the most frequently exploited Azure misconfigurations, why they matter, and the check that finds each. Use this as a quick-hit list during assessments.

## Top 15 — ranked by real-world exploitation frequency

### 1. Storage account anonymous/public blob access
Public containers leak data to anyone. Routinely found by attackers via enumeration tools.
→ `CHK-STOR-PUBLIC-BLOB`, `CHK-STOR-ANON-CONTAINER`

### 2. Management ports (RDP/SSH) open to the internet
The #1 initial access vector for cloud VMs. Constant automated brute force.
→ `CHK-NET-MGMT-PORT-INTERNET`

### 3. "Allow Azure services" on SQL / databases
The 0.0.0.0 firewall rule lets resources from *any* Azure tenant reach the database.
→ `CHK-DB-SQL-ALLOW-AZURE-SERVICES`

### 4. Privileged accounts without MFA
A single phished Global Admin or Owner without MFA = full compromise.
→ `CHK-IDEN-GA-NO-MFA`

### 5. Custom roles with roleAssignments/write
The classic Azure privilege escalation — grant yourself Owner.
→ `CHK-RBAC-CUSTOM-ROLE-ASSIGN-WRITE`

### 6. Secrets in App Service/Function app settings
Connection strings and keys in plaintext config, readable by anyone with config access.
→ `CHK-COMP-APPSVC-SECRETS-PLAINTEXT`

### 7. Key Vault using access policies + public network
Coarse-grained access plus internet reachability over the crown-jewel secret store.
→ `CHK-STOR-KV-ACCESS-POLICY-MODEL`, `CHK-STOR-KV-PUBLIC-NETWORK`

### 8. Legacy authentication enabled
Bypasses Conditional Access and MFA entirely via old protocols.
→ `CHK-IDEN-LEGACY-AUTH`

### 9. AKS public API server + local accounts
Exposed control plane with admin kubeconfig bypassing Entra RBAC.
→ `CHK-COMP-AKS-PUBLIC-API`, `CHK-COMP-AKS-LOCAL-ADMIN`

### 10. Over-permissioned service principals
SPs with subscription Contributor/Owner whose stolen secret = broad control.
→ `CHK-RBAC-SP-PRIVILEGED`

### 11. Public managed identity with privileged roles
Internet-facing app + privileged managed identity = token theft to escalation.
→ `CHK-COMP-VM-PUBLIC-RUNCOMMAND`, attack-path correlation

### 12. Dangling DNS records
CNAME to a deleted resource → subdomain takeover.
→ `CHK-NET-DANGLING-DNS`

### 13. Shared key auth on storage
Account keys are all-or-nothing and rarely rotated.
→ `CHK-STOR-SHARED-KEY`

### 14. Defender for Cloud disabled
No runtime threat detection — attacks proceed unseen.
→ `CHK-LOG-DEFENDER-DISABLED`

### 15. No alerting on role assignments
Privilege escalation happens silently with no detection.
→ `CHK-LOG-NO-ALERT-ROLE-ASSIGN`

## The compounding pattern

The most dangerous findings combine **exposure** + **weak auth** + **no detection**:

> Public storage account (exposure) + shared key auth (weak auth) + no diagnostic logging (no detection) = silent, repeatable data breach.

Always look for these triples — they are where the Reporting Agent assigns top priority.
