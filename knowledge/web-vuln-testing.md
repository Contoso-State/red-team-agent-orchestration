# Web Vulnerability Testing — Safe, Scoped Procedures

How EVA tests in-scope Azure-fronted web endpoints **safely**. Every target here is assumed to be on
the Azure-derived allowlist; the egress guardrail enforces that independently. Procedures are ordered
from least to most intrusive — always start at Tier 1.

## Operating principles

- **Least intensity that proves the point.** A single confirming request beats a scan; a scan beats a
  fuzz; a fuzz beats an exploit.
- **Non-destructive by default.** No DoS, no volumetric traffic, no destructive payloads, no data
  exfiltration beyond a benign marker.
- **Respect budgets.** Honor `external_testing.limits` (`max_requests_per_host`, `rate_per_second`,
  `concurrency`). When in doubt, throttle.
- **Evidence + redaction.** Capture the request line, key response headers, and a minimal body
  excerpt; redact per `data_handling` (hosts, tokens, cookies, PII).

## Tier 1 — `safe-active` (benign, unauthenticated)

Run `tools/external/safe-prober.mjs`. Dependency-free; self-scoping to the allowlist. It performs a
small number of benign requests per host and analyzes the responses:

- **Security headers** — presence/quality of CSP, HSTS, X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy, Permissions-Policy. (`CHK-EVA-001`)
- **Information disclosure** — `Server`, `X-Powered-By`, `X-AspNet-Version` banners; verbose errors.
  (`CHK-EVA-002`)
- **Cookies** — `Secure`, `HttpOnly`, `SameSite` flags on any Set-Cookie. (`CHK-EVA-003`)
- **CORS** — reflect an `Origin` and check for `Access-Control-Allow-Origin: *` or origin reflection
  with credentials. (`CHK-EVA-004`)
- **HTTP methods** — `OPTIONS` to enumerate allowed methods; flag TRACE/PUT/DELETE. (`CHK-EVA-005`)
- **TLS** — negotiated version, cipher, certificate validity/expiry. (`CHK-EVA-006`)
- **HTTP→HTTPS** — request `http://` and confirm a redirect to `https://`. (`CHK-EVA-007`)

Tier 1 is on whenever EVA is enabled and authorized. It is the safe baseline.

## Tier 2 — `active-dast` (automated scanners)

Only when the engagement's `external_testing.tier` is `active-dast` or higher. Launch **only** through
`tools/external/Invoke-ScopedScan.ps1`, which materializes the target list from the allowlist and
scopes the scanner to it. Never invoke scanners with hand-typed targets.

- **Fingerprinting** — `whatweb`, `httpx` (titles, tech, status). Feeds A06.
- **Templated vuln scan** — `nuclei` with default + known-CVE/misconfig templates. (`CHK-EVA-010`)
- **TLS deep scan** — `testssl.sh` for protocol/cipher/cert detail. (augments `CHK-EVA-006`)
- **Web server checks** — `nikto` for legacy/dangerous defaults. (augments `CHK-EVA-005`/`013`)
- **Active web scan** — `zap-baseline.py` (passive+light active). XSS/injection leads → `CHK-EVA-011/012`.
- **Content discovery** — bounded wordlist against the host to find exposed paths (`.git/`, `.env`,
  backups, swagger). (`CHK-EVA-013`) Keep it bounded; this is not a brute-force.

Tune scanners to the engagement rate limits. Prefer their built-in `-rate-limit`/`-c` flags.

## Tier 3 — `exploit-validation` (opt-in, per finding)

Only for a **specific, already-confirmed** finding, with explicit per-finding approval. Goal: prove
impact with the *minimum* necessary action.

- **XSS** — a harmless `alert(document.domain)`/marker payload reflected and executed; screenshot/DOM
  evidence. No data theft, no persistence beyond proving reflection.
- **SQLi** — confirm with a boolean or benign error-based probe; never `DROP`/`DELETE`, no mass
  extraction, avoid heavy time-based payloads.
- **SSRF** — point at an operator-controlled in-scope canary; demonstrate the server makes the request.
  For Azure IMDS, demonstrate reachability of `169.254.169.254`; do **not** actually exfiltrate a
  managed-identity token (note the *potential* and hand off to the authorization agent).
- **Broken access control** — access one object you shouldn't (a single ID), capture the response,
  stop. No bulk enumeration of other users' data.

## SQL/NoSQL injection notes (`CHK-EVA-012`)

Start with detection, not extraction. A single quote / boolean pair (`' OR '1'='1` vs `' OR '1'='2`)
or a benign type-confusion (`?id=1` vs `?id=1 AND 1=1`) to observe differential responses is enough to
flag. Escalate to proof only under Tier 3 with approval, and only enough to confirm — never dump tables.

## Reporting

Emit each finding to `engagements/<session>/findings/raw/external-vuln.jsonl`, ID prefix `AZ-EVA-`,
with: target host/URL, check_id, OWASP/CWE mapping, the tier used, redacted request/response evidence,
and a remediation. **Aggregate** one issue across N endpoints into a single finding with an
`affected_resources[]` list. Always cross-reference the originating Azure resource and any related
web-exposure / authorization control-plane finding — and raise severity when findings chain.
