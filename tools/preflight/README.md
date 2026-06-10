# `tools/preflight/` — Environment doctor

A one-command readiness check you run **right after cloning**, before your first
assessment. It confirms your machine has everything the team needs and tells you
exactly how to fix anything that's missing.

```bash
node tools/preflight/check-environment.mjs
```

It verifies:

| Check | Why it matters | Fix if missing |
|---|---|---|
| **Node.js ≥ 22.5** | The engagement datastore + report generator use the built-in `node:sqlite` | Install Node 22.5+ from <https://nodejs.org/> |
| **Azure CLI installed** | Every domain agent runs read-only `az` queries | <https://learn.microsoft.com/cli/azure/install-azure-cli> |
| **Azure CLI signed in** | Assessments run as your identity | `az login` |
| **resource-graph extension** | Inventory + scope brief run `az graph query` | `az extension add --name resource-graph` |
| **engagement.yaml present** | Your scope file (a warning, not a blocker — `/setup` creates it) | `/setup` or `cp engagement.example.yaml engagement.yaml` |

**Read-only.** The doctor only reads tool versions and your signed-in account
(`az version`, `az account show`, `az extension show`). It touches no Azure
resources, mutates nothing, and stores nothing.

**Exit code:** `0` when every required check passes, `1` otherwise — so it can
gate a pipeline. Add `--json` for machine-readable output.

The pure version logic is unit-tested in `check-environment.test.mjs`
(`node tools/preflight/check-environment.test.mjs`).
