---
marp: true
paginate: true
theme: default
title: "Azure Security Assessment — {{engagement.name}}"
---

<!--
PowerPoint-ready deck. Rendered by the Reporting Agent into
engagements/<session>/reports/assessment-deck.md, then converted to .pptx:

  Marp:    marp engagements/<session>/reports/assessment-deck.md -o assessment-deck.pptx
  Pandoc:  pandoc engagements/<session>/reports/assessment-deck.md -o assessment-deck.pptx --slide-level=2

Authoring rules so BOTH converters produce clean slides:
  • Every slide starts with a `##` heading and is separated by a `---` rule.
  • One idea per slide; keep to <= 6 bullets, <= 8 words each.
  • Speaker notes go in an HTML comment at the END of a slide (Marp presenter
    notes; harmless to Pandoc). Tables and bullets render natively in PPTX.
  • No nested bullets deeper than one level — they flatten poorly in PPTX.
-->

# Azure Security Assessment

## {{engagement.name}}

**Engagement:** {{engagement.id}}
**Date:** {{report_date}}
**Mode:** {{mode}}
**Prepared by:** Azure Red Team Agent Orchestration

<!-- Title slide. Read-only, configuration-based assessment unless mode states otherwise. -->

---

## Scope

- **Subscription:** {{subscription_name}} ({{subscription_id}})
- **Tenant:** {{tenant_id}}
- **Resources assessed:** {{resource_count}}
- **Resource groups:** {{rg_scope}}
- **Exclusions:** {{exclusions}}

<!-- State what was in scope so the audience trusts the coverage numbers. -->

---

## Overall Risk Posture

# {{overall_rating}}

> {{one_sentence_bottom_line}}

<!-- The single most important takeaway for leadership, in one sentence. -->

---

## Findings at a Glance

| Severity | Count |
|---|---|
| 🔴 Critical | {{critical_count}} |
| 🟠 High | {{high_count}} |
| 🟡 Medium | {{medium_count}} |
| 🔵 Low | {{low_count}} |
| ⚪ Informational | {{info_count}} |

<!-- Lead with the shape of the risk, not the details. -->

---

## Top Attack Paths

1. **{{path_1_title}}** — {{path_1_plain_language}}
2. **{{path_2_title}}** — {{path_2_plain_language}}
3. **{{path_3_title}}** — {{path_3_plain_language}}

<!-- The 3-5 most dangerous chains, plain language: how an attacker really wins.
Add a dedicated slide per path below for the top 1-2 chains. -->

---

## Attack Path — {{path_1_title}}

- **Entry point:** {{path_1_entry}}
- **Step 1:** {{path_1_step_1}}
- **Step 2:** {{path_1_step_2}}
- **Impact:** {{path_1_end_state}}
- **Break the chain:** {{path_1_fix}}

<!-- One marquee attack path walked step by step. Duplicate this slide for the
next most severe chain if needed; delete if there is only one. -->

---

## Top Risks by Theme

| Theme | Risk | Affected |
|---|---|---|
| Public exposure | {{exposure_risk}} | {{exposure_count}} |
| Identity & access | {{identity_risk}} | {{identity_count}} |
| Data protection | {{data_risk}} | {{data_count}} |
| Detection coverage | {{logging_risk}} | {{logging_count}} |

<!-- Group findings into themes leadership recognizes. -->

---

## Critical & High Findings

| ID | Finding | Severity | Resource |
|---|---|---|---|
| {{id}} | {{title}} | {{severity}} | {{resource_short}} |
| {{id}} | {{title}} | {{severity}} | {{resource_short}} |
| {{id}} | {{title}} | {{severity}} | {{resource_short}} |

<!-- Only Critical/High here. Full list lives in the technical report.
Split across two slides if more than ~8 rows. -->

---

## Detection Coverage

- **Would be detected:** {{detectable_summary}}
- **Would NOT be detected:** {{blind_spot_summary}}
- **Exposed *and* invisible:** {{compounding_summary}}

<!-- From the Logging agent. The exposed-and-invisible items are the scariest. -->

---

## Remediation Roadmap

- **Immediate (quick wins):** {{quick_win_1}}; {{quick_win_2}}
- **Near-term (this quarter):** {{near_term_1}}; {{near_term_2}}
- **Strategic (architectural):** {{strategic_1}}; {{strategic_2}}

<!-- Sequence the fixes. Quick wins first to build momentum. -->

---

## Coverage & Limitations

- {{coverage_note_1}}
- {{coverage_note_2}}

<!-- Be explicit about blind spots and permission gaps. Never let a gap read
as "all clear." Source: engagements/<session>/inventory/coverage-limitations.json. -->

---

## Next Steps

- {{next_step_1}}
- {{next_step_2}}
- **Re-test target date:** {{retest_date}}

<!-- Close with clear ownership and a re-test date. -->
