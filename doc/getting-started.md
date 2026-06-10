---
title: Getting Started
description: Define scope, start the Pentest Manager, and run your first read-only Azure assessment.
---

# Getting Started

The team runs inside **GitHub Copilot CLI**. Check out the repo, then drive the engagement
either through the **Pentest Manager** agent or the slash-command shortcuts. Every run is
read-only by default and writes all of its output into a single timestamped session folder.

:::{tip}
Prefer to talk to the team in natural language? Just ask Copilot to *"run an Azure red team
assessment"* — it loads the orchestrator skill and follows the same flow described below.
:::

## Prerequisites

Install these once, then verify your machine is ready:

| Requirement | Why | Install / verify |
|---|---|---|
| **GitHub Copilot CLI** | Hosts the agents, skills, and guardrail | [Copilot CLI install guide](https://docs.github.com/copilot/github-copilot-in-the-cli) |
| **Azure CLI** (`az`) | Every domain agent runs read-only `az` queries | [Install Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) |
| **`resource-graph` extension** | Inventory + scope brief run `az graph query` | `az extension add --name resource-graph` |
| **Node.js ≥ 22.5** | Datastore + report generator use the built-in `node:sqlite` (no `npm install`) | [nodejs.org](https://nodejs.org/) |
| **Azure sign-in** | Assessments run as your identity | `az login` |

Minimum Azure RBAC on the target scope is **`Reader` + `Security Reader`**; `Log Analytics
Reader`, `Directory Reader`, and `Key Vault Reader` improve coverage. Keep it read-only —
assign your identity read roles only.

Run the environment doctor to confirm everything in one shot (it's read-only and tells you
how to fix anything missing):

```bash
node tools/preflight/check-environment.mjs
```

## 1. Define engagement scope

Run the guided setup — it lists the subscriptions you can access, asks which one to assess,
and writes `engagement.yaml` for you:

```text
/setup
```

Prefer to do it by hand? Copy the template instead:

```bash
cp engagement.example.yaml engagement.yaml
# Edit engagement.yaml with target subscription, tenant, and permissions
```

## 2. Start the Pentest Manager

```text
/agent redteam-orchestrator
```

This launches the **Orchestrator** (Pentest Manager), which dispatches the domain
sub-agents for you. The slash commands below are shortcuts that drive the same team.

## 3. Run reconnaissance

```text
/recon
```

The orchestrator will:

- Open a fresh per-run session folder `engagements/<session>/` (where `<session>` =
  `<engagement-id>-<timestamp>`) that holds **all** output for this run and is gitignored.
- Validate your Azure permissions (preflight).
- Enumerate all resources in scope.
- Build a resource inventory.
- Identify which domain agents to dispatch.

## 4. Run the full assessment

```text
/assess
```

Dispatches all domain agents against the inventory. Each agent produces structured findings
in `engagements/<session>/findings/raw/`. Agents read cached resource config from the
[engagement datastore](datastore.md) instead of re-querying Azure, so large estates stay fast.

## 5. Analyze attack paths

```text
/attack-paths
```

Correlates findings across domains to identify multi-step compromise chains.

## 6. Generate the report

```text
/report
```

Normalizes findings, deduplicates, reconciles severity, and generates the executive
summary, technical report, normalized `findings.json`, and an **interactive HTML report**.
It also folds the run into the datastore's history and emits a `delta.json` of what changed
since last time. See [Reporting](reporting.md) for the full deliverable set and a live sample.

## 7. Build the presentation deck

```text
/deck
```

Renders a PowerPoint-convertible slide deck. Convert it to `.pptx` with Marp or Pandoc:

```bash
npx @marp-team/marp-cli engagements/<session>/reports/assessment-deck.md -o assessment-deck.pptx
# or
pandoc engagements/<session>/reports/assessment-deck.md -o assessment-deck.pptx --slide-level=2
```

`/report` also emits this deck automatically.

## Slash commands

| Command | What it does |
|---|---|
| `/setup` | Guided engagement scoping → writes `engagement.yaml` |
| `/recon` | Preflight + resource inventory |
| `/assess` | Dispatch all in-scope domain agents |
| `/attack-paths` | Correlate findings into attack chains |
| `/report` | Render executive + technical + HTML report + deck |
| `/deck` | Render the slide deck only |
| `/external` *(gated)* | Active outside-in OWASP Top 10 testing of Azure-discovered URLs/IPs — only in `external-active-testing` mode |

:::{warning}
`/external` dispatches the **External Vulnerability Agent (EVA)**, the one agent that sends
real traffic. It is **off by default** and refuses to run unless the engagement is in
`external-active-testing` mode with a signed authorization. See
[External Vulnerability Agent](external-vuln.md).
:::

Next: see the [Agent Team](agent-team.md) that powers these commands, or review
[Safety & Authorization](safety.md) before running against a real environment.
