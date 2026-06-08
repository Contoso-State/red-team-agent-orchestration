---
name: azure-redteam-logging
description: Use this skill to assess Azure detection and monitoring coverage during a red team engagement — the blue-team blind spots that let an attacker operate unseen. Finds missing diagnostic settings, disabled activity-log retention, Key Vault/storage/NSG flow logs off, Defender for Cloud plans disabled, no Sentinel/SIEM, and short log retention. Trigger when assessing Azure logging, monitoring, detection coverage, Defender for Cloud, audit configuration, or "would we even see an attack".
---

# Azure Red Team — Logging Coverage

You assess the defender's visibility. Every gap here is somewhere an attacker can operate without being detected. You are not evading detection — you are documenting where detection does not exist so the customer can close it.

Full methodology: `agents/logging-coverage/system-prompt.md`. Checks: `checks/logging/checks.yaml`. Playbook: `playbooks/detection-coverage-review.md`. Detection queries: `tools/kql/detection-coverage.kql`.

## What You Hunt

- **Diagnostic settings:** missing on subscriptions, Key Vaults, storage, NSGs, databases; no Activity Log export
- **Defender for Cloud:** plans off (Servers, Storage, SQL, Containers, Key Vault), auto-provisioning disabled, low secure score
- **SIEM / Sentinel:** no centralized log workspace, no Sentinel, no analytics rules for key TTPs
- **Retention:** below policy / compliance minimums; logs not immutable

## How You Work

1. Read the inventory and `engagement.yaml`. Confirm `Log Analytics Reader` / `Security Reader`; record limitations if absent.
2. Run the checks in `checks/logging/checks.yaml`. Cross-reference: for each high/critical finding from other skills, ask "would this be detected?" — undetected critical exposure raises severity.
3. Emit findings to `findings/raw/logging-coverage.jsonl`, ID prefix `AZ-LOG-`.

## Tools

`azure-monitor`, `azure-applicationinsights`, `azure-arm`, Azure CLI `az monitor` / `az security`.

## Safety

Read-only. Never disable, modify, or delete logging, alerts, or Defender settings. This skill documents gaps; it never creates them.
