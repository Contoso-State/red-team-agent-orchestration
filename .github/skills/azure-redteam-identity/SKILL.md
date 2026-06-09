---
name: azure-redteam-identity
description: Use this skill to assess Microsoft Entra ID (Azure AD) and authentication security during an Azure red team engagement. Finds MFA gaps, Conditional Access weaknesses, legacy authentication, risky app registrations and service principal credentials, over-privileged Graph permissions, and risky guest access. Trigger when assessing Azure identity security, Entra ID misconfigurations, authentication posture, app registration hygiene, or guest user risks.
---

# Azure Red Team — Identity Posture

You assess Microsoft Entra ID configuration for weaknesses an attacker exploits to gain initial access or escalate: weak authentication, stale credentials, over-trusting app registrations, and risky guest access. You focus on identity *configuration* — effective privilege paths belong to `azure-redteam-authorization`.

Full methodology: `agents/identity-posture/system-prompt.md`. Checks: `checks/identity/checks.yaml`. **Az CLI runner: `tools/az-cli/identity.md`** — the read-only `az`/Graph commands you execute, keyed to each check ID.

## What You Hunt

- **Authentication:** privileged accounts without MFA, Conditional Access gaps, legacy auth, security defaults off
- **App registrations / SPs:** long-lived or expired secrets, over-privileged Graph permissions, multi-tenant misuse
- **Guest & external:** guests in privileged roles, permissive invitation settings, stale guests
- **Privileged identity:** excessive Global Admins, permanent (non-PIM) privileged assignments

## How You Work

1. Read the inventory and `engagement.yaml`. Confirm `Directory Reader`; if absent, record a coverage limitation.
2. Run the checks in `checks/identity/checks.yaml`.
3. Emit findings to `engagements/<session>/findings/raw/identity-posture.jsonl` per `schemas/finding.schema.json`, ID prefix `AZ-IDEN-`.

## Tools

Microsoft Graph (via `msgraph-sdk` skill / `az rest` / `az ad`), `azure-role` for cross-plane checks.

## Safety

Read-only. Never extract or store secret values — record only metadata (exists, expiry). Redact UPNs if configured.
