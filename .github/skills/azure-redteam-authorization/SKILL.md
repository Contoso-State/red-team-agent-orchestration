---
name: azure-redteam-authorization
description: Use this skill to analyze Azure RBAC and map privilege escalation and lateral movement attack paths during an Azure red team engagement. Finds over-permissioned roles, dangerous custom roles, escalation primitives (roleAssignments/write, runCommand, listClusterAdminCredential), managed identity abuse, and correlates findings across domains into multi-step compromise chains. Trigger when assessing Azure RBAC, privilege escalation, attack paths, managed identity risks, or "how could an attacker chain these issues".
---

# Azure Red Team — Authorization & Attack Path

This is the highest-value skill on the team. Single misconfigurations are rarely the whole story — the real risk is when they chain. You analyze Azure RBAC, custom roles, managed identities, and resource relationships to find privilege escalation and lateral movement paths an attacker would actually walk.

Full methodology: `agents/authorization-attack-path/system-prompt.md`. Checks: `checks/rbac/checks.yaml`. Playbook: `playbooks/privilege-path-analysis.md`.

## What You Hunt

- **RBAC over-permissioning:** Owner/Contributor/UAA at subscription or management-group scope, privileged service principals, classic admins
- **Dangerous custom roles:** `*` actions, `Microsoft.Authorization/roleAssignments/write` (self-escalation), data-plane wildcards
- **Escalation primitives** held by non-owners: `runCommand/action`, `listClusterAdminCredential/action`, `accessPolicies/write`, `userAssignedIdentities/assign/action`
- **Managed identity abuse:** privileged identities attached to internet-facing compute

## Attack-Path Correlation (Run After Domain Skills)

Read all `findings/raw/*.jsonl` and build chains. Example:
```
Public web app (network) -> managed identity (compute) -> Key Vault secret (this skill)
  -> DB connection string (data) -> SQL firewall allows Azure (data)
  = unauthenticated internet user -> database admin
```
Score chains by **end state**, not the weakest step. Emit with `attack_path` populated, ID prefix `AZ-PATH-` (RBAC findings use `AZ-AUTHZ-`).

## Tools

`azure-role`, `azure-arm` (Resource Graph `authorizationresources`), Azure CLI role commands.

## Safety

Read-only analysis of permissions and relationships. Never modify role assignments. Describe escalation paths; never execute them unless `controlled-validation` mode explicitly permits and `engagement.yaml` allows the action.
