---
description: Run a full Azure security assessment — dispatch all relevant domain agents against the resource inventory.
---

# /assess — Full Security Assessment

You are acting as the **Orchestrator Agent** (`agents/orchestrator/system-prompt.md`). Run the full domain assessment phase.

## Preconditions

- `engagement.yaml` exists and is valid.
- `engagements/<session>/inventory/resources.jsonl` exists (run `/recon` first if not).

## Steps

1. **Confirm inventory** is present and current. If missing, run reconnaissance first.
2. **Dispatch domain agents** based on resource types in the inventory. Each agent runs its checks from `checks/<domain>/` and writes findings to `engagements/<session>/findings/raw/<agent>.jsonl`:

   | Condition | Agent | Prompt |
   |---|---|---|
   | Entra ID / app registrations in scope | Identity Posture | `agents/identity-posture/system-prompt.md` |
   | Network resources / public IPs | Network Exposure | `agents/network-exposure/system-prompt.md` |
   | Compute / AKS / Kubernetes / containers / functions | Compute Platform | `agents/compute-platform/system-prompt.md` |
   | Storage / Key Vault / databases | Data Protection | `agents/data-protection/system-prompt.md` |
   | CDN / Front Door / static sites / APIM / WAF | Web & Static Sites | `agents/web-exposure/system-prompt.md` |
   | Cognitive Services / Azure OpenAI / AI Foundry / ML | AI & Foundry | `agents/ai-foundry/system-prompt.md` |
   | Public IPs / DNS zones / internet-facing endpoints (always) | Attack Surface (EASM) | `agents/attack-surface/system-prompt.md` |
   | Always | Logging Coverage | `agents/logging-coverage/system-prompt.md` |
   | Always (control-plane guardrails) | Governance & Posture | `agents/governance-posture/system-prompt.md` |
   | Federated credentials (OIDC) / ACR / Automation / Logic Apps / CI/CD SPs | DevOps & Supply Chain | `agents/devops-supplychain/system-prompt.md` |
   | M365 / Exchange Online in scope (optional) | Email Security | `agents/email-security/system-prompt.md` |
   | Role assignments / custom roles (after the above) | Authorization & Attack Path | `agents/authorization-attack-path/system-prompt.md` |

3. **Enforce scope and mode** for every agent. Skip excluded resources. Never exceed the engagement `mode`.
4. **Validate findings** against `schemas/finding.schema.json` as they are produced.
5. **Report progress**: finding counts by agent and severity.

## Output

- `engagements/<session>/findings/raw/*.jsonl` populated by each dispatched agent
- An assessment summary table (agent × findings × severity)
- Recommended next step: `/attack-paths` then `/report`

All checks are configuration-based and read-only unless the engagement `mode` is `controlled-validation` and the specific action is permitted in `engagement.yaml`.
