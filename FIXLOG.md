# FIX Log — Red Team Orchestration

Tracking log of bugs, rough edges, and enhancements discovered while running the
orchestration. Newest entries first. Severity reflects impact on assessment
correctness or operator workflow, not on any target.

| Status legend |                                            |
| ------------- | ------------------------------------------ |
| 🔴 open       | confirmed, not yet fixed                   |
| 🟡 planned    | fix designed / agreed, not yet implemented |
| 🟢 fixed      | implemented and verified                   |

---

## Discovered during the first live assessment (session-20260609-160259)

### BUG-001 — `generate-report.mjs` does not create the `--out` parent directory 🟢
- **Severity:** High (blocks report generation on a fresh session)
- **Area:** `tools/report/generate-report.mjs` (≈ lines 2064–2070)
- **Symptom:** Running the generator with the documented output path
  `engagements/<session>/reports/report.html` fails with an `ENOENT` write error
  when the `reports/` folder does not already exist. The first live run hit this:
  `findings.json`/`report.html` could not be written until `reports/` was created
  by hand.
- **Root cause:** `writeFileSync(outPath, html)` is called directly with no
  `mkdirSync(dirname(outPath), { recursive: true })` beforehand. No other tool in
  the pipeline (`Invoke-Preflight.ps1`, `Export-Inventory.ps1`) creates `reports/`
  either — only `inventory/` is scaffolded.
- **Proposed fix:**
  ```js
  import { mkdirSync } from 'node:fs';
  import { dirname } from 'node:path';
  // before writeFileSync(outPath, html, 'utf8'):
  mkdirSync(dirname(outPath), { recursive: true });
  ```
- **Fix applied:** `mkdirSync(dirname(outPath), { recursive: true })` added before the
  write (guards against `.`/empty dir). Imports `mkdirSync` + `dirname`.
- **Related:** see ENH-001 (session scaffolding).

### BUG-002 — Resource Graph queries silently mis-execute when passed as multi-line strings 🟢
- **Severity:** High (returns wrong results with no error — silent data corruption)
- **Area:** `tools/resource-graph/queries.md`, `tools/az-cli/*.md`, any agent that
  runs `az graph query -q`.
- **Symptom:** Passing a KQL query to `az graph query -q` (or the `azure-arm` MCP
  tool) as a **multi-line / heredoc** string (PowerShell `@"…"@`) returns rows but
  silently drops the `where` / `project` / `summarize` pipeline — e.g. an NSG
  "internet-inbound allow" query returned ~100 unfiltered rows with blank projected
  columns. The real answer was **1** rule. There is no error; the operator can act
  on bad data.
- **Root cause:** newlines in the argument are not forwarded intact to the Resource
  Graph service through the shell/CLI boundary, so only the leading `Resources`
  table reference survives. Every reusable query in `queries.md` is authored
  multi-line and will exhibit this if copied verbatim into a heredoc.
- **Proposed fix:**
  1. Add a prominent callout at the top of `tools/resource-graph/queries.md`:
     **"Always pass KQL as a single-line string to `az graph query -q`."**
  2. Provide a tiny flattener helper (PowerShell + bash) that collapses a `.kql`
     file to one line before invocation, and reference it from the agent prompts.
  3. Optionally store canonical queries as single-line `.kql` files under
     `tools/resource-graph/` and have agents read those rather than copy from the
     markdown.
- **Fix applied:** added a ⚠️ single-line callout to the top of
  `tools/resource-graph/queries.md`; added `tools/resource-graph/flatten-kql.mjs`
  (collapses a `.kql` file/stdin to one safe line); converted the query in
  `Export-Inventory.ps1` from a here-string to a single line.

### BUG-003 — `az security secure-scores list` returns empty in some tenants 🟢
- **Severity:** Medium (governance check produces no data; reads as "no finding")
- **Area:** `checks/governance/checks.yaml` (line 54), `tools/az-cli/governance.md`
  (line 26), `agents/governance-posture/system-prompt.md` (line 45).
- **Symptom:** `az security secure-scores list -o json` returned `0/0` (empty) on
  the live target even though Defender for Cloud is enabled, so the secure-score
  signal silently dropped out of the governance check.
- **Root cause:** the `az security secure-scores` surface is inconsistent across
  API versions / extension states; the data is reliably available via the REST
  endpoint with the well-known `ascScore` name.
- **Proposed fix:** add an `az rest` fallback and document it:
  ```bash
  az rest --method get \
    --url "https://management.azure.com/subscriptions/<sub>/providers/Microsoft.Security/secureScores/ascScore?api-version=2020-01-01"
  ```
  Update the check `logic` to treat an empty CLI result as "use REST fallback,"
  not as "no finding."
- **Fix applied:** added the `az rest` ascScore fallback and "empty != no finding"
  guidance to `checks/governance/checks.yaml`, `tools/az-cli/governance.md`, and
  `agents/governance-posture/system-prompt.md`.

### BUG-004 — `normalizeFindings` accepts schema-invalid findings without warning 🟢
- **Severity:** Medium (bad findings render into the report instead of failing fast)
- **Area:** `tools/report/generate-report.mjs` → `normalizeFindings()` (≈ line 238),
  e.g. `agent: String(f.agent ?? 'unknown')`.
- **Symptom:** The generator coerces/defaults missing or invalid fields (an
  out-of-enum `agent`, a malformed `id`, a missing `severity`) and renders them
  anyway. There is no validation against `schemas/finding.schema.json`, so authoring
  mistakes surface as a polished-but-wrong report rather than an error.
- **Root cause:** no schema-validation pass before rendering; normalization is
  lenient by design but there is no strict mode.
- **Proposed fix:** ship a lightweight validator (see ENH-002) and call it (or an
  inline check) before `buildHtml`, emitting `Notes:`/non-zero exit on hard schema
  violations (id regex, severity/confidence/agent enums, required fields).
- **Fix applied:** generator now emits `Notes:` warnings for bad id pattern, unknown
  agent enum, missing required fields, and empty evidence (still renders, leniently);
  the strict non-zero gate lives in `tools/validate-findings.mjs` (ENH-002), wired
  into `tools/report/README.md` as a "validate first" step.

### BUG-005 — PowerShell `-f` format-string evidence output renders blank 🟢
- **Severity:** Low (cosmetic; loses evidence text in some console runs)
- **Area:** ad-hoc evidence/inventory formatting in agent runs and example commands.
- **Symptom:** Lines built with the `-f` format operator (e.g.
  `"{0}: {1}" -f $a, $b`) intermittently rendered blank in captured output during
  the run, dropping evidence detail.
- **Root cause:** object/format-operator interaction in the captured non-interactive
  shell; piping objects through `ConvertTo-Json` or accessing properties explicitly
  was reliable.
- **Proposed fix:** prefer `ConvertTo-Json -Depth` or explicit
  `Select-Object`/string interpolation for evidence capture; avoid `-f` in
  copy-paste examples in `tools/az-cli/*.md`.
- **Fix applied:** added an evidence-capture guidance bullet to the Contract in
  `tools/az-cli/README.md` (use `ConvertTo-Json`, not `-f`).

---

## Enhancements

### ENH-001 — One-command session scaffolding 🟢
- **Why:** the session layout (`findings/raw`, `evidence/raw`, `inventory`,
  `reports`, `engagement.yaml`, `.current-session`) is created by hand today.
  The first run missed `reports/` and hit BUG-001.
- **Proposal:** add `tools/powershell/New-Session.ps1` (and a bash twin) that
  creates the full tree, copies `engagement.example.yaml` → `engagement.yaml`,
  writes `engagements/.current-session`, and exports `REDTEAM_SESSION`. Have
  `Invoke-Preflight.ps1` call it so a single entrypoint guarantees the structure.
- **Fix applied:** added `tools/powershell/New-Session.ps1` (full tree, seeds
  `engagement.yaml`, records `.current-session`, prints the `REDTEAM_SESSION`
  export). `Invoke-Preflight.ps1` now scaffolds all four subdirs and records
  `.current-session` rather than only creating `inventory/`.

### ENH-002 — `tools/validate-findings.mjs` schema validator 🟢
- **Why:** nothing validates `findings.json` / `attack-paths.json` against
  `schemas/*.schema.json` before report generation (BUG-004). Authoring errors are
  easy to make (the `agent` enum and `id` regex are strict).
- **Proposal:** a dependency-free Node validator that checks required fields, the
  `^AZ-[A-Z]+-[0-9]{3}$` id pattern, and the severity/confidence/agent enums; exits
  non-zero with a clear list of violations. Wire it as a pre-step in the report
  README and optionally inside `generate-report.mjs`.
- **Fix applied:** added `tools/validate-findings.mjs` (required fields, id patterns,
  severity/confidence/agent/status enums, evidence `source`/`summary`, dangling
  attack-path edges; exit 1 on violations). Wired into `tools/report/README.md`.

### ENH-003 — Inventory filename consistency 🟢
- **Why:** `Export-Inventory.ps1` writes `inventory/resources.jsonl`, but the live
  run produced `inventory/resources.json`. Mixed extensions make downstream tooling
  fragile.
- **Proposal:** standardize on one (`resources.json` array + a `summary.json`),
  document it, and have any consumer read the documented name.
- **Fix applied:** `Export-Inventory.ps1` now writes a canonical `resources.json`
  array plus `summary.json` (type rollup), keeps `resources.jsonl` for back-compat,
  and documents `resources.json` as canonical.

### ENH-004 — Single-line KQL query assets 🟡
- **Why:** mitigates BUG-002 at the source.
- **Proposal:** keep human-readable multi-line KQL in `queries.md` for reading, but
  ship the canonical executable form as single-line `.kql` files the agents
  actually run, plus a `flatten-kql` helper.
- **Status:** the `flatten-kql` helper is shipped (see BUG-002); committing every
  query as a single-line `.kql` asset is deferred.

---

## Post-review hardening (independent critique)

After implementing the items above, an independent review surfaced robustness gaps
that have now been closed:

- **Shared session resolver** — added `tools/powershell/Common.ps1`
  (`Resolve-SessionPath`, `Set-CurrentSession`, `ConvertTo-JsonArrayFile`,
  `Get-RepoRoot`). `New-Session.ps1`, `Invoke-Preflight.ps1`, and
  `Export-Inventory.ps1` now resolve the active session in a consistent order
  (explicit `-SessionPath` -> `$env:REDTEAM_SESSION` -> `.current-session` ->
  new timestamp) and anchor relative paths to the repo root, so they work
  regardless of the caller's working directory.
- **`.current-session` is now consumed**, not just written — the previously
  written pointer was being ignored by the inventory/preflight scripts.
- **Array-safe JSON** — inventory JSON (`resources.json`, `subscriptions.json`,
  `summary.json`) is always emitted as a JSON array, even for 0 or 1 element
  (`ConvertTo-Json` would otherwise emit `null`/a bare object).
- **`flatten-kql.mjs` is string-aware and CRLF-safe** — it only strips `//`
  comments outside quoted strings and normalizes line endings, so a `//` inside
  a KQL string literal is preserved and CRLF comments are fully removed.
- **Validator type/format checks** — `validate-findings.mjs` now enforces array
  types (evidence/references/nodes/edges), `date-time` on `first_seen`/`last_seen`/
  `generated`, and the attack-path `node.type` enum.
- **Schema alignment** — `schemas/finding.schema.json` now requires
  `evidence` `minItems: 1`, matching the validator and generator expectations.
