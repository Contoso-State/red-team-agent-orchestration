# OSC — Automatic Attack Disruption False Positive (imunoz@osc.ny.gov)

**Date:** 2026-06-01
**Status:** Active — customer escalated, frustrated
**Affected user:** imunoz@osc.ny.gov
**MS Support contact:** Bryan Rigano (Sr Support Engineer - Security & Compliance)

---

## What Happened

1. **Radius Aad Syncer** (service principal `8321d64c-e3bc-484b-aac1-c6cc550d1443`) disabled user `imunoz@osc.ny.gov` on 2026-05-19 — this is a **legitimate HR/identity sync tool** performing a routine account disable (offboarding or status change).

2. Defender XDR correlated this account disable with other signals and generated **multiple high-severity alerts** for imunoz:
   - BEC financial fraud (Attack Disruption — **Queued**)
   - Suspicious inbox manipulation rule (×2)
   - Possible BEC-related inbox rule
   - Anonymous IP address (×2, AAD Identity Protection)

3. **Automatic Attack Disruption** fired — "Microsoft Defender XDR disrupted the attack using an automated response action" — and took containment action on imunoz.

4. OSC is frustrated because:
   - The account disable was **their own automation** (Radius Aad Syncer), not an attack
   - They feel they have **no control** over Attack Disruption
   - Bryan Rigano confirmed Attack Disruption **cannot be fully disabled** — only exclusions or a support case opt-out

---

## Analysis

### Is this truly a false positive?

**The account disable itself is legitimate** — Radius Aad Syncer is OSC's own identity sync tool. However, the other alerts (inbox manipulation, BEC, anonymous IP) may or may not be legitimate. Two scenarios:

| Scenario | Implication |
|----------|------------|
| **A: All alerts are false positives** | Attack Disruption's AI correlation was wrong — the account disable by Radius Aad Syncer was misinterpreted as part of an attack chain. The inbox manipulation / anonymous IP alerts may be unrelated or also false. |
| **B: Real attack on imunoz + coincidental HR sync** | imunoz may have been genuinely compromised (BEC, inbox rules), and the Radius sync disable happened to coincide. Attack Disruption correctly identified the attack, but the "contain user" action conflicted with the legitimate disable. |

**Key question for OSC:** Were the inbox manipulation rules and anonymous IP alerts also unexpected? Or does imunoz legitimately create inbox rules / sign in from anonymized networks?

### Root cause of the false positive signal

If Scenario A: Defender XDR likely saw the account disable (from Radius Aad Syncer) and correlated it with low-confidence inbox signals to reach a "high-confidence" BEC determination. The service principal's action was misattributed as attacker activity.

---

## Remediation Options

### Immediate — Release the user

1. **Action Center** → find the "Contain User" action for imunoz → **Release** / **Undo**
2. Re-enable the account if the Radius sync was the only disable (check if Attack Disruption also disabled it independently)

### Short-term — Prevent recurrence

| Option | How | Risk |
|--------|-----|------|
| **Exclude imunoz from Attack Disruption** | Settings → Microsoft Defender XDR → Automated response → Identities → Add user exclusion → imunoz | Only protects this one user — doesn't fix the pattern |
| **Exclude the Radius Aad Syncer service principal** | May not be possible via the user exclusion UI — exclusions are for user accounts being contained, not for initiating service principals. **Needs validation.** | N/A if not supported |
| **Mark alerts as false positive** | In each alert → Manage alert → Mark as False Positive → select reason | Helps train the ML model for future correlation |
| **Submit false positive feedback** | In the incident → provide feedback that this was a false positive → Microsoft uses this to improve detection models | Long-term fix |

### Long-term — Prevent pattern-wide false positives

| Option | How |
|--------|-----|
| **Tag the Radius Aad Syncer service principal** | In Defender for Cloud Apps or Entra → tag as "sanctioned" / "service account" so its actions are weighted differently in correlation |
| **Configure automation interference check** | Microsoft docs specifically note: *"If you have automation in place to activate or block a user, check if the automation can interfere with disruption."* — OSC's Radius sync is exactly this pattern. Need to ensure Defender recognizes Radius as a trusted automation. |
| **Request product feedback** | File feedback through Defender portal that service principal-initiated account disables from known tenant apps should not be weighted as attack signals |
| **Opt out of Attack Disruption (last resort)** | Open MS support case with subject "Attack disruption opt-out" — Microsoft will disable automated actions but alerts still fire. **Not recommended.** |

---

## What Bryan Rigano Said (MS Support Response)

- Attack Disruption **cannot be fully disabled** via a single setting
- It's **AI-driven, multi-signal correlation** — no deterministic alert list
- Actions target **only assets identified as directly involved** (not widespread)
- Controls available: **exclusions** (user, device, IP) and **remediation level settings**
- Can also **opt out entirely** via support case (not recommended)
- References:
  - https://learn.microsoft.com/en-us/defender-xdr/automatic-attack-disruption
  - https://learn.microsoft.com/en-us/defender-xdr/configure-attack-disruption
  - https://learn.microsoft.com/en-us/defender-xdr/automatic-attack-disruption-exclusions

---

## Recommended Response to OSC

> **We understand the frustration — your own identity sync tool (Radius Aad Syncer) triggered a false positive in Defender XDR's Automatic Attack Disruption.** Here's what we recommend:
>
> **Immediate:**
> 1. Release imunoz from containment via the Action Center
> 2. Mark all related alerts as false positive to train the model
>
> **Prevent recurrence:**
> 3. Submit false positive feedback on the incident so Microsoft improves detection for service-principal-initiated account changes
> 4. Investigate whether the inbox manipulation / anonymous IP alerts for imunoz were also false — if yes, mark those too
>
> **Longer-term (discuss in bi-weekly):**
> 5. Review whether the Radius Aad Syncer service principal can be tagged/recognized as a trusted automation to reduce future false correlation
> 6. This ties directly into our action item on **better communication of Defender product changes** — OSC needs visibility into how these AI-driven features behave with their existing automation
>
> **We do NOT recommend opting out of Attack Disruption entirely** — the feature provides real protection against BEC and ransomware. Tuning it is the right approach.

---

## Action Items

| Owner | Action | Due |
|-------|--------|-----|
| OSC | Release imunoz from containment in Action Center | Immediately |
| OSC | Confirm: were the inbox manipulation / anonymous IP alerts also unexpected? | This week |
| AG | Help OSC mark alerts as false positive and submit incident feedback | This week |
| AG | Investigate whether Radius Aad Syncer SP can be tagged to prevent future false positives | Next bi-weekly |
| AG + OSC | Review Attack Disruption exclusion options and decide on strategy | Next bi-weekly |
