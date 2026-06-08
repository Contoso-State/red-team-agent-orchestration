# Azure Red Team Agent Orchestration

Agentic red team platform for identifying security vulnerabilities in Azure cloud infrastructure. A coordinated team of AI agents — each specialized in a security domain — performs comprehensive penetration testing against Azure environments.

The team ships as native **GitHub Copilot CLI** primitives, so once this repo is checked out Copilot automatically discovers the Pentest Manager and its specialists. Three cooperating layers make it work:

- **Custom agents** (`.github/agents/*.agent.md`) — the dispatchable team. The user-invocable **Orchestrator** (Pentest Manager) coordinates and hands tasks to eight domain sub-agents via Copilot's `agent` (Task) tool. This is the wiring that lets "the agent the user talks to" actually call the specialist agents.
- **Skills** (`.github/skills/azure-redteam-*`) — auto-loaded domain knowledge. Copilot pulls the relevant skill in based on its `description`, giving every agent its methodology and `az` runner without manual wiring.
- **Extension / hooks** (`.github/extensions/redteam-guardrails`) — a `preToolUse` hook that **enforces read-only**, denying any mutating `az`/`azd` command unless `engagement.yaml` explicitly opts into `controlled-validation`.

Start the team with `/agent redteam-orchestrator` (or just ask Copilot to "run an Azure red team assessment").

## How It Works

```mermaid
graph TD
    User[Security Engineer] -->|/recon or /assess| Orchestrator
    Orchestrator -->|1. Preflight| Preflight[Inventory & Scope Agent]
    Preflight -->|Resource inventory| Orchestrator
    Orchestrator -->|2. Dispatch| Agents

    subgraph Agents[Domain Agents]
        ID[Identity Posture]
        AUTH[Authorization & Attack Path]
        NET[Network Exposure]
        COMP[Compute Platform]
        DATA[Data Protection]
        LOG[Logging Coverage]
    end

    Agents -->|Structured findings| Orchestrator
    Orchestrator -->|3. Correlate| APA[Attack Path Analysis]
    APA -->|Attack chains| Orchestrator
    Orchestrator -->|4. Report| Reporter[Reporting Agent]
    Reporter -->|Final report| User
```

## Agent Team

| Agent | Domain | Key Focus |
|---|---|---|
| **Orchestrator** | Coordination | Engagement lifecycle, task dispatch, finding aggregation |
| **Inventory & Scope** | Preflight | Resource enumeration, permission validation, scope enforcement |
| **Identity Posture** | Entra ID | MFA gaps, Conditional Access, app registrations, guest users, credential hygiene |
| **Authorization & Attack Path** | RBAC / Privilege | Over-permissioned roles, custom role abuse, managed identity chains, priv esc paths |
| **Network Exposure** | Networking | Public IPs, NSG rules, firewall gaps, VNet peering, DNS exposure, private endpoints |
| **Compute Platform** | Compute | VM patching, AKS security, Container Apps, Function Apps, App Service hardening |
| **Data Protection** | Storage / Data | Storage account exposure, Key Vault policies, database firewall rules, encryption |
| **Logging Coverage** | Monitoring | Diagnostic settings, Sentinel connectors, alert rules, Activity Log gaps |
| **Reporting** | Output | Finding normalization, severity reconciliation, executive + technical reports |

## How the Team Is Packaged (Agents + Skills + Hooks)

The team uses three native Copilot CLI layers that map cleanly onto **who acts**, **what they know**, and **what they're allowed to do**.

### 1. Custom agents — the dispatchable team (`.github/agents/`)

The Orchestrator is the only **user-invocable** agent; the eight specialists set `disable-model-invocation: true` so they run only when the Orchestrator dispatches them through the `agent` (Task) tool. This is the dispatch wiring that makes "the orchestrator calls the respective agent" real.

| Agent file | Display name | Invoked by |
|---|---|---|
| `redteam-orchestrator.agent.md` | Red Team Orchestrator (Pentest Manager) | **User** (`/agent redteam-orchestrator`) |
| `redteam-inventory.agent.md` | Red Team Inventory & Scope | Orchestrator |
| `redteam-identity.agent.md` | Red Team Identity | Orchestrator |
| `redteam-authorization.agent.md` | Red Team Authorization | Orchestrator |
| `redteam-network.agent.md` | Red Team Network | Orchestrator |
| `redteam-compute.agent.md` | Red Team Compute | Orchestrator |
| `redteam-data.agent.md` | Red Team Data | Orchestrator |
| `redteam-logging.agent.md` | Red Team Logging | Orchestrator |
| `redteam-reporting.agent.md` | Red Team Reporting | Orchestrator |

### 2. Skills — auto-loaded domain knowledge (`.github/skills/`)

Each agent's deep methodology is a Copilot skill, loaded automatically by `description`.

| Skill | When Copilot uses it |
|---|---|
| `azure-redteam-orchestrator` | **Pentest Manager.** "Run a red team assessment", "pentest my Azure environment" |
| `azure-redteam-inventory` | Preflight recon — permission validation + resource enumeration |
| `azure-redteam-identity` | Entra ID / authentication posture |
| `azure-redteam-authorization` | RBAC, privilege escalation, attack-path correlation |
| `azure-redteam-network` | Public exposure, NSGs, segmentation |
| `azure-redteam-compute` | VM, AKS, container, serverless security |
| `azure-redteam-data` | Storage, Key Vault, database protection |
| `azure-redteam-logging` | Detection & monitoring coverage |
| `azure-redteam-reporting` | Normalize findings, render deliverables |

### 3. Extension / hooks — read-only enforcement (`.github/extensions/redteam-guardrails`)

A `preToolUse` hook inspects every shell command and **denies mutating `az`/`azd` operations** (`create`, `update`, `delete`, `set`, role assignments, `vm run-command`, `az rest` with non-GET, etc.) while allowing read-only verbs (`list`, `show`, `get`, `query`). The block is lifted only when `engagement.yaml` sets `mode: controlled-validation`. Decision logic lives in `guardrails-core.mjs` and is unit-tested by `guardrails-core.test.mjs`.

Each skill stays thin and delegates to the detailed methodology in `agents/<name>/system-prompt.md` and the atomic tests in `checks/<domain>/checks.yaml`, keeping a single source of truth. Every domain agent runs **its own read-only `az` CLI assessment** using the per-domain command runner in `tools/az-cli/<domain>.md` (each command keyed to a check ID). The slash commands in `.github/prompts/` (`/recon`, `/assess`, `/attack-paths`, `/report`) are convenient entry points that drive the same team.

## Quick Start

### 1. Define engagement scope

```bash
cp engagement.example.yaml engagement.yaml
# Edit engagement.yaml with target subscription, tenant, and permissions
```

### 2. Start the Pentest Manager

```text
/agent redteam-orchestrator
```

This launches the Orchestrator (Pentest Manager), which dispatches the domain sub-agents for you. The slash commands below are shortcuts that drive the same team.

### 3. Run reconnaissance

```text
/recon
```

The orchestrator will:
- Validate your Azure permissions (preflight)
- Enumerate all resources in scope
- Build a resource inventory
- Identify which domain agents to dispatch

### 4. Run full assessment

```text
/assess
```

Dispatches all domain agents against the inventory. Each agent produces structured findings in `findings/raw/`.

### 5. Analyze attack paths

```text
/attack-paths
```

Correlates findings across domains to identify multi-step compromise chains.

### 6. Generate report

```text
/report
```

Normalizes findings, deduplicates, reconciles severity, and generates executive + technical reports in `reports/generated/`.

## Operating Modes

| Mode | Description | Risk Level |
|---|---|---|
| `read-only-assessment` | Enumerate and analyze configurations only | 🟢 Safe |
| `attack-path-analysis` | Read-only + build attack path graphs | 🟡 Low |
| `controlled-validation` | Limited safe validation of specific findings | 🟠 Medium |

Mode is set in `engagement.yaml` and enforced by all agents.

## Repository Structure

```
├── engagement.example.yaml      # Engagement scope template
├── .github/
│   ├── agents/                  # Custom agents — dispatchable team (redteam-orchestrator + 8 specialists)
│   ├── skills/                  # Copilot skills — auto-loaded domain knowledge (azure-redteam-*)
│   ├── extensions/              # Hooks — redteam-guardrails enforces read-only (preToolUse deny)
│   └── prompts/                 # Slash commands: /recon /assess /attack-paths /report
├── agents/                      # Agent system prompts and methodology (skills delegate here)
│   ├── orchestrator/            # Team lead — coordinates the engagement
│   ├── inventory-scope/         # Preflight — enumeration and permission checks
│   ├── identity-posture/        # Entra ID and authentication security
│   ├── authorization-attack-path/ # RBAC analysis and privilege escalation
│   ├── network-exposure/        # Network security and public exposure
│   ├── compute-platform/        # VM, AKS, containers, serverless security
│   ├── data-protection/         # Storage, databases, Key Vault, encryption
│   ├── logging-coverage/        # Monitoring, Sentinel, diagnostic settings
│   └── reporting/               # Finding normalization and report generation
├── checks/                      # Atomic security checks per domain
├── playbooks/                   # Multi-step assessment methodologies
├── schemas/                     # JSON schemas for findings, checks, engagement
├── controls/                    # CIS, MITRE ATT&CK, Defender mappings
├── knowledge/                   # Azure attack matrix, common misconfigs
├── tools/                       # az CLI runners (per domain), KQL, Resource Graph, PowerShell
├── reports/templates/           # Report templates
├── findings/                    # Assessment output (gitignored: raw/)
├── evidence/                    # Evidence artifacts (gitignored: raw/)
└── inventory/                   # Resource inventory cache (gitignored)
```

## Findings Model

All findings are structured JSON — reports are rendered from them, never hand-written.

```json
{
  "id": "AZ-STOR-001",
  "title": "Storage account permits public blob access",
  "severity": "High",
  "confidence": "High",
  "agent": "data-protection",
  "resource_id": "/subscriptions/.../storageAccounts/example",
  "category": "Storage",
  "attack_vector": "Public exposure → unauthenticated data access",
  "evidence": [],
  "recommendation": "Disable public blob access at the storage account level",
  "controls": { "cis_azure": ["3.7"], "mitre": ["T1530"] }
}
```

## Severity Model

Severity is determined by five factors — agents propose, the reporting agent normalizes:

| Factor | Weight | Description |
|---|---|---|
| Exploitability | High | How easy is this to exploit? |
| Exposure | High | Is the resource internet-facing? |
| Blast Radius | Medium | What's the scope of impact? |
| Data Sensitivity | Medium | Does this affect sensitive data? |
| Compensating Controls | Low | Are there mitigations in place? |

## Safety & Authorization

- **Scope enforcement**: Every agent validates target resources against `engagement.yaml`
- **Preflight checks**: Permissions validated before any assessment begins
- **Read-only default**: The default mode only reads configurations — no mutations
- **Hook-enforced guardrail**: The `redteam-guardrails` extension blocks mutating `az`/`azd` commands at the tool boundary (a `preToolUse` deny), so read-only is enforced even if an agent is misprompted — not just requested
- **Evidence redaction**: Secrets are never stored; PII redaction is configurable
- **Audit trail**: All agent actions and findings are logged with timestamps

## Requirements

- GitHub Copilot with Azure MCP tools enabled
- Azure CLI authenticated (`az login`)
- Minimum Azure RBAC: `Reader` + `Security Reader` on target scope
- Recommended: `Log Analytics Reader`, `Directory Reader`, `Key Vault Reader`
