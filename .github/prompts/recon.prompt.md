---
description: Start an Azure red team reconnaissance engagement — validate scope, run preflight, and build the resource inventory.
---

# /recon — Reconnaissance & Inventory

You are acting as the **Orchestrator Agent** (`agents/orchestrator/system-prompt.md`). Begin a new red team engagement reconnaissance phase.

## Steps

1. **Load scope.** Read `engagement.yaml`. If it does not exist, tell the user to copy `engagement.example.yaml` to `engagement.yaml` and fill it in, then stop.
2. **Validate scope** against `schemas/engagement.schema.json`. Echo a one-line summary: engagement ID, mode, target subscriptions, assessment focus (`scope.domains` / `scope.resource_types`), and any exclusions. Confirm with the user before proceeding if anything looks off.
   - **If no focus is set** (`scope.resource_types` and `scope.domains` both empty), ask **"What is your assessment focus for this subscription?"** before enumerating — offer the focus menu (Full estate · Public/internet exposure · Virtual Machines & compute · Data stores · Identity & access · AI/Foundry · Logging & governance · DevOps & supply chain · or specific resource types like *just VMs* or *just Public IPs*). Pass the chosen `scope.resource_types` to the Inventory agent so Resource Graph filters server-side.
3. **Open the session folder.** Derive `<session>` = `<engagement.id>-<YYYY-MM-DD-HHMMSS>` (current UTC time) and create `engagements/<session>/` with `inventory/`, `findings/raw/`, `findings/normalized/`, `evidence/`, and `reports/` subfolders. Snapshot the scope to `engagements/<session>/engagement.yaml`. The whole `engagements/` tree is gitignored, so every run is self-contained and never overwrites a prior session. Set `$env:REDTEAM_SESSION` to this path if you use the PowerShell helpers.
4. **Dispatch the Inventory & Scope Agent** (`agents/inventory-scope/system-prompt.md`):
   - Confirm the authenticated Azure identity (`az account show`).
   - Validate effective RBAC for the caller; record any missing roles as coverage limitations.
   - Enumerate all in-scope resources via Azure Resource Graph into `engagements/<session>/inventory/resources.jsonl` (applying `scope.resource_types` server-side), and build the **scope brief** (`inventory/scope-brief.json`).
   - Write `engagements/<session>/inventory/subscriptions.json` and `engagements/<session>/inventory/coverage-limitations.json`.
5. **Refine focus against what's actually present.** From the scope brief, show the composition (e.g. "1,200 storage accounts, 200 VMs, 18 public IPs across 12 resource types"). If the estate is large, offer to narrow the focus (e.g. "start with the internet-facing surface?") and update `scope.resource_types` / `scope.domains` before `/assess`. Highlight internet-facing resources, privileged principals, and data stores, and recommend which domain agents to dispatch.

## Output

- A populated `engagements/<session>/inventory/` directory
- A recon summary with the recommended next step (`/assess`)

Stay within the engagement `mode`. This phase is always read-only.
