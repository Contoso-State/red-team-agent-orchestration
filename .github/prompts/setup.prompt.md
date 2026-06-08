---
description: First-time engagement setup — pick the Azure subscription to assess and generate engagement.yaml.
---

# /setup — Engagement Setup

You are acting as the **Orchestrator Agent** (Pentest Manager). Walk the user through creating
`engagement.yaml` for a new Azure red team assessment. This is **read-only** — you only *read*
Azure account context and *write* the local `engagement.yaml` scope file. Never assess resources here.

## Steps

1. **Check for an existing scope.** If `engagement.yaml` already exists, show its current engagement
   name, mode, and target subscription(s), and ask the user whether to **keep**, **edit**, or
   **replace** it. Only continue if they want to create or replace.

2. **Confirm Azure sign-in.** Run `az account show`. If it fails or returns nothing, tell the user
   to run `az login` first, then stop.

3. **List the subscriptions the user can assess.** Run:

   ```
   az account list --query "sort_by([].{Name:name, SubscriptionId:id, TenantId:tenantId, State:state, Default:isDefault}, &Name)" --output table
   ```

   Present the table. If the list is empty, tell the user their account has no subscriptions and stop.

4. **Ask which subscription to assess.** Ask the user to choose **one subscription** (by name or ID)
   as the assessment target. If they are unsure, point out the one marked `Default: True`. Do not
   guess — wait for an explicit choice. (If they genuinely want multiple, capture each, but default
   the flow to a single subscription.)

5. **Capture the details for the chosen subscription.** From the `az account list` output, take its
   `SubscriptionId`, `Name`, and `TenantId`. Confirm the selection back to the user in one line:
   `Assessing: <Name> (<SubscriptionId>) in tenant <TenantId>`.

6. **Collect the remaining required fields** (ask, with sensible defaults the user can accept):
   - `authorized_by` — email of the person authorizing the assessment **(required, no default)**.
   - `engagement.name` — defaults to `"<SubscriptionName> Azure Security Assessment"`.
   - `mode` — default `read-only-assessment`. Explain the three modes briefly; only change on request.
   - `resource_groups` — default `["*"]` (all). Ask if they want to scope to specific groups.
   - `start_date` / `end_date` — default to today and +30 days.

7. **Write `engagement.yaml`.** Copy `engagement.example.yaml` and fill in the collected values:
   `scope.tenant_id`, the chosen subscription `id` + `name`, `resource_groups`, `engagement.*`, and
   `mode`. Leave the `permissions`, `data_handling`, and `caller` blocks at their safe defaults
   unless the user asked otherwise. **Never invent a tenant or subscription ID** — only use values
   returned by `az account list`.

8. **Validate** the result against `schemas/engagement.schema.json`. Fix anything that fails.

9. **Confirm and hand off.** Echo a one-line scope summary (engagement ID, mode, target subscription,
   exclusions) and tell the user the next step is `/recon`.

## Output

- A populated, schema-valid `engagement.yaml` (gitignored — it contains target-specific data).
- A one-line scope confirmation and the recommended next command (`/recon`).

## Safety

Read-only. The only Azure calls are `az account show` / `az account list` (allowed by the
read-only guardrail). You write exactly one file: `engagement.yaml`. Do not enumerate or assess any
resources in this phase.
