# Meeting Notes — 2026-06-02

## Meeting Info
- **Date:** 2026-06-02
- **Account:** Xoople
- **Attendees:**
- **Type:** (Discovery | Demo | Technical Deep-Dive | Follow-up | Executive Briefing)

## Agenda
1. EASM overview
2. Architecture overview
3. Whiteboarding session

### Pre-Work Prior to Workshop (2-hour session, ~June 4-5 TBC)
- **Intro Current Technical Status**
  - Considering plan shared in February workshop
  - Status of platform build-out — MVP / products / regions
- **Identify Pain Points** to work on during on-site session
- **Bottlenecks:**
  - Capacity Plan / Regions and Services
  - Load testing
  - Throughput
  - Latency
  - Cost
  - Data organization
  - Spain Central (Roadmap and migration plan)
- **V2 Target**
  - Q3/Q4 technical objectives
  - Setup for higher maturity level deployments
  - Support to roadmap definition and plan
  - Robust region/capacity choices (XPL "hero" region)

### On-Site Workshop Agenda (Jun 10–12)

| Day | Stream | Morning | Afternoon |
|-----|--------|---------|-----------|
| **Wed, Jun 10** | All | Executive + Architecture Alignment · Intro Data Platform Reality Check · Working Session: Current State Review & Pain Points | Architecture + WAF Deep Dive · Outcome Day 1 |
| **Thu, Jun 11** | Cloud & Data | Cloud Platform Scaling · Governance Evolution · Identity & Access Management | Data & AI Platform at Scale · Outcome Day 2 |
| **Thu, Jun 11** | Sec | SSDLC | Azure perimeter security (EASM + Internal posture + AI red team agents) |
| **Fri, Jun 12** | Cloud & Data | Operational Model + Observability | (Roll-over activity time) · Final outcomes |
| **Fri, Jun 12** | Sec | End user security (Defender and GSA) | Data Security · Azure resource level security (Storage / K8s) |

## Notes
- Customer asked about Frontier program and whether enabling it auto-installs Cowork — it does not; requires admin setup + Copilot licenses
- Need to have a good understanding of CrowdStrike coexistence with MDE on Mac — how they run together, any conflicts or configuration requirements
- **My role:** Covering all security topics across the workshop (Thu + Fri security stream)
- **Goal:** Get customer to whiteboard their architecture from a security perspective — Azure, M365, E5 suite
- **Major focus area: Kubernetes security** — requirements, Azure Policy, Defender for Cloud (Defender for Containers), etc. Expect this to be a primary topic of discussion

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| | Research CrowdStrike + MDE coexistence on macOS (kernel extensions, network filters, exclusions) | |

## Next Steps
- Follow up with CrowdStrike/MDE on Mac coexistence guidance
