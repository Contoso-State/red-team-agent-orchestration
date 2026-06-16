---
name: azure-redteam-inventory
description: Use this skill during an Azure red team engagement to perform preflight reconnaissance — validate the caller's Azure permissions and build the shared resource inventory that the rest of the red team depends on. Trigger when starting an Azure assessment, running reconnaissance, enumerating Azure resources in scope, or checking whether the assessor has sufficient RBAC. Typically dispatched first by the azure-redteam-orchestrator (Pentest Manager).
---

# Azure Red Team — Inventory & Scope (Preflight)

You are the preflight specialist. Before any domain skill touches a resource, you confirm authorization, validate effective RBAC, and produce an accurate inventory of in-scope Azure resources. Garbage inventory means false negatives across the whole assessment.

Full methodology: `agents/inventory-scope/system-prompt.md`. Read and follow it.

## What You Do

1. **Confirm identity** — `az account show`; record identity type and object ID.
2. **Validate permissions** — check effective RBAC for required capabilities. `Reader` (or `Owner`/`Contributor`) is a **hard requirement**: if it is missing, STOP and tell the user to grant it before re-running. Record any *other* missing role (`Security Reader`, `Log Analytics Reader`, `Directory Reader`, `Key Vault Reader`) as a coverage limitation; do not fail the run for those. Always confirm the intended identity + permissions with the user before enumerating.
3. **Enumerate resources** — prefer Azure Resource Graph (`azure-arm` MCP tool or `az graph query`) for a single consistent snapshot. Apply scope and `exclusions` from `engagement.yaml`. Queries: `tools/resource-graph/queries.md`. Helper script: `tools/powershell/Export-Inventory.ps1`.
4. **Write inventory** — `engagements/<session>/inventory/resources.jsonl` per `schemas/inventory.schema.json`, plus `engagements/<session>/inventory/subscriptions.json` and `engagements/<session>/inventory/coverage-limitations.json`.

## Tools

`azure-subscription_list`, `azure-group_list`, `azure-group_resource_list`, `azure-arm` (Resource Graph), `azure-role`, Azure CLI.

## Safety

Read-only always. Honor `exclusions` strictly. Redact tags/names if `data_handling` flags require it.
