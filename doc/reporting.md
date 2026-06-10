---
title: Reporting
description: The interactive HTML report, consulting deliverables, and the structured findings model.
---

# Reporting

The `/report` command normalizes findings, deduplicates, reconciles severity, and renders a
full set of consulting-grade deliverables — all from a single normalized `findings.json`,
never hand-written.

## Deliverables

Every run writes these into `engagements/<session>/reports/`:

- **Executive summary** — leadership-ready narrative and risk posture.
- **Technical report** — per-finding detail with evidence and remediation.
- **Interactive HTML report** (`report.html`) — the flagship deliverable (below).
- **Slide deck** (`assessment-deck.md`) — PowerPoint-convertible via Marp or Pandoc.
- **`findings.json`** — the normalized, machine-readable source of truth.
- **`delta.json`** — what changed since the prior run (new / persisting / resolved /
  regressed), produced from the [engagement datastore](datastore.md)'s history. The executive
  summary leads with it.

## The interactive HTML report

The HTML report is a **self-contained, offline, print-first consulting deliverable**:

- Cover page, table of contents, and executive summary.
- **Attack paths** with clickable nodes.
- Findings that **expand in place**.
- Prioritized recommendations and an asset/scope inventory.
- A **consolidated pan/zoom attack graph**.
- Method appendices, and clean **export to PDF**.

It is rendered straight from `findings.json` by `tools/report/generate-report.mjs` (see
`tools/report/README.md`).

:::{card} 📊 View the live sample report
:link: https://raw.githack.com/Contoso-State/red-team-agent-orchestration/main/tools/report/sample/report.sample.html
A full fictional engagement, rendered by the report generator — interactive attack-path
graph, expandable findings, and print-to-PDF. (Source:
`tools/report/sample/report.sample.html`.)
:::

## Findings model

All findings are **structured JSON** and validated against JSON Schemas in `schemas/`:

| Schema | Describes |
|---|---|
| `schemas/finding.schema.json` | A single normalized finding |
| `schemas/attack-path.schema.json` | A multi-step attack chain |
| `schemas/check.schema.json` | An atomic check definition |
| `schemas/inventory.schema.json` | The enumerated resource inventory |
| `schemas/engagement.schema.json` | Engagement scope and configuration |

Because reports are generated from this model, the executive summary, technical report,
HTML report, and slide deck always stay consistent with one another.

## Report templates

Human-readable templates that the reporting agent fills from `findings.json` live in
`reports/templates/`:

- `executive-summary.md`
- `technical-report.md`
- `finding.md`
- `assessment-deck.md`
