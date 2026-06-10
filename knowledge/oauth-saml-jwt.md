# OAuth 2.0 / OIDC, JWT, and SAML Federation — Attack Methodology (EVA-gated)

How the **External Vulnerability Agent (EVA)** assesses internet-facing authentication and
federation surfaces — OAuth 2.0 / OpenID Connect endpoints, JWT-based session/bearer tokens, and
SAML Service-Provider (ACS) endpoints — that were discovered on in-scope Azure resources.

> **⚠️ EVA-gated, scope-locked, authorization-required.** Everything in this file that sends real
> traffic is **active testing**. It runs **only** when *all* of the following hold (see
> `agents/external-vuln/system-prompt.md`):
> - `engagement.yaml` → `mode: external-active-testing`
> - `external_testing.enabled: true` with a signed `authorization` (`attested_by` + `attestation_id`)
> - inside the authorized time window (if set)
> - the target host is on the Azure-derived allowlist `engagements/<session>/scope/external-targets.json`
>
> The `redteam-guardrails` egress hook enforces this **fail-closed**: any probe to a host that is not
> on the allowlist is denied, even in the right mode. In every other mode EVA is **inert** and this
> material is reference knowledge only. Test only what the Rules of Engagement (ROE) authorize, at the
> **least intensity that proves the point**, never destructively, and never exfiltrating real data
> beyond a benign marker.

> **Derivation / attribution.** The methodology below was *harvested and re-expressed* from the
> Apache-2.0 project [mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills)
> (pinned commit `04450304b12645cb2b974ab96d28c0664758a88d`) — specifically the
> `exploiting-oauth-misconfiguration`, `testing-oauth2-implementation-flaws`,
> `exploiting-jwt-algorithm-confusion-attack`, `testing-jwt-token-security`, and
> `building-identity-federation-with-saml-azure-ad` guides. We did **not** copy their `SKILL.md` files
> or Python; we re-expressed the technique knowledge in this repository's structure. See
> [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and [`knowledge/ATTRIBUTION.md`](ATTRIBUTION.md).

## What EVA does vs. what it does not

EVA is an **external** tester. It validates how a publicly-reachable auth endpoint *behaves* when sent
crafted-but-benign requests. It does **not**:

- Touch the Entra ID / AD FS control plane, steal token-signing keys, or modify federation trust —
  that is **identity / authorization** territory and is **read-only** there (see
  `knowledge/entra-attack-techniques.md`). EVA correlates with, but never performs, those control-plane
  actions.
- Brute-force secrets online, run volumetric traffic, or perform DoS.
- Pull real user data; a successful auth-bypass is proven with a **benign marker** (e.g. reading the
  caller's *own* `/me`-style identity endpoint with a forged-but-unprivileged token) and then handed off.

Azure relevance: these surfaces commonly sit behind **App Service / Functions, API Management, Front
Door / CDN, Static Web Apps, or container apps**, with **Microsoft Entra ID** (or AD FS / a third-party
IdP) as the issuer. An external auth bypass here frequently chains with control-plane findings
(over-broad app registration scopes, missing Conditional Access) raised by the identity agent.

---

## 1. OAuth 2.0 / OpenID Connect misconfiguration

OWASP **A07:2021** (Identification & Authentication Failures), **A01:2021** (Broken Access Control —
scope escalation), **A05:2021** (Security Misconfiguration). Mapped to **`CHK-EVA-021`**.

### 1.1 Map the flow (recon, Tier 1 / `safe-active`)

Benign, unauthenticated discovery only:

- Fetch `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server` to learn the
  `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, `jwks_uri`,
  `grant_types_supported`, `scopes_supported`, and `code_challenge_methods_supported`.
- Identify the grant type from `response_type` (`code` = authorization-code, `token` = implicit,
  `code token` = hybrid) and whether **PKCE** (`code_challenge` / `code_challenge_method=S256`) is used.

### 1.2 Redirect-URI validation (Tier 2 / `active-dast`)

The classic OAuth token-theft primitive (CWE-601). Send authorization requests with a tampered
`redirect_uri` and observe whether the server *accepts* it (issues a code / 302s to it). Probe, in
order of subtlety, for matching that is **not** exact-string:

- different domain; attacker subdomain (`app.example.com.evil.test`); userinfo confusion
  (`app.example.com@evil.test`); path traversal (`/callback/../../evil`); appended query/fragment
  (`/callback?next=…`, `/callback#…`); case variations; `http://` downgrade; explicit/alternate ports;
  path-prefix match (`/callbackevil`).

A redirect to any attacker-influenced location while a `code=`/`access_token=` is present is a finding.
**Do not** complete the theft against a real user — demonstrate that the server *would* emit the
credential to a non-registered URI, then stop.

### 1.3 CSRF / `state` and PKCE (Tier 2)

- **Missing/weak `state`** (CWE-352): request authorization with `state` removed, fixed, or sequential.
  Note that final `state` validation is *client-side* — flag that the callback handler must verify it.
- **PKCE bypass** (CWE-287): check whether a code can be exchanged at the token endpoint with **no**
  `code_verifier`, a **wrong** verifier, or a downgraded `plain` `code_challenge_method`. Public/mobile
  clients without enforced S256 PKCE are vulnerable to code interception.

### 1.4 Scope escalation & token handling (Tier 2)

- **Scope escalation** (CWE-863): request scopes beyond what the client is registered for
  (`…+admin`, `write:*`, `*`) and see if the authorization server grants them without consent.
- **Authorization-code replay** (CWE-384-adjacent): exchange the same code twice — codes must be
  single-use with a short TTL.
- **Audience/binding**: a token minted for client A accepted by client B's API ⇒ missing `aud`
  validation; a refresh token usable under a *different* `client_id` ⇒ not client-bound.
- **Implicit flow enabled**: `response_type=token` returning a token in the URL fragment is
  deprecated and leaks via Referer/history.
- **Client-secret exposure** (CWE-200 / CWE-615): grep externally-served JS bundles for `client_secret`.

### 1.5 Account takeover patterns (knowledge / correlate — *do not* execute against real users)

Unverified-email account linking, pre-auth linking, and CSRF on `/oauth/link` can yield victim-account
takeover. These require a victim and are **out of bounds** for unattended EVA runs; document the
*condition* (e.g. linking trusts an unverified email) and hand off.

> MITRE: **T1190** (Exploit Public-Facing Application), **T1528** (Steal Application Access Token),
> **T1550.001** (Use Alternate Authentication Material: Application Access Token), **T1539** (Steal Web
> Session Cookie).

---

## 2. JWT token security & algorithm confusion

OWASP **A02:2021** (Cryptographic Failures), **A07:2021**, **A01:2021**. Mapped to **`CHK-EVA-022`**.

> **Intensity note.** *Detection* uses a forged token carrying the caller's **own, unmodified** claims
> (a benign marker) purely to observe whether the server **accepts** it (Tier 2 / `active-dast`).
> *Forging privileged claims* (e.g. `role=admin`) to prove impact is **Tier 3 / `exploit-validation`**
> and requires explicit per-finding approval — minimal, never bulk, never against real users' data.

### 2.1 Decode & analyze (Tier 1)

Base64url-decode the header and payload (never paste production tokens into online decoders). Record
`alg`, `kid`, `jku`, `x5u`, `typ`; and payload claims `sub`, `role`/permissions, `iss`, `aud`, `exp`,
`nbf`, `iat`. Flag sensitive data (PII, internal IDs) carried in the payload.

### 2.2 `alg: none` bypass (CWE-347)

Set the header algorithm to `none` (and case variants `None`/`NONE`/`nOnE`, or omit `alg`) with an
empty signature, leaving claims unchanged. If the server accepts it, signature verification is being
skipped — authentication bypass.

### 2.3 Algorithm confusion RS256 → HS256 (CWE-347 / CWE-345)

When the server verifies RS256, fetch its **public** key (from `jwks_uri`, the OIDC config, or a
public-key path), then sign a token with **HS256 using that public key as the HMAC secret**. A library
that trusts the header `alg` will HMAC-verify with the public key and accept the forgery. Try multiple
public-key encodings (full PEM, stripped, no-newline, base64 body) — formatting is the usual reason a
first attempt fails. EdDSA/Ed25519 and server-side algorithm allowlisting eliminate this class.

### 2.4 Weak HMAC secret (CWE-321)

For HS256 tokens, the signing secret may be a dictionary word. This is an **offline** crack
(`hashcat -m 16500`, `jwt_tool -C`, John) against a *captured* token — no traffic to the target during
cracking. Online guessing against the live endpoint is **not** permitted (volumetric / lockout risk).

### 2.5 Header-injection key control (CWE-347)

- **`jku` / `x5u` injection**: header points the verifier at an attacker-hosted JWKS / cert URL;
  test URL-filter bypasses (`@`, fragment tricks). For EVA, callbacks may target **only** an
  operator-controlled, in-scope canary.
- **`kid` injection**: the Key-ID is used in a file lookup or SQL query — path traversal
  (`../../dev/null` ⇒ empty/known key) or SQLi (`' UNION SELECT 'secret' --`) lets the attacker control
  the verification key.

### 2.6 Claim & lifetime validation

Confirm the server validates `iss`/`aud`/`exp`/`nbf`; test **expired-token** acceptance and
**far-future `exp`**; test token reuse **after logout / password change** (missing server-side
revocation, CWE-613). Exposed signing material found in code maps to CWE-798/CWE-321 and **T1552.001**.

> MITRE: **T1190**, **T1606** (Forge Web Credentials), **T1552.001** (Unsecured Credentials: Credentials
> In Files).

---

## 3. SAML 2.0 federation attacks

OWASP **A07:2021**, **A08:2021** (Software & Data Integrity Failures), **A05:2021**. EVA's *external*
remit is limited to the publicly-reachable **Service Provider / Assertion Consumer Service (ACS)**
endpoints on the allowlist (commonly an Entra-fronted enterprise app, or an app federated to AD FS / a
third-party IdP). Token-signing-key theft and federation-trust modification are **control-plane,
read-only** concerns owned by the identity / authorization agents — knowledge here, not EVA actions.

### 3.1 Assertion signature handling (CWE-347 / CWE-345)

The highest-impact external class. Against the ACS, test whether the SP enforces XML signatures:

- **Signature stripping / unsigned-assertion acceptance**: remove the `<ds:Signature>` and see if the
  assertion is still trusted.
- **XML Signature Wrapping (XSW)**: relocate/duplicate signed elements so the SP validates a signature
  over one element but consumes attributes/`NameID` from an injected, unsigned one.
- **Assertion vs. response signing confusion**: a signed *response* wrapping an unsigned, tampered
  *assertion* (or vice-versa).
- **Certificate confusion**: a self-signed cert substituted where the SP fails to pin the IdP's
  token-signing certificate.

### 3.2 Assertion content manipulation (CWE-290)

Where signing is broken/absent, tamper with `NameID` (incl. XML-comment-injection truncation, e.g.
`admin<!--x-->@corp.test`), `Audience`/`Recipient`/`Destination` (test acceptance for the wrong SP),
and authorization attributes/group claims.

### 3.3 Replay & conditions

Test missing `NotOnOrAfter` / `OneTimeUse` enforcement — a captured assertion replayed within/after its
window indicates weak condition validation.

### 3.4 XML parser abuse (CWE-611)

SAML is XML; test the ACS for **XXE** and billion-laughs-style entity expansion in the posted
`SAMLResponse` (benign, non-amplifying probes only — never a DoS payload).

### 3.5 Federation-trust context (knowledge / correlate — NOT executed by EVA)

For situational awareness only — these are **read-only** identity/authorization concerns:

- **Golden SAML** (**T1606.002**): an attacker who has stolen the AD FS / IdP **token-signing private
  key** forges arbitrary SAML assertions and impersonates any user to any federated SP, bypassing MFA.
  Detection is control-plane (key custody, ADFS Event 307, anomalous sign-ins), not external probing.
- **Federation-trust modification** (**T1484.002**, **T1556.007**): adding a rogue federated domain or
  altering `issuerUri` / token-signing cert via `New-MgDomainFederationConfiguration` /
  `Set-AdfsRelyingPartyTrust` lets an attacker mint trusted tokens. Audit federated domains and
  relying-party trusts read-only.
- Weak claims rules, missing extranet/smart lockout, and expiring token-signing certs are hardening
  gaps surfaced by the identity and web-exposure agents.

> MITRE: **T1606.002** (Forge Web Credentials: SAML Tokens / Golden SAML), **T1556.007** (Modify
> Authentication Process: Hybrid Identity), **T1484.002** (Domain Policy Modification: Trust
> Modification), **T1078.004** (Valid Accounts: Cloud Accounts), **T1199** (Trusted Relationship).

---

## Mapping to checks & reporting

| Surface | Check | Tier | OWASP |
|---|---|---|---|
| OAuth2/OIDC authorization-flow weaknesses | `CHK-EVA-021` | `active-dast` | A07:2021 |
| JWT signature/algorithm validation weaknesses | `CHK-EVA-022` | `active-dast` (proof → `exploit-validation`) | A02:2021 |

Emit findings to `engagements/<session>/findings/raw/external-vuln.jsonl`, ID prefix `AZ-EVA-`, each
with: the target host/endpoint, the `check_id`, the OWASP/CWE/MITRE mapping, the tier used, and
**redacted** request/response evidence per `data_handling` (never record real tokens, codes, secrets,
assertions, or PII — mask them; record that they exist and where). **Aggregate** one issue across N
endpoints into a single finding with an `affected_resources[]` list, and **cross-reference** the
originating Azure resource and any related identity / web-exposure control-plane finding — raising
severity when an external bypass chains with a control-plane weakness.

## Consolidated references

- **OWASP Top 10 (2021):** A01 (Broken Access Control), A02 (Cryptographic Failures), A05 (Security
  Misconfiguration), A07 (Identification & Authentication Failures), A08 (Software & Data Integrity
  Failures).
- **CWE:** CWE-287, CWE-290, CWE-345, CWE-347, CWE-352, CWE-384, CWE-601, CWE-613, CWE-611, CWE-798,
  CWE-863, CWE-321, CWE-200/CWE-615.
- **MITRE ATT&CK:** T1190, T1528, T1550.001, T1539, T1606, T1606.002, T1552.001, T1556.007, T1484.002,
  T1078.004, T1199.
- **Standards:** RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), RFC 8252 (OAuth for native apps), RFC 7519
  (JWT), RFC 8725 (JWT BCP), OASIS SAML 2.0.
