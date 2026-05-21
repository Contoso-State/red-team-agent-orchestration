# Meeting Notes — 2026-05-21

## Meeting Info
- **Date:** 2026-05-21
- **Account:** Harvard
- **Attendees:** Joel M Nentwich (joel_nentwich@harvard.edu), Jermaine Elliott (CSAM), Temika
- **Type:** Technical Deep-Dive
- **Topic:** MSFT Identity & Security Working Session

## Agenda
1. Sentinel automation and data integration
2. Okta integration with IAM team
3. Patch management / WSUS deprecation roadmap
4. Conditional access error messaging for help desk

## Notes

### Sentinel Automation & Data Integration
- Sentinel is already set up to receive data from cloud apps and Entra
- Plans to install Arc and onboard domain controllers to expand data collection
- Goal: have Sentinel automate actions (auditing, emailing) rather than relying on manual dashboard interactions
- Joel wants Sentinel to make smart decisions based on authentication data
- Matt and the IAM team are involved to address technical concerns and ensure comprehensive data coverage

### Okta Integration
- IAM team has concerns about integrating Okta data — questions around connector requirements and throttling
- Matt is coordinating a meeting to address these issues
- Matt is the designated driver for IAM-related meetings to streamline communication
- Need to coordinate with Corey before involving Tom Daniels (previous discussions involved both)
- Configuration responsibility has been handed off

### Patch Management & WSUS Deprecation
- WSUS is deprecated — Joel wants to minimize server maintenance by leveraging Arc
- Arc is used primarily as an orchestrator (does not perform patching itself)
- Joel needs clarity on the 5–10 year roadmap for patch management in the cloud to avoid future rework
- Requested connection with a WSUS SME, preferring email communication

### Conditional Access Error Messaging for Help Desk
- Joel seeking guidance on providing help desk with clear error message verbiage for users blocked due to high sign-in or user risk
- Help desk does not currently have access to Entra or Defender for Identity
- Temika investigating whether custom error messages can be configured for blocked sign-ins — customization is possible for certain internet pages
- Temika suggested a Logic App or Power App could automate sending relevant info to help desk without granting additional permissions
- Need careful consideration of permissions and system integration

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| Jermaine | Send meeting invite for Sentinel working session (include Matt, Chris, Aiden) — June 8th at 3:00 PM | ~2026-06-08 |
| Joel M Nentwich | Deploy Arc client to production domain controllers after change freeze ends; connect Arc agent to Sentinel | After 2026-06-01 |
| Jermaine | Connect Joel with a WSUS SME to discuss patch management roadmap (via email) | TBD |
| Jermaine | Coordinate internally with Corey and Matt to schedule IAM/Okta working session with right participants | TBD |
| Temika | Research whether error messages for high user/sign-in risk can be customized for help desk guidance; share findings with Joel | TBD |

## Next Steps
- Change freeze lifts June 1st — Harvard can begin deploying Arc to domain controllers and connecting to Sentinel
- Sentinel working session targeting June 8th at 3:00 PM, led by Jermaine (CSAM)
- IAM/Okta working session to be scheduled after internal coordination with Corey and Matt
- Temika to follow up on conditional access custom messaging research
