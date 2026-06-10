# Cloud Posture, Benchmarks & Vulnerability Management (Azure)

Reference methodology for the **governance-posture** agent (and supporting context for
**logging-coverage** and **devops-supplychain**) on how to read an Azure subscription's
security posture: CIS benchmark coverage, Cloud Security Posture Management (CSPM),
Cloud Vulnerability Posture Management (CVM), Microsoft Defender for Cloud plans, and
asset inventory.

> **Provenance.** This file harvests *methodology* from the Apache-2.0 project
> `mukul975/Anthropic-Cybersecurity-Skills` (pinned commit
> `04450304b12645cb2b974ab96d28c0664758a88d`) — specifically the upstream skills
> `auditing-cloud-with-cis-benchmarks`, `implementing-cloud-security-posture-management`,
> `implementing-cloud-vulnerability-posture-management`,
> `performing-cloud-asset-inventory-with-cartography`, and
> `conducting-cloud-penetration-testing`. We did **not** copy their `SKILL.md` or Python;
> we re-expressed the read-only methodology in this repo's structures. See
> [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and
> [`knowledge/ATTRIBUTION.md`](ATTRIBUTION.md).

> **Read-only posture.** Everything in this file that an agent *runs* is read-only
> (`az ... show/list`, `az rest --method GET`, `az security ... list`). Third-party
> tools (Prowler, ScoutSuite, Cartography) are **optional/knowledge-only** and never
> wired into a default runner. Active penetration-testing technique (from
> `conducting-cloud-penetration-testing`) is captured in the clearly-labelled
> [Active technique — knowledge only](#active-technique--knowledge-only) section and is
> never executed by a read-only agent.

---

## 1. CIS Microsoft Azure Foundations Benchmark

The CIS Azure Foundations Benchmark is the de-facto baseline for an Azure subscription.
It is organised into sections (Identity & Access Management, Defender for Cloud, Storage
Accounts, Database Services, Logging & Monitoring, Networking, Virtual Machines, Key
Vault, App Service, …) with **Level 1** (broadly applicable hardening) and **Level 2**
(defense-in-depth, may reduce functionality) profiles.

**How we measure it (read-only):**

- Azure Policy: is the **Microsoft Cloud Security Benchmark (MCSB)** initiative assigned?
  (`CHK-GOV-POLICY-COVERAGE`)
- Defender for Cloud **Regulatory Compliance** dashboard: is the **CIS Microsoft Azure
  Foundations Benchmark** standard assigned and producing passed/failed control state?
  (`CHK-GOV-NO-CIS-COMPLIANCE-STANDARD`)
  ```bash
  az rest --method GET \
    --url "https://management.azure.com/subscriptions/<subId>/providers/Microsoft.Security/regulatoryComplianceStandards?api-version=2019-01-01-preview" -o json
  ```
- Individual control state maps back to concrete checks in this repo — e.g. CIS
  Storage 3.x → `CHK-STOR-*`, Logging 5.x → `CHK-LOG-*`, Defender 2.1 → `CHK-LOG-DEFENDER-DISABLED`.

**Optional external tooling (knowledge only, not run by an agent):** Prowler
(`prowler azure`) and ScoutSuite produce a CIS-mapped report from read-only credentials
and are useful to corroborate findings during a manual phase. They are not dependencies
of this repo.

**Distinction from policy coverage:** `CHK-GOV-POLICY-COVERAGE` asks "is the MCSB
*policy* initiative assigned and enforcing?"; `CHK-GOV-NO-CIS-COMPLIANCE-STANDARD` asks
"is a *benchmark standard* (CIS/ISO/PCI) being continuously scored?". Both can fail
independently.

---

## 2. Microsoft Defender for Cloud — plans & ownership

Defender for Cloud is both a **CSPM** engine (posture) and a **CWPP** engine (workload
protection). The pricing surface is read via:

```bash
az security pricing list --query "value[].{name:name,tier:pricingTier}" -o json
az security pricing show -n CloudPosture -o json     # foundational Defender CSPM plan
```

**Plan ownership in this repo (avoid double-flagging):**

| Plan(s) | Owning check | Domain |
|---|---|---|
| Workload-protection: VirtualMachines, StorageAccounts, SqlServers, Containers, KeyVaults, AppServices, Arm | `CHK-LOG-DEFENDER-DISABLED` | logging-coverage |
| Foundational **Defender CSPM** (`CloudPosture`) + posture features | `CHK-GOV-NO-DEFENDER-CSPM-PLAN` | governance-posture |
| Per-server **Defender for SQL** alert policy + VA | `CHK-DB-SQL-NO-DEFENDER-VA` | data-protection |
| **Containers** image scanning *enforced in the deploy path* | `CHK-SUP-NO-IMAGE-SCAN-ENFORCED` | devops-supplychain |

The **secure score** (`CHK-GOV-SECURE-SCORE-LOW`) is the aggregate KPI; the **security
contact** (`CHK-GOV-NO-SECURITY-CONTACT`) ensures alerts reach a human.

---

## 3. Cloud Security Posture Management (CSPM)

CSPM = continuous detection of *misconfigurations and compliance drift* (over-permissive
IAM, public storage, unencrypted data, missing network controls), as opposed to
signature-based vulnerability scanning.

The **Defender CSPM** plan unlocks the high-value posture capabilities:

- **Cloud security graph** + **attack-path analysis** — surfaces multi-step exposure
  chains (e.g. internet-exposed VM → managed identity → Key Vault), which is exactly the
  correlation the **authorization-attack-path** agent reasons about.
- **Agentless scanning** of VM disks (secrets, malware, software inventory).
- **Security governance rules** (owner + remediation SLA per recommendation).

Read-only signals:

```bash
az security pricing show -n CloudPosture -o json                 # plan + extensions
az security assessment list -o json                              # recommendation backlog
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<subId>/providers/Microsoft.Security/assessments?api-version=2021-06-01" -o json
```

→ `CHK-GOV-NO-DEFENDER-CSPM-PLAN`, `CHK-GOV-SECURE-SCORE-LOW`.

**Optional external tooling (knowledge only):** Prowler / ScoutSuite provide a
provider-agnostic CSPM second opinion; AWS Security Hub / GCP SCC are the cross-cloud
analogues referenced upstream but out of scope here.

---

## 4. Cloud Vulnerability Posture Management (CVM)

CVM is the *vulnerability* (CVE) view layered on CSPM: continuously assess machines,
containers, and registry images and drive the findings to closure.

Read-only signals:

```bash
az security assessment list -o json
az security sub-assessment list -o json
# Look for:
#  'Machines should have a vulnerability assessment solution'
#  'Container registry images should have vulnerability findings resolved'
#  'Running container images should have vulnerability findings resolved'
```

A failing CVM posture means scanner-confirmed, exploitable CVEs on exposed assets —
direct initial-access / privilege-escalation paths (MITRE T1190, T1203, T1068).

→ `CHK-GOV-NO-VULN-POSTURE-MGMT` (governance backlog view), feeding
`CHK-SUP-NO-IMAGE-SCAN-ENFORCED` for the container deploy-path angle. Distinguish from
`CHK-GOV-SECURE-SCORE-LOW` (overall score) — CVM is specifically the vulnerability
sub-assessment backlog.

---

## 5. Asset inventory (foundation for posture)

You cannot assess what you cannot see. Posture work starts from a complete inventory,
which in this repo is built by the inventory/recon phase and the datastore
(`knowledge/datastore.md`) rather than by re-crawling Azure per check.

Read-only enumeration primitives:

```bash
az graph query -q "Resources | project name, type, location, resourceGroup, subscriptionId"
az resource list -o json
az account management-group list -o json   # hierarchy / blast-radius context
```

**Cartography (optional, knowledge only).** Upstream uses
[Cartography](https://github.com/cartography-cncf/cartography) to load cloud assets and
IAM relationships into a Neo4j graph for attack-path queries. It is **not** a dependency
here — our equivalent is Azure Resource Graph + the SQLite datastore + the
authorization-attack-path correlation. Cartography is noted as an alternative an operator
may use out-of-band with read-only credentials.

---

## 6. Active technique — knowledge only

> The upstream `conducting-cloud-penetration-testing` skill describes **active**
> techniques (Pacu, exploiting IAM misconfigurations, SSRF to the instance metadata
> service / IMDS, token theft). These are **not** run by any read-only agent in this
> repo. They are recorded here purely as context and, where in scope, are routed through
> the gated External Vulnerability Agent (EVA) lane under engagement mode
> `external-active-testing` only.

Posture relevance of these techniques (so a read-only finding can explain *why* it
matters), without executing them:

- **IMDS / SSRF → managed-identity token theft.** A workload with a privileged managed
  identity plus an SSRF-able front end lets an attacker mint Azure tokens. Posture
  controls: least-privilege MI RBAC, IMDSv2-style restrictions, WAF. (Surfaced by
  attack-path analysis, not by an active probe.)
- **IAM misconfiguration chaining.** `roleAssignments/write`, broad custom roles, and
  Owner sprawl are the escalation primitives — owned by **authorization-attack-path**.
- **Shared-responsibility scope.** Only the customer-controlled configuration plane is
  ever assessed; the Azure platform/control plane is out of scope for any testing.

---

## 7. Control references

| Concept | This repo's checks | CIS Azure | NIST CSF 2.0 | MITRE ATT&CK |
|---|---|---|---|---|
| CIS benchmark coverage | `CHK-GOV-NO-CIS-COMPLIANCE-STANDARD` | 2.1 | GV.PO-01 | T1078.004, T1580 |
| Defender CSPM plan | `CHK-GOV-NO-DEFENDER-CSPM-PLAN` | 2.1 | GV.RM-01 | T1078.004, T1580 |
| Vulnerability posture (CVM) | `CHK-GOV-NO-VULN-POSTURE-MGMT` | 2.1 | ID.RA-01 | T1190, T1203, T1068 |
| Secure score backlog | `CHK-GOV-SECURE-SCORE-LOW` | 2.1 | ID.RA-05 | T1190, T1078 |
| Defender plans (workload) | `CHK-LOG-DEFENDER-DISABLED` | 2.1.x | DE.CM-09 | T1562.001 |
| Defender for SQL / VA | `CHK-DB-SQL-NO-DEFENDER-VA` | 4.1.x | DE.CM-09 | T1190, T1530 |
| Image scanning enforced | `CHK-SUP-NO-IMAGE-SCAN-ENFORCED` | — | GV.SC-04 | T1525, T1195.002 |

CSF subcategory IDs above are drawn from [`controls/nist-csf.yaml`](../controls/nist-csf.yaml);
CIS section references from [`controls/cis-azure.yaml`](../controls/cis-azure.yaml).
