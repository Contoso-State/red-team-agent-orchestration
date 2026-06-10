# OWASP Top 10 (2021) — External Testing Field Reference

A practical map of the OWASP Top 10 to **what EVA tests from the outside** against in-scope Azure
endpoints, why each matters, and the check that records it. EVA only ever targets hosts on the
Azure-derived allowlist (`engagements/<session>/scope/external-targets.json`).

## A01 — Broken Access Control
The most impactful category. From the outside, look for endpoints reachable without authentication
that should require it, IDOR (object IDs you can increment/swap), forced browsing to admin or API
routes, and missing function-level authorization. On Azure this often means a Static Web App
"protected" route served anyway, an APIM API published without a subscription key, or an App Service
app endpoint with no auth in front.
→ `CHK-EVA-015` (IDOR / missing authz), correlate with `CHK-EVA-013` (sensitive paths).

## A02 — Cryptographic Failures
Cleartext transport and weak crypto in transit. Test for HTTP that isn't redirected to HTTPS, TLS
< 1.2, weak cipher suites, expired/mis-bound certificates, and missing HSTS. Azure edges (Front Door,
App Gateway, App Service custom domains) frequently allow legacy TLS or skip the HTTP→HTTPS redirect.
→ `CHK-EVA-006` (TLS/cert), `CHK-EVA-007` (HTTP-not-redirected). HSTS lives in `CHK-EVA-001`.

## A03 — Injection
Untrusted input reaching an interpreter: SQL/NoSQL injection, command injection, and (reflected/DOM)
XSS. Test with safe, non-destructive payloads first; never run destructive SQLi (no stacked
`DROP`/`DELETE`, no time-based payloads that hammer the DB). XSS is its own deep topic — see `xss.md`.
→ `CHK-EVA-011` (XSS), `CHK-EVA-012` (SQL/NoSQL injection).

## A04 — Insecure Design
A design-level category, hard to prove with a single external probe. EVA surfaces *symptoms*
(missing rate limits enabling enumeration, lack of anti-automation on sensitive flows) and defers the
root-cause design judgment to the report narrative. No standalone check; note as context on related
findings.

## A05 — Security Misconfiguration
The bread and butter of safe external testing. Missing/weak security headers (CSP, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS), verbose error pages, server/
framework version disclosure, directory listing, dangerous HTTP methods (TRACE/PUT/DELETE), permissive
CORS, and exposed sensitive paths (`.git/`, `.env`, `/actuator`, backups, swagger in prod).
→ `CHK-EVA-001` (headers), `CHK-EVA-002` (disclosure), `CHK-EVA-004` (CORS), `CHK-EVA-005` (methods),
`CHK-EVA-013` (sensitive paths).

## A06 — Vulnerable and Outdated Components
Known-CVE components and frameworks exposed at the edge. Fingerprint with `whatweb`/`httpx` and run
`nuclei`'s known-vuln/CVE and technology templates against in-scope hosts only. Treat version banners
as leads, confirm exploitability conservatively.
→ `CHK-EVA-010` (nuclei templates), informed by `CHK-EVA-002` (version disclosure).

## A07 — Identification and Authentication Failures
Weak session and auth handling observable externally: session cookies without `Secure`/`HttpOnly`/
`SameSite`, predictable tokens, missing brute-force protection, and credentials accepted over HTTP.
EVA does **not** brute-force credentials or attempt account takeover; it observes cookie/session
hygiene and reports anti-automation gaps.
→ `CHK-EVA-003` (insecure cookies); session weaknesses noted alongside.

## A08 — Software and Data Integrity Failures
Insecure deserialization, unsigned/auto-update supply chain, and untrusted CI/CD artifacts. Mostly
out of external scope; the **devops-supplychain** agent owns the control-plane angle. EVA contributes
only when an externally observable integrity issue exists (e.g., SRI missing on third-party scripts) —
note as context, no dedicated check.

## A09 — Security Logging and Monitoring Failures
Not externally testable in a benign way. Owned by the **logging-coverage** agent (control plane). EVA
does not probe for it.

## A10 — Server-Side Request Forgery (SSRF)
A user-controllable fetch on the server that can be pointed at internal resources. On Azure the
crown-jewel target is the **Instance Metadata Service (`169.254.169.254`)**, which can yield managed-
identity tokens. Test SSRF only with an operator-controlled, in-scope canary; demonstrate reachability,
never weaponize toward third parties or actually exfiltrate tokens.
→ `CHK-EVA-014` (SSRF, incl. Azure IMDS awareness).

## Severity guidance
Map to the engagement severity model (`knowledge/severity-model.md`): exploitable A01/A03/A10 with
real impact → High/Critical; A05 header/config gaps → Low/Medium unless they enable a chain; A02 weak
TLS → Medium (High if cleartext credentials). Always raise severity when an external finding **chains**
with an Azure control-plane finding (e.g., SSRF + a managed identity with broad RBAC).
