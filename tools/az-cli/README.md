# Az CLI Assessment Runners

Each deployed domain agent runs its own read-only security assessment using the Azure CLI
(`az`) commands in its domain file here. This is the **execution scaffolding** that turns
each agent into a self-contained assessor: the agent reads its `checks/<domain>/checks.yaml`
for *what* to test and the matching file here for the *exact `az` command* that detects it.

| Domain file | Agent | Checks source |
|---|---|---|
| `identity.md` | `azure-redteam-identity` | `checks/identity/checks.yaml` |
| `rbac.md` | `azure-redteam-authorization` | `checks/rbac/checks.yaml` |
| `network.md` | `azure-redteam-network` | `checks/network/checks.yaml` |
| `compute.md` | `azure-redteam-compute` | `checks/compute/checks.yaml` |
| `storage.md` | `azure-redteam-data` | `checks/storage/checks.yaml` |
| `database.md` | `azure-redteam-data` | `checks/database/checks.yaml` |
| `logging.md` | `azure-redteam-logging` | `checks/logging/checks.yaml` |

## Contract

- **Read-only only.** Every command here is `list` / `show` / `query` — no create, update, or
  delete. Agents must never run a mutating `az` command in `read-only-assessment` mode.
- **Scope-bound.** Agents pass `--subscription <id>` from `engagement.yaml` and skip any
  resource in `exclusions`.
- **Structured output.** Run with `-o json` and map results to findings conforming to
  `schemas/finding.schema.json`, written to `findings/raw/<agent>.jsonl`.
- **No secret extraction.** Commands assess configuration/metadata only. Never retrieve secret
  values, keys, connection strings, or data records.
- **Each command is a template.** Replace `<...>` placeholders at runtime. Commands are static
  reference text — running them is the agent's job during an engagement, not part of the repo.

## Preflight (run once, by the inventory agent)

```bash
az account show -o json                              # confirm identity + subscription
az account list -o json                              # enumerate accessible subscriptions
az graph query -q "Resources | project id, type, name, location, resourceGroup" -o json
```
