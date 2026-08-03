---
title: Methodology
description: Atomic checks, multi-step playbooks, control mappings, and the Azure attack knowledge base.
---

# Methodology

The agents don't improvise. Every domain agent runs **its own read-only `az` CLI
assessment** driven by atomic checks, follows structured playbooks for multi-step analysis,
and grounds findings in a shared knowledge base and control mappings.

## Methodology as a graph

The methodology is now executed as the declarative graph in
[`graph/redteam.graph.json`](../graph/redteam.graph.json), not as a static linear checklist. The
graph loads prior methodology memory, runs preflight inventory first, fans out across the
read-only specialist roster, dedupes findings, evaluates quality, reflects through a bounded
optimizer loop, sends candidate findings through a read-only Agent-as-a-Judge false-positive
filter, and writes a Reflexion debrief back to `memory/methodology/` for future runs.

This does **not** weaken the safety model: self-improvement is confined by the memory firewall
and cannot modify `guardrails/**`, the egress or cluster allowlists, or the read-only role
boundary. See [Graph Engineering & Self-Improvement](graph-engineering.md) for the graph,
reducers, routers, and self-improvement policy.

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
| External Vulnerability (EVA) *(active, gated)* | `checks/external-vuln/checks.yaml` |

:::{note}
The **External Vulnerability** checks are **active** (they describe outside-in web tests, not
read-only `az` queries) and run only when the engagement is in the gated
`external-active-testing` mode. See [Safety & Authorization](safety.md#active-external-testing-eva).
:::

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
- **`owasp-top10.md`**, **`web-vuln-testing.md`**, **`xss.md`**, **`static-analysis.md`** —
  the web-application testing knowledge base used by the gated External Vulnerability Agent
  (OWASP Top 10, outside-in DAST technique, XSS, and offline static analysis).
- **`entra-attack-techniques.md`** — Entra ID / identity attack methodology (consent
  phishing, service-principal & app-ownership abuse, federation trust, standing privilege).
- **`kubernetes-security.md`**, **`container-security.md`** — AKS / Kubernetes RBAC, Pod
  Security, workload-identity exposure, and container-image / registry posture (with gated
  cluster-active confirmation tiers).
- **`aks-security-baseline.md`** — Microsoft Cloud Security Benchmark–mapped AKS baseline used
  by the Azure Container & Kubernetes agent, linking each MCSB family to the relevant checks
  and the read-only vs. gated cluster-active lane.
- **`oauth-saml-jwt.md`** — OAuth2/OIDC, JWT, and SAML federation testing methodology used
  by the gated EVA lane.
- **`cloud-posture-benchmarks.md`** — CIS / CSPM / cloud-vulnerability-management posture
  methodology and Defender plan-ownership mapping.

:::{note}
The Entra, Kubernetes, container, OAuth/SAML/JWT, and cloud-posture knowledge files were
adapted from the Apache-2.0 project [`mukul975/Anthropic-Cybersecurity-Skills`](https://github.com/mukul975/Anthropic-Cybersecurity-Skills);
see [`THIRD_PARTY_NOTICES.md`](https://github.com/Contoso-State/red-team-agent-orchestration/blob/main/THIRD_PARTY_NOTICES.md)
and `knowledge/ATTRIBUTION.md`. All adapted material is read-only methodology — no
active/offensive commands were added to any command runner.
:::

## Control mappings (`controls/`)

Findings are mapped to industry frameworks so the report speaks the language of auditors and
defenders:

- **`cis-azure.yaml`** — CIS Microsoft Azure Foundations Benchmark.
- **`mitre-cloud.yaml`** — MITRE ATT&CK for cloud / Azure techniques.
- **`nist-csf.yaml`** — NIST Cybersecurity Framework 2.0 functions, categories, and
  subcategories. Checks may also carry inline `controls.nist_csf` tags.

## Command runners (`tools/`)

- **`tools/az-cli/<domain>.md`** — the read-only `az` commands each domain agent runs, one
  per check ID.
- **`tools/resource-graph/queries.md`** — Azure Resource Graph queries for fast inventory.
- **`tools/kql/`** — KQL for detection-coverage analysis.
- **`tools/powershell/`** — preflight and inventory-export helpers.
- **`tools/external/`** — the **gated** active external-testing toolchain: `build-targets.mjs`
  (derives the Azure-scoped target allowlist), `safe-prober.mjs` (dependency-free Tier-1
  probes), `Invoke-ScopedScan.ps1` (scope-locked DAST wrapper), and `Invoke-StaticAnalysis.ps1`
  (offline SAST). These run only in `external-active-testing` mode and are bounded by a
  second fail-closed egress guardrail.
- **`tools/cluster/`** — the **gated** cluster-active toolchain for the Azure Container &
  Kubernetes agent: `build-cluster-targets.mjs` (derives the Azure-scoped cluster/registry
  allowlist), `safe-kube-audit.mjs` (dependency-free Tier-C1 read-only `kubectl` audit), and
  `Invoke-ScopedClusterScan.ps1` (scope-locked kube-bench/kubesec/trivy/grype wrapper). These
  run only in `cluster-active-testing` mode, never mutate workloads, and are bounded by a
  third fail-closed cluster guardrail.

All read-only commands pass through the guardrail described in
[Safety & Authorization](safety.md). The `tools/external/` toolchain is the **one active
exception** and is independently gated and scope-locked. Results are cached in the
[engagement datastore](datastore.md), so agents query the database instead of re-running the
same `az` calls — essential on large estates.
