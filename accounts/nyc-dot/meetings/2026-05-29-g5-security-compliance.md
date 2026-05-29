# Meeting Notes — 2026-05-29

## Meeting Info
- **Date:** 2026-05-29
- **Account:** NYC DOT
- **Attendees:**
- **Type:** Technical Deep-Dive

## Agenda
1. G5 MSFT Security and Compliance discussion
2. MDI (Microsoft Defender for Identity) not working

## Notes
- MDI is not functioning properly — two issues identified:
  1. **Services Advanced Auditing is not enabled** — required for MDI to collect events from Domain Controllers
  2. **Possible service account issue** — the MDI service account (Directory Service Account / gMSA) may be misconfigured or lacking required permissions

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| | Enable Services Advanced Auditing on Domain Controllers for MDI | |
| | Investigate and resolve MDI service account (DSA/gMSA) configuration | |
| | Verify MDI sensor health after both issues are resolved | |

## Next Steps

