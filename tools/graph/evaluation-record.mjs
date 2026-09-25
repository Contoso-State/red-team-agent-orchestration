import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defaultRouters } from './run-graph.mjs';

export const EVALUATION_RUBRIC = 'Evaluate evidence sufficiency, schema quality and overclaims. Return quality 0..1 and actionable notes. Coverage gaps honestly disclosed are not failed finding quality.';

/** Preserve the exact inputs and judgment for each round; never infer learning gain. */
export function recordEvaluation({ sessionDir, runId, revision, critique, params, candidates, evidence, emit }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(runId) || !Number.isInteger(revision) || revision < 1) throw Error('Invalid evaluation identity');
  if (!Number.isFinite(critique?.quality) || critique.quality < 0 || critique.quality > 1 || !Array.isArray(critique.notes) || critique.notes.some(note => typeof note !== 'string')) throw Error('Invalid evaluator judgment');
  const route = defaultRouters().route_after_evaluate({ critique, revision }, params);
  const inputs = { rubric: EVALUATION_RUBRIC, candidates, evidence };
  const input_sha256 = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
  const artifact = {
    schema_version: 1, run_id: runId, revision, recorded_at: new Date().toISOString(),
    score_kind: 'model-judgment', improvement_verified: false, comparison: 'not-controlled',
    route, params, input_sha256, inputs, critique,
  };
  const base = resolve(sessionDir);
  for (const directory of [base, join(base, 'runs'), join(base, 'runs', runId)]) {
    mkdirSync(directory, { recursive: true });
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw Error('Evaluation directory must be a real directory');
  }
  const ref = `runs/${runId}/evaluation-round-${revision}.json`;
  // Exclusive creation preserves earlier rounds and rejects a pre-existing file or link.
  writeFileSync(join(base, ref), JSON.stringify(artifact, null, 2), { mode: 0o600, flag: 'wx' });
  emit({ type: 'evaluation.completed', node_id: 'evaluate', agent_id: 'evaluator', status: 'completed',
    metrics: { quality: critique.quality, revision, candidates: candidates.length },
    evaluation: { kind: 'model-judgment', route, comparison: 'not-controlled' }, evidence_refs: [ref] });
  return artifact;
}
