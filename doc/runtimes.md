---
title: AI Model Runtimes
description: Run the same read-only Azure red team on GitHub Copilot, Claude Code, OpenAI Codex, and Cursor — one guard core, four runtimes.
---

# AI Model Runtimes

The red team ships as **GitHub Copilot CLI** primitives, but the same team runs natively on
**Claude Code**, **OpenAI Codex CLI**, and **Cursor**. Every runtime shares one decision
engine, so a given command reaches an **identical** allow / ask / deny outcome everywhere —
the read-only guarantee never forks per platform.

:::{important}
Whichever runtime you use, the engagement is **read-only by default** and the guard **fails
closed**: anything it cannot prove is read-only is blocked. Pair it with least-privilege
roles — see [Permissions Best Practices](permissions.md).
:::

## One core, four runtimes

The platform-neutral guard (`guardrails/guard.mjs`, wrapping the unit-tested evaluators in
`guardrails/core/`) is the single source of truth for read-only enforcement. Each runtime has
a thin adapter that translates the runtime's hook payload into that core and maps the verdict
back into the runtime's native wire format.

| Runtime | Reads its team from | Read-only enforced by | Launch |
|---|---|---|---|
| **GitHub Copilot CLI** | `.github/agents`, `.github/skills`, `.github/prompts` | `.github/extensions/redteam-guardrails` (`preToolUse` hook) | `/agent redteam-orchestrator` |
| **Claude Code** | `.claude/agents`, `.claude/skills`, `.claude/commands` | `.claude/hooks/redteam-guard.mjs` (`PreToolUse`, `SessionStart`) | `/agent redteam-orchestrator` |
| **OpenAI Codex CLI** | `AGENTS.md` + `.agents/skills` | `.codex/hooks/redteam-guard.mjs` (`PreToolUse`, `PermissionRequest`, `SessionStart`) + `.codex/config.toml` | ask Codex to "run an Azure red team assessment" |
| **Cursor** | `.cursor/rules`, `.cursor/commands` + `.github/skills` | `.cursor/hooks/redteam-guard.mjs` (`beforeShellExecution`, `beforeMCPExecution`) | invoke the rule / command in chat |

The Copilot definitions under `.github/` are the **canonical source**. The per-platform files
are produced by an anti-drift generator, so the team can never silently diverge between
runtimes:

```bash
node tools/agents/build-agent-defs.mjs          # regenerate every runtime
node tools/agents/build-agent-defs.mjs --check  # CI: fail if any runtime is stale
```

## GitHub Copilot CLI

The default runtime. Check out the repo and Copilot auto-discovers the Pentest Manager and
its specialists. See [Getting Started](getting-started.md).

```text
/agent redteam-orchestrator
```

## Claude Code

The generator emits Claude subagents, slash commands, and skills, plus a `PreToolUse` hook
that reproduces the Copilot guardrail exactly (and a `SessionStart` banner). After checkout:

```text
/agent redteam-orchestrator
```

The hook is registered in `.claude/settings.json`; on a mutating `az`/`azd`/Az PowerShell
command it returns `permissionDecision: "deny"` (or `"ask"` in `controlled-validation` mode).

## OpenAI Codex CLI

Codex reads the team's roster and read-only posture from **`AGENTS.md`** and loads the 18
domain skills from **`.agents/skills/`** (the open agent-skills standard). Enforcement is a
Claude-compatible lifecycle hook plus a hardened config:

- **`.codex/hooks/redteam-guard.mjs`** runs on `PreToolUse`, `PermissionRequest`, and
  `SessionStart` (matcher `*`, so shell, MCP, and file tools are all gated). Because Codex
  *fails open* on an unsupported `ask` decision and on any non-2 exit code, the adapter
  blocks every deny / ask / error path with **stderr + `exit 2`** — the only signal Codex
  honours — and stays silent on allow.
- **`.codex/config.toml`** pins a defense-in-depth read-only posture: `approval_policy =
  "untrusted"` (auto-run only known-safe reads), `sandbox_mode = "workspace-write"` with
  `network_access = true` (so `az` can *read* Azure while writes stay in the workspace).

:::{warning}
**Trust the hook on first run.** Codex requires you to trust a newly discovered project hook
before it executes. After cloning, start Codex in the repo and run **`/hooks`** (or accept the
onboarding prompt) once to trust `.codex/hooks/redteam-guard.mjs`. Until it is trusted the
guard does not run — confirm it is trusted before beginning an assessment.
:::

Then ask Codex to *"run an Azure red team assessment"*; it follows the same flow as the
Copilot orchestrator using the `.agents/skills/` knowledge.

## Cursor

The team is expressed as Cursor **rules** (an always-applied read-only posture rule plus a
description-triggered rule per specialist) and **commands**, with skill knowledge referenced
at its canonical `.github/skills/` location. Enforcement is `.cursor/hooks/redteam-guard.mjs`,
registered in `.cursor/hooks.json` with `failClosed: true`:

- `beforeShellExecution` evaluates every terminal command and denies anything not provably
  read-only (asks in `controlled-validation` mode).
- `beforeMCPExecution` surfaces every MCP tool call for explicit approval, because the
  shell-oriented engine cannot prove an arbitrary MCP action is read-only.

## Verifying parity

The adapters are covered by `tools/agents/adapter-parity.test.mjs`, which spawns **every**
runtime adapter against the shared golden fixtures (`guardrails/fixtures/decisions.json`) and
asserts each one maps the same inputs to the same allow / deny outcome in its own wire
format — including Codex's fail-closed `exit 2` contract.

```bash
node --test                                     # run all guard + adapter parity suites
```

See also [Safety & Guardrails](safety.md) for the enforcement model in depth.
