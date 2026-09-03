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

## The same guard on every runtime

Read-only enforcement is **not** Copilot-specific. The decision logic lives in one
platform-neutral core (`guardrails/guard.mjs`, wrapping the unit-tested evaluators in
`guardrails/core/`), and every runtime has a thin adapter that calls that core and maps the
verdict to its native hook format. A given command therefore reaches an **identical**
allow / ask / deny outcome on every platform — and every adapter **fails closed**.

| Runtime | Enforcement hook | Fail-closed signal |
|---|---|---|
| GitHub Copilot CLI | `.github/extensions/redteam-guardrails` (`preToolUse`) | deny verdict |
| Claude Code | `.claude/hooks/redteam-guard.mjs` (`PreToolUse`, `SessionStart`) | `permissionDecision: "deny"` |
| OpenAI Codex CLI | `.codex/hooks/redteam-guard.mjs` (`PreToolUse`, `PermissionRequest`, `SessionStart`) + `.codex/config.toml` | stderr + `exit 2` (Codex fails *open* on a non-2 exit, so deny/ask/error all use exit 2) |
| Cursor | `.cursor/hooks/redteam-guard.mjs` (`beforeShellExecution`, `beforeMCPExecution`) | deny verdict + `failClosed: true` |

`tools/agents/adapter-parity.test.mjs` spawns **every** adapter against the shared golden
fixtures (`guardrails/fixtures/decisions.json`) and asserts they all reach the same decision,
so the runtimes can't drift apart. See [AI Model Runtimes](runtimes.md) for per-platform
setup — including the one-time Codex `/hooks` trust step.

## Operating modes

The mode is set in `engagement.yaml` and enforced by the guardrail across all agents.

| Mode | Description | Risk Level |
|---|---|---|
| `read-only-assessment` | Enumerate and analyze configurations only | 🟢 Safe |
| `attack-path-analysis` | Read-only + build attack-path graphs | 🟡 Low |
| `controlled-validation` | Read-only + state-changing actions require explicit human approval | 🟠 Medium |
| `external-active-testing` | Unlocks the External Vulnerability Agent (EVA) active tiers against in-scope, Azure-derived external targets only | 🔴 High — off by default |
| `cluster-active-testing` | Unlocks the Azure Container & Kubernetes agent's cluster-active lane (`kubectl exec`/`debug`, kube-bench/kubesec, trivy/grype image scans) against in-scope, Azure-derived clusters/registries only | 🔴 High — off by default |

:::{note}
`controlled-validation` does **not** silently allow mutations. It downgrades any
state-changing command to an explicit human-approval prompt — the guardrail prompts, it
never auto-allows.
:::

(active-external-testing-eva)=
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

## Active cluster testing (Azure Container & Kubernetes)

The **Azure Container & Kubernetes agent** runs a read-only posture assessment by default. Its
**cluster-active lane** is the only path that reaches *inside* a running cluster or container,
or that pulls and scans images. Like EVA, it is **off by default** and hard-gated. It **never
mutates a workload** — every mutating `kubectl`/`helm` verb (`apply`, `create`, `delete`,
`patch`, `scale`, `drain`, …) is denied in **every** mode.

**The scope lock.** The lane may only ever touch an AKS cluster or registry that maps back to
an in-scope Azure resource. This is enforced in depth:

1. **Allowlist** — `tools/cluster/build-cluster-targets.mjs` derives `engagements/<session>/scope/cluster-targets.json` from the engagement datastore. A cluster/registry is on the list only because a specific in-scope AKS or ACR resource published it.
2. **Cluster guardrail** — a third `preToolUse` matcher (`cluster-core.mjs`) classifies every `kubectl`/`helm`/`docker`/`nerdctl`/`podman`/`kube-bench`/`kubesec`/`trivy`/`grype`/`crictl` command. Read-only verbs (`get`, `describe`, `logs`, `auth can-i`, `version`, …) are always allowed; mutating verbs are always denied; reach-in verbs (`exec`, `debug`, `cp`, `attach`, `port-forward`, `run`, `proxy`) and the scanners are denied unless mode/authorization/allowlist all pass. `trivy`/`grype` image references are additionally checked against the allowlisted `*.azurecr.io` registries. Unknown verbs fail closed.
3. **Scoped wrappers** — scanners are launched only through `tools/cluster/Invoke-ScopedClusterScan.ps1` (or the dependency-free Tier-C1 `safe-kube-audit.mjs`), which source scope exclusively from the allowlist and re-check the gate locally.

**The authorization gate** (ALL required, or the lane stays inert):

- `mode: cluster-active-testing`
- `cluster_testing.enabled: true`
- `cluster_testing.authorization.attested_by` **and** `attestation_id` set (a named human signed off)
- the current time is within the authorized window, if configured
- a non-empty `cluster-targets.json` exists for the session

**Intensity tiers** escalate only as needed: `cluster-benchmark` (C1 — read-only `kubectl` audit +
kube-bench/kubesec) → `image-scan` (C2 — offline trivy/grype image CVE scan) → `in-cluster` (C3 —
`kubectl exec`/`debug` reach-in confirmation, per-finding and opt-in). Rules of engagement: in-scope
only, least intensity that proves the point, no workload mutation, no denial-of-service, no data
exfiltration, no lateral movement.

## Authorization

Only run this against environments you are **explicitly authorized** to assess. Define the
target subscription, tenant, and permitted scope in `engagement.yaml` (start from
`engagement.example.yaml` or run `/setup`). The Inventory & Scope agent validates your
permissions during preflight and enforces scope before any domain agent is dispatched.

Session output contains sensitive target data and is fully gitignored — never commit a
session folder. See [Repository Layout](#session-output) for details.
