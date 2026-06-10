---
title: Skills
description: Auto-loaded Copilot skills that give each agent its Azure domain methodology.
---

# Skills

Each agent's deep methodology is a Copilot **skill** under `.github/skills/azure-redteam-*`,
loaded automatically by Copilot based on its `description`. Skills give every agent its
methodology and read-only `az` runner without manual wiring.

## Skill map

| Skill | When Copilot uses it |
|---|---|
| `azure-redteam-orchestrator` | **Pentest Manager.** "Run a red team assessment", "pentest my Azure environment" |
| `azure-redteam-inventory` | Preflight recon — permission validation + resource enumeration |
| `azure-redteam-identity` | Entra ID / authentication posture |
| `azure-redteam-authorization` | RBAC, privilege escalation, attack-path correlation |
| `azure-redteam-network` | Public exposure, NSGs, segmentation |
| `azure-redteam-compute` | VM, AKS / Kubernetes, container, serverless security |
| `azure-redteam-data` | Storage, Key Vault, SQL / database protection |
| `azure-redteam-web` | Web edge/delivery: WAF, TLS, static sites, API Management |
| `azure-redteam-ai` | Azure AI Foundry, OpenAI, Cognitive Services, ML |
| `azure-redteam-easm` | External attack surface, dangling DNS, unknown assets |
| `azure-redteam-logging` | Detection & monitoring coverage |
| `azure-redteam-governance` | Azure Policy, Defender for Cloud posture, MG hierarchy, resource locks |
| `azure-redteam-supplychain` | OIDC/federated credentials, pipeline SPs, ACR, automation, Logic Apps |
| `azure-redteam-email` | M365 email security (SPF/DKIM/DMARC, Defender for Office 365) — optional |
| `azure-redteam-external-vuln` | **Gated active testing.** OWASP Top 10 validation of Azure-discovered URLs/IPs + optional offline static analysis — scope-locked, off by default |
| `azure-redteam-reporting` | Normalize findings, render deliverables |

:::{note}
The **Identity Posture** agent additionally loads the supporting **`msgraph-sdk`** skill — a
Microsoft Graph SDK reference used to enumerate Entra ID configuration (users, app
registrations, Conditional Access) read-only via `az rest` / Graph. All other domains map
one-to-one to an `azure-redteam-*` skill above.
:::

## Agent ↔ skill ↔ runner

Each skill stays **thin** and delegates to a single source of truth:

- **Methodology** lives in `agents/<name>/system-prompt.md`.
- **Atomic tests** live in `checks/<domain>/checks.yaml`.
- **Read-only commands** live in the per-domain runner `tools/az-cli/<domain>.md`, each
  command keyed to a check ID.

This keeps the skill, the agent, and the checks in lock-step without duplicating content.

| Agent file | Display name | Invoked by |
|---|---|---|
| `redteam-orchestrator.agent.md` | Red Team Orchestrator (Pentest Manager) | **User** (`/agent redteam-orchestrator`) |
| `redteam-inventory.agent.md` | Red Team Inventory & Scope | Orchestrator |
| `redteam-identity.agent.md` | Red Team Identity | Orchestrator |
| `redteam-authorization.agent.md` | Red Team Authorization | Orchestrator |
| `redteam-network.agent.md` | Red Team Network | Orchestrator |
| `redteam-compute.agent.md` | Red Team Compute (incl. Kubernetes & containers) | Orchestrator |
| `redteam-data.agent.md` | Red Team Data (incl. SQL/databases) | Orchestrator |
| `redteam-web.agent.md` | Red Team Web & Static Sites | Orchestrator |
| `redteam-ai.agent.md` | Red Team AI & Foundry | Orchestrator |
| `redteam-easm.agent.md` | Red Team Attack Surface (EASM) | Orchestrator |
| `redteam-logging.agent.md` | Red Team Logging | Orchestrator |
| `redteam-governance.agent.md` | Red Team Governance & Posture | Orchestrator |
| `redteam-supplychain.agent.md` | Red Team DevOps & Supply Chain | Orchestrator |
| `redteam-email.agent.md` | Red Team Email Security *(optional, M365)* | Orchestrator |
| `redteam-external-vuln.agent.md` | Red Team External Vulnerability (EVA) *(gated active testing)* | Orchestrator (only in `external-active-testing` mode) |
| `redteam-reporting.agent.md` | Red Team Reporting | Orchestrator |

See [Methodology](methodology.md) for the checks, playbooks, and knowledge base that the
skills draw on.
