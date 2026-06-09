# Interactive HTML Report Generator

`generate-report.mjs` turns the canonical `findings.json` into a single,
self-contained, **interactive HTML report** laid out as a **professional,
print-first consulting deliverable**: a cover page, table of contents, executive
summary, attack paths, findings, prioritized recommendations, an asset/scope
inventory, a consolidated interactive attack graph, and method appendices.
Attack paths render as clickable node graphs, every finding expands in place,
and the whole document prints (or "Save as PDF") cleanly.

It is **dependency-free** (Node standard library only) and produces a report
that is **fully offline and self-contained**: no external scripts, styles,
fonts, images, or network calls. This matters because the report is a pentest
deliverable opened in a browser — it must never phone home.

## Usage

```bash
node tools/report/generate-report.mjs \
  --findings   engagements/<session>/reports/findings.json \
  --attack-paths engagements/<session>/reports/attack-paths.json \   # optional
  --engagement engagements/<session>/engagement.yaml \               # optional
  --out        engagements/<session>/reports/report.html
```

| Flag | Required | Description |
|---|---|---|
| `--findings` | yes | Normalized `findings.json` (array, or `{ "findings": [...] }`). The canonical source of truth. |
| `--attack-paths` | no | Explicit attack-path graph (see `schemas/attack-path.schema.json`). When present it is **authoritative** for the graph; paths it covers are not re-derived. |
| `--engagement` | no | `engagement.yaml`/`.json` for report metadata (name, id, mode, subscriptions). Falls back to values derived from the findings. |
| `--out` | no | Output path. Defaults to `report.html` next to the findings file. |
| `--title` | no | Override the report title. |

If `--attack-paths` is omitted, the generator **derives** a linear node chain
from any finding whose `id` starts with `AZ-PATH-` or whose `attack_path[]` is
non-empty. Derived paths are clearly labelled `derived` (the nodes are the
finding's narrative steps, not validated resource topology).

## What the report contains

The document reads top-to-bottom like a consulting report. A sticky sidebar
table of contents (with scroll-spy) mirrors the cover's printed contents list.

1. **Cover** — engagement title, client, engagement id, mode, date, in-scope
   subscriptions, a severity breakdown, a `CONFIDENTIAL` marker, the read-only
   disclaimer, and a printed table of contents.
2. **Executive Summary** — safe, evidence-bounded narrative (totals, the
   highest-severity modeled path, the busiest domain, open-risk and attack-path
   participation counts), a severity donut, KPIs, and per-severity cards that
   click through to filter the findings list.
3. **Attack Paths** — each chain as an inline SVG node graph
   (`entry → pivot → target`) with technique-labelled edges. Nodes that map to a
   finding are clickable and jump to that finding. Explicit paths are tagged
   `modeled`; single-finding chains are tagged `derived`. Each path shows its
   entry point, end state, and the "break the chain" remediation.
4. **Findings** — a dense, filterable list (severity / domain / agent / text
   search). Click a row to expand description, attack vector, attack-path steps,
   evidence, risk, recommendation, and CIS/MITRE/Defender/NIST control chips.
5. **Recommendations** — findings consolidated (by `check_id`, else normalized
   recommendation text) into prioritized tiers — **Immediate**, **Short-term**,
   **Hardening** — with control mappings and the findings each item addresses.
   Items that sever a modeled attack path are flagged and weighted higher.
6. **Resources & Scope** — an asset inventory deduplicated by resource id and
   ranked by worst observed severity, plus a per-tenant / per-subscription
   roll-up of assets and findings.
7. **Consolidated Attack Graph** — all **modeled** attack paths merged into one
   deduplicated, **pan/zoom** interactive graph (drag to pan, scroll to zoom,
   click a node to open its finding, hover to highlight shared paths). Falls back
   to a node table for very large graphs.
8. **Appendix A · Coverage & Controls** — findings by domain and severity, plus
   the rolled-up MITRE ATT&CK / CIS Azure / Defender / NIST mappings observed.
9. **Appendix B · Methodology & Limitations** — scope, approach, and the
   limitations of a read-only assessment.
10. **Appendix C · About This Report** — generation provenance, counts, and any
    generation notes/warnings.

## Security properties

- **Context-aware escaping.** Every interpolated value is escaped for its exact
  context (HTML text, HTML attribute, URL, JSON-in-`<script>`, SVG text). Finding
  text can originate from an attacker-controlled Azure environment (resource
  names, tags), so this prevents stored XSS in the deliverable.
- **URL allow-list.** `references[]` are rendered as links only when `http`/
  `https`; `javascript:`, `data:`, `file:`, etc. are rendered as inert text.
  Links carry `rel="noopener noreferrer"`.
- **Restrictive CSP** (`default-src 'none'`) and `referrer: no-referrer` are set
  via `<meta>`. No event-handler attributes; the single inline script only
  toggles CSS classes and SVG transforms (progressive enhancement). All content
  is server-rendered, so the report works with JavaScript disabled — a
  `<noscript>` fallback expands every finding and hides the JS-only controls —
  and prints/exports to PDF cleanly (print styles force every finding open and
  reset the graph transform).

## Sample

`tools/report/sample/` contains a **fictional, clearly-labelled** dataset
(all-zero subscription GUIDs, no real targets) and the rendered
`report.sample.html`. Open it in a browser to see the generator's output, or
regenerate it:

```bash
node tools/report/generate-report.mjs \
  --findings tools/report/sample/findings.json \
  --attack-paths tools/report/sample/attack-paths.json \
  --engagement tools/report/sample/engagement.yaml \
  --out tools/report/sample/report.sample.html
```

> Real engagement reports are written under `engagements/<session>/reports/`,
> which is **gitignored** — they contain sensitive target data and must never be
> committed. Only this fictional sample lives in the tracked tree.
