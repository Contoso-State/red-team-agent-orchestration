# Engagements — Per-Session Output

Every assessment **run** writes **all** of its output into a single folder under here, named for the
engagement and the moment it ran. Nothing from a run is scattered across the repo root anymore.

```
engagements/
└── <session>/                       # <engagement-id>-<YYYY-MM-DD-HHMMSS>
    ├── engagement.yaml              # snapshot of the scope this run used (self-contained)
    ├── inventory/
    │   ├── resources.jsonl          # shared resource inventory
    │   ├── subscriptions.json       # subscription metadata
    │   └── coverage-limitations.json# blind spots / permission gaps
    ├── findings/
    │   ├── raw/<agent>.jsonl        # one file per domain agent
    │   └── normalized/findings.json # deduplicated, severity-reconciled set
    ├── evidence/
    │   ├── raw/                      # raw captured evidence (gitignored)
    │   └── sanitized/               # redacted evidence safe to share
    └── reports/
        ├── executive-summary.md     # leadership audience
        ├── technical-report.md      # engineer audience
        ├── assessment-deck.md       # PowerPoint-convertible deck (Marp / Pandoc)
        └── findings.json            # machine-readable canonical findings
```

## Naming

`<session>` = `<engagement.id>` (from `engagement.yaml`) + `-` + a UTC timestamp `YYYY-MM-DD-HHMMSS`.

Example: `example-2026-q2-2026-06-15-141200`.

The timestamp means **re-running never overwrites** a previous session — each run gets its own folder,
giving you a clean, auditable history of every assessment.

## Git

The entire `engagements/` tree is **gitignored** (only this `README.md` and `.gitkeep` are tracked),
because session output contains sensitive target-specific data. Never commit a session folder.

## How it gets created

- The **Orchestrator** (or `/recon`) creates `engagements/<session>/` at the start of a run and tells
  every dispatched agent the exact path to write under.
- The PowerShell helpers honor a session folder too: set `$env:REDTEAM_SESSION` to the session path, or
  pass `-SessionPath ./engagements/<session>` to `Invoke-Preflight.ps1` and `Export-Inventory.ps1`.
