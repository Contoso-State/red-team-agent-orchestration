# Playbook: Privilege Escalation Path Analysis

**Goal:** Identify how a principal (user, service principal, or managed identity) with limited privileges could escalate to higher privileges — ideally subscription Owner or Global Administrator.

**Owner:** Authorization & Attack Path Agent.

**Mode required:** `read-only-assessment` (analysis) / `attack-path-analysis` (graphing).

## Why this matters

Real compromise rarely starts with Owner access. It starts with a foothold — a low-privilege account, a compromised app, an over-permissioned service principal — and escalates. This playbook maps those escalation routes.

## The Azure escalation primitives

Flag any non-Owner principal holding these — each is a self-escalation lever:

| Permission | Escalation |
|---|---|
| `Microsoft.Authorization/roleAssignments/write` | Grant self any role → Owner |
| `Microsoft.Compute/virtualMachines/runCommand/action` | Run code as VM's managed identity |
| `Microsoft.Web/sites/*` | Modify app → steal its managed identity token |
| `Microsoft.ContainerService/.../listClusterAdminCredential/action` | AKS cluster admin |
| `Microsoft.Automation/.../runbooks/*` | Run code as automation identity |
| `Microsoft.KeyVault/vaults/accessPolicies/write` | Grant self secret access |
| `Microsoft.ManagedIdentity/.../assign/action` | Attach a privileged identity |

## Steps

### 1. Build the privilege graph
Export principals × role assignments × scopes × managed identities. Use Resource Graph `authorizationresources`.

Run: `CHK-RBAC-SUB-OWNER-SPRAWL`, `CHK-RBAC-SP-PRIVILEGED`, `CHK-RBAC-CLASSIC-ADMIN`.

### 2. Find dangerous role definitions
Run: `CHK-RBAC-CUSTOM-ROLE-ASSIGN-WRITE`, `CHK-RBAC-WILDCARD-ACTION`.

### 3. Identify escalation primitives held by non-owners
Run: `CHK-RBAC-MI-RUNCOMMAND`, `CHK-RBAC-AKS-CLUSTER-ADMIN`, `CHK-RBAC-KV-ACCESSPOLICY-WRITE`.

### 4. Map managed identity reachability
For each managed identity, determine:
- What compute it's attached to (and is that compute internet-facing?)
- What roles the identity holds
- Whether a foothold on that compute yields the identity's privileges

Cross-reference Compute findings (`CHK-COMP-VM-PUBLIC-RUNCOMMAND`).

### 5. Chain to an end state
Connect the steps into a path. Example:
```
Compromised low-priv user
  → holds roleAssignments/write on RG (CHK-RBAC-CUSTOM-ROLE-ASSIGN-WRITE)
  → grants self Owner on RG
  → modifies Function App (CHK-COMP-APPSVC-SECRETS-PLAINTEXT)
  → steals app managed identity token
  → identity has Key Vault secret access
  = low-priv user → Key Vault secrets
```

## Output

Ranked privilege escalation paths, each with: starting principal, ordered steps (each tied to a check/finding), end state, and severity reflecting the end state. Emit as `AZ-PATH-` findings with `attack_path` populated.

## MITRE Mapping

T1078 (Valid Accounts), T1098 (Account Manipulation), T1548 (Abuse Elevation Control), T1552.007 (Container API credentials), T1651 (Cloud Administration Command).
