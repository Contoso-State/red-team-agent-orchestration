# Parsed Transcript - 2026-05-27 - Internal - Service Principals and App Registrations

## Decisions
- Team to sync up before the George Kemp call — no surprises
- Sundeep (Sunny) should attend the George Kemp session — knows how to speak their language
- Heidi to attend from Azure perspective

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| Mohammed | Confirm Sundeep for George Kemp session | ASAP |
| Mohammed | Ping Heidi to attend from Azure perspective | ASAP |
| AG | Prepare SP/app registration + Azure↔Entra ID walkthrough | Before George Kemp call |

## Risks & Objections
- George Kemp has no Entra ID permissions — app registrations require Entra ID access, creating a dependency on the Identity team
- Architecture team is multi-cloud (Azure, AWS, GCP) and new to Azure — need to meet them at their experience level
- Split ownership between Azure infra and Entra ID identity is a paradigm shift from GCP where George managed both

## Key Intelligence
- **New stakeholder:** George Kemp — Head of Architecture at ITS
- **Org change:** Architecture team now owns Azure, AWS, and GCP administration
- **Team background:** Members came from AWS and GCP admin roles — new to Azure
- **Core friction:** App registrations live in Entra ID, but a separate Identity team owns Entra ID — George cannot self-service
- **GCP comparison:** In GCP, George managed cloud + identity together; Azure's Entra ID separation is unfamiliar

## Follow-up Questions
- What specific development scenarios need app registrations? (API access, managed apps, daemon services?)
- Does the Identity team have a process for Architecture to request app registrations/SPs?
- Is there appetite for delegated app registration permissions via Entra ID roles?
- What Azure subscriptions does the Architecture team manage?

## Product / Workload Mentions
- Azure portal
- Entra ID (formerly Azure AD)
- Service Principals
- App Registrations
- Active Directory (on-prem, connected to Entra ID)
- Office 365
- Google Cloud Platform
- AWS
