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
`guardrails-core.test.mjs` (111 assertions).

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

:::{note}
`controlled-validation` does **not** silently allow mutations. It downgrades any
state-changing command to an explicit human-approval prompt — the guardrail prompts, it
never auto-allows.
:::

## Authorization

Only run this against environments you are **explicitly authorized** to assess. Define the
target subscription, tenant, and permitted scope in `engagement.yaml` (start from
`engagement.example.yaml` or run `/setup`). The Inventory & Scope agent validates your
permissions during preflight and enforces scope before any domain agent is dispatched.

Session output contains sensitive target data and is fully gitignored — never commit a
session folder. See [Repository Layout](#session-output) for details.
