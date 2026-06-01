# Meeting Packet - 2026-05-28 - George Kemp - Service Principals and App Registrations Walkthrough

## Meeting Info
- **Date:** 2026-05-28
- **Account:** nys-its
- **Type:** Technical Deep-Dive
- **Attendees:** George Kemp (ITS); Andrew Goodson; Sundeep (Sunny); Heidi; Mohammed Abdelhadi

## Decision & Outcome
- **Single decision needed:** Agree on the cross-team workflow for app registrations between ITS Architecture and ITS Identity teams
- **Best-case outcome:** George commits to a pilot: Application Administrator role (PIM-eligible) delegated to 2-3 Architecture team members + Bicep template for app reg creation + Workload Identity Federation as the default credential pattern
- **Fallback outcome:** Schedule follow-up with ITS Identity team present to agree on delegation model

## Current State Delta
1. Internal sync completed 2026-05-27 with Mohammed, Mark, Zari, AG
2. aligned on attendees and approach

## Priority Pains
1. Architecture team has zero Entra ID permissions today
2. dev teams blocked on app registrations
3. team is new to Azure (came from GCP+AWS)
4. GCP single-pane experience is the mental model to bridge from

## Proof Required
- **Proof to show:** GCP-to-Azure identity mental model; SP vs App Reg vs Managed Identity vs WIF decision tree; viable cross-team workflow patterns
- **Evidence ready:** Decision tree diagram; GCP-Azure terminology mapping; Application Administrator role delegation options; WIF reference for GCP/GitHub/on-prem scenarios

## Objections & Risk
- **Likely objections:**
- ITS Identity team may resist delegating Application Administrator role
- legacy apps may not support WIF and will need secrets/certs
- Architecture team needs Entra ID training, not just role grants
- **Competitive risk:** None
- **Execution risk:** Low

## Commitments
- **Customer commitment needed:** George - identify 2-3 Architecture team members for Application Admin pilot; identify 1-2 dev team scenarios to use as first app reg test cases; bring Identity team contact for follow-up call
- **Microsoft commitment:** AG - deliver Bicep app reg template + WIF setup guide for top 3 source scenarios (GitHub, AKS, on-prem) within 1 week; Sunny - deliver GCP-to-Azure identity mapping deck

## Agenda (45 min — proposed)
| Time | Topic | Owner |
|------|-------|-------|
| 0–5 | Intros + George frames his goals & dev team scenarios | George |
| 5–15 | GCP↔Azure identity mental model translation | Sunny |
| 15–25 | App Reg vs SP vs Managed Identity vs WIF decision tree | AG (whiteboard) |
| 25–35 | Cross-team workflow options (Application Admin delegation, templates, PIM) | AG + Mohammed |
| 35–40 | Governance guardrails & what stays with Identity team | AG |
| 40–45 | Next steps + commitments | All |

## Live Notes

---

# 🎯 PRE-MEETING BRIEFING — George Kemp Walkthrough

## 60-Second Frame
> *"George — coming from GCP, the biggest mental shift in Azure is that **Azure (the cloud) and Entra ID (the identity directory) are two separate planes**, run by two separate teams at ITS. The good news: every concept you know in GCP has a 1:1 Azure equivalent — including Workload Identity Federation, which keeps the same name. Today we'll map your mental model, walk the decision tree for picking the right identity type, and propose a cross-team workflow that unblocks your dev teams without requiring you to own Entra ID."*

## GCP → Azure Translation (lead with this)

| GCP (George's world) | Azure / Entra (where he's going) |
|---|---|
| Cloud platform | Azure (ARM control plane) |
| Cloud Identity / Workspace | **Microsoft Entra ID** (separate plane) |
| Service Account | **Service Principal** (the runtime identity in a tenant) |
| (implicit in SA) | **App Registration** (design-time blueprint in Entra ID) |
| Workload Identity (GKE) | **Managed Identity** (system or user-assigned) |
| Workload Identity Federation | **Workload Identity Federation** (same name) |
| IAM Bindings on resources | **Azure RBAC** (subscription/RG/resource scope) |
| IAM Org/Folder policies | **Entra ID Roles + API permissions** (admin consent) |
| Service Account Keys (JSON) | App Registration **client secret / certificate** (last resort) |

### 🔑 The "aha" moment for him
**App Registration ≠ Service Principal.** In GCP a Service Account is one object. In Entra:
- **App Registration** = the global blueprint (definition, redirect URIs, API perms, secrets/certs) — lives in the **home tenant**
- **Service Principal** = an instance of that app in *each tenant* where it's used — gets RBAC, tokens, group memberships

Every GCP person trips on this. Lead with it.

## Decision Tree (whiteboard this)

```
Need an identity for code/app/automation?
│
├── Running INSIDE Azure (VM, AKS, Functions, App Service, ACA)?
│   └── ✅ MANAGED IDENTITY (system or user-assigned)
│         No creds to manage. Period.
│
├── Running OUTSIDE Azure (GitHub Actions, GitLab, on-prem, AWS, GCP)?
│   └── ✅ App Registration + WORKLOAD IDENTITY FEDERATION
│         Federated cred — no secrets, no expiry, OIDC trust to issuer
│         Same name as GCP — easiest concept transfer
│
├── User-facing app that signs people in (web, SPA, mobile, daemon)?
│   └── ✅ App Registration (single- or multi-tenant per scope)
│         Choose auth flow: Auth Code + PKCE, Client Creds, Device Code, etc.
│
└── Legacy script/tool that can't do OIDC, runs on a server with no MI?
    └── ⚠️ App Registration + CERTIFICATE (NOT secret)
          Stored in Key Vault, rotated, audited
          Secrets only with justification + 90-day max
```

**Priority order:** Managed Identity → Workload Identity Federation → Certificate → Secret. **Secrets should be the exception, not the default.**

## The Real Business Problem — Cross-Team Handoff

Architecture owns Azure subscriptions. Identity owns Entra ID. Dev teams need both. Without a defined process, **every app reg becomes a help-desk ticket**.

| Pattern | What it does | When to use |
|---|---|---|
| **Application Administrator role** (Entra) delegated to Architecture (PIM-eligible) | Self-service app reg creation; cannot grant admin-consent perms | **Recommended default** — unblocks 80% of dev scenarios |
| **App ownership model** | Identity creates shell; Architecture team listed as owners | Compromise if Identity won't delegate role |
| **App registration template + pipeline** | Bicep/Terraform module + approval workflow | Scales the request process; auditable |
| **Custom Entra role** | Scoped permissions (create apps but not assign privileged API perms) | Hardened version of Application Administrator |
| **PIM (Privileged Identity Management)** | Time-bound, approval-gated role activation | Tier 0 / high-blast-radius apps |

**Recommendation to George:** Start with **Application Administrator (PIM-eligible)** for 2–3 Architecture leads + **Bicep template library** + **WIF as default credential**. Identity team keeps Global Admin and admin-consent for privileged Graph permissions. **Separation of duty preserved.**

## Governance Guardrails (what stays with Identity team)

- **Admin consent** for Graph API permissions (high-risk perms gated by Identity)
- **Global Admin / Privileged Role Admin** — never delegated
- **App registration deletion** — soft-delete restore window managed by Identity
- **Tenant-wide policies** — Conditional Access, app restrictions, External ID

## Governance Defaults (proposed for ITS)

- **Naming:** `app-<env>-<workload>-<purpose>` (e.g., `app-prod-erp-sftp-sync`)
- **Mandatory owners:** ≥2 per app reg (no orphans)
- **No long-lived secrets:** WIF first → cert second → secret only with justification + 90-day max + Key Vault stored
- **Lifecycle:** quarterly review of unused app regs; auto-disable after 180 days of inactivity (Entra surfaces this signal)
- **Tagging:** owner, cost center, environment, data classification
- **Workload Identities Premium** (paid SKU) — unlocks Conditional Access for SPs, risk detections, lifecycle workflows. Worth raising as the maturity target.

## Discovery Questions for George
1. What specific dev team scenarios are blocked right now? (API, daemon, user sign-in, B2B?)
2. Where do those workloads run — Azure VMs/AKS/Functions, on-prem, GitHub Actions, other clouds?
3. How does Identity team handle app reg requests today — ticket queue, email, SLA?
4. Does Identity team object to delegating Application Administrator, or are they open?
5. Any subscriptions Architecture team is fully sovereign on (vs shared with other agencies)?
6. Existing automation/IaC pattern (Bicep, Terraform, ARM, Portal-clicks)?
7. Is there an existing app reg naming/tagging standard, or greenfield?
8. Compliance constraints — StateRAMP, CJIS, NIST 800-53 — that affect cred policies?

## Watch-Outs
- **Don't over-Microsoft-ify the answer.** George knows GCP cold — speak his language first, then translate.
- **Don't promise Application Administrator delegation without Identity team in the room.** That's their call to make. Frame it as "this is the pattern we'd recommend you propose to Identity."
- **The "workload identity federation" name is identical to GCP** — use that bridge hard. It's the easiest concept transfer.
- **Avoid Entra alphabet soup early.** SP, AppReg, MI, WIF, OIDC, ROPC, OBO — too much too fast loses him.
- **Don't forget Sunny is here to translate** — give him air time on the GCP↔Azure mapping section.

## Likely Objections & Responses

### Obj 1: "Identity team won't give us any Entra permissions"
- Acknowledge — this is a real org dynamic. Propose the app ownership model (Identity creates shells, Architecture owns) as the fallback. Recommend follow-up meeting with Identity team present.
- Bring data: Application Administrator role does NOT grant Global Admin, cannot assign privileged Graph perms, cannot modify Conditional Access. It's purpose-built for this delegation scenario.

### Obj 2: "Legacy apps won't support WIF — we'll need secrets forever"
- Real concern. Position: WIF for everything new + cert (not secret) for legacy that can't be modernized + Key Vault rotation. Secret is the rarest, last-resort path with strict governance.

### Obj 3: "We need training, not just role grants"
- Yes — recommend Sunny-led GCP-to-Azure identity workshop (1–2 hours) as the kickoff. The role grant is the unlock; training is the enablement.

### Obj 4: "How do we handle multi-tenant — other agencies have their own Entra tenants?"
- This is the deeper SLG conversation. Short-term: each agency's apps live in their tenant. Long-term: B2B collaboration, cross-tenant access settings, or Entra External ID for federation. Park for a follow-up if it comes up.

---

## 🎁 LIVE CASE STUDY — WCB / Dale Friscic Email (use this during the meeting)

**Source:** Email forwarded from George Kemp, originally from **Dale Friscic (WCB — Workers' Compensation Board)**

> *"George, We believe WCB's cloud instance of Azure DevOps has had it's OAuth fully deprecated over the past few weeks. We'd like to inquire about the possibility of getting a Managed Identity-backed App Registration on the AZ Commercial Cloud. We have adequate workarounds in place for our current purposes but believe it would be best to head this direction for the long-haul."*

### Translation of Dale's ask

| Dale's words | What that actually means |
|---|---|
| "OAuth fully deprecated" | ✅ True — Microsoft deprecated the legacy Azure DevOps OAuth 2.0 app model; replacement is Entra ID auth |
| "Managed Identity-backed App Registration" | ⚠️ Conflated term — not a single Entra object. But the intent is clear: **secret-less auth to Azure DevOps using an Entra identity** |

**Reference:** [No new Azure DevOps OAuth apps (Microsoft DevBlogs)](https://devblogs.microsoft.com/devops/no-new-azure-devops-oauth-apps/) · [Authenticate with service principals & managed identities](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/service-principal-managed-identity)

### The actual answer — runs Dale's scenario through OUR decision tree (use the whiteboard)

| Where does WCB's workload run? | Recommended pattern |
|---|---|
| **In Azure** (VM, Function, App Service, Pipeline, AKS) | ✅ **Managed Identity** added to Azure DevOps org — calls APIs with MI token, zero credentials |
| **Outside Azure** (on-prem, GitHub Actions, anywhere else) | ✅ **App Registration + Workload Identity Federation** — federated cred, zero secrets |
| **Legacy / cannot OIDC** | ⚠️ App Registration + **certificate** (NOT secret) in Key Vault, auto-rotated |

### Why this email is a gift for the meeting

It's the **exact problem George's role is supposed to solve** — and it's already landing in his inbox. Use it as the live case study when walking the decision tree. Makes the abstract concrete.

**Talk track:**
> *"George — perfect timing. Dale at WCB sent you this exact scenario. Let's walk it through the decision tree we just covered: what's WCB's workload, where does it run, and which of the 3 patterns applies?"*

### Questions to scope with George/Dale before answering Dale
1. **Where does the workload that calls Azure DevOps run today?** (Azure resource → MI. External → WIF.)
2. **What's the workload doing on Azure DevOps?** REST API, pipeline triggers, repo access, work item updates?
3. **Which Azure DevOps org?** (Needs the SP/MI added as a member.)
4. **Confirmed Azure Commercial (not Gov)?** — Dale specifies Commercial ✅
5. **Who owns SP/App Reg creation at WCB?** — they may hit the same Identity-team-bottleneck George is trying to solve

### Draft response for George to send Dale

> *Dale,*
>
> *Good instinct on the direction. The Azure DevOps OAuth 2.0 app model is indeed deprecated — Microsoft is moving everyone to Entra ID-based auth. The "managed identity-backed" pattern is the right call.*
>
> *A few quick questions to scope the right answer:*
>
> *1. Where does the workload that calls Azure DevOps run today? (Azure VM/Function/Pipeline, on-prem, GitHub Actions, etc.)*
> *2. What's it doing on Azure DevOps — REST API calls, pipeline triggers, repo access?*
> *3. Which Azure DevOps org needs the access?*
>
> *Based on those answers, we'll land on one of three patterns:*
> *  • Managed Identity (workload runs in Azure — preferred, zero credentials)*
> *  • App Registration + Workload Identity Federation (workload runs outside Azure — also zero credentials)*
> *  • App Registration + Certificate in Key Vault (legacy fallback)*
>
> *Happy to loop in our Microsoft account team — Andrew Goodson and Sundeep are deep on this. Want to set up a 30-min working session?*
>
> *George*

### Strategic implication for ITS

This is **proof of demand**. If Dale (WCB) is asking, others will too. Reinforces the recommendation that ITS Architecture get **Application Administrator (PIM-eligible)** + a **WIF + Bicep template** library — so these requests become self-service, not bottlenecks.

---

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| TBD | TBD | TBD |

## Next Steps
- TBD

## Artifacts Expected This Call
- Decision tree (App Reg / SP / MI / WIF)
- GCP-Azure terminology mapping
- Application Administrator delegation options
- naming convention template
- sample Bicep app reg module
