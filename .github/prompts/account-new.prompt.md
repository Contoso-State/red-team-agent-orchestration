---
description: Scaffold a new account folder and README from template.
---

Create a new account scaffold.

1. Require account slug (or account name to slugify).
2. Optionally collect display name.
3. Execute:
   `powershell -ExecutionPolicy Bypass -File .\scripts\account-new.ps1 -Account "<slug-or-name>" -AccountName "<display-name>"`
4. Return the created account folder and key files.
