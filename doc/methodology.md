---
title: Methodology
description: Atomic checks, multi-step playbooks, control mappings, and the Azure attack knowledge base.
---

# Methodology

The agents don't improvise. Every domain agent runs **its own read-only `az` CLI
assessment** driven by atomic checks, follows structured playbooks for multi-step analysis,
and grounds findings in a shared knowledge base and control mappings.

## Atomic checks (`checks/`)

Each domain has a `checks/<domain>/checks.yaml` file of atomic, independently verifiable
security checks. Every check is keyed to a read-only command in `tools/az-cli/<domain>.md`
and maps to the severity model and control frameworks.

| Domain | Checks file |
|---|---|
| AI & Foundry | `checks/ai/checks.yaml` |
| Compute | `checks/compute/checks.yaml` |
| Data / Database | `checks/database/checks.yaml` |
| Attack Surface (EASM) | `checks/easm/checks.yaml` |
| Email | `checks/email/checks.yaml` |
| Governance | `checks/governance/checks.yaml` |
| Identity | `checks/identity/checks.yaml` |
| Logging | `checks/logging/checks.yaml` |
| Network | `checks/network/checks.yaml` |
| RBAC / Authorization | `checks/rbac/checks.yaml` |
| Storage | `checks/storage/checks.yaml` |
| Supply Chain | `checks/supplychain/checks.yaml` |
| Web | `checks/web/checks.yaml` |

## Playbooks (`playbooks/`)

Playbooks are multi-step assessment methodologies that combine checks across domains:

- **`exposure-assessment.md`** — outside-in public exposure review.
- **`privilege-path-analysis.md`** — RBAC and managed-identity privilege-escalation paths.
- **`data-access-review.md`** — who can reach which data stores, and how.
- **`detection-coverage-review.md`** — logging/Sentinel coverage gaps an attacker would exploit.

## Knowledge base (`knowledge/`)

- **`azure-attack-matrix.md`** — Azure-specific attack techniques mapped to tactics.
- **`common-misconfigs.md`** — the recurring misconfigurations the agents hunt for.
- **`severity-model.md`** — how findings are scored and normalized for the report.
- **`scaling.md`** — how the assessment scales to estates with thousands of resources
  (aggregation, sampling, ARG paging, and the datastore as the working set).
- **`datastore.md`** — the canonical spec for the SQLite [engagement datastore](datastore.md).

## Control mappings (`controls/`)

Findings are mapped to industry frameworks so the report speaks the language of auditors and
defenders:

- **`cis-azure.yaml`** — CIS Microsoft Azure Foundations Benchmark.
- **`mitre-cloud.yaml`** — MITRE ATT&CK for cloud / Azure techniques.

## Command runners (`tools/`)

- **`tools/az-cli/<domain>.md`** — the read-only `az` commands each domain agent runs, one
  per check ID.
- **`tools/resource-graph/queries.md`** — Azure Resource Graph queries for fast inventory.
- **`tools/kql/`** — KQL for detection-coverage analysis.
- **`tools/powershell/`** — preflight and inventory-export helpers.

All commands are **read-only** and pass through the guardrail described in
[Safety & Authorization](safety.md). Results are cached in the
[engagement datastore](datastore.md), so agents query the database instead of re-running the
same `az` calls — essential on large estates.
