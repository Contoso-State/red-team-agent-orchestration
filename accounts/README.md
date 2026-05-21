# Accounts

Each subfolder represents a customer account. To create a new account:

1. Create a folder using `lowercase-hyphenated` naming (e.g., `contoso-corp`)
2. Copy `../_templates/account-readme.md` → `<account>/README.md`
3. Create subfolders: `notes/`, `questions/`, `demos/`, `scenarios/`, `architecture/`, `artifacts/`
4. Copy `../_templates/questions.md` → `<account>/questions/questions.md` as a starting tracker
5. Fill in the README with account details

## Account Structure
```
<account-name>/
├── README.md         # Account overview, contacts, deal stage
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
$dirs = "notes","questions","demos","scenarios","architecture","artifacts"
foreach ($d in $dirs) {
    New-Item -ItemType Directory -Path "accounts\$name\$d" -Force | Out-Null
    New-Item -ItemType File -Path "accounts\$name\$d\.gitkeep" -Force | Out-Null
}
Copy-Item "_templates\account-readme.md"  "accounts\$name\README.md"
Copy-Item "_templates\questions.md"       "accounts\$name\questions\questions.md"
Copy-Item "_templates\discovery.md"       "accounts\$name\notes\discovery-framework.md"
```
