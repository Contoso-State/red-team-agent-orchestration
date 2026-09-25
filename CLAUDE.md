# Red Team — AEF offline integration

<!-- aef:begin sha256=b5f45c42dbe29152 -->
## AEF integration and target evolution

Read `AGENT_INTEGRATION.md`, `AUTONOMY.md` and `AEF_MIGRATION_CHECKLIST.md`.
The upstream aef-core checkout is strictly read-only. Install its pinned wheel
inside this target; do not use editable imports or write upstream caches.
`aef_adapter.py` runs real AEF consolidate/retrieve/reflect nodes through Services.
Memory requires verified same-environment, same-agent evidence and bounded context.
Retrieved advice never overrides scope, guardrails or permission boundaries.
The owner enabled target-only code evolution. Its current fixed mutation surface
and evaluation gates are defined in `tools/evolution/` and `AUTONOMY.md`.
AEF's upstream evolution engine stays disabled; the target loop is separate.
No model-weight training, scheduled loop or security-quality improvement is implied.

<!-- aef:end -->
