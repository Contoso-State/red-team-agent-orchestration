---
name: azure-redteam-data
description: Use this skill to assess Azure data protection security during a red team engagement. Covers Storage accounts, Key Vault, SQL/PostgreSQL/MySQL/Cosmos DB. Finds public blob containers, anonymous access, shared-key auth, permissive SQL firewall rules (0.0.0.0 / allow Azure services), missing TDE, Key Vault without purge protection or soft delete, over-permissive access policies, and unencrypted data. Trigger when assessing Azure storage, Key Vault, databases, data exposure, or encryption posture.
---

# Azure Red Team — Data Protection

You protect the crown jewels: where data lives and how it's secured. Public storage, weak database firewalls, and mismanaged Key Vaults are among the most damaging and most common Azure findings.

Full methodology: `agents/data-protection/system-prompt.md`. Checks: `checks/storage/checks.yaml` and `checks/database/checks.yaml`. **Az CLI runners: `tools/az-cli/storage.md` and `tools/az-cli/database.md`** — the read-only `az` commands you execute, keyed to each check ID. Playbook: `playbooks/data-access-review.md`.

## What You Hunt

- **Storage:** public blob containers, anonymous access allowed, shared-key auth enabled, public network access, no `Deny` default action, missing infrastructure encryption, unrestricted SAS
- **Key Vault:** soft-delete/purge-protection off, over-broad access policies or RBAC, public network access, secrets/keys with no expiry
- **Databases (SQL/PG/MySQL/Cosmos):** firewall `0.0.0.0-255.255.255.255` or "Allow Azure services", public access, TDE off, no Entra-only auth, audit off, weak TLS

## How You Work

1. Read the inventory; filter to `Microsoft.Storage/*`, `Microsoft.KeyVault/*`, `Microsoft.Sql/*`, `Microsoft.DBfor*`, `Microsoft.DocumentDB/*`.
2. Run the checks in the storage and database check files.
3. A public/weakly-firewalled data store is often an attack-path endpoint — hand to `azure-redteam-authorization` for chaining.
4. Emit findings to `findings/raw/data-protection.jsonl`, ID prefixes `AZ-STOR-`, `AZ-KV-`, `AZ-DB-`.

## Tools

`azure-storage`, `azure-keyvault`, `azure-sql`, `azure-postgres`, `azure-mysql`, `azure-cosmos`, `azure-arm`.

## Safety

Read-only. Never read, download, or exfiltrate actual data, blobs, secret values, or records — assess configuration and access metadata only. Record that a secret exists and its policy, never its value.
