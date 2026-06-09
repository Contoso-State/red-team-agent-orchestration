# Interactive HTML Report Generator

`generate-report.mjs` turns the canonical `findings.json` into a single,
self-contained, **interactive HTML report** — a professional, dense deliverable
where attack paths render as clickable node graphs and every finding expands
in place to show evidence, attack vector, recommendation, and control mappings.

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

- **Executive band** — severity donut, per-severity counts (click to filter),
  KPIs (findings, open risk, attack paths, Critical+High), and the top risk.
- **Attack Paths** (featured first) — each chain as an inline SVG node graph
  (`entry → pivot → target`) with technique-labelled edges. Nodes that map to a
  finding are clickable and jump to that finding's detail. Each path shows its
  entry point, end state, and the single "break the chain" remediation.
- **Findings** — a dense, filterable list (severity / domain / status / text
  search). Click a row to expand description, attack vector, attack-path steps,
  evidence, risk, recommendation, and CIS/MITRE/Defender/NIST control chips.
- **Coverage & Control Mapping** — findings by domain agent and status, plus the
  rolled-up MITRE ATT&CK techniques and CIS Azure controls observed.
- **About** — engagement metadata, generation provenance, evidence window,
  in-scope subscriptions, inputs used, and the read-only assessment statement.

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
  toggles CSS classes (progressive enhancement — the report works with JS off
  and prints/exports to PDF cleanly).

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
