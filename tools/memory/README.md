# Environment-scoped workshop memory

`workshop-memory.mjs` provides the live adapter's inert prior-run memory. Unlike the simulated graph's in-memory procedural store, it reloads persisted observations across process restarts. Target-derived records stay exclusively in ignored `engagements/<session>/memory/methodology/<runId>.json`. It never writes Codex global memory, tracked methodology files, prompts, tools, parameters or security policy.

## Runtime integration

```js
const hooks = createLiveMemoryHooks({ sessionDir, runId, scope, emit });
const context = await hooks.load();       // canonical memory_load node
const result = await hooks.record(state); // canonical reflexion_debrief node
```

`scope` contains `tenantId`, `subscriptionId` (or `subscriptionIds`) and `mode`. The stable environment key binds all three; subscription ordering is normalized. Load returns separate `agents` buckets. Supply each specialist only its own bucket. Records are historical hints, never current configuration evidence or instructions. No previous manifest means zero retrieved records, even when old reports exist.

The hook accepts `state.confirmed_findings` and records a candidate only when its ID, check ID and agent occur together in both an existing session `findings/raw/*.jsonl` artifact and `findings/judged.jsonl`. Both artifacts are hashed. Override the latter with session-relative paths in `state.memory_judge_artifacts` when the runtime uses another judged output path. Raw candidates alone cannot become confirmed memory. It records hashes, bounded check/signature fields and outcome labels, not finding text. The lower-level `createWorkshopMemory({root,session,environment,runId,onEvent})` also exposes `retrieve(agent)` and `recordDebrief({agent,observations})` for judged suppressions or coverage gaps. Each observation must supply `checkId`, bounded `signature`, `outcome` (`confirmed`, `suppressed`, `coverage-gap`) and nonempty `evidence:[{path,sha256}]`. Evidence paths are relative to their source session (`sourceSession` on retrieved records is repository-relative); realpath containment and content digests are verified. Callers remain responsible for the correctness of the judged outcome.

## Evidence gates and truthful events

- `memory.retrieved`: verified historical records retrieved for the exact environment and agent. The current run is excluded.
- `memory.verified`: source file content matches the recorded digest. This means evidence integrity, **not** independent security validation or improved assessment quality.
- `memory.candidate`: an inert, attributed observation was persisted. Replaying a run ID does not add corroboration.
- `memory.promoted`: the same agent/check/signature/outcome was corroborated in at least two distinct run IDs for this environment. The resulting knowledge remains an inert observation; no automatic suppression, permission change or prompt rewrite follows.

Every return includes `improvementVerified:false`. A measured improvement requires a separate evaluation with real outcomes; candidate count or repeated evidence does not establish it. Missing, changed or malformed historical evidence is excluded on retrieval. Hashes detect changed files, not malicious coordinated replacement of both evidence and manifest. Local files are a trusted operator boundary.

`REDTEAM_SELF_IMPROVE=off` bypasses historical retrieval, the AEF runtime, and all memory recording, including AEF reports and checkpoints. The caller can continue the assessment without an installed AEF runtime; the returned memory state identifies the disabled engine. Learning remains enabled when the variable is unset. Tests cover distinct runs, agent/environment isolation, changed evidence, path traversal, symlink escape and live artifact attribution:

```sh
node --test tools/memory/workshop-memory.test.mjs
```
