---
description: Gated active external testing (EVA) — validate Azure-discovered URLs/public IPs against the OWASP Top 10. Off by default; requires mode external-active-testing with a signed authorization.
---

# /external — External Active Testing (EVA)

You are acting as the **Orchestrator Agent** (`agents/orchestrator/system-prompt.md`) dispatching the
**External Vulnerability Agent (EVA)** (`agents/external-vuln/system-prompt.md`). EVA is the **only**
agent that sends real traffic to live endpoints, so this command is hard-gated and OFF by default.

## Preconditions (ALL required — otherwise stop and report what's missing)

- `engagement.yaml` → `mode: external-active-testing`
- `external_testing.enabled: true`
- `external_testing.authorization.attested_by` **and** `attestation_id` are set (a named human signed off)
- the current time is within the authorized window, if configured
- `engagements/<session>/inventory/resources.jsonl` exists (run `/recon` first if not)

If any precondition fails, do **not** dispatch EVA. Tell the user exactly what is missing and stop.

## Steps

1. **Verify the gate.** Re-read `engagement.yaml` and confirm every precondition above. If not satisfied, stop.
2. **Build the Azure-derived allowlist.** Run
   `node tools/external/build-targets.mjs --db engagements/<session>/engagement.db --session engagements/<session>`.
   This produces `engagements/<session>/scope/external-targets.json` — the URLs/public IPs that map to
   in-scope Azure resources. If it is empty, report "no in-scope external targets" and stop. EVA may
   **only** ever touch hosts on this allowlist; the `redteam-guardrails` egress hook enforces it fail-closed.
3. **Dispatch EVA**, passing the session path, the configured `external_testing.tier`, and
   `external_testing.limits`. EVA always starts at the `safe-active` tier and escalates only up to the
   configured tier:
   - **Tier 1 `safe-active`** — `node tools/external/safe-prober.mjs --cwd . --out engagements/<session>/findings/raw/external-vuln.jsonl` (benign headers/TLS/cookies/CORS/methods).
   - **Tier 2 `active-dast`** — scanners **only** via `pwsh tools/external/Invoke-ScopedScan.ps1 -Tool nuclei|httpx|testssl|nikto|whatweb|zap-baseline`.
   - **Tier 3 `exploit-validation`** — minimal, per-finding proof with explicit approval; never destructive.
4. **Static analysis (opt-in).** If `external_testing.static_analysis.enabled: true`, EVA may pull code
   read-only from Azure into `engagements/<session>/static/` and run
   `pwsh tools/external/Invoke-StaticAnalysis.ps1 -Source engagements/<session>/static/<app>` — OFFLINE
   only (the code is never executed).
5. **Ingest findings** into the datastore (`node tools/datastore/ingest.mjs --db engagements/<session>/engagement.db --session engagements/<session>`).
6. **Report progress**: finding counts by check and severity; note the authorization reference and the
   coverage (which in-scope hosts were tested at which tier).

## Output

- `engagements/<session>/findings/raw/external-vuln.jsonl` (ID prefix `AZ-EVA-`), OWASP/CWE-mapped
- Findings ingested into `engagements/<session>/engagement.db`
- A summary of external findings and recommended next step: `/attack-paths` (to chain external + control-plane findings) then `/report`

## Safety

Active external testing only — strictly scope-locked to the Azure-derived allowlist and enforced
fail-closed by the egress guardrail. No DoS, no data exfiltration, no lateral movement. Honor
`data_handling` redaction. Static analysis is offline only. If anything looks like real production
impact or an out-of-scope system, stop and report.
