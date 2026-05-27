# Meeting Packet - 2026-05-27 - Internal - Service Principals and App Registrations

## Meeting Info
- **Date:** 2026-05-27
- **Account:** nys-its
- **Type:** Internal Sync / Pre-Call Alignment
- **Attendees:** Mohammed Abdelhadi, Mark Brogan, Andrew Goodson, Zari Mati-Rivera
- **Context:** Mohammed briefed the team on George Kemp's (ITS Architecture team lead) request to learn about service principals and app registrations in Azure/Entra ID. Internal alignment before the customer-facing session.

## Decision & Outcome
- **Single decision needed:** Align on answers to Mohammed's SP/app registration questions and determine next steps
- **Best-case outcome:** Resolve Mohammed's open questions; finalize SP/app reg guidance for ITS
- **Fallback outcome:** Identify open questions on ITS multi-tenant SP topology and assign owners for follow-up research

## Current State Delta
1. ITS undergoing major org restructuring — new Architecture team now owns Azure, AWS, and GCP administration
2. Architecture team led by **George Kemp** — reached out during a training session
3. Team members come from AWS/GCP backgrounds, new to Azure platform
4. Entra ID is managed by a separate identity team — George has no permissions on Entra ID
5. George's GCP experience: he managed both cloud and identity (GCP has its own identity) — split ownership in Azure is unfamiliar

## George Kemp's Questions
1. How to create service principals in Azure
2. How to create app registrations in Azure (Entra ID) to support dev teams
3. How Azure and Entra ID work together — particularly the split ownership model where Entra ID is managed by a separate team

## Key Context
- George understands the identity team owns Entra ID, but this is a shift from his GCP experience where he managed both
- App registrations live in Entra ID, which George doesn't have access to — need to clarify the workflow/handoff between Architecture and Identity teams
- The Architecture team is "really open to learn" about Azure

## Priority Pains
1. Architecture team has no Entra ID permissions — can't create app registrations or SPs independently
2. Split ownership model (Azure infra vs Entra ID identity) is unfamiliar to team coming from GCP
3. Dev teams need app registrations to do development work in Azure — blocked without a clear process

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
- ITS org restructure: new Architecture team now has "the keys" for Azure portal
- Architecture team also owns GCP and AWS — multi-cloud responsibility
- George Kemp (head of Architecture) reached out during a training to learn about SPs and app registrations
- Core friction: app registrations require Entra ID, but a separate Identity team manages Entra ID — George has no permissions there
- In GCP, George managed both cloud and identity — the Azure/Entra split is a learning curve
- Team agreed to sync up before the call with George to avoid surprises
- Mohammed to confirm Sundeep (Sunny) for the call — "knows their language" and can translate Azure/Entra concepts effectively
- Mohammed to ping Heidi for Azure perspective as well
- Andrew and Sunny already confirmed available for the George Kemp session

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| Mohammed | Ping Sundeep to confirm attendance at George Kemp session | ASAP |
| Mohammed | Ping Heidi to attend from Azure perspective | ASAP |
| AG | Prepare SP/app registration walkthrough for George Kemp session | Before next call |
| AG | Cover Azure ↔ Entra ID relationship and split ownership model | Before next call |

## Next Steps
- Customer-facing session with George Kemp (Architecture team lead) — scheduled
- Attendees: Andrew Goodson, Sundeep (Sunny), Heidi, Mohammed
- Focus: Service principals, app registrations, Azure/Entra ID relationship, cross-team workflow for Identity + Architecture collaboration

## Artifacts Expected This Call
- SP vs managed identity decision tree
- App registration naming and lifecycle policy template
- Workload identity federation overview
