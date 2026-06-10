# Engagements — Per-Session Output

Every assessment **run** writes **all** of its output into a single folder under here, named for the
engagement and the moment it ran. Nothing from a run is scattered across the repo root anymore.

```
engagements/
└── <session>/                       # <engagement-id>-<YYYY-MM-DD-HHMMSS>
    ├── engagement.yaml              # snapshot of the scope this run used (self-contained)
    ├── engagement.db                # SQLite engagement datastore (cache + canonical store, gitignored)
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
        ├── delta.json               # what changed vs the prior run (new/persisting/resolved/regressed)
        └── findings.json            # machine-readable canonical findings
```

Alongside the per-session folders, longitudinal state lives in a sibling directory:

```
engagements/
└── _history/
    └── <engagement.id>.db           # cross-run finding & resource lifecycle (gitignored)
```

The per-session `engagement.db` is the **single source of truth and cache** for one run: inventory,
resource configuration facts, relationships, coverage, tasks, and deduplicated findings. Agents query it
instead of re-hitting Azure (see `knowledge/datastore.md`). The `_history/<engagement.id>.db` accumulates
every run so the report can show what's new, persisting, resolved, or regressed over time.

## Naming

`<session>` = `<engagement.id>` (from `engagement.yaml`) + `-` + a UTC timestamp `YYYY-MM-DD-HHMMSS`.

Example: `example-2026-q2-2026-06-15-141200`.

The timestamp means **re-running never overwrites** a previous session — each run gets its own folder,
giving you a clean, auditable history of every assessment.

## Git

The entire `engagements/` tree is **gitignored** (only this `README.md` and `.gitkeep` are tracked),
because session output contains sensitive target-specific data. Never commit a session folder. This
includes every `*.db` (the per-session `engagement.db` and the `_history/*.db` files) — they hold target
configuration and findings and must never be pushed.

## How it gets created

- The **Orchestrator** (or `/recon`) creates `engagements/<session>/` at the start of a run and tells
  every dispatched agent the exact path to write under.
- The PowerShell helpers honor a session folder too: set `$env:REDTEAM_SESSION` to the session path, or
  pass `-SessionPath ./engagements/<session>` to `Invoke-Preflight.ps1` and `Export-Inventory.ps1`.
