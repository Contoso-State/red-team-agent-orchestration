# Meeting Packet - 2026-05-28 - Kristen - SSPR for WHfB Project

## Meeting Info
- **Date:** 2026-05-28
- **Account:** nys-osc
- **Type:** Discovery
- **Attendees:** TBD

## Decision & Outcome
- **Single decision needed:** Agree on SSPR authentication method strategy for OSC's BYOD-restricted environment
- **Best-case outcome:** OSC agrees to pilot hardware OATH tokens + voice + email OTP as the SSPR method combo for WHfB rollout
- **Fallback outcome:** Schedule a follow-up workshop to design SSPR + WHfB PIN reset architecture with hands-on demo

## Current State Delta
1. Kristen re-raised the SSPR/Authenticator concern - same premise as 5/21 question
2. need to definitively close this out

## Priority Pains
1. Cannot require Authenticator on personal devices
2. team believes Authenticator is the only SSPR option (incorrect)
3. WHfB rollout blocked on SSPR design decision

## Proof Required
- **Proof to show:** Definitive list of SSPR methods with GA/preview status; concrete BYOD-restricted pattern; clear separation between SSPR and WHfB PIN reset
- **Evidence ready:** 5/21 prior Q&A response; SSPR methods matrix; hardware OATH vendor list (Token2/Yubico/FEITIAN/Thales)

## Objections & Risk
- **Likely objections:**
- Hardware OATH token rollout cost/logistics
- voice call SSPR reliability with their PBX
- Microsoft Authenticator-only assumption already baked into project plan
- **Competitive risk:** None
- **Execution risk:** Medium

## Commitments
- **Customer commitment needed:** Kristen - confirm desk phone / Teams Phone coverage for voice SSPR; identify hardware token budget owner
- **Microsoft commitment:** AG - deliver hardware OATH provisioning runbook + WHfB PIN reset architecture diagram within 1 week

## Agenda
1. Confirm desired decision and success criteria
2. Review changed conditions and risk blockers
3. Walk through technical proof and open objections
4. Lock owners, dates, and next milestone

## Live Notes

---

# 📋 PRE-MEETING BRIEFING — Kristen's SSPR Question

## ⚡ 60-Second Talk Track (lead with this)

> **Kristen — the premise that "Authenticator is the only SSPR method" is incorrect.** Microsoft Entra SSPR supports **six methods** today, and three of them require **zero personal-device dependency**: voice call to a desk phone, email OTP, and hardware OATH tokens. The OSC use case is fully supported — we just need to flip on the right methods in tenant policy. Separately, **Windows Hello for Business PIN reset is a different system** (Microsoft PIN Reset Service), not SSPR — same no-personal-device methods apply there too. SSPR will be very beneficial to OSC employees.

---

## The SSPR Methods Matrix (verified April 2026)

| Method | SSPR? | Status | Personal Device? | Notes |
|---|---|---|---|---|
| **Voice call → office phone** | ✅ | **GA** | **❌ No** | Desk phone, Teams Phone DID, Cisco/Avaya PSTN. User presses # |
| **Email OTP** | ✅ | **GA** | **❌ No** | Use **alternate/personal email** to avoid circular lockout if M365 is down |
| **Hardware OATH tokens** | ✅ | **⚠️ Public Preview** | **❌ No** | Physical token (Thales OTP 110, FEITIAN, Token2) — best phishing-resilient option without personal device |
| **Software OATH tokens** | ✅ | GA | Configurable | Can install on a **work-managed** laptop/device |
| **SMS** | ✅ | GA | ✅ Yes (mobile) | Skip — BYOD conflict |
| **Microsoft Authenticator** | ✅ | GA | ✅ Yes (mobile) | Skip — BYOD conflict |
| **Security questions** | ✅ | **⚠️ RETIRING March 2027** | No | Do **not** design around these |
| **FIDO2 keys / passkeys / TAP / CBA** | **❌ No SSPR support** | N/A | — | Phishing-resistant methods are for sign-in/MFA only — not SSPR. **No roadmap to change this.** |

**Source citations:**
- Master methods table: https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-methods
- SSPR how it works: https://learn.microsoft.com/en-us/entra/identity/authentication/concept-sspr-howitworks#authentication-methods
- Hardware OATH (preview): https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-oath-tokens#hardware-oath-tokens-preview
- Voice/office phone: https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-phone-options

---

## ⭐ Recommended OSC Stack (the answer to Kristen)

**Enable 3 methods. Require 2 for SSPR.**

| Layer | Method | Why |
|---|---|---|
| Primary | **Voice call → Office Phone** | Universal — every OSC employee has a desk phone or Teams DID. Pre-register from AD `telephoneNumber` attribute (syncs to Entra `officePhone`). No license cost. |
| Primary | **Email OTP → alternate personal email** | Backup if user is in office and can't take call. Must be personal/non-corp email — corporate email creates circular lockout |
| High-assurance | **Hardware OATH token (preview)** | For privileged users or as device-free phishing-resistant primary. Self-service activation via mysignins.microsoft.com |
| Helpdesk backstop | **Temporary Access Pass (TAP)** | Time-limited admin-issued credential when all methods fail — trains helpdesk away from password-reset-for-user pattern |

**Policy settings to recommend:**
- SSPR: enabled
- Number of methods required: **2**
- Registration: Required at sign-in
- Pre-registration: pull office phone from AD/HR (no user action needed for voice method)

---

## 🔑 WHfB PIN Reset — The Critical Clarification

**WHfB PIN reset ≠ SSPR.** Different system entirely.

| If user… | They use… | Methods accepted |
|---|---|---|
| Forgot Entra/AD password | **SSPR** | The 6 methods above |
| Forgot Windows Hello PIN | **Microsoft PIN Reset Service** | Any Entra MFA method — password, FIDO2 key, voice call, hardware OATH, another WHfB credential |

**Two PIN reset modes:**
- **Destructive** (default, no config) — deletes WHfB container, re-provisions
- **Non-destructive** (recommended for OSC) — preserves keys, only PIN changes
  - Requires: 2 Microsoft app registrations + Intune policy `EnablePinRecovery = True`
  - App IDs: `b8456c59-1230-44c7-a4a2-99b085333e84` + `9115dd05-fad5-4f9c-acc7-305d08b1b04e`
  - Verify with `dsregcmd /status` → `CanReset: DestructiveAndNonDestructive`

**Key point for OSC:** A user with a hardware OATH token + voice-call-to-desk-phone can reset both their password (SSPR) AND their WHfB PIN — no personal device required.

Source: https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/hello-feature-pin-reset

---

## 🛡️ Answering Likely Objections

### Obj 1: "Hardware OATH token rollout cost/logistics"
- **Cost:** ~$15–30/device (Thales OTP 110 ~$20–30, FEITIAN ~$15–25, Token2 ~$15–20)
- **No extra Entra license** — included with P1 (already needed for SSPR)
- **Self-service activation** via Graph API path — user activates from mysignins.microsoft.com using printed serial #
- **Recommendation:** start with privileged users + helpdesk staff; expand to general pop only if voice/email coverage gaps emerge
- **Vendor pick:** **Thales OTP 110** — most documented in Microsoft's own samples; defensible procurement choice

### Obj 2: "Voice call SSPR reliability with our PBX"
- Works with **any PSTN endpoint** — Cisco, Avaya, Polycom, Teams Phone (PSTN-enabled)
- **Will fail with:** internal-only IP PBX with no PSTN breakout, voicemail-only lines, auto-forwarded lines
- **Known failure mode:** "Call forwarded to voicemail" — make sure SSPR phone lines don't auto-forward to VM
- **Microsoft caller IDs (US, whitelist these):** +1 (855) 330-8653, +1 (855) 336-2194, +1 (855) 341-5605
- Admin can set a custom US caller ID in Entra → MFA → Phone call settings
- **No Communications Credits / Teams Calling Plan needed** — Microsoft pays the outbound

### Obj 3: "Authenticator-only assumption is baked into the project plan"
- **Validate this is just a documentation/comms gap.** The platform already supports the alternatives — no code change needed
- Recommend: 1-week tenant config tweak + helpdesk training + comms refresh = unblocks WHfB rollout without project replan
- If pilot is scheduled, we can run alternative-method users in parallel — same UX from end-user perspective

### Obj 4 (likely from Kristen): "Microsoft is pushing phishing-resistant — why not FIDO2 for SSPR?"
- **Honest answer:** SSPR cannot use FIDO2/passkeys today. This is a documented Entra platform constraint with no announced roadmap to change.
- Microsoft's investment in FIDO2/passkeys is in **sign-in and MFA**, not SSPR.
- Compensate with: strong logging on SSPR events, Conditional Access on the SSPR registration flow, TAP as the backstop for high-risk users.

### Obj 5 (likely from Kristen): "Can't WHfB PIN act as 2FA for SSPR?"
- **WHfB IS multi-factor authentication** ✅ — Microsoft treats a WHfB sign-in as MFA because the credential itself is multi-factor (TPM-bound key + PIN/biometric).
- **But the PIN cannot be used as an SSPR verification method** ❌ — SSPR verification is an explicit allowlist (Authenticator, OATH, SMS, voice, email, security questions). PIN isn't on it; no roadmap to add it.
- **The reframe that helps OSC:** Once WHfB is your primary sign-in, **SSPR usage drops dramatically** — because the password becomes a backup credential users almost never touch:

| Scenario | Pre-WHfB | Post-WHfB |
|---|---|---|
| Day-to-day Windows sign-in | Password | PIN/biometric — never types password |
| Day-to-day M365 sign-in | Password + MFA | SSO from WHfB session |
| Change password (proactive) | SSPR recovery flow | **Already signed in → change directly** (Ctrl+Alt+Del or aka.ms/sspr) — no SSPR verification needed |
| Forgot Windows PIN | N/A | **Microsoft PIN Reset Service** (uses MFA, not SSPR) |
| True lockout (lost device, new device, never enrolled) | SSPR | SSPR (the only residual case) |

- **Estimated SSPR volume post-WHfB: <5% of pre-WHfB volume.** The "limited SSPR methods" concern is largely theoretical for most users once WHfB is in place.
- **Residual SSPR case = true lockout** = by definition needs an out-of-band method (user can't get into anything). WHfB can't help here because user can't sign in to use it.
- **Recommendation for bootstrap scenarios** (new hire, replacement laptop, contractor): issue a **Temporary Access Pass (TAP)** as the helpdesk-provisioned bootstrap credential; pair with hardware OATH token at onboarding for ongoing recovery.

### Obj 6: "Employees can't use phones AT ALL — not even desk phones. What now?"

This is a stricter constraint than the original BYOD-only restriction. Eliminates voice call AND SMS AND any phone-based method. The SSPR-capable methods that survive:

| Method | SSPR? | Phone needed? | Verdict for no-phone OSC |
|---|---|---|---|
| **Hardware OATH tokens (Preview)** | ✅ | ❌ | **🟢 THE primary SSPR method** — non-negotiable in this environment |
| **Software OATH tokens** (on work-managed laptop) | ✅ | ❌ | 🟢 Backup |
| **Email OTP** (alternate/personal email) | ✅ | ❌ | 🟢 Works if employees have registered personal email |
| Passkey (FIDO2) | ❌ | ❌ | Sign-in/MFA only — NOT SSPR |
| Certificate-based (smart card / PIV) | ❌ | ❌ | Sign-in/MFA only — NOT SSPR |
| Temporary Access Pass | ❌ | ❌ | Helpdesk recovery TO sign-in, not SSPR verification method |
| Verified ID | ❌ | ❌ | Account Recovery flow only (separate from SSPR) |
| QR code | ❌ | ❌ | Frontline sign-in, not SSPR |

**In a no-phone environment, hardware OATH tokens are not optional — they are THE answer for SSPR.**

**Full no-phone identity stack for OSC:**

| Use case | Method |
|---|---|
| Daily Windows sign-in | **WHfB PIN/biometric** (TPM-bound, phishing-resistant) |
| MFA step-up for sensitive ops | **WHfB** or **FIDO2 security key** or **CBA (smart card)** |
| Forgot Windows PIN | **Microsoft PIN Reset Service** → auth via FIDO2 key, hardware OATH, or password |
| Forgot Entra password (true lockout) | **SSPR** → hardware OATH token (primary) + email OTP (secondary, if personal email registered) |
| Total credential loss / new hire / new device | Helpdesk-issued **TAP** → bootstrap WHfB + new hardware OATH token |

**Procurement implications:**
- **Hardware OATH tokens** for all employees who need SSPR access (~$15–30/employee — Thales OTP 110 most documented)
- **FIDO2 security keys** for all employees (YubiKey 5 NFC / FEITIAN ePass — primary phishing-resistant sign-in + PIN reset auth) — ~$50/employee
- **Smart cards (PIV)** if OSC has existing government PKI — leverage CBA (free Entra feature, GA)

**Note on screenshot reference:** The Entra Admin Center "Authentication methods" policy page lists ALL sign-in/MFA methods (Passkey, Authenticator, SMS, TAP, Hardware OATH, Software OATH, Voice, Email, CBA, Verified ID, QR code). The **SSPR-capable subset is narrower** and configured separately under **Password reset → Authentication methods**. Don't confuse the two policy pages.

---

## 📋 Open Questions for Kristen

1. **Phone coverage:** Does every OSC employee have a desk phone or Teams Phone DID? Any field/remote staff without an office phone?
2. **PBX:** What's the desk phone platform (Cisco, Avaya, Teams Phone, other)? Are inbound calls from arbitrary US PSTN numbers reliable?
3. **HR data sync:** Is `telephoneNumber` populated in AD/HR for all users? (Drives voice SSPR pre-registration)
4. **Alternate email:** Is there a process to capture/register personal email for SSPR? (Or do we need email OTP via a separate channel?)
5. **Privileged users:** Who would be the pilot population for hardware OATH tokens (≤ 50 users)?
6. **Cloud environment:** Commercial M365 or M365 GCC? (Matters for IRS 1075 / FTI handling — see compliance section)
7. **WHfB device join:** Entra joined, Hybrid joined (Cloud Kerberos Trust / Cert Trust / Key Trust)?
8. **Existing PKI / smart cards:** Does OSC have PIV/CAC infrastructure? (Could enable CBA for sign-in/MFA — not SSPR, but improves overall posture)
9. **Security questions today:** Are these currently configured? (Must migrate users off before March 2027 retirement)
10. **TAP usage:** Is helpdesk already trained on Temporary Access Pass for recovery scenarios?

---

## 🚨 Compliance / Risk Flags

- **IRS 1075 (FTI):** OSC handles state tax/financial data — verify whether OSC is on **commercial M365** or **M365 GCC**. If FTI is in scope, GCC may be required. Microsoft's IRS 1075 boundary = FedRAMP Moderate = GCC/Azure Gov.
- **CJIS:** Microsoft has NY CJIS management agreement — relevant if OSC audits touch criminal justice data
- **NIST 800-63B AAL:** SSPR via voice/email/OATH is **AAL2**, not AAL3 (not phishing-resistant). This is a current Entra platform constraint, not an OSC design choice.
- **Hardware OATH preview risk:** GA timeline not announced — preview terms apply. For financial oversight agency, recommend documenting the preview risk decision and reviewing at GA.
- **Azure Government known issue:** PIN reset on Entra-joined devices in Azure US Gov fails with "We can't open that page right now" — workaround: set `ConfigureWebSignInAllowedUrls` to include `login.microsoftonline.us`. Confirm if OSC is commercial vs GCC.

---

## 🎯 Asks at End of Call

1. Get Kristen to **agree the premise was incorrect** and acknowledge the 3-method stack is viable
2. Confirm the **OSC pilot group** (privileged users + helpdesk for hardware OATH)
3. Schedule **technical workshop within 2 weeks** to:
   - Configure SSPR policy in tenant
   - Pre-register office phones from AD
   - Pilot hardware OATH provisioning
   - Validate WHfB non-destructive PIN reset config
4. Get **budget owner identified** for hardware OATH tokens (small ask — pilot of 50 users = ~$1,000)
5. Confirm **environment** (commercial vs GCC) so compliance recommendations are correct

---

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| Kristen | Confirm desk phone / Teams Phone PSTN reachability for OSC employees | This week |
| Kristen | Identify hardware OATH pilot group (~50 users) and budget owner | 1 week |
| Kristen | Confirm M365 environment (commercial vs GCC) for compliance scoping | This week |
| AG | Deliver hardware OATH provisioning runbook (Graph API path) | 1 week |
| AG | Deliver WHfB non-destructive PIN reset architecture diagram | 1 week |
| AG | Deliver SSPR tenant policy config doc with exact recommended settings | 1 week |
| AG | Schedule technical workshop to configure pilot | 2 weeks |

## Next Steps
- Technical workshop scheduled within 2 weeks to configure SSPR + WHfB PIN reset pilot
- Pilot population (helpdesk + privileged users, ~50) provisioned with hardware OATH tokens
- Production rollout decision after 30-day pilot

## Artifacts Expected This Call
- SSPR methods matrix
- hardware OATH vendor compatibility list
- WHfB PIN reset vs SSPR clarification one-pager
