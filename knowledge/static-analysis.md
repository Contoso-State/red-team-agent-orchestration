# Offline Static Analysis (SAST) — Opt-in Feature Reference

EVA can perform **offline** static analysis of application code retrieved from in-scope Azure
resources. This is an **extended feature, off by default**, gated behind
`external_testing.static_analysis.enabled: true`. Code is **analyzed, never executed.**

## When this runs

ALL of the following must hold:

- the full EVA authorization gate is satisfied (`mode: external-active-testing`, `external_testing.enabled`, signed authorization, valid window);
- `external_testing.static_analysis.enabled: true`;
- the source resource is in scope (its host/resource is on the Azure-derived allowlist / inventory).

If any is missing, static analysis does not run.

## Why offline

Retrieved code is **untrusted**. We never `npm install`, `dotnet build`, run, or evaluate it. We only
read the files and run a pattern/dataflow analyzer (Semgrep) over them in a contained working
directory. No build steps, no package restore, no execution — this avoids supply-chain and
arbitrary-code-execution risk on the operator's machine.

## Retrieving code from Azure (read-only)

Source code/artifacts can be pulled read-only from several Azure surfaces. Use the platform's existing
read-only Azure tooling; never deploy or modify:

- **App Service / Functions (Kudu/SCM):** download the deployed site as a zip via the Kudu zip API
  (`GET https://<app>.scm.azurewebsites.net/api/zip/site/wwwroot/`) or `az webapp deploy`'s companion
  download paths. Requires that SCM access is available to the engagement identity.
- **Storage `$web` / artifact containers:** download the static site bundle or build artifacts
  (`azure-storage` read APIs). SPA bundles are the common DOM-XSS source.
- **Container images (ACR):** pull and unpack image layers to inspect app source/config (read-only).
- **Provided source:** if the customer supplies a repo/zip directly, use that instead of pulling.

Store everything under a temporary, gitignored working dir inside the engagement
(`engagements/<session>/static/<resource>/`) — `engagements/*` is already gitignored, so retrieved
code never enters the repo.

## Analysis with Semgrep

Run Semgrep **offline** against the retrieved tree:

```
semgrep --config p/owasp-top-ten --config p/secrets --config p/javascript \
        --json --output engagements/<session>/findings/raw/eva-sast.json \
        --error --timeout 120 engagements/<session>/static/<resource>/
```

Focus rule packs:

- **Injection sinks** (A03): SQL string concatenation, command exec, `innerHTML`/`eval` (DOM XSS sources).
- **Hardcoded secrets:** connection strings, keys, tokens, `DefaultEndpointsProtocol=...AccountKey=`.
- **Insecure patterns:** disabled TLS verification, weak crypto, insecure deserialization, SSRF-prone
  fetch helpers.
- **Azure-specific:** managed-identity misuse, secrets that should be in Key Vault, over-broad SAS.

Pin Semgrep rule versions where possible for deterministic results. If Semgrep is not installed, the
preflight reports the static-analysis tier as unavailable and EVA skips it (it does not fail the run).

## Mapping results to findings

Map Semgrep results to `CHK-EVA-020` (static analysis), OWASP per the matched rule (commonly A03/A05/
A02), and the relevant CWE. Emit to `engagements/<session>/findings/raw/external-vuln.jsonl`, ID prefix
`AZ-EVA-`. Include the file path (relative, redacted if it contains identifiers), the rule id, a short
code excerpt (redacted per `data_handling` — never include real secrets verbatim; mask them), and a
remediation. **De-duplicate**: one rule firing across N files of the same component is one finding with
an `affected_resources[]`/locations list.

## Safety

- **Never execute** retrieved code (no build, no install, no run, no scripts).
- Retrieved code lives only under the gitignored `engagements/<session>/static/...` and is deleted at
  engagement close per `data_handling.retention`.
- **Mask secrets** found in code in the finding evidence — record that a secret exists and where, not
  the secret value.
- Honor `data_handling` redaction for file paths, identifiers, and any embedded hostnames.
- This feature is **opt-in** and additive; with it disabled, EVA behaves exactly as before.
