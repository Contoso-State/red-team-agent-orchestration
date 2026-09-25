# Live Azure workshop

Use a dedicated branch and an ignored `engagements/<session>` directory. Keep
tenant identifiers, credentials, inventory, findings, event logs and memory out
of commits. Each assessment needs a fresh session and an explicit read-only,
single-subscription engagement file.

## Two different graphs

The report's **Consolidated Attack Graph** shows resource relationships and
modeled attack paths in 3D. Rotate, zoom and select nodes to inspect the supplied
evidence. Conditional relationships remain conditional; a rendered path does not
establish exploitability. A static graph and relationship table support printing
and browsers without JavaScript.

The **Agent Observatory** shows execution of the orchestration graph. It consumes
the selected session's actual event log: dispatches, guarded tool completions,
handoffs and memory events. Historical events are recorded activity; opening a
completed session does not start agents or turn a replay into a live assessment.

## Run live

The standalone live adapter currently uses Claude CLI and a bounded sample of
configuration fields across eight ARM resource types. It does not execute all
repository checks. The default limit is three reads per
specialist; `--max-reads-per-domain` accepts 1–20. See
[the live runtime scope](../tools/graph/LIVE.md) before presenting coverage.

Authenticate the intended account using an isolated Azure CLI configuration.
Prepare the engagement scope using the normal setup flow. Retain that configuration
locally with restrictive permissions. Then invoke the live runtime:

```bash
node tools/graph/run-live.mjs \
  --session engagements/<fresh-session> \
  --engagement engagements/<fresh-session>/engagement.yaml \
  --azure-config engagements/<fresh-session>/.azure \
  --concurrency 3
```

The installed model runtime must be authenticated. Live dispatch uses structured
model requests with native tools disabled. The host checks proposed Azure reads
against scope and read-only guards before execution. Failed authentication,
denied reads and missing evidence must remain visible failures or coverage gaps.

In a second terminal, open the observatory for that same session:

```bash
node tools/dashboard/server.mjs \
  --session engagements/<fresh-session> --port 4318
```

Open `http://127.0.0.1:4318`. The server binds only to loopback and exposes event
metadata, not raw tool outputs or credential files. It does not perform Azure
queries itself. Show the timeline and the selected agent's status while the
runtime executes; then inspect the resulting report and coverage.

`tools/graph/run-graph.mjs` remains a deterministic simulation/test harness.
Use `run-live.mjs` for actual model dispatch and guarded Azure reads.

## Demonstrate environment memory honestly

Run a second fresh session against the same tenant, subscription and mode.
Memory retrieval is scoped to that environment and the same specialist. The
runtime passes retained observations into specialist context. Evidence hashes
must still verify before observations can be reused.

Methodology observations become corroborated only after matching evidence-backed
outcomes from the same agent in at least two distinct runs. They cannot modify
security controls, executable code or agent policies. A retrieval or promotion
event demonstrates memory use; it does not prove better detection or faster
execution. Report measured improvement only when a comparable baseline and
subsequent outcome support it.

## Workshop sign-off

Check the actual live run completed, its report exists, and the dashboard received
that run's events. Review unavailable and partial checks alongside findings.
Confirm the displayed graph distinguishes modeled paths from confirmed evidence.
Check browser rendering before presenting. Preserve prior sessions for comparison
and verify Git contains only intended source changes before any publication.

## Show the AEF and code loops

Install the pinned AEF runtime using [the integration guide](../AGENT_INTEGRATION.md).
Choose a completed session in the dashboard, then run a local memory review to
watch actual verified records enter AEF, retrieval return context, and reflection
record its budget score. Select that run in the toolbar; expand timeline records
for source run IDs, transfer byte counts and evidence references. Packet motion
occurs only when an actual transfer event arrives, or while replaying one.

The green AEF nodes show consolidation, retrieval and reflection. The orange
nodes show the separate target code loop: propose, test, accept or reject.
Run `node tools/evolution/run.mjs engagements/<completed-session>` to evaluate
routing. Once the best fixed candidate is installed, another run should reject
it as unchanged. Do not deliberately break the working implementation for a demo;
replay the recorded accepted change and show the present rejection live.

The graph explains dependency order, parallel work, deterministic reduction and
bounded feedback. That explicit structure makes execution inspectable and memory
attributable. Avoid claiming graph orchestration is newly invented or that a
rendered edge proves an exploit or a model learned new weights.

Use **Evidence quality, round by round** to explain evaluator feedback. Each
recorded score links to a local round artifact containing the supplied inputs,
their hash, the judgment and the graph decision. A low score can still proceed
when the revision limit is reached. Compare these as model judgments; they are
not a controlled measurement of detection improvement. A local memory review
has no evaluator rounds, and the panel says so instead of inventing a score.

The dashboard retains the latest 2,000 valid event records; older records remain
in the local JSONL log. Timeline and memory feeds load in batches of 100. Individual
metadata fields and source/evidence lists are bounded and payload contents are
not served. Inspect the underlying local artifacts for full-fidelity audits.
