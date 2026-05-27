# Meeting Packet - 2026-05-27 - Internal - Service Principals and App Registrations

## Meeting Info
- **Date:** 2026-05-27
- **Account:** nys-its
- **Type:** Technical Deep-Dive
- **Attendees:** TBD

## Decision & Outcome
- **Single decision needed:** Align on recommended Entra app registration and service principal governance model for ITS shared-services environment
- **Best-case outcome:** Finalize SP/app reg guidance doc to present to ITS covering naming conventions, credential lifecycle, least-privilege scoping, and workload identity federation
- **Fallback outcome:** Identify open questions on ITS multi-tenant SP topology and assign owners for follow-up research

## Current State Delta
1. First internal session on this topic

## Priority Pains
1. Ungoverned app registrations across agency tenants
2. Service principal credential sprawl and secret expiry risk
3. Lack of workload identity federation — over-reliance on client secrets

## Proof Required
- **Proof to show:** Reference architecture for SP governance in multi-tenant SLG environments
- **Evidence ready:** Microsoft Entra workload identity docs; App registration best practices; Managed identity vs SP decision matrix

## Objections & Risk
- **Likely objections:**
- Agencies may resist centralized app reg policy
- Legacy apps may not support managed identity or federated credentials
- **Competitive risk:** None
- **Execution risk:** Low

## Commitments
- **Customer commitment needed:** N/A — internal prep
- **Microsoft commitment:** AG — draft SP governance one-pager before ITS engagement

## Agenda
1. Confirm desired decision and success criteria
2. Review changed conditions and risk blockers
3. Walk through technical proof and open objections
4. Lock owners, dates, and next milestone

## Live Notes

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| TBD | TBD | TBD |

## Next Steps
- TBD

## Artifacts Expected This Call
- SP vs managed identity decision tree
- App registration naming and lifecycle policy template
- Workload identity federation overview
