# Usage observability and AEF regression review — 2026-09-25

Historical snapshot before PRs #15 and #16. Independent repository work continued
on `codex/demo-security-subscription`. These results describe that revision; see
the [PR integration review](pr-integration-review.md) for the current 15-node
graph and release-candidate verification.
This review made no Azure, model-provider, or CyberGym evaluation calls. All
browser fixtures, logs, and screenshots are local and ignored under
`engagements/observability-verification/`.

## Changes

- Native model invocations retain allowlisted usage metadata and emit terminal
  records linked to the same run, exchange, task, and agent. Failed calls retain
  reported usage. Missing fields remain unavailable. Raw responses are excluded.
- The dashboard adds a Usage panel, navigation link, event filter, per-field
  coverage, and expandable provenance. Duplicate delivery does not double count;
  conflicting and uncorrelated records are excluded visibly. All-null records do
  not imply usable coverage. Runtime cost is an estimate, not a billing record.
- Explicit learning opt-out now bypasses AEF calls, evidence reads, retrieval,
  and recording without changing existing memory. Learning remains on by default.
- The AEF bootstrap and bridge select `Scripts/python.exe` on Windows and
  `bin/python` on POSIX. Platform path contracts were tested on macOS; native
  Windows process startup remains unverified.

## Verification

| Check | Result |
| --- | --- |
| Historical `node --test` suite | 307 passed, 0 failed, 0 skipped |
| Canonical graph validation at that revision | Passed: 14 nodes, 12 specialists |
| Generated agent definitions | Drift check passed |
| Playwright desktop | Passed at 1440 × 1000 |
| Playwright mobile | Passed at 390 × 844; no page or usage-card horizontal overflow |
| Live local delivery | Appending the seventh fixture event updated usage from 2/3 to 3/3 without reloading; all 7 retained events appeared in the counter |
| Missing-data display | Unknown cache-write usage stayed Unavailable with 0/3 coverage |
| Failed-call accounting | Supplied failed-call usage contributed to its field totals |
| Provenance and filtering | Timeline exposed run/exchange/task/model metadata; an unobserved agent showed 0 exchanges and unavailable values |
| Browser console | 0 errors, 0 warnings |

The fixture has three model exchanges, including one failed call. Its synthetic
token counts and costs test rendering and accounting only; the dashboard labels
the run **DRY RUN · RECORDED**. The fixture is not assessment evidence, provider
billing, a benchmark score, or evidence of learning gains.

Evidence paths (ignored):

- `engagements/observability-verification/node-tests.log`
- `engagements/observability-verification/runs/live-events.jsonl`
- `engagements/observability-verification/output/playwright/usage-desktop.png`
- `engagements/observability-verification/output/playwright/usage-mobile.png`
- `engagements/observability-verification/.playwright-cli/`

The earlier [AEF integration review](aef-update-review.md) records the integration
and its verification limits. No new distinct-run assessment reuse or controlled
learning gain was measured in this synthetic review. Fresh live Azure assessment and CyberGym
execution remain blocked by their earlier automatic approval reviews. CyberGym
has zero attempted tasks and no measured score. The full workshop goal is not
complete. That historical review performed no commit, push, or publication;
current release-candidate status is recorded in the
[PR integration review](pr-integration-review.md).
