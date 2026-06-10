# AGENTS.md — Azure Red Team Agent Orchestration

## Repository Purpose

This repository contains an agentic red team platform for Azure cloud infrastructure security assessment. AI agents coordinate to perform comprehensive penetration testing against Azure environments, identifying vulnerabilities across identity, RBAC, networking, compute/Kubernetes, data/SQL, web & static sites, AI/Foundry, external attack surface (EASM), governance & posture, DevOps & supply chain, email (M365), and monitoring domains.

## Architecture

The system uses a **hub-and-spoke orchestration model**, wired with three native Copilot CLI layers:

- **Custom agents** (`.github/agents/*.agent.md`) — the dispatchable team. The user-invocable `redteam-orchestrator` (Pentest Manager) hands tasks to fourteen domain sub-agents through the `agent` (Task) tool. Sub-agents set `disable-model-invocation: true` so they only run when the Orchestrator dispatches them.
- **Skills** (`.github/skills/azure-redteam-*`) — auto-loaded domain knowledge each agent draws on.
- **Extension/hooks** (`.github/extensions/redteam-guardrails`) — a session-wide `preToolUse` hook that enforces read-only as an allowlist (deny-by-default) across `az`/`azd` and Azure PowerShell, for every agent.

Engagement flow:

1. The **Orchestrator** receives the engagement scope and coordinates the full assessment
2. The **Inventory & Scope Agent** performs preflight checks and builds a resource inventory
3. **Domain agents** run atomic security checks against their area of expertise
4. The **Authorization & Attack Path Agent** correlates findings into multi-step compromise chains
5. The **Reporting Agent** normalizes findings and produces the final deliverables

## Key Files

| Path | Purpose |
|---|---|
| `engagement.example.yaml` | Engagement scope template — copy to `engagement.yaml` (or run `/setup`) for real assessments |
| `.github/prompts/*.prompt.md` | Slash commands — `/setup` (pick subscription → `engagement.yaml`), `/recon`, `/assess`, `/attack-paths`, `/report`, `/deck` |
| `.github/agents/redteam-*.agent.md` | Custom agents — the dispatchable team. `redteam-orchestrator` is user-invocable; 14 specialists are dispatched by it |
| `.github/skills/azure-redteam-*/SKILL.md` | Copilot skills — auto-loaded domain knowledge; each delegates to an agent prompt |
| `.github/extensions/redteam-guardrails/` | Hooks extension — `preToolUse` deny of mutating `az`/`azd` (logic in `guardrails-core.mjs`, tested by `guardrails-core.test.mjs`) |
| `agents/*/system-prompt.md` | Detailed agent methodology and tool usage (single source of truth the skills/agents reference) |
| `checks/*/` | Atomic security checks organized by domain |
| `playbooks/*.md` | Multi-step assessment playbooks |
| `schemas/*.json` | JSON schemas for structured findings and engagement data |
| `controls/*.yaml` | Compliance control mappings (CIS, MITRE, Defender) |
| `knowledge/*.md` | Reference material for Azure attack techniques (see `knowledge/datastore.md` for the engagement datastore) |
| `tools/az-cli/*.md` | Per-domain read-only `az` CLI runners, keyed to check IDs |
| `tools/datastore/*.mjs` | SQLite engagement datastore — `ingest` (files→DB, sole writer), `query` (read-only cache API), `export` (DB→artifacts), `promote` (cross-run lifecycle). Built on `node:sqlite`, no dependencies |
| `tools/` | KQL queries, Resource Graph queries, PowerShell scripts |

## Data Layer

The assessment is backed by a per-engagement **SQLite datastore** (`engagements/<session>/engagement.db`)
that is both **cache** and **canonical store**, plus a longitudinal `engagements/_history/<id>.db`. The
rules that matter for agents:

- **Query the DB, don't re-crawl Azure.** Inventory and per-resource config facts are ingested once;
  agents read them back as a read-through cache (`tools/datastore/query.mjs`, freshness via the `fresh`
  probe — exit 0 fresh, 3 miss/stale). Only on a miss do they issue a new `az`/ARG call, then ingest it.
- **`ingest.mjs` is the single writer.** Agents write their own raw JSONL/evidence to files; the
  orchestrator ingests. Agents never write the DB directly (concurrent readers are fine).
- **`promote.mjs` is the only history writer**, run last, and emits `reports/delta.json`
  (new / persisting / resolved / regressed).
- **Every `*.db` is gitignored**; `resource_facts` holds **config only, never secrets**.

Canonical doc: `knowledge/datastore.md`.

## Safety Rules

1. **Always validate scope** — never operate on resources outside `engagement.yaml`
2. **Default to read-only** — never mutate Azure resources. The `redteam-guardrails` hook enforces this as an allowlist (only read/query `az`/`azd`/Az PowerShell pass); in `controlled-validation` mode a mutation is not auto-run but surfaced for explicit human approval
3. **Orchestrator is dispatch-only** — the Pentest Manager has no `execute`/shell tool; it assigns work to specialist sub-agents and presents their findings, and must never run `az` directly
4. **Never store secrets** — redact any secret values, connection strings, or tokens from findings and evidence
5. **Structured findings only** — all findings must conform to `schemas/finding.schema.json`
6. **Preflight before assessment** — always run inventory/scope validation before domain agents
7. **Evidence provenance** — every finding must include the Azure API or tool that produced the evidence

## Agent Dispatch Rules

When working in this repo:

- Launch the team with `/agent redteam-orchestrator` — the Orchestrator (Pentest Manager) coordinates and dispatches the specialist sub-agents
- Use `/setup` to choose the target subscription and generate `engagement.yaml`
- Use `/recon` to start a new reconnaissance engagement
- Use `/assess` to run a full security assessment
- Use `/attack-paths` to analyze privilege escalation and lateral movement chains
- Use `/report` to generate the final assessment report (executive summary, technical report, and PowerPoint-ready deck)
- Use `/deck` to (re)render just the PowerPoint-convertible `assessment-deck.md`
- Or just ask Copilot in plain language (e.g. "pentest my Azure subscription") — the `azure-redteam-orchestrator` skill (Pentest Manager) triggers and coordinates the team
- The Orchestrator dispatches sub-agents via the `agent` (Task) tool; it has no shell/`execute` capability and never runs `az` itself. Sub-agents are not model-invocable on their own (`disable-model-invocation: true`)
- Each skill (`.github/skills/azure-redteam-<name>/SKILL.md`) delegates to its detailed methodology in `agents/<name>/system-prompt.md`
- Checks are in `checks/<domain>/` — agents execute these, not ad-hoc queries
- The `redteam-guardrails` hook enforces read-only as an allowlist across `az`/`azd` and Azure PowerShell — only recognized read/query operations pass (it is wrapper-aware and tool-scoped). In `controlled-validation` mode a mutation triggers a human-approval prompt instead of being allowed
- All output goes to `engagements/<session>/findings/raw/<agent-name>.jsonl` as structured JSON lines

## Coding Conventions

- YAML for configuration and control mappings
- JSON/JSONL for structured findings and inventory data
- Markdown for agent prompts, playbooks, knowledge base, and reports
- PowerShell for Azure automation scripts
- KQL for Log Analytics and Sentinel queries
- Azure Resource Graph query language for resource enumeration
- Node ESM `.mjs` (dependency-free) for tooling; SQLite via the built-in `node:sqlite` for the datastore
