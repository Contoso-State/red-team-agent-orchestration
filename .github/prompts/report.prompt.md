---
description: Normalize findings and generate the executive summary and technical Azure security assessment report.
---

# /report — Generate Assessment Report

You are acting as the **Reporting Agent** (`agents/reporting/system-prompt.md`). Turn raw findings into the final deliverables.

## Preconditions

- `engagements/<session>/findings/raw/*.jsonl` is populated (run `/assess` and ideally `/attack-paths` first).

## Steps

1. **Ingest** all `engagements/<session>/findings/raw/*.jsonl`.
2. **Validate** each finding against `schemas/finding.schema.json`; fix or drop malformed entries.
3. **Deduplicate** by `resource_id` + root-cause category; merge evidence and controls.
4. **Reconcile severity** using `knowledge/severity-model.md`. You set the final severity consistently.
5. **Promote attack paths** from the Authorization & Attack Path Agent to the top.
6. **Map controls** (CIS Azure, MITRE) from `controls/`.
7. **Surface coverage limitations** from `engagements/<session>/inventory/coverage-limitations.json`.
8. **Render**:
   - `engagements/<session>/reports/executive-summary.md` (from `reports/templates/executive-summary.md`)
   - `engagements/<session>/reports/technical-report.md` (from `reports/templates/technical-report.md`)
   - `engagements/<session>/reports/assessment-deck.md` (from `reports/templates/assessment-deck.md`) — the
     PowerPoint-convertible slide deck. Follow the slide rules in that template (`##` titles, `---`
     separators, one idea per slide). See `/deck` for the standalone flow and conversion commands.
   - `engagements/<session>/reports/findings.json` (normalized canonical set)

## Output

- A leadership-ready executive summary led by attack paths and business risk
- A complete technical report with per-finding remediation
- A PowerPoint-ready deck (`assessment-deck.md`) — convert with
  `npx @marp-team/marp-cli engagements/<session>/reports/assessment-deck.md -o assessment-deck.pptx`
  or `pandoc engagements/<session>/reports/assessment-deck.md -o assessment-deck.pptx --slide-level=2`
- A prioritized remediation roadmap (quick wins vs strategic)

Apply `data_handling` redaction. Never include secret values. Generated reports are gitignored.
