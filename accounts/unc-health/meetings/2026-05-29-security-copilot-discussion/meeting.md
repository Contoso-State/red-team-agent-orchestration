# Meeting Packet - 2026-05-29 - Security Copilot Discussion

## Meeting Info
- **Date:** 2026-05-29
- **Account:** unc-health
- **Type:** Discovery
- **Attendees:** Alex Lowery; Raj; Carlos Townsend

## Decision & Outcome
- **Single decision needed:** Agree on Security Copilot next-step (pilot scope or workshop)
- **Best-case outcome:** TBD
- **Fallback outcome:** TBD

## Current State Delta
1. TBD

## Priority Pains
1. TBD

## Proof Required
- **Proof to show:** TBD
- **Evidence ready:** TBD

## Objections & Risk
- **Likely objections:**
- TBD
- **Competitive risk:** Medium
- **Execution risk:** Medium

## Commitments
- **Customer commitment needed:** TBD
- **Microsoft commitment:** TBD

## Agenda
1. Confirm desired decision and success criteria
2. Review changed conditions and risk blockers
3. Walk through technical proof and open objections
4. Lock owners, dates, and next milestone

## Live Notes
- Topic: free Security Copilot SCU credits included with E5.
- Rob walking through SCU model; floated turning Sec Copilot on at 1 SCU to start.
- Raj escalated directly to Corey Lee: "We still do not see the free SCUs that we are eligible for based off our E5 license. Can you help us with setting this up from Microsoft backend?"
- Discussed multi-workspace pattern: can create multiple Sec Copilot workspaces, assign via Entra groups for segregation/RBAC; each instance tracks its own SCU usage.
- Q: Are the free SCUs assigned to an Azure subscription or tenant-wide?
  - **Tenant-wide, no subscription attachment.** Per Microsoft Learn (security-copilot-inclusion FAQ), E5/E7 inclusion creates a **"Default Security Copilot Capacity"**: auto-created with a default workspace, tenant-scoped, cannot be modified, not billed hourly (drawn from monthly inclusion bucket). No Azure setup or resource group required.
  - Paid/overage SCUs are different: provisioned as "Microsoft Security compute capacities" on a specific Azure subscription + resource group and attached to a workspace ($6/SCU PAYG for overage).
  - Allocation: 400 SCUs/month per 1,000 paid E5/E7 user licenses, capped at 10,000 SCUs/month. Resets monthly, no rollover.
  - Implication for multi-workspace question: the Default Capacity is tenant-wide and shared across all users/experiences — additional workspaces beyond the default would need their own provisioned capacity (paid), since the inclusion bucket lives on the Default Capacity only.

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| Corey Lee | Confirm UNC Health's free Security Copilot SCU entitlement from E5 and get it provisioned on the backend | TBD |
| Corey Lee | Confirm whether the free E5 SCUs can be spread across multiple Sec Copilot workspaces, or are tied to a single workspace | TBD |
| Corey Lee | Confirm in writing for UNC: free E5/E7 SCUs live in tenant-wide Default Security Copilot Capacity (no Azure subscription attachment); only paid/overage capacity attaches to a subscription | TBD |
| TBD | TBD | TBD |

## Next Steps
- TBD

## Artifacts Expected This Call
- TBD
