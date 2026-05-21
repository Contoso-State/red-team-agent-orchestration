# New York State — Questions Log

Track open questions, customer-asked questions, and follow-ups for New York State.

## Format
Use one file per topic/meeting, or maintain a running log. Suggested naming: `YYYY-MM-DD-topic.md`

---

## Open Questions (Awaiting Customer Response)

| # | Date Asked | Question | Asked By | Status | Answer / Notes |
|---|------------|----------|----------|--------|----------------|
| 1 | | | | Open | |

## Questions From Customer (Need Our Response)

| # | Date Asked | Question | Owner | Due | Response |
|---|------------|----------|-------|-----|----------|
| 1 | 2026-05-21 | (OSC / Comptroller, WHfB project) We're implementing SSPR. We can't require employees to install Microsoft Authenticator on personal devices, and we believe Authenticator is the only SSPR method. Is Microsoft adding other SSPR methods? | AG | 2026-05-21 | **Premise is incorrect — six SSPR methods exist today.** Per [Microsoft Entra SSPR — How it works](https://learn.microsoft.com/entra/identity/authentication/concept-sspr-howitworks#authentication-methods): (1) Microsoft Authenticator push, (2) **Hardware OATH tokens (preview)** — recommended for BYOD-restricted environments, (3) Software OATH tokens, (4) SMS, (5) Voice call (works with desk phones / Teams Phone), (6) Email OTP. **Recommended OSC pattern:** hardware OATH tokens as primary + voice-to-desk-phone + email OTP — zero personal-device dependency. Also clarify: WHfB PIN reset uses the separate [Microsoft PIN Reset Service](https://learn.microsoft.com/windows/security/identity-protection/hello-for-business/pin-reset), not SSPR. Future-state: evaluate [Microsoft Entra passkey on Windows (preview)](https://learn.microsoft.com/entra/identity/authentication/how-to-authentication-entra-passkeys-on-windows) for phishing-resistant sign-in. |

## Technical Deep-Dive Questions

_Architecture, integration, licensing, sizing, etc._

- **SSPR methods matrix (BYOD-restricted)** — see Q1 above.
- Hardware OATH token vendors known to work with Entra: Token2, Yubico OTP, FEITIAN, Thales.
- Workshop topic: design SSPR + WHfB recovery flow combining hardware OATH + voice + email OTP.

## Business / Procurement Questions

_Budget, timeline, decision process, stakeholders, etc._

-

## Resolved Questions

| Date Resolved | Question | Resolution |
|---------------|----------|------------|
| 2026-05-21 | Is Microsoft Authenticator the only SSPR method? | No — 6 methods supported; hardware OATH tokens (preview) recommended for OSC's BYOD-restricted environment (see Q1). |

