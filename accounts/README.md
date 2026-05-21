# Accounts

## Rule #1 (Repository of Record)

All customer and account meetings, notes, and related artifacts must be stored in:
`https://github.com/agoodson_microsoft/Accounts.git`

Each subfolder represents a customer account. To create a new account:

1. Create a folder using `lowercase-hyphenated` naming (e.g., `contoso-corp`)
2. Copy `../_templates/account-readme.md` → `<account>/README.md`
3. Create subfolders: `meetings/`, `notes/`, `demos/`, `scenarios/`, `architecture/`, `artifacts/`
4. Fill in the README with account details

## Account Structure
```
<account-name>/
├── README.md         # Account overview, contacts, deal stage
├── meetings/         # Meeting records and summaries (YYYY-MM-DD-topic.md)
├── notes/            # Meeting notes (YYYY-MM-DD-topic.md)
├── demos/            # Tailored demo scripts & configs
├── scenarios/        # Customer-specific scenario briefs
├── architecture/     # Current & proposed architecture diagrams
└── artifacts/        # Proposals, SOWs, assessments
```

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

## Repo Automation Shortcuts

### Slash Commands
Defined in `.github\prompts\`:

- `/prep`
- `/post`
- `/meeting-new`
- `/transcript-parse`
- `/account-new`
- `/brief`

### Local Skills
Defined in `.github\skills\`:

- `azure-architecture-autopilot`
- `azure-role-selector`
- `cloud-design-patterns`
- `create-agentsmd`
- `create-implementation-plan`
- `create-llms`
- `create-readme`
- `microsoft-agent-framework`
- `microsoft-code-reference`
- `microsoft-docs`
- `msgraph-sdk`
- `remember`
