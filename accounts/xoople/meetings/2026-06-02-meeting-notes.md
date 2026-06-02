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
| **Fri, Jun 12** | Sec | End user security (Defender) | Data Security · Azure resource level security (Storage / K8s) |

## Notes
- Customer asked about Frontier program and whether enabling it auto-installs Cowork — it does not; requires admin setup + Copilot licenses
- Need to have a good understanding of CrowdStrike coexistence with MDE on Mac — how they run together, any conflicts or configuration requirements
- **My role:** Covering all security topics across the workshop (Thu + Fri security stream)
- **Goal:** Get customer to whiteboard their architecture from a security perspective — Azure, M365, E5 suite
- **Major focus area: Kubernetes security** — requirements, Azure Policy, Defender for Cloud (Defender for Containers), etc. Expect this to be a primary topic of discussion
- **Prep needed:** Hands-on Kubernetes security hardening session with Azure Policies (AKS baseline initiative, Gatekeeper/OPA, pod security, network policies)
- **Identity & access topics to cover:** MFA, Conditional Access best practices, RBAC, PIM (just-in-time, approvals, access reviews), least privilege guidance
- **Mobile / endpoint:** Defender for Endpoint on mobile (iOS/Android) with Intune-joined device setup — enrollment, compliance policies, app protection, MTD integration with Conditional Access
- **PKI / certificates:** Discuss certificate management strategy. Open question from customer: are **GlobalSign certificates better for Azure Front Door** (vs. AFD-managed certs or other CAs)?
  - **Answer:** Not inherently — it's a trade-off:
    - **AFD-managed certs** (free, auto-renewed via DigiCert, DV only) are great for standard custom-domain TLS with no specific CA mandate.
    - **BYOC via Key Vault (GlobalSign, DigiCert, etc.)** makes sense when:
      - Need **EV/OV** trust (AFD-managed is DV only)
      - Need **wildcard or multi-SAN** certs managed centrally across services
      - Enterprise PKI policy / compliance **mandates a specific CA**
      - Partner integrations require a **pinned / known CA**
      - Want **custom validity period or renewal control**
    - **Recommendation:** GlobalSign is the right choice if Xoople already standardizes on it for enterprise PKI, needs OV/EV signals, or wants one CA across Front Door + non-Azure endpoints. Otherwise AFD-managed is simpler and free.
  - **End user experience (AFD-managed vs GlobalSign):** Essentially identical to end users.
    - Both show the browser padlock and HTTPS works with no warnings.
    - Modern browsers (Chrome, Edge, Firefox, Safari) no longer visually distinguish DV vs OV/EV in the address bar — the green bar / company-name treatment was removed back in 2019.
    - Only difference visible to users: if they click the padlock → View certificate, OV/EV certs show the organization name (e.g., "Xoople, Inc."); DV certs only show the domain.
    - TLS handshake performance is the same.
    - **Real value of GlobalSign OV/EV today** is for: compliance/audit requirements, partner B2B trust reviews, and phishing resistance for users who inspect cert details — not for visible UX gains.
- **Sentinel — Codeless Connector Framework (CCF) migration (Azure portal notification):**
  - **Deadline: 14 September 2026** — the legacy HTTP Data Collector API will no longer be supported.
  - Data sources, custom integrations, or third-party connectors using the legacy API should transition to **DCR-based ingestion** and connectors built on the **Codeless Connector Framework (CCF)**.
  - After the date, legacy connectors will still function but **will no longer receive customer support**.
  - **Recommended action:** Migrate to CCF-based connectors or **Azure Logs Ingestion API** for custom integrations by 14 Sep 2026.
  - **Why it matters for Xoople:** CCF gives built-in DCR controls for schema, transformations, and cost — better scalability, easier management, access to latest Sentinel innovations.
  - Subscription called out in notice: `8faacb8d-c300-4ca4-8a76-456264a3ee98`

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| | Research CrowdStrike + MDE coexistence on macOS (kernel extensions, network filters, exclusions) | |
| | Prepare hands-on Kubernetes security hardening lab with Azure Policy (AKS baseline initiative, Defender for Containers) | Pre-Jun 10 |
| | Plan Sentinel connector migration to CCF / Logs Ingestion API (legacy HTTP Data Collector deprecated 14 Sep 2026) | Before 14 Sep 2026 |

## Next Steps
- Follow up with CrowdStrike/MDE on Mac coexistence guidance
