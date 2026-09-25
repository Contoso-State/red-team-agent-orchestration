# Target code evolution contract

The owner explicitly enabled code evolution in Red Team while keeping aef-core
read-only. `tools/evolution/config.json` enables a finite local optimizer with a
maximum of two rounds per invocation. There is no scheduled background loop.

The initial objective is correct attribution of actual agent IDs to graph nodes.
Only `tools/dashboard/public/node-resolver.mjs` may be replaced. Candidates come
from a deterministic generator, never arbitrary model output or memory text.
This is a real measured code change with a narrow mutation surface; it is not a
general-purpose source-code optimizer or model-weight training.

## Acceptance and stop conditions

The runner requires this checkout on a `codex/` branch, a direct ignored
engagement directory and no active assessment lock. It preserves all canonical
routing cases and requires a strict improvement on the fixed alias challenge
against both the incumbent and null control. Challenge cases are known to the
generator; they are regression coverage, not a held-out quality evaluation.
An unchanged or regressing candidate is rejected. Concurrent code changes abort
application. Candidate code and decisions are saved before/after evaluation in
`engagements/<session>/runs/evolution-<run-id>/` and the real event stream records
proposal, evaluation and acceptance/rejection. The runner never commits or pushes.

```bash
node tools/evolution/run.mjs engagements/<completed-session>
REDTEAM_CODE_EVOLUTION=off node tools/evolution/run.mjs engagements/<completed-session>
```

Guardrails, policies, engagement scope, evaluators and the AEF source are outside
the mutation surface. The existing read-only Azure boundary remains enforced.
Methodology learning still writes only to `memory/methodology/`; the separate
code loop cannot turn a retrieved lesson into executable instructions.

## Validation

```bash
node --test
node tools/graph/validate-graph.mjs
node tools/agents/build-agent-defs.mjs --check
```

Memory tests invoke the installed target AEF runtime. Browser verification must
cover desktop/mobile rendering, real stream updates, historical replay labels,
packet motion, run filters and provenance. Report unsupported coverage and
unmeasured security gains. A tool-enforced assessment block stops dependent
live work; it is not permission to switch tools and retry the same action.
