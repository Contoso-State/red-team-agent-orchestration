---
title: The Agent Team
description: The Orchestrator and its fourteen Azure domain specialists, and how they coordinate.
---

# The Agent Team

![Orchestrator dispatches fourteen domain specialists](assets/agent-team.svg)

A single user-invocable **Orchestrator** (Pentest Manager) coordinates the engagement and
hands tasks to fourteen domain specialists via Copilot's `agent` (Task) tool. The
orchestrator is **dispatch-only** — it has no shell access and never runs `az` itself; it
assigns work to specialists and aggregates the findings they return.

| Agent | Domain | Key Focus |
|---|---|---|
| **Orchestrator** | Coordination | Engagement lifecycle, task dispatch, finding aggregation |
| **Inventory & Scope** | Preflight | Resource enumeration, permission validation, scope enforcement |
| **Identity Posture** | Entra ID | MFA gaps, Conditional Access, app registrations, guest users, credential hygiene |
| **Authorization & Attack Path** | RBAC / Privilege | Over-permissioned roles, custom role abuse, managed identity chains, priv-esc paths |
| **Network Exposure** | Networking | Public IPs, NSG rules, firewall gaps, VNet peering, DNS exposure, private endpoints |
| **Compute Platform** | Compute / Kubernetes / Containers | VM patching, AKS & Kubernetes RBAC, Container Apps/Instances, ACR, Function Apps, App Service |
| **Data Protection** | Storage / Data / SQL | Storage exposure, Key Vault policies, SQL & database firewall rules, encryption |
| **Web & Static Sites** | Web edge / delivery | CDN/Front Door, WAF, TLS, Static Web Apps & storage static sites, API Management |
| **AI & Foundry** | AI services | Azure AI Foundry, Azure OpenAI, Cognitive Services, ML workspace exposure |
| **Attack Surface (EASM)** | External exposure | Outside-in footprint, dangling DNS / subdomain takeover, orphaned IPs, unknown assets |
| **Logging Coverage** | Monitoring | Diagnostic settings, Sentinel connectors, alert rules, Activity Log gaps |
| **Governance & Posture** | Governance / Posture | Azure Policy guardrails & exemptions, Defender for Cloud secure score, MG hierarchy, resource locks |
| **DevOps & Supply Chain** | CI/CD / Supply chain | Workload identity federation (OIDC), pipeline service principals, ACR admin/tasks, Automation Accounts, Logic Apps |
| **Email Security** *(optional)* | Microsoft 365 | SPF/DKIM/DMARC, Exchange Online Protection, Defender for Office 365, mail-flow rules |
| **Reporting** | Output | Finding normalization, severity reconciliation, executive + technical reports |

:::{note}
The **Email Security** agent covers Microsoft 365 / Exchange Online and is dispatched only
when M365 is in engagement scope. Entra ID, RBAC, SQL/databases, and Kubernetes/containers
are covered by the Identity, Authorization, Data, and Compute agents respectively.
:::

## How it works

```{mermaid}
graph TD
    User[Security Engineer] -->|/recon or /assess| Orchestrator
    Orchestrator -->|1. Preflight| Preflight[Inventory & Scope Agent]
    Preflight -->|Resource inventory| Orchestrator
    Orchestrator -->|2. Dispatch| Agents

    subgraph Agents[Domain Agents]
        ID[Identity Posture]
        NET[Network Exposure]
        COMP[Compute / Kubernetes]
        DATA[Data Protection]
        WEB[Web & Static Sites]
        AI[AI & Foundry]
        EASM[Attack Surface / EASM]
        GOV[Governance & Posture]
        SUP[DevOps & Supply Chain]
        LOG[Logging Coverage]
        MAIL[Email Security · optional]
        AUTH[Authorization & Attack Path]
    end

    Agents -->|Structured findings| Orchestrator
    Orchestrator -->|3. Correlate| APA[Attack Path Analysis]
    APA -->|Attack chains| Orchestrator
    Orchestrator -->|4. Report| Reporter[Reporting Agent]
    Reporter -->|Final report| User
```

## How the team is packaged

The team uses three native Copilot CLI layers that map cleanly onto **who acts**, **what
they know**, and **what they're allowed to do**.

### 1. Custom agents — the dispatchable team (`.github/agents/`)

The Orchestrator is the only **user-invocable** agent; the fourteen specialists set
`disable-model-invocation: true` so they run only when the Orchestrator dispatches them
through the `agent` (Task) tool. The Orchestrator is **dispatch-only** — it has no
`execute`/shell capability, so it never runs `az` itself.

### 2. Skills — auto-loaded domain knowledge (`.github/skills/`)

Each agent's deep methodology is a Copilot **skill**, loaded automatically by its
`description`. See [Skills & Methodology](methodology.md) for the full skill map.

### 3. Extension / hooks — read-only enforcement (`.github/extensions/redteam-guardrails`)

A session-wide `preToolUse` hook enforces read-only as an **allowlist (deny-by-default)**.
Because it is session-wide, it covers **every** agent. See
[Safety & Authorization](safety.md) for details.

Each skill stays thin and delegates to the detailed methodology in
`agents/<name>/system-prompt.md` and the atomic tests in `checks/<domain>/checks.yaml`,
keeping a single source of truth.
