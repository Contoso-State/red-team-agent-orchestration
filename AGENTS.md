# AGENTS.md — Azure Red Team Agent Orchestration

## Repository Purpose

This repository contains an agentic red team platform for Azure cloud infrastructure security assessment. AI agents coordinate to perform comprehensive penetration testing against Azure environments, identifying vulnerabilities across identity, networking, compute, data, and monitoring domains.

## Architecture

The system uses a **hub-and-spoke orchestration model**:

1. The **Orchestrator** receives the engagement scope and coordinates the full assessment
2. The **Inventory & Scope Agent** performs preflight checks and builds a resource inventory
3. **Domain agents** run atomic security checks against their area of expertise
4. The **Authorization & Attack Path Agent** correlates findings into multi-step compromise chains
5. The **Reporting Agent** normalizes findings and produces the final deliverables

## Key Files

| Path | Purpose |
|---|---|
| `engagement.example.yaml` | Engagement scope template — copy to `engagement.yaml` for real assessments |
| `.github/skills/azure-redteam-*/SKILL.md` | Copilot skills — the red team. Loaded automatically by Copilot; each delegates to an agent prompt |
| `agents/*/system-prompt.md` | Detailed agent methodology and tool usage (single source of truth the skills reference) |
| `checks/*/` | Atomic security checks organized by domain |
| `playbooks/*.md` | Multi-step assessment playbooks |
| `schemas/*.json` | JSON schemas for structured findings and engagement data |
| `controls/*.yaml` | Compliance control mappings (CIS, MITRE, Defender) |
| `knowledge/*.md` | Reference material for Azure attack techniques |
| `tools/` | KQL queries, Resource Graph queries, PowerShell scripts |

## Safety Rules

1. **Always validate scope** — never operate on resources outside `engagement.yaml`
2. **Default to read-only** — never mutate Azure resources unless `controlled-validation` mode is active and the specific action is explicitly permitted
3. **Never store secrets** — redact any secret values, connection strings, or tokens from findings and evidence
4. **Structured findings only** — all findings must conform to `schemas/finding.schema.json`
5. **Preflight before assessment** — always run inventory/scope validation before domain agents
6. **Evidence provenance** — every finding must include the Azure API or tool that produced the evidence

## Agent Dispatch Rules

When working in this repo:

- Use `/recon` to start a new reconnaissance engagement
- Use `/assess` to run a full security assessment
- Use `/attack-paths` to analyze privilege escalation and lateral movement chains
- Use `/report` to generate the final assessment report
- Or just ask Copilot in plain language (e.g. "pentest my Azure subscription") — the `azure-redteam-orchestrator` skill (Pentest Manager) triggers and coordinates the team
- Each skill (`.github/skills/azure-redteam-<name>/SKILL.md`) delegates to its detailed methodology in `agents/<name>/system-prompt.md`
- Checks are in `checks/<domain>/` — agents execute these, not ad-hoc queries
- All output goes to `findings/raw/<agent-name>.jsonl` as structured JSON lines

## Coding Conventions

- YAML for configuration and control mappings
- JSON/JSONL for structured findings and inventory data
- Markdown for agent prompts, playbooks, knowledge base, and reports
- PowerShell for Azure automation scripts
- KQL for Log Analytics and Sentinel queries
- Azure Resource Graph query language for resource enumeration
