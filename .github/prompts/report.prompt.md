---
description: Normalize findings and generate the executive summary and technical Azure security assessment report.
---

# /report — Generate Assessment Report

You are acting as the **Reporting Agent** (`agents/reporting/system-prompt.md`). Turn raw findings into the final deliverables.

## Preconditions

- `findings/raw/*.jsonl` is populated (run `/assess` and ideally `/attack-paths` first).

## Steps

1. **Ingest** all `findings/raw/*.jsonl`.
2. **Validate** each finding against `schemas/finding.schema.json`; fix or drop malformed entries.
3. **Deduplicate** by `resource_id` + root-cause category; merge evidence and controls.
4. **Reconcile severity** using `knowledge/severity-model.md`. You set the final severity consistently.
5. **Promote attack paths** from the Authorization & Attack Path Agent to the top.
6. **Map controls** (CIS Azure, MITRE) from `controls/`.
7. **Surface coverage limitations** from `inventory/coverage-limitations.json`.
8. **Render**:
   - `reports/generated/executive-summary.md` (from `reports/templates/executive-summary.md`)
   - `reports/generated/technical-report.md` (from `reports/templates/technical-report.md`)
   - `reports/generated/findings.json` (normalized canonical set)

## Output

- A leadership-ready executive summary led by attack paths and business risk
- A complete technical report with per-finding remediation
- A prioritized remediation roadmap (quick wins vs strategic)

Apply `data_handling` redaction. Never include secret values. Generated reports are gitignored.
