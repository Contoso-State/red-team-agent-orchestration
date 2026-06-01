# NYS OSC — Questions Log

Track open questions, customer-asked questions, and follow-ups for NYS Office of the State Comptroller.

## Format
Use one file per topic/meeting, or maintain a running log. Suggested naming: `YYYY-MM-DD-topic.md`

---

## Open Questions (Awaiting Customer Response)

| # | Date Asked | Question | Asked By | Status | Answer / Notes |
|---|------------|----------|----------|--------|----------------|
| | | | | | |

## Questions From Customer (Need Our Response)

| # | Date Asked | Question | Owner | Due | Response |
|---|------------|----------|-------|-----|----------|
| 1 | 2026-05-28 | **Kristen (WHfB project):** We're implementing SSPR at OSC. We're finding the only auth method OSC employees will be able to use is the Microsoft Authenticator app. We cannot require employees to install Authenticator on their personal device. Is Microsoft working on other authentication methods that can be used for SSPR? We're not sure how beneficial SSPR will be to OSC employees since we cannot require the use of the authenticator app. | AG | Meeting w/ Kristen (today) | **Premise is incorrect — six+ SSPR methods exist today.** Recommended OSC pattern: **hardware OATH tokens + voice-to-desk-phone + email OTP** — zero personal-device dependency. Full prep in [meetings/2026-05-28-kristen-sspr-for-whfb-project/](../meetings/2026-05-28-kristen-sspr-for-whfb-project/). WHfB PIN reset uses separate Microsoft PIN Reset Service, not SSPR. |

## Technical Deep-Dive Questions

_Architecture, integration, licensing, sizing, etc._

- **SSPR methods matrix (BYOD-restricted)** — see Resolved Q1 below
- Hardware OATH token vendors known to work with Entra: Token2, Yubico OTP, FEITIAN, Thales
- Workshop topic: design SSPR + WHfB recovery flow combining hardware OATH + voice + email OTP

## Business / Procurement Questions

_Budget, timeline, decision process, stakeholders, etc._

-

## Resolved Questions

| Date Resolved | Question | Resolution |
|---------------|----------|------------|
| 2026-05-21 | Is Microsoft Authenticator the only SSPR method? (WHfB project) | No — 6 methods supported today: (1) Authenticator push, (2) Hardware OATH tokens (preview) — recommended for BYOD-restricted, (3) Software OATH tokens, (4) SMS, (5) Voice call, (6) Email OTP. Recommended OSC pattern: hardware OATH tokens + voice-to-desk-phone + email OTP. Also clarified: WHfB PIN reset uses the separate Microsoft PIN Reset Service, not SSPR. |
