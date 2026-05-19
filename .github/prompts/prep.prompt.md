---
description: Run pre-call meeting prep and create a standardized meeting package.
---

Run `scripts\meeting-hook.ps1` in pre-call mode for this repo.

1. Collect missing inputs one-by-one in chat.
2. Execute:
   `powershell -ExecutionPolicy Bypass -File .\scripts\meeting-hook.ps1 -Mode pre ...`
3. Return the created meeting folder path.

Use any arguments I already provided in this command invocation as defaults.
