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
- MDI is not functioning properly — **Services Advanced Auditing is not enabled**
- Advanced Auditing must be enabled for MDI to collect the necessary events from Domain Controllers
- This is a prerequisite configuration step that was missed or not applied

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| | Enable Services Advanced Auditing on Domain Controllers for MDI | |
| | Verify MDI sensor health after auditing is enabled | |

## Next Steps

