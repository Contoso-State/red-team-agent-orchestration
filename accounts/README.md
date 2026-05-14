# Accounts

Each subfolder represents a customer account. To create a new account:

1. Create a folder using `lowercase-hyphenated` naming (e.g., `contoso-corp`)
2. Copy `../_templates/account-readme.md` → `<account>/README.md`
3. Create subfolders: `notes/`, `demos/`, `scenarios/`, `architecture/`, `artifacts/`
4. Fill in the README with account details

## Account Structure
```
<account-name>/
├── README.md         # Account overview, contacts, deal stage
├── notes/            # Meeting notes (YYYY-MM-DD-topic.md)
├── demos/            # Tailored demo scripts & configs
├── scenarios/        # Customer-specific scenario briefs
├── architecture/     # Current & proposed architecture diagrams
└── artifacts/        # Proposals, SOWs, assessments
```
