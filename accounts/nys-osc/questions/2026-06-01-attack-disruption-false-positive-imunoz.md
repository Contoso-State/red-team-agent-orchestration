# OSC — Automatic Attack Disruption False Positive (imunoz@osc.ny.gov)

**Date:** 2026-06-01
**Status:** Resolved — account restored, customer wants prevention plan
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

### ✅ Resolved — Account Restored

imunoz account has been re-enabled. Focus is now on **preventing recurrence**.

### Prevention Strategy — How to Ensure This Doesn't Happen Again

#### 1. Exclude the Radius Aad Syncer service account from Attack Disruption (Recommended)

**Path:** Defender portal → Settings → Microsoft Defender XDR → Automated response → Identities → Add user exclusion

- If Attack Disruption contained imunoz (the target user), **exclude high-value service accounts or users that are frequently managed by automation** to prevent future false correlation.
- **Important:** The exclusion UI is for **user accounts being contained**, not for the initiating service principal. So you'd exclude users that Radius routinely disables if they keep getting falsely flagged.
- This is the most targeted fix — protects automated-workflow users without weakening Attack Disruption for real threats.

#### 2. Mark the incident as false positive + submit feedback (Do this NOW)

**Path:** Defender portal → Incidents → find the imunoz BEC incident → Manage incident → Mark as False Positive

- This is **critical** — it feeds Microsoft's ML model so similar Radius Aad Syncer patterns are weighted lower in future correlations.
- Also submit feedback on each individual alert (inbox manipulation, anonymous IP, BEC) marking them as false positive with notes explaining Radius Aad Syncer is a legitimate identity sync tool.
- **If OSC hasn't done this yet, they should do it immediately** — without this feedback, the same pattern WILL recur.

#### 3. Tag Radius Aad Syncer as a sanctioned/trusted app

**Path:** Defender for Cloud Apps → Cloud app catalog → find Radius Aad Syncer → mark as Sanctioned

- Or in Entra ID → Enterprise Applications → Radius Aad Syncer → ensure it's properly tagged/documented as a trusted automation tool.
- This helps Defender's correlation engine recognize its actions as legitimate automation rather than potential attacker behavior.

#### 4. Review the specific alert signals

Before concluding everything was false, OSC should validate:

| Alert | Question for OSC |
|-------|-----------------|
| Suspicious inbox manipulation rule (×2) | Did imunoz actually have new inbox rules created? Were they legitimate (out-of-office, forwarding for handoff)? |
| Anonymous IP address (×2) | Did imunoz sign in from a VPN, Tor, or anonymizer? Or was this a stale session / token replay? |
| BEC financial fraud | Was this purely correlated from the other signals, or was there actual financial email activity? |

**If all of these were also false:** the entire incident was a correlation error — submit feedback on every alert.
**If some were real:** imunoz may have been partially compromised, and the Radius disable was coincidental. Different remediation needed.

#### 5. Automation-aware configuration (Microsoft's own guidance)

From the [Attack Disruption prerequisites docs](https://learn.microsoft.com/en-us/defender-xdr/configure-attack-disruption):

> *"If you have automation in place to activate or block a user, check if the automation can interfere with disruption. For example, if there is an automation in place to regularly check and enforce that all active employees have enabled accounts, this could unintentionally activate accounts that were deactivated by attack disruption while an attack is detected."*

**This works both ways** — OSC's Radius automation disabling accounts can also trigger false Attack Disruption signals. OSC should:
- Document all service principals that perform user enable/disable operations
- Ensure those SPs are tagged, sanctioned, and excluded from triggering correlation
- Consider timing: if Radius syncs happen at predictable intervals, Attack Disruption may learn to ignore them after sufficient false positive feedback

#### 6. Do NOT opt out of Attack Disruption entirely

- Attack Disruption is one of the highest-value features in Defender XDR for stopping active BEC and ransomware attacks
- Opting out removes ALL automated containment — real attacks would proceed unchecked
- **Exclusions and feedback are the right approach — not disabling the feature**

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

> **The incident is resolved, but here's how we prevent this from happening again:**
>
> **Step 1 (do now):** Go to the Defender portal, find the imunoz BEC incident, and **mark it as a false positive** with notes that Radius Aad Syncer is your legitimate identity sync tool. Do the same for each individual alert. **This is the single most important step** — it trains Microsoft's AI to not flag your Radius sync as an attack.
>
> **Step 2:** Tag the Radius Aad Syncer service principal as a **sanctioned app** in Defender for Cloud Apps so its actions are recognized as trusted automation.
>
> **Step 3:** Validate whether the inbox manipulation and anonymous IP alerts for imunoz were also false — if yes, mark those too. If they were real, we have a different conversation.
>
> **Step 4 (bi-weekly topic):** Document all service principals in your tenant that perform user enable/disable operations. We'll review exclusion options together to ensure your identity automation doesn't trigger Attack Disruption again.
>
> **We do NOT recommend opting out of Attack Disruption** — it's one of the most effective features for stopping real BEC and ransomware. The right fix is tuning, not disabling.

---

## Action Items

| Owner | Action | Due |
|-------|--------|-----|
| OSC | **Mark the imunoz incident + all alerts as false positive** in Defender portal — include note about Radius Aad Syncer | Immediately |
| OSC | Confirm: were the inbox manipulation / anonymous IP alerts also false? | This week |
| OSC | Tag Radius Aad Syncer as sanctioned app in Defender for Cloud Apps | This week |
| AG | Help OSC review Attack Disruption exclusion options for automation service accounts | Next bi-weekly |
| AG + OSC | Document all SPs that perform user enable/disable — ensure they're tagged + excluded from triggering correlation | Next bi-weekly |
| AG | **Follow up with Chris Kirk** on Attack Disruption false positive resolution and prevention plan | TBD |
