# Meeting Notes - 2026-05-18

## Meeting Info
- **Date:** 2026-05-18
- **Account:** Pennsylvania Higher Education Assistance Agency (PHEAA)
- **Attendees:** Glen, Tim, Microsoft account team
- **Type:** Discovery
- **CSA Assignment:** [CSA name TBD — to be assigned for implementation support and POC guidance]

## Agenda
1. Current MDE and server security posture
2. Defender for Servers path and dependencies
3. Detection, alerting, and reporting requirements

## Notes
- **MDE coverage:** Yes on workstations (desktops/laptops); not yet on servers.
- **Current server endpoint stack:** Servers remain on Trend Micro today.
- **Transition path:** Defender for Servers evaluation with Tim is in flight. Plan A is to onboard Defender for Servers via Defender for Cloud + Azure Arc, then layer KQL content on top.
- **Server environment details:**
  - Windows Server 2008/2012 estate
  - All on-premises
  - Internal-only access pattern (VPN + RDP)
  - Citrix servers are hybrid-joined
  - Standard domain-member servers are not hybrid-joined yet
- **Requirement expansion (beyond initial 4 use cases):**
  - Session recording during admin windows
  - Real-time alerting (not only retroactive log review)
  - "Color in the lines" guardrails: proactive alerts when activity moves outside approved behavior
  - Sentinel workbook for recurring cadence review
- **Audit additions:** Explicit interest in persistence indicators, including:
  - Service account creation
  - Scheduled task creation/changes
  - GPO edits

## Discovery Questions (for next call)
1. **Defender for Servers onboarding path:** Do you want full Defender for Servers Plan 2 feature coverage from day one (which points to Azure Arc onboarding), or a phased start with direct MDE onboarding where applicable?
2. **Arc readiness on legacy servers:** Which Windows Server 2008/2012 systems are Arc-eligible now, and which require remediation or exception handling first?
3. **Agent/version baseline:** What Defender for Endpoint agent versions are currently deployed across server tiers, and where are upgrade gaps?
4. **Data collection scope:** Which event sources are approved for onboarding to support persistence detections (SecurityEvent, Task Scheduler, AD/GPO change signals, session telemetry)?
5. **Real-time alerting target:** For proactive "color in the lines" monitoring, which admin actions should trigger immediate alerts versus daily/weekly workbook review?
6. **Session recording requirements:** What tooling/policy is approved for session recording during admin windows, and where should evidence be retained for audit?
7. **SOC operating model:** Who owns triage, escalation, and response playbooks once Sentinel analytics rules are enabled?

## What We Should Talk About Next
- **Platform decision checkpoint:** Confirm Arc + Defender for Cloud deployment sequencing for Defender for Servers Plan 2 capabilities.
- **Detection-to-action design:** Translate the KQL pack into a prioritized list of Sentinel analytics rules (including NRT where appropriate) and incident routing.
- **Workbook design:** Define workbook audience (Glen/audit/operations), required visuals, cadence, and "out-of-bounds" indicators.
- **Persistence monitoring expansion:** Agree on first wave detections for service account creation, scheduled task changes, and GPO edits.
- **Portal transition planning:** Align new Sentinel content with Defender portal workflows to avoid rework ahead of Azure-portal retirement milestones.

## Microsoft Documentation References
- Defender for Servers deployment planning: https://learn.microsoft.com/azure/defender-for-cloud/plan-defender-for-servers
- Non-Azure server onboarding with Defender for Endpoint (and limitations): https://learn.microsoft.com/azure/defender-for-cloud/onboard-machines-with-defender-for-endpoint
- Defender for Servers plan selection and Arc considerations: https://learn.microsoft.com/azure/defender-for-cloud/plan-defender-for-servers-select-plan
- Microsoft Sentinel near-real-time rules (plus Custom detections guidance): https://learn.microsoft.com/azure/sentinel/create-nrt-rules
- Microsoft Sentinel workbooks (templates, prerequisites, and customization): https://learn.microsoft.com/azure/sentinel/monitor-your-data

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| CSA (TBD) | Kick off Azure Arc + Bastion + PIM/JIT POC on 1 test server; document prerequisites and onboarding checklist. | Week of 2026-05-27 |
| CSA (TBD) | Validate end-to-end session recording pipeline and alert triggering during normal admin activity. | Week of 2026-06-10 |
| Glen / Customer IT | Identify test server for POC and confirm network/firewall prerequisites for Arc and Bastion. | Week of 2026-05-27 |
| Tim | Continue Defender for Servers evaluation; confirm plan P2 readiness and licensing model for POC + Phase 2. | Week of 2026-05-27 |
| Microsoft account team | Map KQL pack into analytics rules + Sentinel workbook design aligned to Glen's proactive monitoring ask. | TBD |

## Next Steps
- Complete Defender for Servers onboarding path and validate Arc-connected coverage for target servers.
- Convert key KQL detections into actionable alert rules.
- Draft a Sentinel workbook focused on admin-window behavior, exception alerts, and persistence-focused monitoring.

## Path Forward & POC Plan

### Immediate Actions (Next 4-6 weeks)
**Phase 1: Azure Arc + Bastion + PIM/JIT Proof of Concept**
- Select 1 production-like test server (Windows Server 2016 or higher preferred; 2008/2012 if that's the baseline to validate)
- Onboard to Azure Arc with Defender for Cloud integration
- Enable Defender for Servers Plan 2 on test server
- Configure Azure Bastion subnet with session recording → Log Analytics
- Set up PIM just-in-time (JIT) access workflow for admin approval
- Validate session audit trail end-to-end (PIM approval → Bastion connection → session recording → Sentinel visibility)
- Document "color in the lines" alerts triggered during normal admin window activity

**Why this POC first:**
- Directly addresses Glen's session recording + proactive alert requirements
- Validates Arc readiness on legacy infrastructure before broad rollout
- Demonstrates the Defender for Cloud → Sentinel audit pipeline
- Creates repeatable playbook for Phase 2 (broader server coverage)

### Medium-term (Weeks 6-12)
**Phase 2: KQL Pack → Analytics Rules → Workbook**
- Translate existing KQL detections into Sentinel scheduled analytics rules (+ NRT candidates)
- Persistence-focus first wave: service account creation, scheduled task changes, GPO edits
- Build Glen's cadence workbook for admin-window behavior + out-of-bounds indicators
- Validate alert routing and SOC triage workflow

### Long-term (Months 3+)
**Phase 3: Broad Defender for Servers Rollout**
- Extend Arc + Defender for Cloud to remaining server estate (Citrix + standard domain members)
- Operationalize Sentinel analytics, alert tuning, and incident response
- Align with Defender portal workflows ahead of Azure-portal retirement (March 31, 2027)

### CSA Responsibilities
- Initial onboarding and Arc agent deployment on test server
- PIM/JIT and Azure Bastion configuration
- POC validation and documentation
- Handoff to Microsoft account team for KQL-to-alert translation
- Ongoing POC escalation and customer guidance
