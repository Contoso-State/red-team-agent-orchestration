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

The team ships as native **GitHub Copilot CLI** primitives — and the **same team runs
natively on [Claude Code, OpenAI Codex CLI, and Cursor](runtimes.md)**, all backed by one
shared read-only guard core so a given command reaches an identical decision on every
platform. Once this repo is checked out, your AI runtime automatically discovers the
**Pentest Manager** (Orchestrator) and its fifteen domain specialists — no manual wiring
required.

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

:::{warning}
**AI Disclosure & Disclaimer:** This project uses AI agents (powered by GitHub Copilot / Claude models) to conduct security assessments. **AI models can make errors, generate false positives, miss vulnerabilities, or misinterpret findings.** Use at your own risk and validate all findings independently. This tool is a **starting point** for security assessments, not a replacement for professional human review. **You assume full responsibility for verifying findings, ensuring authorization, and assessing accuracy.** Always combine agentic assessments with manual review by experienced security professionals before acting on findings in production environments.

**Not affiliated with Microsoft.** This is an independent demonstration project — not affiliated with, endorsed by, or sponsored by Microsoft. *"Contoso"* is a fictitious company name Microsoft uses in its own samples and documentation; it is used here only in that demonstration spirit. *"Microsoft"* and *"Azure"* are trademarks of Microsoft Corporation.
:::

## What you get

- **Graph-engineered orchestration** — [`graph/redteam.graph.json`](../graph/redteam.graph.json)
  is the canonical engagement topology: scope validation, methodology memory, parallel
  specialist fan-out, deterministic reduce, bounded evaluator-optimizer reflection, read-only
  false-positive judging, gated active-lane interrupts, reporting, and autonomous Reflexion
  debrief. See [Graph Engineering & Self-Improvement](graph-engineering.md).
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

:::{card} 🧠 AI Model Runtimes
:link: runtimes.md
Run the same read-only team on GitHub Copilot, Claude Code, OpenAI Codex, and Cursor — one
guard core, four runtimes.
:::

:::{card} 🔐 Permissions & Least Privilege
:link: permissions.md
Recommended read-only roles for target subscription and Entra ID, plus extra safety controls.
:::

:::{card} 🕸️ Graph Engineering & Self-Improvement
:link: graph-engineering.md
The canonical graph, bounded reflection loops, memory firewall, and Node + LangGraph engines.
:::

:::{card} 🤖 The Agent Team
:link: agent-team.md
Meet the Orchestrator and its fifteen domain specialists, and see how they coordinate.
:::

:::{card} 🧠 Skills
:link: skills.md
The auto-loaded skills that give each agent its Azure domain methodology — mirrored across
every runtime.
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

## Primary architecture: graph engineering

The engagement is defined as an explicit graph, not a static prompt pipeline. The same graph
runs through the dependency-free Node runner in the four CLI runtimes and through the first-class
LangGraph target, while self-improving loops can update only `memory/methodology/` — never the
read-only guard. Start with [Graph Engineering & Self-Improvement](graph-engineering.md).

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
