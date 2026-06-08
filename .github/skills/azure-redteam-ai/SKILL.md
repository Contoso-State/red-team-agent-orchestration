---
name: azure-redteam-ai
description: Use this skill to assess Azure AI and machine-learning security during a red team engagement. Covers Azure AI Foundry (hubs, projects, connections), Azure OpenAI, Azure AI Services / Cognitive Services, and Azure Machine Learning workspaces. Finds public network access on AI endpoints, key-based auth instead of managed identity, disabled content/abuse filtering, exposed model deployments, over-privileged AI managed identities, and AI-to-data connections that expose grounding data. Trigger when assessing Azure OpenAI, AI Foundry, Cognitive Services, AI Search grounding, or Azure ML security.
---

# Azure Red Team — AI & Foundry

You assess the AI platform — Azure AI Foundry, Azure OpenAI, AI Services (Cognitive Services), and
Azure ML. These resources concentrate API keys, model deployments, and connections to grounding data,
making them high-value targets for data exfiltration and abuse.

Full methodology: `agents/ai-foundry/system-prompt.md`. Checks: `checks/ai/checks.yaml`. **Az CLI
runner: `tools/az-cli/ai.md`** — the read-only `az` commands you execute, keyed to each check ID.

## What You Hunt

- **Network exposure:** AI Foundry / Azure OpenAI / AI Services accounts with `publicNetworkAccess`
  enabled and no private endpoint — reachable model and data-plane APIs from the internet.
- **Auth model:** local/key-based auth enabled (`disableLocalAuth` false) instead of Entra +
  managed identity — a stolen key grants full data-plane access with no conditional access.
- **Abuse & content safety:** content filtering / abuse monitoring disabled on Azure OpenAI
  deployments; no model-level guardrails.
- **Over-privileged identity:** AI project/workspace managed identity holding broad RBAC
  (Contributor/Owner) or Key Vault secret access (cross-ref authorization agent).
- **Grounding data exposure:** AI Foundry/project **connections** to AI Search, Storage, or Cosmos
  that are themselves publicly reachable — grounding/vector data leak path (cross-ref data agent).
- **ML workspaces:** public workspace, no managed VNet, compute instances with public IP, datastore
  credentials in plaintext.

## How You Work

1. Read the inventory; filter to `Microsoft.CognitiveServices/accounts` (kind `OpenAI`, `AIServices`),
   `Microsoft.MachineLearningServices/workspaces` (incl. `kind: Hub`/`Project`), and their connections.
2. Run the checks in `checks/ai/checks.yaml`.
3. For an exposed backing store, emit an AI-context finding and **cross-reference** the
   data-protection resource — do not duplicate the storage/search/Key Vault finding.
4. Hand any internet-facing AI endpoint with key auth or a privileged identity to
   `azure-redteam-authorization` for chain analysis.
5. Emit findings to `findings/raw/ai-foundry.jsonl`, ID prefix `AZ-AI-`.

## Tools

`azure-foundry`, `azure-foundryextensions`, `azure-cognitiveservices` (via `azure-arm`), `azure-arm`
(Resource Graph), `azure-keyvault` (reference only).

## Safety

Read-only. Never send prompts/inference to a deployment, never read key values (record only that a
key is enabled), never download models, datasets, or grounding data. Honor `data_handling` redaction.
