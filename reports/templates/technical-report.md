# Technical Security Assessment Report

> Audience: Engineers / security team. Rendered by the Reporting Agent. Every finding with evidence and concrete remediation.

**Engagement:** {{engagement.name}} ({{engagement.id}})
**Date:** {{report_date}}
**Mode:** {{mode}}
**Source of truth:** `engagements/<session>/reports/findings.json`

---

## 1. Methodology

This assessment was conducted by an agentic Azure red team. The Inventory & Scope Agent enumerated in-scope resources; domain agents (Identity, Authorization & Attack Path, Network, Compute, Data Protection, Logging) executed atomic checks; the Authorization & Attack Path Agent correlated findings into attack chains. All checks were read-only configuration analysis unless mode permitted validation.

## 2. Scope

- **Subscriptions:** {{subscription_list}}
- **Resource groups:** {{rg_list}}
- **Exclusions:** {{exclusions}}
- **Total resources assessed:** {{resource_count}}

## 3. Findings Summary

| ID | Title | Severity | Confidence | Resource | Status |
|---|---|---|---|---|---|
| {{id}} | {{title}} | {{severity}} | {{confidence}} | {{resource_short}} | {{status}} |

## 4. Attack Paths

> Featured first because chained findings represent real compromise paths.

### {{path_id}} — {{path_title}}
**Severity:** {{severity}} (scored by end state)
**Entry point:** {{entry}}
**End state:** {{end_state}}

**Path:**
1. {{step_1}}
2. {{step_2}}
3. {{step_3}}

**Break the chain:** {{remediation_to_break_chain}}

## 5. Detailed Findings

> One block per finding. Repeat for each.

### {{finding.id}} — {{finding.title}}

| | |
|---|---|
| **Severity** | {{finding.severity}} |
| **Confidence** | {{finding.confidence}} |
| **Category** | {{finding.category}} |
| **Agent** | {{finding.agent}} |
| **Check** | {{finding.check_id}} |
| **Resource** | `{{finding.resource_id}}` |

**Description:** {{finding.description}}

**Attack vector:** {{finding.attack_vector}}

**Evidence:**
- {{evidence.source}}: {{evidence.summary}}

**Risk:** {{finding.risk}}

**Recommendation:** {{finding.recommendation}}

**Control mapping:** CIS {{cis}} · MITRE {{mitre}}

**References:** {{references}}

---

## 6. Detection Coverage

> From the Logging & Coverage Agent. Which findings would/wouldn't be detected if exploited.

| Finding | Exploitable | Detectable | Compounding? |
|---|---|---|---|
| {{id}} | {{yes/no}} | {{yes/no}} | {{exposed+invisible}} |

## 7. Assessment Coverage & Limitations

{{coverage_limitations}}

## 8. Appendix — Full Control Mapping

{{control_matrix}}
