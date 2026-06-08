# redteam-guardrails (Copilot CLI extension)

Runtime **hook** that enforces the read-only safety model of the Azure red team. It registers a
`preToolUse` hook that **denies mutating `az` / `azd` commands** so an engagement can never change
the target environment by accident.

## Behavior

- **Default = enforce.** If `engagement.yaml` is missing or `mode` is `read-only-assessment` /
  `attack-path-analysis`, any state-changing Azure CLI command is denied before it runs.
- **`mode: controlled-validation`** in `engagement.yaml` lifts the block — the only mode that
  authorizes state changes, and only because the engagement explicitly opted in.
- **Read-only commands always pass:** `list`, `show`, `get`, `query`, `az graph query`,
  `az account show/set`, `az extension add`, `az rest --method GET`, etc.
- **Blocked examples:** `az vm create`, `az role assignment create`, `az storage account update`,
  `az keyvault delete`, `az rest --method POST|PUT|PATCH|DELETE`.
- On a block the user sees a clear reason and the offending command; a warning is logged to the
  timeline.

## How it fits the team

```
.github/agents/      → WHAT to assess (orchestrator dispatches the sub-agents)
.github/skills/      → domain knowledge auto-loaded by Copilot
.github/extensions/  → THIS: enforces HOW (read-only) at the tool-call boundary
```

## Lifecycle

The CLI discovers this automatically from `.github/extensions/` at the git root, reloads it on
`/clear`, and stops it on exit. No install step — `@github/copilot-sdk` is resolved by the harness.

## Customizing

- Tighten to an allow-list, add resource-group scoping, or block specific MCP tools by editing
  `extension.mjs` (`MUTATING_OPS`, `BENIGN`, and the `onPreToolUse` hook).
- The mutation verb list is intentionally broad and read from the `az` operation token; adjust for
  your environment's tolerance.
