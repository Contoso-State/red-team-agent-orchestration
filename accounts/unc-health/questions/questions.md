# UNC Health — Questions Log

Track open questions, customer-asked questions, and follow-ups for UNC Health.

## Format
Use one file per topic/meeting, or maintain a running log. Suggested naming: `YYYY-MM-DD-topic.md`

---

## Open Questions (Awaiting Customer Response)

| # | Date Asked | Question | Asked By | Status | Answer / Notes |
|---|------------|----------|----------|--------|----------------|
| 1 | | | | Open | |

## Questions From Customer (Need Our Response)

| # | Date Asked | Question | Owner | Due | Response |
|---|------------|----------|-------|-----|----------|
| 1 | 2026-05-21 | Does Microsoft have a Sentinel data connector for Epic EMR audit logs? | AG | 2026-05-21 | **No.** Verified against Microsoft Learn (2026-05-21): no entry in [Sentinel data connectors reference](https://learn.microsoft.com/azure/sentinel/data-connectors-reference), no Content Hub solution, and [Security in Microsoft for Healthcare](https://learn.microsoft.com/industry/healthcare/security-overview#microsoft-sentinel-cloud-based-security-operations) lists only Purview, Power Apps, Dynamics 365, Entra ID, and generic "other data sources" — **Epic is not listed**. The only documented MS↔Epic integration is the [Teams EHR connector for Epic](https://learn.microsoft.com/microsoft-365/frontline/ehr-admin-epic) (clinical workflow, not security audit logs). Ingestion is achieved via custom pipelines (Log Ingestion API + DCR pulling from Clarity/Caboodle `ACCESS_LOG`/`HIM_REC_AUDIT`, Logstash/Fluent Bit/Cribl forwarders, ADF/Synapse ETL, or privacy middleware like FairWarning/Protenus/Maize that forwards to Sentinel via syslog/API). |
| 2 | 2026-05-21 | Do you know of any healthcare orgs ingesting Epic EMR audit logs into Sentinel? | AG | 2026-05-21 | No publicly verifiable references in Microsoft Learn or customer story repositories. Epic-to-Sentinel ingestion is rarely published due to PHI sensitivity. Microsoft Cloud for Healthcare references cite broad Sentinel adoption but don't break out Epic audit log pipelines. **Action:** offer to connect UNC with the MS Health & Life Sciences industry team for peer references under NDA. |

## Technical Deep-Dive Questions

_Architecture, integration, licensing, sizing, etc._

- **Epic audit log ingestion architecture options** (see customer Q1 above):
  - **Pattern A — Log Ingestion API + DCR**: scheduled pull from Clarity/Caboodle → custom table in Log Analytics
  - **Pattern B — File forwarder**: Logstash/Fluent Bit/Cribl tailing Chronicles flat-file exports
  - **Pattern C — ETL**: Azure Data Factory / Synapse from Clarity SQL → ADX or Log Analytics
  - **Pattern D — Privacy middleware**: FairWarning (Imprivata Patient Privacy Intelligence), Protenus, or Maize Analytics → syslog/API into Sentinel
  - **Pattern E — Defender for Cloud Apps**: session-layer activity for Epic Hyperdrive (not EMR-internal audit trail)

## Business / Procurement Questions

_Budget, timeline, decision process, stakeholders, etc._

-

## Resolved Questions

| Date Resolved | Question | Resolution |
|---------------|----------|------------|
| 2026-05-21 | Native Sentinel connector for Epic EMR audit logs? | No — custom ingestion required (see Q1) |
| 2026-05-21 | Healthcare orgs ingesting Epic audit logs into Sentinel? | No public refs; offer NDA peer connect via MS HLS team (see Q2) |

