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
  2. **Service account issue confirmed** — `Test-MDIDSA -Identity "mdiSvc01"` returned **false**, indicating the DSA `mdiSvc01` is not properly configured or lacks required permissions

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| | Enable Services Advanced Auditing on Domain Controllers for MDI | |
| | Investigate and resolve MDI DSA `mdiSvc01` — `Test-MDIDSA` returned false | |
| | Verify MDI sensor health after both issues are resolved | |

## Next Steps

