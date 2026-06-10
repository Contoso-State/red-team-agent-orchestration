# Entra ID / Identity Attack Techniques

Consolidated reference notes on Microsoft Entra ID (Azure AD) identity attack
techniques used by the **Identity Posture** and **Authorization & Attack Path**
agents. This is background knowledge; the read-only detections live in
`checks/identity/checks.yaml`, `checks/rbac/checks.yaml`, and their runners in
`tools/az-cli/identity.md` / `tools/az-cli/rbac.md`.

> **Attribution.** The methodology summarised here was *derived* from the
> Apache-2.0 project **mukul975/Anthropic-Cybersecurity-Skills** (pinned commit
> `04450304b12645cb2b974ab96d28c0664758a88d`). We harvested read-only commands,
> detection logic, and the `nist_csf` / `mitre_attack` control tags and
> re-expressed them in this repo's native structures. No upstream `SKILL.md`
> files or Python scripts were copied. See
> [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and
> [`ATTRIBUTION.md`](ATTRIBUTION.md) for the license notice and per-skill map.

---

## 1. Illicit consent grant / consent phishing

Attackers register (or compromise) a multi-tenant OAuth application and lure a
user — or a careless admin — into **consenting** to delegated Microsoft Graph
permissions. The grant yields a refresh token that survives password resets and
is **not** re-challenged by MFA, so it is both an initial-access and a
persistence primitive.

- **High-risk delegated scopes:** `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`,
  `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `offline_access`.
- **Tenant-wide blast radius:** a grant with `consentType == AllPrincipals`
  (admin consent) applies to every user, not just the consenter.
- **Tells:** unverified publisher, recently created app, redirect URIs on
  consumer domains, mismatch between app display name and requested scopes.
- **Detection:** enumerate `/oauth2PermissionGrants`, join to
  `/servicePrincipals`, and correlate `Consent to application` events in
  `/auditLogs/directoryAudits`. → `CHK-IDEN-ILLICIT-OAUTH-CONSENT`.
- **MITRE:** T1528 (Steal Application Access Token), T1550.001 (Application
  Access Token), T1566.002 (Spearphishing Link).

## 2. Service principal & application abuse

Service principals (the tenant-local instance of an app) are first-class
identities and a favourite for persistence and privilege escalation.

- **Additional cloud credentials (T1098.001).** Adding a new client secret or
  certificate to an existing privileged SP gives durable app-only access.
  Enterprise SPs that carry their *own* `passwordCredentials`/`keyCredentials`
  are worth scrutiny. → `CHK-IDEN-SP-EXTRA-CREDENTIAL`.
- **Application ownership = credential control.** An *owner* of an application or
  SP can mint credentials for it. A non-admin owning a privileged app is a hidden
  escalation path: compromise the owner → add a secret → authenticate as the
  privileged app. → `CHK-IDEN-APP-OWNER-NONADMIN`.
- **Over-privileged app (application) permissions.** Graph app roles such as
  `RoleManagement.ReadWrite.Directory`, `Directory.ReadWrite.All`,
  `Application.ReadWrite.All`, `AppRoleAssignment.ReadWrite.All` let a
  compromised app rewrite the directory. → `CHK-IDEN-APP-OVERPRIV-GRAPH`.
- **MITRE:** T1098.001, T1078.004 (Valid Accounts: Cloud), T1528.

## 3. Standing privilege vs PIM (just-in-time) gaps

Privileged Identity Management converts **permanent (active)** assignments into
**eligible** ones that must be activated with MFA, justification, and optional
approval. Standing privilege removes that gate and is an always-on target.

- **Entra directory roles.** Compare active assignments
  (`/roleManagement/directory/roleAssignments`) against eligible schedules
  (`/roleManagement/directory/roleEligibilityScheduleInstances`); flag privileged
  roles held active with no eligible schedule, beyond break-glass.
  → `CHK-IDEN-PRIV-ROLE-STANDING`.
- **Azure resource roles.** The same gap exists for Owner/Contributor/UAA at
  subscription / management-group scope versus PIM-for-Azure eligible schedules.
  → `CHK-RBAC-STANDING-PRIV-NO-PIM`.
- **Best practice:** ≤ 2 permanent Global Administrators (break-glass only);
  everything else eligible with ≤ 8 h activation, MFA, justification, approval.
- **MITRE:** T1078 (Valid Accounts), T1098 (Account Manipulation).

## 4. Weak / phishable authentication

- **Phishable MFA.** SMS, voice, and basic push are defeated by real-time
  (adversary-in-the-middle) phishing and MFA-fatigue prompting. Phishing-resistant
  methods — FIDO2 security keys, Windows Hello for Business, certificate-based
  auth, device-bound passkeys — bind the credential to the origin.
- **Enforcement.** A Conditional Access **authentication-strength** policy must
  require a phishing-resistant combination for privileged roles, and SMS/voice
  should be disabled in the authentication methods policy.
  → `CHK-IDEN-NO-PHISH-RESISTANT-MFA`.
- **Legacy authentication.** Basic-auth protocols (IMAP/POP/SMTP/MAPI,
  ActiveSync) bypass CA and MFA entirely. → `CHK-IDEN-LEGACY-AUTH`.
- **MITRE:** T1556 (Modify Authentication Process), T1621 (MFA Request
  Generation), T1110.003 (Password Spraying), T1078.004.

## 5. Federation & cross-tenant trust

- **Token-signing / federation abuse.** Control of a federation trust (e.g. a
  forged SAML token via a stolen token-signing key — the "Golden SAML" pattern)
  or an attacker-added federated domain lets an adversary mint authentication
  assertions for arbitrary users. Watch domain federation settings and added
  identity providers.
- **Workload identity federation (OIDC).** Federated credentials that trust an
  external IdP (GitHub Actions, Azure DevOps) are credential-free but only as
  safe as their `subject`/`issuer` trust conditions — broad trust = supply-chain
  entry. (Assessed by the supply-chain domain; cross-referenced here.)
- **Cross-tenant access policies** can permit inbound B2B access or SP sign-ins
  from partner tenants — a lateral-movement avenue in Azure that has no
  on-prem analogue.
- **MITRE:** T1484.002 (Domain/Tenant Policy Modification: Trust Modification),
  T1606.002 (Forge Web Credentials: SAML Tokens), T1199 (Trusted Relationship).

## 6. Credential compromise & identity lateral movement

Lateral movement in Entra ID pivots through tokens and identities rather than
SMB/RDP.

- **Indicators of compromised credentials.** Risky sign-ins
  (`/auditLogs/signIns` with `riskLevelDuringSignIn ne 'none'`), anonymized/Tor
  IPs, impossible travel, and `identityProtection/riskyUsers` (Entra ID
  Protection, P2). These are detection/monitoring signals — surfaced by the
  Logging & Coverage agent — not default read-only posture checks.
- **Managed identity token theft.** A workload compromise (RCE, SSRF, or VM
  `runCommand`) lets the attacker read a managed-identity token from the instance
  metadata endpoint (IMDS) and inherit whatever roles that identity holds.
  - Privileged **control-plane** roles on a compute MI →
    `CHK-RBAC-MI-PRIVILEGED-FROM-COMPUTE`.
  - **Data-plane** Key Vault / Storage roles on a compute MI (read secrets →
    harvest more credentials) → `CHK-RBAC-MI-DATA-PLANE-SECRETS`.
- **MITRE:** T1552.005 (Cloud Instance Metadata API), T1528, T1550.001,
  T1021.007 (Remote Services: Cloud Services), T1098.003 (Additional Cloud
  Roles), T1555.006 (Cloud Secrets Management Stores).

---

## Read-only tooling notes

All commands referenced above are read/query only (`az ... list/show`,
`az ad ... list/show`, `az rest --method GET` against Microsoft Graph or ARM).
They are keyed by check ID in `tools/az-cli/identity.md` and
`tools/az-cli/rbac.md` and pass the `redteam-guardrails` allowlist.

Third-party assessment tools mentioned in the upstream material — **ScoutSuite**
(multi-cloud auditor), **AzureADRecon**, **Microsoft Defender for Identity**, and
**Microsoft Entra ID Protection** — are noted here for completeness only. They
are *not* wired into any default runner and would require their own
authorization, dependencies, and (for active recon tooling) the gated external
testing lane.

## Cross-references

- `knowledge/azure-attack-matrix.md` — ATT&CK-for-cloud technique map.
- `controls/nist-csf.yaml` — NIST CSF 2.0 subcategory mapping for the checks above.
- `controls/mitre-cloud.yaml` — MITRE ATT&CK control mapping.
- `agents/identity-posture/system-prompt.md`,
  `agents/authorization-attack-path/system-prompt.md` — agent methodology.
