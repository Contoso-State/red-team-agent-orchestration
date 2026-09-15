# Agent Observatory

A local, dependency-free event dashboard for the actual orchestration run. It makes no Azure or model calls. It cannot start tasks, modify an engagement, or change learning policy.

An assessment started through the graph runner brings the Observatory up by itself, so a long
run is observable from its own first node instead of from whenever someone remembers to launch
a viewer:

```sh
node tools/graph/run-graph.mjs --engagement engagement.yaml --session engagements/<session>
```

The run prints the bound URL before the first node executes. Observability is best-effort and
never gates the engagement: if the port is taken or the dashboard faults, the run warns and
continues. Use `--dashboard-port <n>` for a second concurrent run, `--no-dashboard` to stay
headless, and `--dashboard-linger` to keep serving the finished run until Ctrl+C.

To attach a viewer to a session that is already running, or to re-open a completed one:

```sh
node tools/dashboard/server.mjs --session engagements/<session> --port 4318
```

Open `http://127.0.0.1:4318`. The selected directory must exist inside this repository's `engagements/` directory. The server binds only to IPv4 loopback. Stop it with Ctrl+C.

The server tails `<session>/runs/live-events.jsonl` and sends complete, allowlisted records over SSE. The three-dimensional map comes from the canonical graph; unobserved nodes are marked as such. Drag to orbit, scroll to zoom, use arrow keys while the canvas is focused, or select an agent with the accessible dropdown. Actual new events briefly highlight their node. There is no idle animation or invented agent activity. A running badge is the last reported state, not proof the process is still alive. Terminal runs appear idle. A missing log shows an empty waiting state.

History replay is explicitly labeled and advances recorded events at a presentation cadence. It does not reproduce original timing or launch work. Return to stream to follow current appends. Dry-run events remain labeled separately from live runs. The latest 2,000 valid events are retained; this is a bounded presentation window, not the canonical archive.

Memory panels distinguish retrieved records, inert candidates, promotions, evidence-integrity verification, and recorded measurements. Verification or promotion is never presented as measured improvement. Counts come from event metrics when supplied; otherwise a count denotes a recorded event. The timeline exposes the underlying metrics and references.

Direct methodology-memory library calls must wire Observatory emission explicitly. When a host calls `reflexionDebrief()` or `consolidateMethodology()` outside `tools/graph/run-graph.mjs`, pass the shared dashboard writer as `emitEvent` (or pass `session: "engagements/<session>"` so the library creates that writer with `createEventWriter`). Real experience writes emit `memory.candidate`; real knowledge promotions emit `memory.promoted`; no event is emitted for zero writes/promotions. If neither `emitEvent` nor `session` is supplied, memory still writes, but the dashboard will truthfully show no candidate/promotion events.

## Event contract

JSONL rows use `schema_version: 1`, `id` (nonnegative integer or safe identifier), ISO `ts`, and a supported `type`. Optional metadata fields are `session_id`, `run_id`, `agent_id`, `node_id`, `status`, `mode` (`live`, `dry-run`, `replay`), `from_agent`, `to_agent`, `task_id`, `metrics`, and session-relative `evidence_refs`.

Supported event families: `run.started/completed/failed`, `node.started/completed/failed`, `agent.started/completed/failed`, `tool.allowed/cached/completed/failed`, `message.sent`, `task.dispatched`, `memory.retrieved/verified/candidate/promoted/measured`, `evaluation.completed`, and `evolution.proposed/evaluated/accepted/rejected`. Handoffs require explicit sender and recipient metadata. Unknown event types are omitted and counted, not inferred from raw logs.

The evaluation panel shows each recorded model judgment and the canonical graph's
`refine` or `proceed` decision. Each round retains its rubric, exact supplied
findings/evidence, input SHA256, critique and routing parameters in an exclusive
`runs/<run-id>/evaluation-round-<revision>.json` artifact. Those contents stay
local; the viewer serves only metrics and the recorded reference. A revision
limit can make the graph proceed below its quality threshold. Neither proceeding
nor an increased judgment score establishes a security pass or a learning gain.

Free-form summaries, message bodies, model reasoning, commands, outputs, environment variables, and unknown fields are never forwarded. The UI generates neutral event summaries. Numeric metrics use a fixed allowlist. Producers must emit metadata only; this viewer is not a sanitizer for arbitrary customer data.

The dashboard is a reader, not an activity detector. Graph runs started with
`tools/graph/run-graph.mjs --session ...` emit lifecycle events automatically. Hosts that
dispatch agents directly must append lifecycle metadata themselves; otherwise the dashboard
truthfully reports no started, running, completed, or failed agents.

Producer boundaries are intentionally strict:

- `tools/dashboard/watch-session.mjs` can observe only local artifact changes under findings,
  evidence, inventory, and reports. It emits `tool.completed` and `message.sent` events for
  files that appear or grow. A findings file is not proof that its producer has finished, so the
  watcher never emits `agent.completed`, never infers completion from quiet periods, and never
  invents heartbeats.
- The dispatcher/orchestrator is the only producer that knows agent lifecycle. A direct host
  should use `tools/dashboard/agent-lifecycle.mjs`, which wraps the shared event writer and
  records only explicit `agent.started`, `agent.completed`, or `agent.failed` observations.

Both the watcher and lifecycle helper default to joining the latest non-watcher `run_id` already
present in `<session>/runs/live-events.jsonl`. That keeps artifact and lifecycle events in the
same dashboard run by default. Pass `--run-id` only when intentionally starting or targeting a
different recorded run.

```sh
node tools/dashboard/agent-lifecycle.mjs --session engagements/<session> \
  --type started --agent "Red Team Reporting" --node report --task reporting

node tools/dashboard/agent-lifecycle.mjs --session engagements/<session> \
  --type completed --agent "Red Team Reporting" --node report --task reporting
```

Evidence links return only the exact recorded reference and event provenance. They never read the referenced file, confirm its existence, or serve artifact contents. Inspect local artifacts through the normal authorized workspace workflow.

## Security and validation

There are no remote assets, external requests, write routes, directory listings, or arbitrary file endpoints. Static assets are a fixed allowlist. Event paths reject traversal and symlinks. Host/origin checks and a restrictive CSP prevent remote pages from embedding or reading the local UI. Malformed or oversized JSONL records are dropped; partial lines wait for completion. Slow SSE consumers are disconnected when their output buffer exceeds its bound.

```sh
node --test tools/dashboard/server.test.mjs
node --check tools/dashboard/public/app.js
```

## Memory review and exchange logging

The existing ninja asset is served locally. Timeline and memory entries show UTC timestamps, agent/run attribution, source run IDs, integrity outcomes, and recorded metrics. Model handoffs emit a correlated request and response (or failure), with serialized application payload sizes and elapsed time. These are application exchange sizes, not network traffic measurements; message contents and private reasoning are excluded.

To verify previously saved same-environment evidence locally:

```sh
node tools/memory/review-session.mjs engagements/<session>
```

This appends actual retrieval/hash-verification events with `run_kind: memory-review`. The UI labels the operation LOCAL MEMORY REVIEW and states that no Azure or model calls occur. It neither starts an assessment nor creates new corroborating observations. Changed evidence fails verification. The review refuses to run while an assessment holds `runs/live.lock`. Assessment producers may set `run_kind: assessment`; legacy events retain their existing behavior.
