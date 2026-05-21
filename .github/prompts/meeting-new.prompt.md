---
description: Fast-path creation of a meeting package without interactive Q&A.
---

Create a meeting package in non-interactive mode.

1. Require `account` and `topic`.
2. Execute:
   `powershell -ExecutionPolicy Bypass -File .\scripts\meeting-hook.ps1 -Mode pre -NonInteractive ...`
3. If required values are missing, ask for them and rerun.
4. Return the created meeting folder path and files.

Use any arguments I already provided in this command invocation as defaults.
