---
title: Repository Layout
description: How agents, skills, hooks, checks, and per-session output are organized.
---

# Repository Layout

```text
├── engagement.example.yaml      # Engagement scope template
├── .github/
│   ├── agents/                  # Custom agents — dispatchable team (redteam-orchestrator + 15 specialists + gated EVA)
│   ├── skills/                  # Copilot skills — auto-loaded domain knowledge (azure-redteam-*)
│   ├── extensions/              # Hooks — redteam-guardrails enforces read-only (preToolUse deny) + EVA egress lock
│   └── prompts/                 # Slash commands: /setup /recon /assess /attack-paths /report /deck /external (gated)
├── guardrails/                  # Platform-neutral read-only guard core (guard.mjs + core/) — shared by every runtime
├── .claude/                     # Claude Code runtime — agents, commands, skills + PreToolUse guard hook (generated)
├── .cursor/                     # Cursor runtime — rules, commands + beforeShellExecution/MCP guard hook (generated)
├── .codex/                      # OpenAI Codex runtime — guard hook (PreToolUse/PermissionRequest) + config.toml posture
├── .agents/skills/              # Codex skills — open agent-skills standard (generated from .github/skills)
├── agents/                      # Agent system prompts and methodology (skills delegate here)
│   ├── orchestrator/            # Team lead — coordinates the engagement
│   ├── inventory-scope/         # Preflight — enumeration and permission checks
│   ├── identity-posture/        # Entra ID and authentication security
│   ├── authorization-attack-path/ # RBAC analysis and privilege escalation
│   ├── network-exposure/        # Network security and public exposure
│   ├── compute-platform/        # VM, App Service, Function App, serverless security
│   ├── aks-container/           # AKS / Kubernetes / ACR / containers + gated in-cluster active lane
│   ├── data-protection/         # Storage, SQL/databases, Key Vault, encryption
│   ├── web-exposure/            # Web edge: WAF, TLS, static sites, API Management
│   ├── ai-foundry/              # Azure AI Foundry, OpenAI, Cognitive Services, ML
│   ├── attack-surface/          # External attack surface (EASM), dangling DNS
│   ├── email-security/          # M365 email security (optional)
│   ├── logging-coverage/        # Monitoring, Sentinel, diagnostic settings
│   ├── governance-posture/      # Azure Policy, Defender posture, MG hierarchy, resource locks
│   ├── devops-supplychain/      # OIDC/federated creds, pipeline SPs, ACR, automation, Logic Apps
│   ├── external-vuln/           # External Vulnerability Agent (EVA) — gated active OWASP testing
│   └── reporting/               # Finding normalization and report generation
├── checks/                      # Atomic security checks per domain (checks.yaml) + machine-readable predicate banks (predicates.json)
├── playbooks/                   # Multi-step assessment methodologies
├── schemas/                     # JSON schemas for findings, attack paths, checks, predicate banks, engagement
├── controls/                    # CIS, MITRE ATT&CK, NIST CSF 2.0 mappings
├── knowledge/                   # Azure attack matrix, common misconfigs, severity model, token-optimization contract, web/OWASP testing (EVA)
├── tools/                       # az CLI runners (per domain), KQL, Resource Graph, PowerShell, datastore, HTML report generator
│   ├── agents/                  # Anti-drift generator (build-agent-defs.mjs) — emits Claude/Cursor/Codex defs from .github + adapter-parity tests
│   ├── checks/                  # Deterministic zero-LLM check engine — evaluates predicate banks into findings + a compact triage summary
│   ├── tokens/                  # Token ledger — per-phase/per-agent token accounting for the report's Engagement Cost appendix
│   ├── datastore/               # SQLite engagement datastore — ingest (single writer), read-only query cache, export, promote/lifecycle
│   ├── external/                # Gated EVA toolchain — Azure-scoped target allowlist, safe prober, scope-locked DAST + offline SAST wrappers
│   └── cluster/                 # Gated cluster-active toolchain — Azure-scoped cluster/registry allowlist, safe kube audit, scope-locked kube-bench/kubesec/trivy/grype wrapper
├── reports/templates/           # Report templates (tracked)
└── engagements/                 # Per-session output — one folder per run (gitignored)
```

(session-output)=
## Session output

Every assessment **run** writes **all** of its output into a single, self-contained folder
named for the engagement and the moment it ran — nothing is scattered across the repo root:

```text
engagements/
├── _history/                         # longitudinal lifecycle DBs (one per engagement id, gitignored)
└── <session>/                        # <engagement-id>-<YYYY-MM-DD-HHMMSS>
    ├── engagement.yaml               # scope snapshot used by this run
    ├── engagement.db                 # SQLite datastore — cache + canonical store (gitignored)
    ├── inventory/                    # resources.jsonl, subscriptions.json, coverage-limitations.json
    ├── findings/                     # raw/<agent>.jsonl + normalized/findings.json
    ├── evidence/                     # raw + sanitized artifacts
    └── reports/                      # executive-summary, technical-report, report.html, assessment-deck, findings.json, delta.json
```

- **Timestamped, never overwritten** — `<session>` = `<engagement.id>` + a UTC
  `YYYY-MM-DD-HHMMSS` stamp (e.g. `example-2026-q2-2026-06-15-141200`), so re-running
  produces a new folder and keeps a clean, auditable history of every assessment.
- **Fully gitignored** — the entire `engagements/` tree is ignored (only `README.md` +
  `.gitkeep` are tracked) because session output contains sensitive target data. Never
  commit a session folder.
- **Opened automatically** — the Orchestrator (and `/recon`) creates the folder at the start
  of a run and tells every dispatched agent the exact path to write under. With the
  PowerShell helpers, set `$env:REDTEAM_SESSION` or pass `-SessionPath ./engagements/<session>`.
