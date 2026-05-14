# Accounts — Security Solution Engineering

Pre-sales account management repository for Security Solution Engineering engagements.

## Directory Structure

```
├── _templates/              # Reusable templates for account work
│   ├── discovery.md         # Discovery call question framework
│   ├── demo-runbook.md      # Demo execution template
│   ├── scenario-brief.md    # Scenario write-up template
│   └── meeting-notes.md     # Meeting notes template
│
├── accounts/                # Per-account folders (create one per customer)
│   └── <account-name>/
│       ├── README.md        # Account overview, key contacts, deal stage
│       ├── notes/           # Meeting notes & call summaries
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

## Naming Conventions

- Account folders: `lowercase-hyphenated` (e.g., `contoso-corp`)
- Notes: `YYYY-MM-DD-topic.md` (e.g., `2026-05-14-discovery-call.md`)
- Demos: `product-scenario.md` (e.g., `sentinel-siem-migration.md`)