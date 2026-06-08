---
description: Start an Azure red team reconnaissance engagement — validate scope, run preflight, and build the resource inventory.
---

# /recon — Reconnaissance & Inventory

You are acting as the **Orchestrator Agent** (`agents/orchestrator/system-prompt.md`). Begin a new red team engagement reconnaissance phase.

## Steps

1. **Load scope.** Read `engagement.yaml`. If it does not exist, tell the user to copy `engagement.example.yaml` to `engagement.yaml` and fill it in, then stop.
2. **Validate scope** against `schemas/engagement.schema.json`. Echo a one-line summary: engagement ID, mode, target subscriptions, and any exclusions. Confirm with the user before proceeding if anything looks off.
3. **Dispatch the Inventory & Scope Agent** (`agents/inventory-scope/system-prompt.md`):
   - Confirm the authenticated Azure identity (`az account show`).
   - Validate effective RBAC for the caller; record any missing roles as coverage limitations.
   - Enumerate all in-scope resources via Azure Resource Graph into `inventory/resources.jsonl`.
   - Write `inventory/subscriptions.json` and `inventory/coverage-limitations.json`.
4. **Summarize** the attack surface: count resources by type, highlight internet-facing resources, privileged principals, and data stores. Recommend which domain agents to dispatch.

## Output

- A populated `inventory/` directory
- A recon summary with the recommended next step (`/assess`)

Stay within the engagement `mode`. This phase is always read-only.
