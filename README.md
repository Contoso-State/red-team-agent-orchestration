# Accounts — Security Solution Engineering

Pre-sales account management repository for Security Solution Engineering engagements.

## Rule #1 (Repository of Record)

All customer and account meetings, notes, and artifacts must be created and maintained in:
`https://github.com/agoodson_microsoft/Accounts.git`

Do not save new customer/account meeting content to any prior repository.

## Directory Structure

```
├── _templates/              # Reusable templates for account work
│   ├── discovery.md         # Discovery call question framework
│   ├── demo-runbook.md      # Demo execution template
│   ├── scenario-brief.md    # Scenario write-up template
│   ├── meeting-notes.md     # Meeting notes template
│   ├── questions.md         # Customer questions tracker template
│   └── security-solution-engineer-agent.md # Presales SSE agent system prompt
│
├── accounts/                # Per-account folders (create one per customer)
│   └── <account-name>/
│       ├── README.md        # Account overview, key contacts, deal stage
│       ├── meetings/        # Meeting records and summaries
│       ├── notes/           # Meeting notes & call summaries
│       ├── questions/       # Open/answered customer & internal questions
│       ├── demos/           # Demo scripts & configs tailored to this account
│       ├── scenarios/       # Customer-specific pain points → solution mappings
│       ├── architecture/    # Current-state & proposed architecture diagrams
│       └── artifacts/       # Proposals, SOWs, assessments, deliverables
│
├── demos/                   # Reusable demo library (not account-specific)
│   ├── defender-xdr/        # Microsoft Defender XDR demos
│   ├── sentinel/            # Microsoft Sentinel demos
│   ├── entra/               # Microsoft Entra ID demos
│   ├── purview/             # Microsoft Purview demos
│   ├── intune/              # Microsoft Intune demos
│   └── copilot-security/    # Security Copilot demos
│
├── scenarios/               # Common security scenarios & playbooks
│   ├── threat-protection/   # XDR, EDR, email security scenarios
│   ├── identity/            # Zero Trust, conditional access, PIM
│   ├── cloud-security/      # CSPM, CWPP, multicloud
│   ├── data-security/       # DLP, sensitivity labels, insider risk
│   ├── siem-soar/           # SIEM migration, SOAR automation
│   └── compliance/          # Regulatory compliance, audit readiness
│
├── competitive/             # Competitive intelligence
│   └── battle-cards/        # Per-competitor battle cards
│
└── resources/               # Reference materials & links
```

## Quick Start

1. **New account?** Copy `_templates/` files into a new folder under `accounts/<account-name>/`
2. **Prepping a demo?** Check `demos/` for reusable content, customize in the account folder
3. **Building a scenario?** Start from `scenarios/` playbooks, tailor to the customer

## Meeting Hook Flow (Pre + Post Call)

Use the scripted hook flow to standardize pre-call prep, transcript handling, parsed notes, and postmortem:

```powershell
# Pre-call (interactive): prompts questions one-by-one and creates a meeting package
powershell -ExecutionPolicy Bypass -File .\scripts\meeting-hook.ps1 -Mode pre -Account pheaa -Topic "server-security-alignment"

# Pre-call (non-interactive): pass required values in command args
powershell -ExecutionPolicy Bypass -File .\scripts\meeting-hook.ps1 -Mode pre -Account pheaa -Topic "server-security-alignment" -DecisionNeeded "Confirm POC scope"

# Post-call (interactive): prompts retrospective and writes postmortem.md
powershell -ExecutionPolicy Bypass -File .\scripts\meeting-hook.ps1 -Mode post -MeetingFolder "accounts\pheaa\meetings\2026-05-19-server-security-alignment"
```

For each call, pre-call mode creates a meeting package folder:
- `meeting.md` (prep + live notes)
- `transcript.txt` (raw transcript drop zone)
- `parsed.md` (structured extraction placeholder)
- `postmortem.md` (retrospective scaffold, updated post-call)

Scripts:
- `scripts\meeting-hook.ps1` (wrapper)
- `scripts\meeting-prep.ps1` (pre-call intake and package generation)
- `scripts\meeting-postmortem.ps1` (post-call retrospective capture)
- `scripts\meeting-parse.ps1` (transcript to parsed notes)
- `scripts\account-new.ps1` (new account scaffolding)
- `scripts\meeting-brief.ps1` (account summary from recent meetings)

## Slash Commands (Copilot Chat)

Custom slash commands are now defined in `.github\prompts\`:

- `/prep` -> interactive pre-call package creation
- `/post` -> interactive postmortem capture
- `/meeting-new` -> non-interactive package creation
- `/transcript-parse` -> build `parsed.md` from `transcript.txt`
- `/account-new` -> scaffold account folder + README
- `/brief` -> generate/update `accounts\<account>\brief.md`

Example usage:

```text
/prep account pheaa topic "server-security-alignment"
/transcript-parse accounts\pheaa\meetings\2026-05-19-server-security-alignment
/brief pheaa
```

## Naming Conventions

- Account folders: `lowercase-hyphenated` (e.g., `contoso-corp`)
- Meeting folders: `YYYY-MM-DD-topic` (e.g., `2026-05-19-server-security-alignment`)
- Notes: `YYYY-MM-DD-topic.md` (optional legacy, same format as meetings)
- Demos: `product-scenario.md` (e.g., `sentinel-siem-migration.md`)
