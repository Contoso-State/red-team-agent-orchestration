---
description: Run post-call retrospective and update postmortem.md for a meeting folder.
---

Run `scripts\meeting-hook.ps1` in post-call mode.

1. If meeting folder path is missing, ask for it.
2. Collect retrospective answers one-by-one.
3. Execute:
   `powershell -ExecutionPolicy Bypass -File .\scripts\meeting-hook.ps1 -Mode post ...`
4. Return the updated `postmortem.md` path.

Use any arguments I already provided in this command invocation as defaults.
