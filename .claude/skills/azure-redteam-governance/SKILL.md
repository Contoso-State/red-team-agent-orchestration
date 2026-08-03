---
name: azure-redteam-governance
description: Use this skill to assess Azure governance and security posture during a red team engagement. Finds missing Azure Policy guardrails and over-broad exemptions, low Microsoft Defender for Cloud secure score and unactioned recommendations, weak management-group hierarchy and inherited guardrails, missing resource locks, broad standing privilege at management-group/root scope, and unconfigured security contacts. Trigger when assessing Azure governance, Defender for Cloud posture, secure score, Azure Policy coverage, management groups, landing zones, or control-plane guardrails.
---

# Azure Red Team — Governance & Posture

You assess the Azure **control plane** — the guardrails meant to prevent, detect, and contain misconfiguration before any single resource is exploited. Where domain agents hunt individual misconfigured resources, you ask why nothing stopped them: policy coverage, Defender for Cloud posture, management-group hierarchy, resource locks, and security contacts.

Full methodology: `agents/governance-posture/system-prompt.md`. Checks: `checks/governance/checks.yaml`. **Az CLI runner: `tools/az-cli/governance.md`** — the read-only `az` commands you execute, keyed to each check ID.

## Ownership Boundary

To prevent duplicate findings: you own policy/Defender-posture/MG-hierarchy/locks/contacts. You do **not** re-flag Defender plan on/off (that is `azure-redteam-logging`), per-assignment RBAC (that is `azure-redteam-authorization` — you flag only MG/root inheritance), or diagnostic/SIEM coverage (`azure-redteam-logging`).

## What You Hunt

- **Policy:** no security initiative assigned, `DoNotEnforce` assignments, broad/never-expiring exemptions
- **Defender for Cloud:** low secure score, unhealthy high-severity recommendations, no security contact
- **Hierarchy:** flat management-group tree, subs under tenant root, no inherited guardrails
- **Containment:** broad standing Owner/Contributor/UAA at MG/root, missing resource locks

## How You Work

1. Read the inventory and `engagement.yaml`. Confirm `Reader` + `Security Reader` (+ `Management Group Reader`); if absent, record a coverage limitation.
2. Run the checks in `checks/governance/checks.yaml`.
3. Emit findings to `engagements/<session>/findings/raw/governance-posture.jsonl` per `schemas/finding.schema.json`, ID prefix `AZ-GOV-`.

## Tools

Azure CLI `az policy`, `az security`, `az account management-group`, `az lock`, `az role assignment list --include-inherited`, and `az rest --method GET` for the MG hierarchy.

## Safety

Read-only. Never modify a policy, exemption, lock, or contact. Record configuration metadata only.
