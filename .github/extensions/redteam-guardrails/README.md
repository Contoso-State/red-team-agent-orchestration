# redteam-guardrails (Copilot CLI extension)

Runtime **hook** that enforces the read-only safety model of the Azure red team. It registers a
session-wide `preToolUse` hook that **denies any Azure command that is not a recognized read/query
operation** — so an engagement can never change the target environment by accident, no matter which
agent issues the command.

## Behavior

- **Allowlist / deny-by-default.** Only recognized read operations are permitted; anything else on
  `az` / `azd` or Azure PowerShell (`*-Az*`) is treated as a state change and blocked. Unknown or
  brand-new mutating verbs therefore fail closed.
- **Read-only commands pass:** `az list/show/get/...`, `az graph query`, `az rest --method GET`,
  `Get-Az*`, `Find-Az*`, `Search-Az*`, `Test-Az*`, `Export-Az*`, `Invoke-AzRestMethod -Method GET`,
  plus session/local-context commands (`az account set`, `az login`, `az extension add`,
  `Set-AzContext`, `Connect-AzAccount`).
- **Blocked examples:** `az vm create`, `az role assignment create`, `az storage account update`,
  `az keyvault purge`, `az vm run-command invoke`, `az rest --method POST|PUT|PATCH|DELETE` (in every
  form — `--method=POST`, `-m POST`, `-mPOST`, quoted, or an implicit-POST `az rest … --body …`),
  `az config set`, `New-AzVM`, `Remove-AzKeyVault`, `Invoke-AzVMRunCommand`,
  `Invoke-AzRestMethod -Method POST` (incl. abbreviations `-M`/`-Me`).
- **Evasion-aware normalization.** The executable name is normalized before matching, so quoting or
  qualifying it can't hide a mutation (`'az'`, `"az"`, `az.exe`, `& 'Remove-AzVM'`). Leading
  execution wrappers are fast-forwarded to the inner Azure call (`timeout 30 az …`, `xargs -I{} az …`,
  `env -i FOO=bar az …`, `watch -n5 az …`), and a dynamic method value (`--method $VAR`) fails closed.
- **Wrapper-aware.** Indirection can't sneak a mutation past it — it also inspects payloads passed to
  `pwsh -Command`, `powershell -EncodedCommand` (base64 is decoded), `bash -c`, `cmd /c`,
  `Invoke-Expression`/`iex`, the call operator `&`, backtick command substitution, and
  `Start-Process … -ArgumentList`.
- **Precise on reads.** Leading `az` global flags (`az --verbose vm list`, `az -o json account show`)
  are recognized so legitimate reads aren't mis-denied, while an *unknown* leading flag still fails
  closed.
- **Tool-scoped.** Only command-execution tools are inspected. File `read`/`edit`/`create` calls are
  never treated as commands, so documentation that *mentions* `az ... delete` is never blocked.
- **`mode: controlled-validation`** does **not** silently allow mutations — it downgrades them to an
  explicit **human-approval prompt** (`permissionDecision: "ask"`). Read-only modes
  (`read-only-assessment`, `attack-path-analysis`, or a missing `engagement.yaml`) hard-deny.
- On a block/ask the user sees a clear reason and the offending command; a warning is logged.

## How it fits the team

```
.github/agents/      → WHO acts (orchestrator dispatches the sub-agents; it has no shell access)
.github/skills/      → WHAT they know (domain knowledge auto-loaded by Copilot)
.github/extensions/  → THIS: enforces what they MAY do (read-only) at the tool-call boundary
```

## Files

- `extension.mjs` — session wiring (`joinSession`, `onSessionStart`, `onPreToolUse`).
- `guardrails-core.mjs` — pure decision logic (`evaluate`, `violation`, allowlists, wrapper
  extraction). Importable and side-effect free.
- `guardrails-core.test.mjs` — unit tests. Run with
  `node .github/extensions/redteam-guardrails/guardrails-core.test.mjs`.

## Lifecycle

The CLI discovers this automatically from `.github/extensions/` at the git root, reloads it on
`/clear`, and stops it on exit. No install step — `@github/copilot-sdk` is resolved by the harness.

## Customizing

Edit `guardrails-core.mjs`:

- `AZ_READ_OP` / `PS_READ_VERBS` — the read allowlists (widen/narrow the permitted operations).
- `AZ_BENIGN` / `PS_BENIGN` — session/local-context commands exempted from the read check.
- `extractInner` — wrapper/indirection patterns to unwrap before evaluation.

Re-run the unit tests after any change.
