# Account: NYS Office of the State Comptroller (OSC)

## Overview
- **Industry:** State & Local Government (SLG) — Financial Oversight / Audit
- **Size:**
- **Region:** New York, USA (Albany)
- **Deal Stage:** Discovery
- **Estimated Close:**

## About
The NYS Office of the State Comptroller (OSC) is the independently elected fiscal watchdog for New York State — responsible for auditing state agencies, managing the state pension fund (3rd largest in the US), and overseeing local government finances. OSC operates its own IT environment but identity services are tied to the broader NYS ITS infrastructure (Entra ID / Active Directory). Currently rolling out Windows Hello for Business (WHfB) and SSPR.

## Key Contacts
| Name | Title | Email | Role in Deal |
|------|-------|-------|-------------|
| Kristen | (WHfB project lead) | | Driving SSPR/WHfB rollout — primary technical contact for identity recovery design |

## Microsoft Licensing
- Current: (G3 / G5 / Other — verify Government SKU)
- Security Add-ons:
- Cloud: Azure Commercial / Azure Government (verify)

## Opportunity Summary
_Known engagement areas:_
- **SSPR rollout** — OSC cannot require Authenticator on personal devices (BYOD-restricted). Recommended: hardware OATH tokens + voice-to-desk-phone + email OTP
- **Windows Hello for Business** — WHfB PIN reset uses separate Microsoft PIN Reset Service, not SSPR
- Identity hardening and phishing-resistant auth (future: Entra passkeys on Windows)

## Competitive Landscape
_Who else is in the deal?_

## Related Accounts
- `nys-its/` — NYS ITS shared IT services (manages Entra ID / AD for state agencies including OSC)
- `ny-state/` — NYS umbrella account

## Engagement History
| Date | Activity | Notes |
|------|----------|-------|
| 2026-05-21 | SSPR auth methods Q&A | OSC asked if Authenticator is the only SSPR method — clarified 6 methods exist; recommended hardware OATH tokens for BYOD-restricted environment |
| 2026-05-28 | Kristen — SSPR/WHfB meeting | Kristen re-raised SSPR concern. Full prep w/ verified Apr 2026 method matrix, BYOD-restricted stack (voice + email + OATH), WHfB PIN reset clarification. See `meetings/2026-05-28-kristen-sspr-for-whfb-project/` |

