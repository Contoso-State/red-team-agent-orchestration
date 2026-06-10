---
title: External Vulnerability Agent (EVA)
description: Gated, scope-locked active web testing of Azure-discovered URLs and public IPs.
---

# External Vulnerability Agent (EVA)

EVA is the **only** agent in this team that sends real traffic to live endpoints. It performs
outside-in validation of the **OWASP Top 10** against the URLs and public IPs that the other
agents already discovered in your Azure subscription, and can optionally run **offline** static
analysis of website code pulled from Azure.

:::{danger}
EVA is **off by default** and hard-gated. It is the one active capability in an otherwise
read-only template. Only enable it against assets you own or are **contractually authorized**
to test — active scanning of internet-facing systems may be illegal without written
authorization from the asset owner.
:::

## The scope lock (why EVA can't wander the internet)

EVA may only ever touch a host that maps back to an **in-scope Azure resource**. There is no
way to hand it a free-form target. This is enforced in depth, so a failure in any one layer is
caught by the next:

```{mermaid}
graph LR
    DB[(Engagement Datastore<br/>in-scope Azure resources)] --> BT[build-targets.mjs]
    BT --> AL[external-targets.json<br/>Azure-derived allowlist]
    AL --> EVA[EVA probes / scanners]
    EVA -->|every request| EG{egress guardrail<br/>egress-core.mjs}
    EG -->|host on allowlist + gate open| NET[(in-scope host)]
    EG -->|anything else| DENY[denied · fail closed]
```

1. **Allowlist generation** — `tools/external/build-targets.mjs` reads the engagement
   datastore and emits `engagements/<session>/scope/external-targets.json`. A host appears only
   because a specific in-scope Azure resource (App Service hostname, public IP, Front Door/CDN
   endpoint, Static Web App, API Management gateway, …) published it.
2. **Egress guardrail** — a second session-wide `preToolUse` matcher (`egress-core.mjs`,
   independent of the read-only guardrail) inspects every active-probe command — `curl`,
   `httpx`, `nuclei`, `zap*`, `sqlmap`, `nikto`, `whatweb`, `testssl`, `Invoke-WebRequest`,
   `Invoke-RestMethod` — including **every line of any scanner target-list file**, and **denies**
   it unless mode + authorization + allowlist all pass. It **fails closed**.
3. **Scope-locked wrappers** — scanners are launched only through
   `tools/external/Invoke-ScopedScan.ps1` (or the dependency-free Tier-1 `safe-prober.mjs`),
   which source their targets exclusively from the allowlist.

## The authorization gate

EVA stays completely inert unless **all** of the following are true:

| Requirement | Where | Why |
|---|---|---|
| `mode: external-active-testing` | `engagement.yaml` | Opts the whole engagement into active testing |
| `external_testing.enabled: true` | `engagement.yaml` | Master switch for EVA |
| `authorization.attested_by` **and** `attestation_id` set | `engagement.yaml` | A named human signed off, with a contract / change-ticket / RoE reference |
| Current time within authorized window | `engagement.yaml` (optional) | Confines testing to a permitted window |
| Non-empty `external-targets.json` | `engagements/<session>/scope/` | There is at least one in-scope external target |

If any precondition is missing, EVA is **not** dispatched — the `/external` command stops and
reports exactly what's missing.

## Intensity tiers

EVA always starts at the least intrusive tier and escalates only up to the configured
`external_testing.tier`:

| Tier | What it does | Tooling |
|---|---|---|
| `safe-active` | Benign GET/HEAD probes — security headers, TLS/ciphers, HTTP methods, cookie flags, CORS, exposed paths | Built-in, dependency-free `safe-prober.mjs` |
| `active-dast` | OWASP Top 10 DAST | OSS scanners via `Invoke-ScopedScan.ps1` — nuclei / OWASP ZAP / nikto / whatweb / testssl.sh / httpx |
| `exploit-validation` | Minimal, per-finding proof of a confirmed issue (e.g. injection/XSS) | sqlmap + targeted payloads — opt-in per finding, never destructive |

Intensity caps (`external_testing.limits` → `max_requests_per_host`, `rate_per_second`,
`concurrency`) bound the load so testing cannot affect production availability. Rules of
engagement: in-scope only, least intensity that proves the point, **no denial-of-service, no
data exfiltration, no lateral movement**.

## Offline static analysis (optional)

A **separate** opt-in (`external_testing.static_analysis.enabled: true`) lets EVA pull website
code read-only from Azure (App Service Kudu, Storage `$web`) into
`engagements/<session>/static/` and run `tools/external/Invoke-StaticAnalysis.ps1`. This is
**OFFLINE** — the retrieved code is scanned (Semgrep, OWASP + secrets rulesets) but **never
executed**, and no traffic is sent to the target. If the scanner isn't installed, the wrapper
degrades to a dry run.

## Running EVA — the `/external` command

```text
/external
```

The command, acting through the Orchestrator, will:

1. **Verify the gate** — re-read `engagement.yaml` and confirm every precondition.
2. **Build the allowlist** — `node tools/external/build-targets.mjs` → `external-targets.json`.
   If empty, it reports "no in-scope external targets" and stops.
3. **Dispatch EVA** at `safe-active`, escalating only up to the configured tier.
4. **Static analysis** (if enabled) — offline SAST of code pulled from Azure.
5. **Ingest findings** into the datastore.
6. **Report coverage** — finding counts by check/severity, the authorization reference, and
   which in-scope hosts were tested at which tier.

Findings are written to `engagements/<session>/findings/raw/external-vuln.jsonl` with the ID
prefix `AZ-EVA-` and are OWASP/CWE-mapped. The report generator renders an **External Active
Testing** banner (authorization reference, tier, window, offline-SAST status, external-finding
count) whenever the engagement used this mode.

## Knowledge base

EVA grounds its testing in dedicated knowledge pages: `knowledge/owasp-top10.md`,
`knowledge/web-vuln-testing.md`, `knowledge/xss.md`, and `knowledge/static-analysis.md`. Its
atomic, OWASP-mapped checks live in `checks/external-vuln/checks.yaml`.

See [Safety & Authorization](safety.md#active-external-testing-eva) for how EVA fits the overall
safety model.
