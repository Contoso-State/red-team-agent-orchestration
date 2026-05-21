# Accounts

## Rule #1 (Repository of Record)

All customer and account meetings, notes, and related artifacts must be stored in:
`https://github.com/agoodson_microsoft/Accounts.git`

Each subfolder represents a customer account. To create a new account:

1. Create a folder using `lowercase-hyphenated` naming (e.g., `contoso-corp`)
2. Copy `../_templates/account-readme.md` → `<account>/README.md`
3. Create subfolders: `meetings/`, `notes/`, `questions/`, `demos/`, `scenarios/`, `architecture/`, `artifacts/`
4. Copy `../_templates/questions.md` → `<account>/questions/questions.md` as a starting tracker
5. Fill in the README with account details

## Account Structure
```
<account-name>/
├── README.md         # Account overview, contacts, deal stage
├── meetings/         # Meeting records and summaries (YYYY-MM-DD-topic.md)
├── notes/            # Meeting notes (YYYY-MM-DD-topic.md)
├── questions/        # Open/answered questions tracker (use _templates/questions.md)
├── demos/            # Tailored demo scripts & configs
├── scenarios/        # Customer-specific scenario briefs
├── architecture/     # Current & proposed architecture diagrams
└── artifacts/        # Proposals, SOWs, assessments
```

## PowerShell — Bootstrap a new account
```powershell
$name = "new-account-name"
$dirs = "meetings","notes","questions","demos","scenarios","architecture","artifacts"
foreach ($d in $dirs) {
    New-Item -ItemType Directory -Path "accounts\$name\$d" -Force | Out-Null
    New-Item -ItemType File -Path "accounts\$name\$d\.gitkeep" -Force | Out-Null
}
Copy-Item "_templates\account-readme.md"  "accounts\$name\README.md"
Copy-Item "_templates\questions.md"       "accounts\$name\questions\questions.md"
Copy-Item "_templates\discovery.md"       "accounts\$name\notes\discovery-framework.md"
```

> Or use the helper script: `powershell -ExecutionPolicy Bypass -File .\scripts\account-new.ps1 -Name <account>`

## Standard Meeting Package Flow

For each call, use `scripts\meeting-hook.ps1` to enforce a common format:

1. Run pre-call mode to create a dated meeting folder and prompt prep questions.
2. Paste raw transcript into `transcript.txt`.
3. Complete post-call mode to generate/update `postmortem.md`.

### Commands

```powershell
# Pre-call
powershell -ExecutionPolicy Bypass -File .\scripts\meeting-hook.ps1 -Mode pre -Account <account> -Topic "<topic>"

# Post-call
powershell -ExecutionPolicy Bypass -File .\scripts\meeting-hook.ps1 -Mode post -MeetingFolder "accounts\<account>\meetings\YYYY-MM-DD-<topic>"
```

### Meeting Package Files
- `meeting.md`
- `transcript.txt`
- `parsed.md`
- `postmortem.md`
