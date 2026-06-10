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
   to run `az login` first, then stop. *(Tip: `node tools/preflight/check-environment.mjs` verifies
   sign-in plus the rest of the toolchain — Node, the Azure CLI, and the `resource-graph` extension
   — in one read-only step.)*

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

6. **Ask the assessment focus (scope *within* the subscription).** A subscription can hold
   thousands of resources, so ask the user what they want to focus on rather than assessing
   everything blindly. Ask: **"What is your assessment focus for this subscription?"** and present
   this menu (multi-select; default **Full estate**):

   | # | Focus | Maps to `scope.domains` | Example `scope.resource_types` |
   |---|---|---|---|
   | 1 | **Full estate** — assess everything (default) | *(all)* | *(all)* |
   | 2 | **Public / internet exposure** — Public IPs, NSGs, firewalls, front doors, WAF | `network-exposure`, `attack-surface`, `web-exposure` | `microsoft.network/publicipaddresses`, `microsoft.network/networksecuritygroups`, `microsoft.network/azurefirewalls`, `microsoft.network/applicationgateways`, `microsoft.cdn/*` |
   | 3 | **Virtual Machines & compute** — VMs, scale sets, AKS, containers, App Service | `compute-platform` | `microsoft.compute/*`, `microsoft.containerservice/managedclusters`, `microsoft.containerregistry/registries`, `microsoft.web/sites`, `microsoft.app/*` |
   | 4 | **Data stores** — Storage, Key Vault, SQL, Cosmos DB | `data-protection` | `microsoft.storage/storageaccounts`, `microsoft.keyvault/vaults`, `microsoft.sql/servers`, `microsoft.documentdb/databaseaccounts` |
   | 5 | **Identity & access** — Entra ID, RBAC, managed identities, privilege escalation | `identity-posture`, `authorization-attack-path` | `microsoft.authorization/*`, `microsoft.managedidentity/*` |
   | 6 | **AI / Foundry** — Azure OpenAI, Cognitive Services, ML / AI Foundry | `ai-foundry` | `microsoft.cognitiveservices/accounts`, `microsoft.machinelearningservices/*` |
   | 7 | **Logging & governance** — monitoring coverage, Policy, Defender posture | `logging-coverage`, `governance-posture` | `microsoft.insights/*`, `microsoft.operationalinsights/workspaces` |
   | 8 | **DevOps & supply chain** — ACR, OIDC creds, automation, Logic Apps | `devops-supplychain` | `microsoft.containerregistry/registries`, `microsoft.automation/automationaccounts`, `microsoft.logic/workflows` |
   | 9 | **Specific resource types** — let me name them (e.g. *just Virtual Machines*, *just Public IP addresses*) | *(inferred)* | *(the exact ARM types the user names)* |

   - Let the user pick one or several presets, or **option 9** to name specific resource types
     directly ("just VMs and public IPs"). Translate friendly names to ARM types
     (Virtual Machines → `microsoft.compute/virtualmachines`, Public IP addresses →
     `microsoft.network/publicipaddresses`, Storage → `microsoft.storage/storageaccounts`, etc.).
   - Write the union of the selected domains into `scope.domains` and the union of resource types
     into `scope.resource_types`. If they choose **Full estate**, leave both empty (= all).
   - Confirm back in one line, e.g. `Focus: Public exposure + Virtual Machines (domains: network-exposure, attack-surface, web-exposure, compute-platform)`.

7. **Collect the remaining required fields** (ask, with sensible defaults the user can accept):
   - `authorized_by` — email of the person authorizing the assessment **(required, no default)**.
   - `engagement.name` — defaults to `"<SubscriptionName> Azure Security Assessment"`.
   - `mode` — default `read-only-assessment`. Explain the three modes briefly; only change on request.
   - `resource_groups` — default `["*"]` (all). Ask if they want to scope to specific groups.
   - `start_date` / `end_date` — default to today and +30 days.

8. **Write `engagement.yaml`.** Copy `engagement.example.yaml` and fill in the collected values:
   `scope.tenant_id`, the chosen subscription `id` + `name`, `resource_groups`,
   `scope.resource_types`, `scope.domains` (from the assessment focus in step 6), `engagement.*`,
   and `mode`. Leave the `permissions`, `data_handling`, and `caller` blocks at their safe defaults
   unless the user asked otherwise. **Never invent a tenant or subscription ID** — only use values
   returned by `az account list`.

9. **Validate** the result against `schemas/engagement.schema.json`. Fix anything that fails.

10. **Confirm and hand off.** Echo a one-line scope summary (engagement ID, mode, target subscription,
    assessment focus, exclusions) and tell the user the next step is `/recon`. Note that `/recon`
    opens a fresh per-run session folder `engagements/<engagement-id>-<timestamp>/` where **all**
    output (inventory, findings, evidence, reports) is written and which is fully gitignored. Mention
    that after inventory, `/recon` can **refine the focus against what's actually present** (e.g.
    "I found 1,200 storage accounts and 18 public IPs — want to start with the exposed surface?").

## Output

- A populated, schema-valid `engagement.yaml` (gitignored — it contains target-specific data).
- A one-line scope confirmation and the recommended next command (`/recon`).
- No assessment output yet — that lands under `engagements/<session>/` once `/recon` runs.

## Safety

Read-only. The only Azure calls are `az account show` / `az account list` (allowed by the
read-only guardrail). You write exactly one file: `engagement.yaml`. Do not enumerate or assess any
resources in this phase.
