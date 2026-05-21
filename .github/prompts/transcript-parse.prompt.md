---
description: Parse transcript.txt into parsed.md using meeting parser script.
---

Parse a meeting transcript and update `parsed.md`.

1. Require a meeting folder path.
2. Execute:
   `powershell -ExecutionPolicy Bypass -File .\scripts\meeting-parse.ps1 -MeetingFolder "<path>"`
3. Return the updated `parsed.md` path.
