# Playbook: Data Access & Exfiltration Review

**Goal:** Identify paths by which an attacker could read or exfiltrate sensitive data — directly via exposed stores or indirectly via stolen credentials.

**Owner:** Data Protection Agent (lead), with Authorization & Attack Path Agent for chained access.

**Mode required:** `read-only-assessment`.

## Why this matters

Data is the objective of most attacks. This playbook finds both the front door (publicly exposed data) and the side doors (credentials and identities that grant data access).

## Steps

### 1. Find directly exposed data stores
Run: `CHK-STOR-PUBLIC-BLOB`, `CHK-STOR-ANON-CONTAINER`, `CHK-STOR-PUBLIC-NETWORK`, `CHK-DB-SQL-PUBLIC-NETWORK`, `CHK-DB-COSMOS-PUBLIC-FIREWALL`, `CHK-DB-FLEX-PUBLIC-ACCESS`.

These are immediate breach risks — internet-reachable data.

### 2. Find weak access controls on data stores
Run: `CHK-STOR-SHARED-KEY`, `CHK-DB-SQL-ALLOW-AZURE-SERVICES`, `CHK-DB-SQL-NO-ENTRA-ADMIN`, `CHK-STOR-KV-ACCESS-POLICY-MODEL`.

Shared keys, SQL auth, and access policies are credentials that, once stolen, grant data access.

### 3. Map credential stores and who can read them
Key Vaults often hold the keys to everything else.
Run: `CHK-STOR-KV-PUBLIC-NETWORK`, `CHK-STOR-KV-NO-PURGE-PROTECTION`, `CHK-RBAC-KV-ACCESSPOLICY-WRITE`.

For each Key Vault holding credentials, list which identities can read secrets, and whether any of those identities are reachable from public compute.

### 4. Trace indirect data access chains
Combine with the privilege path analysis:
```
Public app → managed identity → Key Vault secret/get → storage connection string → blob data
```

### 5. Check encryption and resilience
Run: `CHK-STOR-NO-HTTPS-ONLY`, `CHK-DB-SQL-NO-TDE`. Note encryption-at-rest and in-transit gaps.

### 6. Assess exfiltration detectability
Cross-reference with Logging Coverage: would a mass read/download be detected? (`CHK-LOG-NO-DIAG-KEYVAULT`, `CHK-LOG-DEFENDER-DISABLED`). Undetectable exfiltration paths are higher severity.

## Output

A data-risk map: every sensitive store, its exposure level, who/what can access it, the access path, encryption state, and detection coverage. Highlight any unauthenticated or chained-credential path to sensitive data.

## Safety

Configuration and access-posture review **only**. Never read, download, or move actual data or secret values. Listing object names requires explicit `engagement.yaml` permission; reading contents is always forbidden.

## MITRE Mapping

T1530 (Data from Cloud Storage), T1552 (Unsecured Credentials), T1555.006 (Cloud Secrets Management Stores), T1005 (Data from Local System), T1567 (Exfiltration Over Web Service).
