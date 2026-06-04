# Meeting Prep — CalPERS: Defender for Cloud & Entra ID PIM

## Meeting Info

- **Date:** 2026-06-03
- **Account:** CalPERS (California Public Employees' Retirement System)
- **Type:** Technical Deep-Dive / Executive Briefing
- **Topics:** Microsoft Defender for Cloud (vs. Wiz), Entra ID PIM

---

## Agenda

1. Microsoft Defender for Cloud overview & competitive positioning vs. Wiz
2. Entra ID PIM — privileged access management for CalPERS
3. Service accounts → Managed Identities migration
4. Q&A and next steps

---

## Part 1: Defender for Cloud vs. Wiz

### Executive Summary

Defender for Cloud is a **full-stack CNAPP** (CSPM + CWPP + DevSecOps) natively built into Azure. Its core advantages over Wiz are:

- **Native Azure integration** — agentless AND agent-based protection
- **True runtime protection** via Microsoft Defender for Endpoint (MDE) integration
- **XDR correlation** across cloud + endpoint + identity + email in one incident
- **Broadest government cloud support** of any CNAPP (Azure Gov, GCC, DoD)
- **Cost advantages** for customers already on Microsoft E5/Defender licenses
- **50+ regulatory compliance dashboards** including FedRAMP, NIST, CMMC

Wiz is a capable agentless posture tool with excellent UI, but it's fundamentally an **overlay tool** — no native runtime protection, no XDR correlation, no sovereign/government cloud presence, and it's a separate purchase on top of existing Microsoft investments.

### Key Differentiators

#### 1. Agentless + Agent-Based (Best of Both Worlds)

| Capability | Defender for Cloud | Wiz |
|-----------|-------------------|-----|
| Agentless CSPM/scanning | ✅ GA | ✅ GA |
| Agent-based runtime EDR | ✅ GA (MDE integration) | ⚠️ Limited (WizDefend add-on, newer) |
| Real-time behavioral detection | ✅ | ❌ |
| Automated incident response (isolate, kill process) | ✅ | ❌ |

> **Talk track:** *"Defender for Cloud gives you agentless for breadth and speed, plus agent-based for depth and real-time response. Wiz is agentless-only — it can't detect runtime threats or respond to incidents on running workloads."*

#### 2. XDR Ecosystem — The #1 Differentiator

- Defender for Cloud alerts flow into **Microsoft Defender XDR portal** (GA May 2026)
- Automatic correlation with Defender for Endpoint, Identity, Office 365, and Cloud Apps
- SOC analyst sees the full attack story: endpoint → cloud resource → data exfiltration — in one incident
- **Wiz has no equivalent** — it sends alerts to SIEM as a separate integration layer

#### 3. CNAPP Coverage

| Pillar | Defender for Cloud |
|--------|-------------------|
| **CSPM (Free)** | Secure Score, asset inventory, MCSB benchmark, multi-cloud posture |
| **CSPM (Paid)** | Agentless scanning, Attack Path Analysis, Cloud Security Explorer, DSPM, CIEM, AI Security Posture |
| **CWPP** | Servers, Containers, Databases (SQL/OSS/Cosmos), Storage, App Service, Key Vault, APIs, DNS, AI Services |
| **DevSecOps** | GitHub, Azure DevOps, GitLab integration; IaC scanning; secrets detection; PR annotations |

**Recent releases (2025–2026):**

| Date | Feature |
|------|---------|
| May 2026 | Defender portal unification GA — single pane for CNAPP + XDR |
| May 2026 | GitHub Advanced Security integration GA |
| June 2026 | Serverless protection GA (Azure Functions + AWS Lambda) |
| June 2026 | Kubernetes misconfiguration enforcement (audit + **block** at admission) |
| June 2026 | Malware detection for EKS/GKE nodes (Preview) |
| Ongoing | AI Security Posture (AI BOM, AI threat protection) — first mover |

#### 4. Multi-Cloud Support

Foundational CSPM, Defender CSPM, agentless scanning, attack path analysis, and Defender for Containers/Servers all work across **Azure, AWS, and GCP** — using native cloud connectors (no agent required for posture).

#### 5. Regulatory Compliance

50+ built-in standards continuously assessed across clouds:

- **FedRAMP High & Moderate** (Azure)
- **NIST SP 800-53 R5** (Azure, AWS, GCP)
- **CMMC Level 2** (Azure, AWS, GCP)
- **NIST CSF v2.0**, PCI DSS v4.0.1, ISO 27001:2022, HIPAA, SOC2, CJIS, and more

> Wiz has **no native compliance dashboards** at this level.

#### 6. Cost Advantages

- **Foundational CSPM is FREE** — already active for Azure customers
- Defender for Servers P1 is low-cost for customers with existing MDE licenses
- Save up to 22% via pre-purchased Defender for Cloud Commit Units
- **Wiz is a separate purchase** ($500K–$2M+ annually reported for enterprise) on top of existing Microsoft investment

> **Talk track:** *"With Wiz, you're paying for a third-party overlay on top of your Azure investment. With Defender for Cloud, you're extending value from investments you've already made."*

#### 7. Government Cloud — Critical for CalPERS

| Feature | Azure Government | Wiz |
|---------|-----------------|-----|
| Foundational CSPM | ✅ GA | ❌ Not available |
| Defender CSPM | ✅ GA | ❌ Not available |
| Defender for Servers | ✅ GA | ❌ Not available |
| FedRAMP/CMMC dashboards | ✅ Native | ❌ Not available |
| Classified/sovereign cloud | ✅ Azure Gov / Secret | ❌ Not available |

Wiz has FedRAMP authorization for **commercial cloud only** — it cannot operate in Azure Government, GCC-High, or classified environments.

### Handling Wiz Objections

| Objection | Response |
|-----------|----------|
| **"Wiz has better UI/UX"** | Acknowledge it — then pivot: Defender for Cloud now has Cloud Security Explorer (graph-based queries) and unified Defender portal (GA May 2026). UI is solvable; missing runtime detection is an architectural gap. Your SOC team already knows the Defender portal from endpoint/identity work — less fragmentation, not more. |
| **"Wiz gives faster time to value"** | Foundational CSPM is **already active and free** on Azure subscriptions. Defender CSPM agentless scanning activates in hours. The real "time to value" question includes runtime protection — Wiz never gets there. |
| **"We already use Wiz"** | Don't attack the investment. Start with gaps: runtime protection (Defender for Servers), XDR correlation, government cloud support, compliance dashboards. Land Foundational CSPM (free) alongside Wiz → demonstrate consolidation value over time. |

### Feature Comparison Quick Reference

| Capability | Defender for Cloud | Wiz |
|-----------|-------------------|-----|
| Agentless CSPM | ✅ | ✅ |
| Runtime protection (EDR) | ✅ GA (MDE) | ⚠️ Limited (add-on) |
| Attack path / risk graph | ✅ GA | ✅ GA |
| DSPM | ✅ GA | ✅ GA |
| CIEM | ✅ GA | ✅ GA |
| Kubernetes security + enforcement | ✅ GA + Preview | ✅ GA |
| DevSecOps / IaC scanning | ✅ GA | ✅ GA |
| AI Security Posture | ✅ GA | ✅ GA |
| **XDR integration (native)** | ✅ GA | ❌ |
| **Identity correlation (Entra)** | ✅ Native | ❌ |
| **Endpoint correlation (MDE)** | ✅ Native | ❌ |
| **Azure Government** | ✅ Full GA | ❌ |
| **Compliance dashboards (50+)** | ✅ Native | ⚠️ Limited |
| **Foundational CSPM cost** | **FREE** | Paid |

### Analyst Positioning

- **Gartner MQ for CNAPP (2024):** Both Microsoft and Wiz are **Leaders**. Microsoft recognized for Azure integration depth and XDR breadth; Wiz for ease of use and multi-cloud agnosticism.
- **PeerSpot:** Wiz rated 8.7/10 (#1 CNAPP), Defender for Cloud 8.1/10 (#4). Wiz leads in UI/UX satisfaction; Microsoft leads in integrated Microsoft environments.

---

## Part 2: Entra ID PIM (Privileged Identity Management)

### Overview

PIM provides **just-in-time privileged access** — eliminating standing admin permissions and enforcing least privilege. Users receive temporary, time-limited role access only when needed, with full audit trail.

### Core Capabilities

#### Just-in-Time (JIT) Access

- Users are assigned **eligible** roles (not permanently active)
- Must explicitly **activate** to use privileges
- Permissions expire automatically after configurable window (1–24 hours)
- Microsoft internally uses PIM — very few permanent Global Administrators

#### Time-Bound Assignments

| Type | Description |
|------|-------------|
| Permanent eligible | Always eligible, must activate each time |
| Permanent active | Continuous access — **only for break-glass accounts** |
| Time-bound eligible | Eligible only within specific date range |
| Time-bound active | Active only within specific date range |

> **Microsoft recommendation:** Zero permanently active assignments except emergency access accounts.

#### Approval Workflows

- Designated approvers per role (users or groups)
- Email notifications with direct action links
- Business justification required; optional incident/ticket number
- Full request/approval history in audit log

**Example configuration:**

| Role | MFA | Approval Required | Duration |
|------|-----|-------------------|----------|
| Global Administrator | ✅ | ✅ | 1 Hour |
| Exchange Admin | ✅ | ❌ | 2 Hours |
| Helpdesk Admin | ❌ | ❌ | 8 Hours |

#### Access Reviews

- Recurring reviews: weekly, monthly, quarterly, semi-annually, annually
- **ML-assisted recommendations** (with Governance license): approve/deny suggestions based on 30-day sign-in activity
- Auto-apply results option — automatically revoke denied access
- Scope to inactive users only (up to 730 days)

#### Security Alerts

| Alert | Severity | Trigger |
|-------|----------|---------|
| Roles assigned outside PIM | 🔴 High | Potential active attack — bypass detection |
| Stale accounts in privileged role | 🟡 Medium | No sign-in within N days |
| Admins not using privileged roles | 🟢 Low | Role not activated in N days |
| Too many Global Administrators | 🟢 Low | GA count exceeds threshold |

#### Three PIM Pillars

| PIM Type | Governs |
|----------|---------|
| **Entra Roles** | Directory roles (Global Admin, Security Admin, custom roles) — tenant-wide |
| **Azure Resources** | Azure RBAC roles (Owner, Contributor) at management group → subscription → resource group → resource |
| **Groups** | JIT membership/ownership of security groups and M365 groups — can control access across Entra, Azure, SQL, Key Vault, Intune, and third-party apps |

### Why CalPERS Needs PIM

#### Zero Trust Alignment

| Zero Trust Principle | How PIM Delivers |
|---------------------|------------------|
| **Verify Explicitly** | Every activation requires MFA, Conditional Access, justification, optional approval |
| **Use Least Privilege** | JIT eliminates standing admin — minimum role, minimum time |
| **Assume Breach** | Alerts, audit logs, time-bounded access limit blast radius if credentials are compromised |

> **Talk track:** *"An admin's credentials being compromised is far less catastrophic when their privileged role was never permanently active — there's nothing for the attacker to inherit."*

#### Compliance — NIST 800-53 Mapping

PIM directly satisfies critical NIST 800-53 controls (which underpin FedRAMP, StateRAMP, and California SIMM requirements):

| Control | Requirement | How PIM Satisfies |
|---------|-------------|-------------------|
| AC-2 | Account Management | Access reviews, expiring role assignments |
| AC-3 | Access Enforcement | JIT activation gates, approval workflows |
| AC-6 | Least Privilege | Elimination of standing admin access |
| AC-17 | Remote Access | Conditional Access requirements during activation |
| AU-2/AU-12 | Audit Events | Comprehensive audit trail of all privileged actions |
| IA-2 | Identification & Authentication | MFA required for role activation |
| SI-4 | System Monitoring | Security alerts for anomalous activity |

#### Audit Readiness

- **Every activation** logged: who, which role, when, for how long, justification
- **Every approval/denial** logged with approver identity and timestamp
- **Out-of-band assignments** trigger High-severity alerts
- Exportable for external audit; integrates with Microsoft Sentinel

> **Talk track:** *"For a pension fund subject to fiduciary oversight and regulatory examination, PIM's audit log demonstrates that administrative actions were appropriately authorized, time-limited, and justified. You can produce this for any audit."*

#### Conditional Access Integration (GA)

- Require **phishing-resistant MFA** (FIDO2/Windows Hello) for activation
- Require activation from an **Intune-compliant device**
- Enforce **Terms of Use** acceptance
- Force **fresh re-authentication** per activation

### Licensing

| Feature | Entra ID P2 | Entra ID Governance |
|---------|-------------|---------------------|
| PIM core (JIT, approval, alerts, audit) | ✅ | ✅ |
| PIM for Groups | ✅ | ✅ |
| Conditional Access controls | ✅ | ✅ |
| Access reviews (basic) | ✅ | ✅ |
| ML-assisted access certifications | ❌ | ✅ |
| Inactive user-scoped reviews | ❌ | ✅ |

| SKU | Price | Included In |
|-----|-------|-------------|
| Entra ID P2 | $9/user/month | **Microsoft 365 E5** |
| Entra ID Governance | $12/user/month (requires P1) | Add-on; step-up available for P2/E5 |

**Government SKUs available:** Entra ID Governance for Government (GCC, GCC-High, DoD).

> If CalPERS has **M365 E5**, core PIM is already included via Entra ID P2.

### Objection Handling

| Objection | Response |
|-----------|----------|
| *"JIT activation is disruptive"* | Activation takes ~60 seconds. Duration windows are configurable (up to 24 hours). Helpdesk can have 8-hour windows. Only Global Admin needs 1-hour windows. |
| *"We already have AD-based admin tiering"* | PIM extends that model to the cloud. Hybrid orgs can bridge via PIM for Groups and SCIM provisioning. |
| *"We're not FedRAMP"* | CalPERS is subject to CA SIMM 5305-A and NIST 800-53 (via CalHR audit). The control objectives are identical. |
| *"We don't have resources for access reviews"* | ML-assisted recommendations reduce reviewer workload. Auto-apply removes manual follow-up. Inactive-user scoping focuses on highest risk. |

### Recent Enhancements (2025–2026)

- **PIM API Iteration 3 (GA):** Full Microsoft Graph API support with app-only permissions. ⚠️ Iteration 2 APIs deprecated **October 28, 2026** — CalPERS should migrate any custom automation.
- **Azure role assignments via Entitlement Management (Preview, May 2026):** Eligible and active Azure RBAC assignments can flow through the same self-service access request/approval model as apps and groups.
- **PIM for Groups access reviews (Preview):** Periodic certification of group-based JIT access — closing a governance gap.
- **Conditional Access Authentication Context for PIM (GA):** Require specific authentication methods, compliant devices, or fresh re-auth per activation.

---

## Part 3: Service Accounts → Managed Identities Migration

### The Problem with Service Accounts

Traditional service accounts (on-prem AD or Entra ID user accounts used by applications) are one of the **highest-risk identity types** in any enterprise:

| Risk | Impact |
|------|--------|
| **Static credentials** | Passwords/secrets stored in config files, scripts, Key Vault — must be rotated manually |
| **Over-privileged** | Often granted broad permissions "just to make it work" — rarely right-sized |
| **No MFA** | Service accounts can't perform interactive MFA — bypassing a core Zero Trust control |
| **Credential sprawl** | Same secret shared across multiple apps, CI/CD pipelines, and team members |
| **Audit blind spots** | Hard to trace which application actually used the credential vs. a compromised actor |
| **Rotation failures** | Password expiry causes outages; disabling expiry creates permanent attack surface |
| **Lateral movement vector** | Compromised service account credentials are a top initial access technique (MITRE T1078) |

### Azure Managed Identities — The Solution

Managed identities **eliminate credentials entirely** for Azure-hosted workloads. Azure automatically provisions and rotates the identity — no passwords, no certificates, no secrets to manage.

#### Two Types

| Type | Description | Use When |
|------|-------------|----------|
| **System-assigned** | Tied 1:1 to an Azure resource; created/deleted with the resource | Single-purpose workloads (one VM, one App Service, one Function) |
| **User-assigned** | Independent resource; can be assigned to multiple Azure resources | Shared identity across multiple resources, or when identity must survive resource recreation |

#### How It Works

1. Azure creates an identity in Entra ID tied to the resource
2. Azure manages the credential lifecycle automatically (no human intervention)
3. The workload requests a token from the Azure Instance Metadata Service (IMDS) — `http://169.254.169.254`
4. Token is used to authenticate to any Azure service that supports Entra authentication
5. **No secrets, no certificates, no rotation — ever**

#### Supported Azure Services (Partial List)

**Services that CAN USE managed identities (as the client):**

- Azure VMs / VMSS
- Azure App Service / Functions
- Azure Container Apps / AKS pods (workload identity)
- Azure Logic Apps
- Azure Data Factory / Synapse
- Azure Automation Runbooks
- Azure DevOps Pipelines (via service connections)

**Services that ACCEPT managed identity tokens (as the resource):**

- Azure Key Vault
- Azure Storage (Blob, Queue, Table, File)
- Azure SQL / Cosmos DB / PostgreSQL / MySQL
- Azure Service Bus / Event Hubs / Event Grid
- Microsoft Graph API
- Azure Resource Manager
- Azure Monitor / Log Analytics
- Any service supporting Entra ID authentication

#### Migration Path: Service Account → Managed Identity

```
┌─────────────────────────────────────────────────────────┐
│  BEFORE: Service Account Pattern                        │
│                                                         │
│  App → reads secret from config/Key Vault →             │
│      → authenticates with password/cert →               │
│      → accesses Azure SQL / Storage / etc.              │
│                                                         │
│  ⚠️ Secret stored somewhere                             │
│  ⚠️ Must rotate manually                                │
│  ⚠️ No MFA possible                                     │
│  ⚠️ Shared across environments                          │
└─────────────────────────────────────────────────────────┘

                        ↓ MIGRATE TO ↓

┌─────────────────────────────────────────────────────────┐
│  AFTER: Managed Identity Pattern                        │
│                                                         │
│  App → requests token from Azure IMDS →                 │
│      → Azure issues short-lived token automatically →   │
│      → accesses Azure SQL / Storage / etc.              │
│                                                         │
│  ✅ No secrets to manage                                │
│  ✅ Auto-rotated by Azure                               │
│  ✅ Scoped RBAC (least privilege)                       │
│  ✅ Full audit trail in Entra sign-in logs              │
└─────────────────────────────────────────────────────────┘
```

### Migration Strategy for CalPERS

#### Phase 1: Inventory & Assess

- Identify all service accounts (Entra ID app registrations, service principals, on-prem AD accounts used by apps)
- Classify by workload location: **Azure-hosted** (can use managed identity) vs. **on-prem/hybrid** (needs workload identity federation or certificate)
- Map each service account to its target resource permissions

#### Phase 2: Azure-Hosted Workloads (Quick Wins)

- Enable **system-assigned managed identity** on VMs, App Services, Functions, Container Apps
- Replace connection strings with identity-based access (e.g., Azure SQL with Entra auth, Storage with RBAC)
- Remove stored secrets from Key Vault / app config for migrated workloads

#### Phase 3: Multi-Resource & Shared Identities

- Create **user-assigned managed identities** for workloads spanning multiple resources
- Implement **AKS workload identity** for containerized applications (replaces pod-managed identity)
- Configure **Federated Identity Credentials** for CI/CD pipelines (GitHub Actions, Azure DevOps) — passwordless service connections

#### Phase 4: Hybrid / On-Prem Workloads

- Use **Azure Arc** to extend managed identity capabilities to on-prem servers
- For truly on-prem apps that can't use managed identities: migrate to **Workload Identity Federation** (exchange external IdP tokens for Entra tokens — no secrets)
- As a last resort: use managed certificates via Key Vault with automatic rotation

### Security & Compliance Benefits

| Benefit | Detail |
|---------|--------|
| **Eliminates credential theft risk** | No passwords or secrets exist to steal — MITRE ATT&CK T1078 (Valid Accounts) is neutralized for Azure workloads |
| **Automatic rotation** | Azure manages the full credential lifecycle — satisfies NIST 800-53 IA-5 (Authenticator Management) |
| **Least privilege via RBAC** | Assign only the specific Azure roles needed (e.g., "Storage Blob Data Reader" not "Contributor") |
| **Full audit trail** | All managed identity sign-ins appear in Entra ID sign-in logs — satisfies AU-2/AU-12 |
| **Conditional Access support** | Managed identity sign-ins can be scoped by Conditional Access policies (location, compliance) |
| **Zero Trust alignment** | No standing credentials = no implicit trust; every token request is verified and scoped |

### NIST 800-53 Controls Addressed

| Control | Requirement | How Managed Identities Satisfy |
|---------|-------------|-------------------------------|
| IA-5 | Authenticator Management | Azure auto-manages credentials; no human-managed passwords |
| IA-9 | Service Identification & Authentication | Each managed identity is uniquely identified in Entra ID |
| AC-6 | Least Privilege | RBAC assignments scoped to specific resources and actions |
| SC-12 | Cryptographic Key Management | Azure handles key material entirely — no customer key management |
| AU-2 | Audit Events | Sign-in logs capture every token issuance |

### Talk Tracks

> **On eliminating service account risk:** *"Every service account with a stored password is a credential theft opportunity. Managed identities eliminate that entire attack surface — there's no password to steal, no secret to leak, no certificate to expire. Azure handles the credential lifecycle end-to-end."*

> **On compliance:** *"NIST 800-53 IA-5 requires organizations to manage authenticator lifecycle — rotation, protection, revocation. With managed identities, Azure satisfies those requirements automatically. You move from a manual, error-prone rotation process to zero-touch credential management."*

> **On the migration:** *"This isn't a big-bang migration. Start with Azure-hosted workloads — enable managed identity on a VM or App Service, assign the right RBAC role, remove the stored secret. Each workload you migrate is one fewer credential to manage and one fewer attack vector to worry about."*

### Objection Handling

| Objection | Response |
|-----------|----------|
| *"We have too many service accounts to migrate at once"* | Prioritize by risk: start with service accounts that have the broadest permissions or access the most sensitive data. Each migration is independent — no big-bang required. |
| *"Our apps use connection strings with embedded credentials"* | Azure SDKs support `DefaultAzureCredential` which automatically uses managed identity when available — often a one-line code change. For Azure SQL, switch to Entra authentication mode. |
| *"Some workloads are on-prem"* | Use Azure Arc for on-prem servers, or Workload Identity Federation for external identity providers. Managed identity isn't all-or-nothing — migrate what you can, federate the rest. |
| *"We just rotate passwords quarterly"* | Quarterly rotation still leaves a 90-day window for credential theft exploitation. Managed identities rotate continuously and automatically — zero window of exposure. |

---

## Discovery Questions for CalPERS

1. What's your current Microsoft 365 licensing? (E3 vs. E5)
2. How many Global Administrator / privileged role assignments are permanently active today?
3. Do you currently run periodic access reviews on privileged roles?
4. Do you have break-glass account procedures documented?
5. Are any workloads in Azure Government or subject to FedRAMP/StateRAMP?
6. Is Wiz currently deployed? If so, what scope — Azure only or multi-cloud?
7. What SIEM/SOAR platform is in use today?
8. What compliance frameworks are you measured against (NIST 800-53, SIMM, other)?
9. How many service accounts / app registrations are currently in use across Azure and on-prem?
10. How are service account credentials managed today — manual rotation, Key Vault, or other?
11. Are any Azure-hosted workloads still using stored connection strings or embedded secrets?
12. Have you started using managed identities for any workloads? If so, what scope?

---

## Action Items

| Owner | Action | Due Date |
|-------|--------|----------|
| | | |

## Next Steps

- _To be filled after meeting_
