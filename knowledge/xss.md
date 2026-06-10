# Cross-Site Scripting (XSS) — Testing Reference

How EVA tests for XSS on in-scope, Azure-fronted endpoints **safely**. XSS is the canonical OWASP A03
injection issue on the web edge. All targets must be on the Azure-derived allowlist; the egress
guardrail enforces this independently.

## Types

- **Reflected** — input echoed straight back in the response (search boxes, error messages, query
  params reflected into HTML). Most common to find from the outside.
- **Stored** — input persisted and later rendered to other users (comments, profiles, names). Higher
  impact; test only with benign markers and clean up if you can.
- **DOM-based** — the sink is client-side JavaScript (`innerHTML`, `document.write`, `location`,
  `eval`) acting on attacker-controllable source (`location.hash`, `location.search`, `postMessage`).
  Requires reading the page's JS, not just the server response.

## Safe detection workflow

1. **Find reflection points.** Map parameters, headers, and path segments that appear in responses.
   `httpx`/`whatweb` for tech context; manual or `zap-baseline.py` for reflection discovery.
2. **Probe with a unique marker, not a payload.** Send a benign canary like `zzxss1234` and grep the
   response. If it reflects, note *where* (HTML body, attribute, script context, URL) — context
   determines exploitability.
3. **Test context-breaking characters benignly.** See whether `<`, `>`, `"`, `'` are encoded or pass
   through. Output-encoded ⇒ likely safe; raw passthrough into an HTML/JS context ⇒ likely vulnerable.
4. **Confirm (Tier 3 only, with approval).** Use the *minimum* harmless proof:
   `"><svg onload=alert(document.domain)>` or `<script>alert(document.domain)</script>` — enough to
   demonstrate execution. Capture a screenshot/DOM snapshot. **No** cookie theft, **no** beaconing to
   external collectors, **no** keylogging, **no** persistence beyond proving the issue.

## Context matters

| Reflection context | Example sink | Safe confirm payload (Tier 3) |
|---|---|---|
| HTML body | `<div>INPUT</div>` | `<svg onload=alert(document.domain)>` |
| HTML attribute | `value="INPUT"` | `"><svg onload=alert(1)>` |
| JS string | `var x = 'INPUT'` | `';alert(document.domain)//` |
| URL / href | `href="INPUT"` | `javascript:alert(document.domain)` (note only) |

Always prefer `alert(document.domain)` so the screenshot proves *which* in-scope host executed it.

## DOM XSS

Read the client JS (allowed — it's served by an in-scope host). Trace **source → sink**: does
`location.hash`/`location.search`/`postMessage` data reach `innerHTML`/`document.write`/`eval`/
`setAttribute('href', …)` without sanitization? Confirm by setting the fragment to a benign marker and
observing the DOM. This needs a browser/headless context, not just curl.

## What EVA must NOT do

- No stealing real users' cookies/sessions or tokens.
- No exfiltrating data to any external (out-of-scope) host or collector.
- No mass/persistent payloads (no spraying stored XSS across many records).
- No social-engineering or phishing using a found XSS.
- Stop and report if a payload appears to affect real users or production data.

## Azure-specific notes

- **Static Web Apps / Storage `$web`** often serve SPA bundles — DOM XSS is the likely class; review
  the bundled JS for unsafe sinks.
- **App Service / Functions** behind Front Door — confirm whether the WAF (owned by web-exposure)
  blocks the payload; a finding that the WAF *doesn't* block is itself valuable. Note WAF presence in
  the evidence and correlate with the web-exposure finding.
- **Reflected XSS + permissive CORS** (`CHK-EVA-004`) or **+ SSRF** (`CHK-EVA-014`) can chain — raise
  severity and hand the chain to the authorization / attack-path agent.

## Reporting

Emit to `engagements/<session>/findings/raw/external-vuln.jsonl` as `CHK-EVA-011`, ID prefix
`AZ-EVA-`, OWASP A03 / CWE-79. Record the reflection context, the benign proof used, the tier, and
redacted evidence. Aggregate one XSS class across N endpoints into a single finding.
