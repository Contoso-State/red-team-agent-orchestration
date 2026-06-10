---
title: Safety & Authorization
description: The read-only guardrail, operating modes, and engagement authorization.
---

# Safety & Authorization

This is a **read-only** red team. Safety is enforced in code, not by convention — a
session-wide guardrail intercepts every command-execution tool call before it runs.

## The read-only guardrail (`redteam-guardrails`)

A session-wide `preToolUse` hook enforces read-only as an **allowlist (deny-by-default)**:
only recognized read/query operations pass; everything else on `az`/`azd` or Azure
PowerShell (`*-Az*`) is treated as a state change and blocked, so unknown or new mutating
verbs **fail closed**.

The hook is:

- **Wrapper-aware** — it unwraps `pwsh -Command`, `powershell -EncodedCommand`, `bash -c`,
  `cmd /c`, `iex`, `&`, and `Start-Process … -ArgumentList` before deciding.
- **Tool-scoped** — only command-execution tools are inspected, so docs that merely *mention*
  `az ... delete` are never blocked.
- **Session-wide** — it covers **every** agent, not just one.

Decision logic lives in `guardrails-core.mjs` and is unit-tested by
`guardrails-core.test.mjs` (133 assertions). Active external testing adds a second,
independent fail-closed matcher in `egress-core.mjs` (`egress-core.test.mjs`, 69
assertions) — see [Active external testing](#active-external-testing-eva) below.

:::{important}
The Orchestrator additionally has **no shell access at all** (dispatch-only), so it can
never run `az` itself — it only assigns work to specialists and aggregates their findings.
:::

## Operating modes

The mode is set in `engagement.yaml` and enforced by the guardrail across all agents.

| Mode | Description | Risk Level |
|---|---|---|
| `read-only-assessment` | Enumerate and analyze configurations only | 🟢 Safe |
| `attack-path-analysis` | Read-only + build attack-path graphs | 🟡 Low |
| `controlled-validation` | Read-only + state-changing actions require explicit human approval | 🟠 Medium |
| `external-active-testing` | Unlocks the External Vulnerability Agent (EVA) active tiers against in-scope, Azure-derived external targets only | 🔴 High — off by default |

:::{note}
`controlled-validation` does **not** silently allow mutations. It downgrades any
state-changing command to an explicit human-approval prompt — the guardrail prompts, it
never auto-allows.
:::

## Active external testing (EVA)

The **External Vulnerability Agent (EVA)** is the only agent that sends real traffic to live
endpoints. It is **off by default** and hard-gated. EVA validates the OWASP Top 10 from the
outside against URLs/public IPs that other agents discovered in Azure, and can optionally run
**offline** static analysis of code pulled from Azure (the code is never executed).

**The scope lock.** EVA may only ever touch a host that maps back to an in-scope Azure
resource. This is enforced in depth:

1. **Allowlist** — `tools/external/build-targets.mjs` derives `engagements/<session>/scope/external-targets.json` from the engagement datastore. A host is on the list only because a specific in-scope Azure resource published it.
2. **Egress guardrail** — a second `preToolUse` matcher (`egress-core.mjs`) **denies** any active-probe command (`curl`, `httpx`, `nuclei`, `zap*`, `sqlmap`, `nikto`, `whatweb`, `testssl`, `Invoke-WebRequest`, …) reaching a public host unless mode/authorization/allowlist all pass — including every line of any scanner target-list file. It fails closed.
3. **Scoped wrappers** — scanners are launched only through `tools/external/Invoke-ScopedScan.ps1` (or the dependency-free Tier-1 `safe-prober.mjs`), which source targets exclusively from the allowlist.

**The authorization gate** (ALL required, or EVA stays inert):

- `mode: external-active-testing`
- `external_testing.enabled: true`
- `external_testing.authorization.attested_by` **and** `attestation_id` set (a named human signed off)
- the current time is within the authorized window, if configured
- a non-empty `external-targets.json` exists for the session

**Intensity tiers** escalate only up to the configured `external_testing.tier`:
`safe-active` (benign header/TLS/cookie/CORS probes) → `active-dast` (nuclei/ZAP/etc.) →
`exploit-validation` (per-finding, opt-in proof). Offline `static-analysis` is a separate
opt-in (`external_testing.static_analysis.enabled`). Rules of engagement: in-scope only, least
intensity that proves the point, no denial-of-service, no data exfiltration, no lateral movement.

## Authorization

Only run this against environments you are **explicitly authorized** to assess. Define the
target subscription, tenant, and permitted scope in `engagement.yaml` (start from
`engagement.example.yaml` or run `/setup`). The Inventory & Scope agent validates your
permissions during preflight and enforces scope before any domain agent is dispatched.

Session output contains sensitive target data and is fully gitignored — never commit a
session folder. See [Repository Layout](#session-output) for details.
