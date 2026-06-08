# Executive Summary — Azure Security Assessment

> Audience: Leadership / CISO. Rendered by the Reporting Agent from normalized findings. Plain language, business risk first.

**Engagement:** {{engagement.name}} ({{engagement.id}})
**Date:** {{report_date}}
**Scope:** {{subscription_count}} subscription(s), {{resource_count}} resources assessed
**Mode:** {{mode}}
**Prepared by:** Azure Red Team Agent Orchestration

---

## Overall Risk Posture

> One paragraph: the bottom line. Is the environment at high, moderate, or low risk? What is the single most important thing leadership should know?

**Risk rating:** {{overall_rating}}  ⬤ Critical / High / Moderate / Low

## Findings at a Glance

| Severity | Count |
|---|---|
| 🔴 Critical | {{critical_count}} |
| 🟠 High | {{high_count}} |
| 🟡 Medium | {{medium_count}} |
| 🔵 Low | {{low_count}} |
| ⚪ Informational | {{info_count}} |

## Top Attack Paths

> The 3–5 most dangerous chains found, in plain language. These are how an attacker would actually compromise the environment.

1. **{{path_title}}** — {{plain_language_path}}
   *Impact:* {{end_state}}
   *Entry point:* {{entry_point}}

## Top Risks by Theme

| Theme | Risk | Affected resources |
|---|---|---|
| Public exposure | {{...}} | {{...}} |
| Identity & access | {{...}} | {{...}} |
| Data protection | {{...}} | {{...}} |
| Detection coverage | {{...}} | {{...}} |

## Prioritized Remediation Roadmap

**Immediate (quick wins, high impact):**
- {{...}}

**Near-term (this quarter):**
- {{...}}

**Strategic (architectural):**
- {{...}}

## Assessment Coverage & Limitations

> What was and wasn't assessed. Any permission gaps or blind spots from `inventory/coverage-limitations.json`. Never let a blind spot read as "all clear."

- {{coverage_note}}

---

*This assessment is configuration-based and read-only unless otherwise noted. Findings reflect the environment state at the time of assessment.*
