---
description: Generate/update account brief from account README and recent meetings.
---

Build an account brief using recent meeting artifacts.

1. Require account slug/name.
2. Optionally collect how many recent meetings to include.
3. Execute:
   `powershell -ExecutionPolicy Bypass -File .\scripts\meeting-brief.ps1 -Account "<account>" -Last <count>`
4. Return the updated `brief.md` path.
