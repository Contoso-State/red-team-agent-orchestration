---
title: Permissions & Least Privilege
description: Recommended read-only role assignments for Azure subscription scope and Entra ID.
---

# Permissions & Least Privilege

This assessment is designed to run read-only. The safest setup is a dedicated assessment identity
with only read roles on **one target subscription** and read-only tenant roles in Entra ID.

## Recommended role set

| Scope | Role | Baseline | Why |
|---|---|---|---|
| Target subscription | `Reader` | **Required** | Resource inventory and configuration reads across in-scope resources. |
| Target subscription | `Security Reader` | **Required** | Security posture/recommendation surfaces used by security-focused checks. |
| Log Analytics workspace(s) in scope | `Log Analytics Reader` | Recommended | Improves logging and detection-coverage analysis. |
| Key Vaults in scope | `Key Vault Reader` | Recommended | Reads Key Vault metadata and policy state without secret-value access. |
| Entra ID tenant | `Directory Readers` | **Required for full identity coverage** | Read users, groups, app registrations, service principals, and directory objects. |
| Entra ID tenant | `Security Reader` | Recommended | Improves access to security-related Entra surfaces in read-only mode. |
| Entra ID tenant | `Reports Reader` | Recommended | Improves sign-in/audit reporting coverage. |

## Best-practice safeguards

1. Scope role assignments to the exact target subscription (not tenant- or management-group-wide unless explicitly intended).
2. Use a dedicated assessment identity (user or service principal), separate from admin/operator accounts.
3. Use PIM/JIT with short expirations for elevated read roles instead of standing assignments.
4. Require MFA and Conditional Access for the assessment identity.
5. Keep `engagement.yaml` in `read-only-assessment` mode unless active testing is explicitly authorized.
6. Run `/setup` and `/recon` first so permission gaps are captured in `coverage-limitations.json`.

## Roles to avoid for read-only runs

- `Owner`
- `Contributor`
- `User Access Administrator`
- Any role granting write/delete actions on target resources

The guardrail blocks mutating commands, but least-privilege RBAC is the primary control.
