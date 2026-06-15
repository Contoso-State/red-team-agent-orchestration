---
title: Azure Red Team Agent Orchestration
description: An agentic red team for Azure cloud security.
thumbnail: assets/social-card.png
---

![Azure Red Team Agent Orchestration](assets/banner.svg)

**An agentic red team for Azure cloud security.** A coordinated team of AI agents — each a
domain specialist — runs comprehensive, **read-only** penetration testing against your Azure
environment, then hands you a leadership-ready report, an interactive HTML report, and a
slide deck.

The team ships as native **GitHub Copilot CLI** primitives. Once this repo is checked out,
Copilot automatically discovers the **Pentest Manager** (Orchestrator) and its fifteen
domain specialists — no manual wiring required.

:::{important}
This is a **read-only methodology template**. Every Azure interaction goes through a
session-wide guardrail that **denies by default** — only recognized read/query operations
on `az`/`azd`/Azure PowerShell are allowed. Nothing in this repo performs live scanning on
its own; you run the agents against your own authorized, in-scope environment.

The one exception is the **gated External Vulnerability Agent (EVA)** — off by default —
which performs active outside-in web testing against **only** the URLs/IPs already
discovered in your Azure subscription, and only after a signed authorization. See
[Safety & Authorization](safety.md#active-external-testing-eva).
:::

## What you get

- **A dispatchable agent team** — one user-facing Orchestrator that coordinates fifteen
  read-only domain specialists (identity, network, compute, container/Kubernetes, data, web,
  AI, EASM, logging, governance, supply chain, email, authorization/attack-path, inventory,
  reporting), plus **gated** active-testing lanes (the EVA agent and the Container &
  Kubernetes in-cluster lane) that stay off until explicitly authorized.
- **Atomic security checks** across 14 domains, each mapped to CIS Azure, MITRE
  ATT&CK cloud techniques, and NIST CSF 2.0.
- **Attack-path correlation** that chains single-domain findings into multi-step
  compromise scenarios.
- **An incremental SQLite datastore** that caches Azure config so agents stop re-querying,
  joins findings across domains, and tracks what changed between runs (new / persisting /
  resolved / regressed).
- **Consulting-grade deliverables** — executive summary, technical report, an interactive
  self-contained HTML report, and a slide deck, all rendered from a normalized
  `findings.json`.

## Start here

::::{grid} 1 1 2 2

:::{card} 🚀 Getting Started
:link: getting-started.md
Define scope, start the Pentest Manager, and run your first assessment in seven steps.
:::

:::{card} 🔐 Permissions & Least Privilege
:link: permissions.md
Recommended read-only roles for target subscription and Entra ID, plus extra safety controls.
:::

:::{card} 🤖 The Agent Team
:link: agent-team.md
Meet the Orchestrator and its fifteen domain specialists, and see how they coordinate.
:::

:::{card} 🧠 Skills
:link: skills.md
The auto-loaded Copilot skills that give each agent its Azure domain methodology.
:::

:::{card} 🧪 Methodology
:link: methodology.md
Atomic checks, multi-step playbooks, control mappings, and the Azure attack knowledge base.
:::

:::{card} 🗄️ Engagement Datastore
:link: datastore.md
The SQLite cache that stops agents re-querying Azure, joins findings across domains, and
tracks what changed between runs.
:::

:::{card} 📊 Reporting
:link: reporting.md
The interactive HTML report, deliverables, and the structured findings model.
:::

:::{card} 🛡️ Safety & Authorization
:link: safety.md
The read-only guardrail, operating modes, and engagement authorization.
:::

:::{card} 🎯 External Vulnerability Agent
:link: external-vuln.md
The gated, scope-locked active web-testing agent (EVA) — off by default.
:::

:::{card} 🗂️ Repository Layout
:link: repository.md
How agents, skills, hooks, checks, and session output are organized.
:::

::::

## How it works at a glance

```{mermaid}
graph TD
    User[Security Engineer] -->|/recon or /assess| Orchestrator
    Orchestrator -->|1. Preflight| Preflight[Inventory & Scope Agent]
    Preflight -->|Resource inventory| DB[(Engagement Datastore)]
    DB -->|cached config| Orchestrator
    Orchestrator -->|2. Dispatch| Agents[Domain Agents]
    Agents -->|query cache / structured findings| DB
    DB -->|joined facts + findings| Orchestrator
    Orchestrator -->|3. Correlate| APA[Attack Path Analysis]
    APA -->|Attack chains| Orchestrator
    Orchestrator -->|4. Report + delta| Reporter[Reporting Agent]
    Reporter -->|Final report| User
```
