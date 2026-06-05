# Meeting Notes — 2026-06-04 · Xoople Pre-Work Session

## Meeting Info
- **Date:** 2026-06-04
- **Account:** Xoople
- **Type:** Pre-Work Alignment (remote, 1 hour)
- **Purpose:** Each Xoople team shares current status + pain points to align agenda for on-site workshop **Jun 10–12, Charlotte**
- **Format:** ~10 min per team, round-robin
- **Microsoft Attendees:**
- **Xoople Attendees:**

## Objective
> Every Xoople team explains current status and pain points so we can lock the on-site agenda and ensure the 3-day workshop in Charlotte focuses on the right topics.

---

## Pre-Meeting Prep — What to Listen For

### Carry-Overs from 2026-06-02 Prep Call
- Bottlenecks already named: capacity plan / regions, load testing, throughput, latency, cost, data organization, **Spain Central** roadmap + migration
- V2 target: Q3/Q4 technical objectives, higher-maturity deployments, "hero" region choice
- Open security questions: Frontier/Cowork licensing, CrowdStrike + MDE on macOS, PKI/cert strategy (GlobalSign vs AFD-managed), **Sentinel CCF migration before 14 Sep 2026**

### Themes Already On the On-Site Agenda (don't re-litigate, validate)
- **Wed AM (All):** Working Session — Current State Review & Pain Points (this is where today's prework feeds in)
- **Wed PM (All):** Architecture + WAF Deep Dive
- **Thu AM (Sec):** SSDLC including **GitHub Advanced Security**
- **Thu PM (Sec):** Azure perimeter — **EASM + internal posture + AI red team agents**
- **Fri AM (Sec):** **End user security** — Defender for **laptops and phones** (Intune-joined)
- **Fri PM (Sec):** **Data Security** + **Azure resource-level security (Storage / K8s)** — K8s hardening lives here

### Topics NOT explicitly on the new on-site agenda — confirm intent today
- **Sentinel / SecOps / CCF migration** — was in earlier draft, not in current Sec stream. Confirm whether to fold into Thu PM perimeter or Fri PM data security, or defer.
- **IAM (MFA, CA, RBAC, PIM)** — now in Day 2 AM **Cloud & Data** stream (not Sec). Confirm coverage / co-presenting.
- **PKI / certificates** — was a customer ask from 6/2; not explicit on agenda. Possibly slot under WAF Deep Dive (Wed PM) or Sec stream.

### Probes to Use If a Team Stalls
- "What broke in the last 30 days?"
- "What would you fix today if you had 1 engineer for a week?"
- "What's the #1 thing you want to walk away from Charlotte with?"
- "What's blocking your Q3/Q4 plan?"

---

## Team Round-Robin (10 min each)

### Team 1 — Cloud Platform / Governance — _______________________
**Speaker(s):**

**Topic shared: "Organization and upkeep"** — 3-pillar approach to subscription & resource hygiene:
- **Analysis** — Review subscriptions and resources, determine ownership and purpose, classify them for deletion or migration
- **Deletion** — Remove subscriptions and resources not needed
- **Migration plan** — Develop a migration strategy that addresses refactoring for alignment with **corporate Landing Zone models** (target architectures, regions, governance, security)

**Current status:**
-

**Pain points:**
-

**Asks for Charlotte:**
-

---

### Team 2 — Networking / Infrastructure — _______________________
**Speaker(s):**

**Topic shared: "Networking"** — 3-pillar current state:

- **Hub & Spoke**
  - 2 Virtual hubs per region (prod and non-prod): **Central US, North Europe, Southeast Asia, Spain Central**
  - WAN-to-WAN connectivity
  - **Azure Firewall** for internet reachability and east-west traffic
  - Segregation between production and non-production (Staging, QA, Dev, sandbox, demos)

- **IP Address Management**
  - **Corporate Base Range:**
    - Spokes range: `10.0.0.0/8` (16,777,214 usable IPs)
    - Laboratory range: `10.0.0.0/8` (16,777,214 usable IPs)
    - Hub range: `192.168.0.0/16` (65,536 usable IPs)
  - Segregation between prod and non-prod
  - Isolated environments & shared services as spoke

- **Exposure Layer**
  - **Front Door** as entry point
  - Static websites (Front Door + Storage Account)
  - Private **APIM** by region and environments (Prod/Non-Prod)
  - **Application Gateway**
  - Public and Global Private DNS
  - **SSL Certificate Management**

**Networking architecture diagram ("Earth's System") — shared on call:**

```
                    Users Machines  /  User Personas
                              ↓
GoDaddy (DNS registrar) → Public DNS Zones · Global Private DNS Zones
                              ↓
              Shared Services VNet:  Front Door  ↔  WAF
                              ↓
              Load Balancers  ·  Application Gateways  ·  API Management
                              ↓                            ↑
          Connectivity:  Virtual WAN Hub → Azure Firewall   |
                              ↓                            |
   ┌────────────────────┬────────────────────┬─────────────┴───────┬───────────────────────┐
   │ Target Sub 1       │ Target Sub 2       │ Target Sub 3        │ Target Sub 3 (sic)    │
   │ VM Scale Sets      │ Worker Container   │ Kubernetes Services │ Storage Account       │
   │ (IoT App)          │ App (Web App)      │ (Backend)           │ (Static Web Site)     │
   └────────────────────┴────────────────────┴─────────────────────┴───────────────────────┘

Key Vault (SSL certificates)  ↔  GlobalSign  +  Let's Encrypt
```

> **Sec focus areas called out by Andrew during the call — bring deep guidance to Charlotte:**
> 1. **Container Apps security** (Sub 2 — Worker Container App pattern): ingress, secrets, identity, scaling-tier protections, network isolation, image provenance
> 2. **Kubernetes / AKS security** (Sub 3 — backend): AKS baseline initiative via Azure Policy, Defender for Containers, Gatekeeper/OPA, network policies, pod security, workload identity, image scanning, runtime detection
> 3. **Storage Account security** (Sub 3 — static web site + general): public access disabled, private endpoints, network ACLs, key rotation / Entra-based auth, SAS policies, soft delete + versioning, infrastructure encryption, customer-managed keys, Defender for Storage
> 4. **SSL cert management with Key Vault**: GlobalSign + Let's Encrypt → Key Vault → AFD/AppGW/APIM. Validate auto-rotation, access policy / RBAC model, soft-delete + purge protection, monitoring for expiry, alignment with 6/2 PKI decision (BYOC vs AFD-managed). **Sub-sub topic:** Let's Encrypt automation (ACME) for non-prod, GlobalSign for prod.

> Sec callouts: AFD as primary ingress validates the PKI/cert conversation from 6/2 (GlobalSign vs AFD-managed). Hub-and-spoke + Azure Firewall sets up Day 3/Fri PM Azure resource-level security discussion. IPAM overlap (spokes & lab both on `10.0.0.0/8`) — flag for clarification. "Target Sub 3" appears twice in the diagram — confirm whether that's two subscriptions or a typo.

**Current status:**
- See Networking architecture diagram above (Earth's System of Record)

**Pain points — Front Door specifically (customer slide):**
- **Routing strategy** — manage custom domains + origin groups, forward to services based on: Origin? Path? Parameters? Geolocation? Latency? — need decision framework
- How to manage **profiles** — is it useful? (single vs multiple AFD profiles)
- How to manage **HA & multiregion**
- How to manage **Blue/Green deployment**
- **Backup & DR strategy** overview
- **SSL Certificates — issued by Microsoft (AFD-managed) or GlobalSign?** ← _same question from 6/2; bring decision framework_
- **Relevant metrics and logs** — observability for AFD

**Key considerations (customer context):**
- Top-level domain: `*.xoople.com`
- Xoople Portal site: `portal.xoople.com`
- Product APIs: `api.xoople.com/{product}`
- **Products & services are deployed regionally** — not all regions have all products (drives routing complexity)

**Asks for Charlotte:**
- AFD routing strategy decision framework (Origin/Path/Params/Geo/Latency)
- AFD multi-profile vs single-profile guidance
- HA + multi-region + Blue/Green patterns on AFD
- AFD + Key Vault cert lifecycle (BYOC vs AFD-managed) — definitive recommendation
- AFD monitoring + log baseline (metrics, WAF logs, access logs, Sentinel ingestion)

**Pain points — APIM specifically (customer slide):**
- **Segregation of duty:** Infrastructure → Cloud Platform team; APIs → Engineering team
- **Independence in API lifecycle** (workspaces?) — APIM Workspaces feature for team isolation
- **XP need to manage API Keys** (subscription keys lifecycle, rotation)
- **Authn/Authz methods** — OAuth2, JWT validation, mTLS, managed identity, Entra ID integration
- **SSL Certificates — issued by Microsoft or Let's Encrypt?** ← _note: different question than AFD (MS vs GlobalSign). Internal APIM = Let's Encrypt candidate_
- **HA & multi-region** — APIM multi-region deployment, regional gateways
- **Backup & DR strategy** overview
- **Relevant metrics and logs** — APIM observability

**Key considerations (APIM context):**
- **Private APIM** — all APIs are private, reachable through hub
- **Environment segregation** (prod and non-prod) by different APIM resources
- **APIs become public through Front Door** (AFD is the exposure layer; APIM stays private)
- **Private DNS pattern (regional):** `internal-neu.xoople.com`, `internal-cus.xoople.com`, `internal-sesg.xoople.com` (North Europe, Central US, Southeast Asia)

**Asks for Charlotte — APIM:**
- APIM Workspaces guidance — separate API team ownership from platform ownership
- Subscription key management + rotation strategy
- Recommended Authn/Authz patterns (Entra ID JWT, mTLS, managed identity on backends)
- Cert choice for internal APIM (Let's Encrypt via Key Vault + ACME automation)
- APIM HA / multi-region topology (regional gateways vs separate instances)
- APIM observability baseline (Diagnostic Settings → Log Analytics, App Insights, gateway logs)

---

### Team 3 — Observability / SRE — _______________________
**Speaker(s):**

**Topic shared: "Observability — Pain Points"**

**Current status / key considerations:**
- **Two Centralized LAW** (Log Analytics Workspaces): **Security** + **Operations** — split by purpose
- **Multiple Application Insights** instances
- **Two instances of Managed Grafana** — split by audience (**Cloud** + **Engineering**)

**Pain points:**
- Most efficient way to **gather and correlate logs and traces** (cross-resource correlation, distributed tracing)
- **Configure Service Health**:
  - Configure alerts for Service Health notifications
  - Set up activity log alerts for Service Health notifications
  - Configure action groups + notification settings
- **Operating model:** alerting and notifications (who gets paged on what, escalation)
- **Helpful dashboard in Grafana** — need reference dashboards / patterns

> **🔥 Major security signal:** Two-LAW model (Security + Operations) is the right pattern for **Sentinel on the Security LAW**. This confirms Sentinel is in scope and the workspace split is already correct. **Bring to Charlotte:** Sentinel architecture on the Security LAW, cross-workspace queries (`workspace()` operator), CCF migration plan before 14 Sep 2026, table-tier choices (Analytics / Basic / Auxiliary) for cost.

**Asks for Charlotte:**
- Log/trace correlation patterns — App Insights → LAW, OpenTelemetry, distributed trace IDs across services
- Service Health alerting baseline (recommended subscription + resource health alerts, action groups)
- Operating model / on-call patterns + alert routing
- Reference Grafana dashboards for Azure platform (Cloud) vs application/product (Engineering)
- **Sentinel deployment on the Security LAW** — connectors, analytic rules, CCF migration, cost levers

---

### Team 4 — _______________________
**Speaker(s):**

**Current status:**
-

**Pain points:**
-

**Asks for Charlotte:**
-

---

### Team 5 — _______________________
**Speaker(s):**

**Current status:**
-

**Pain points:**
-

**Asks for Charlotte:**
-

---

### Team 6 — _______________________
**Speaker(s):**

**Current status:**
-

**Pain points:**
-

**Asks for Charlotte:**
-

---

## Cross-Cutting Themes (fill in live)
- **Recurring pain points across teams:**
- **Surprises / new info:**
- **Things to add to Charlotte agenda:**
- **Things to drop / time-box from Charlotte agenda:**

## Action Items
- [ ] **Review best practices & security posture for Xoople's networking stack** before Charlotte: Hub & Spoke (Virtual WAN hubs), Azure Firewall, Front Door, APIM (private, regional), Application Gateway, Public/Private DNS, SSL cert management. Map to WAF Day 1 PM + Fri PM Azure resource-level security blocks.
- [ ] **Deep-dive prep for Charlotte — focus areas (per call):**
  - [ ] **Container Apps security** — ingress, secrets, managed identity, network isolation, image provenance, scaling tier
  - [ ] **Kubernetes / AKS security** — AKS baseline Azure Policy initiative, Defender for Containers, Gatekeeper/OPA, network policies, pod security, workload identity, image scanning, runtime detection (already planned as Fri PM major focus — bring hands-on lab)
  - [ ] **Storage Account security** — disable public access, private endpoints, network ACLs, Entra auth + RBAC, SAS policies, soft delete + versioning, CMK, Defender for Storage
  - [ ] **SSL cert management with Key Vault** — GlobalSign + Let's Encrypt → Key Vault → AFD/AppGW/APIM. Auto-rotation, RBAC model, soft-delete + purge protection, expiry monitoring, ACME for Let's Encrypt non-prod
- [ ]

## Charlotte Agenda Adjustments
_Capture any concrete changes to the Jun 10–12 plan based on what we hear._
-

## Next Steps
- [ ] Update on-site agenda + deck based on this session
- [ ] Share revised agenda with Xoople before Mon Jun 8
- [ ] Confirm room logistics / remote bridge for Charlotte
