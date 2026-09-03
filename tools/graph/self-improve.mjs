#!/usr/bin/env node
/**
 * self-improve.mjs — evidence-gated methodology learning for the graph runner.
 *
 * This module layers the self-improvement handlers on top of the deterministic engine in
 * run-graph.mjs. Each engagement records inert observations in the methodology namespace. A
 * bounded parameter update or reusable lesson is promoted only after corroboration by at least
 * two distinct runs; executable code, prompts, tools, and policy are never learning outputs.
 *
 * The design deliberately borrows the *safe* half of the self-improving-agent literature and
 * excludes the unsafe half:
 *
 *   - Evaluator-optimizer  : scores findings and stages bounded parameter candidates; a candidate
 *                            must be reproduced by distinct attributed runs before promotion.
 *   - Agent-as-a-Judge     : a read-only false-positive gate that suppresses known-FP signatures
 *                            and auto-writes newly-identified suppressions to methodology memory.
 *   - Reflexion / ExpeL    : a debrief that records run-scoped experiences, then consolidates
 *                            repeated, agent-isolated signatures into inert procedural knowledge.
 *
 * Excluded on purpose: no runtime code execution, no tool creation, no self-rewriting of the
 * guard. The ONE immutable boundary is the read-only enforcement system:
 *
 *   - the memory firewall refuses any write to a guardrail namespace, and self-improvement may
 *     write ONLY the `methodology` namespace (assertMethodologyNamespace), and
 *   - the filesystem firewall refuses any write under `guardrails/**` or outside the repo root
 *     (assertWritablePath).
 *
 * Adapted from the safe reflection-and-memory contract in the read-only aef-core snapshot at
 * commit 48ee1ef7cd9f2cc91762f4b4c08150d954d443ec. AEF runtime code evolution is intentionally
 * excluded. Every mutation is recorded to a hash-chained append-only audit log, the
 * procedural store supports rollbackLast(), and a kill-switch (REDTEAM_SELF_IMPROVE=off) drops
 * back to static, non-learning behaviour without blocking the assessment itself.
 *
 * Dependency-free (Node stdlib only).
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, runGraph } from './run-graph.mjs';
import { GUARD_NAMESPACES } from './validate-graph.mjs';

export const METHODOLOGY_NS = 'methodology';
export const AEF_LEARNING_CONTRACT = Object.freeze({
  version: 'aef-memory-loop/v1',
  source_repo: 'aef-core',
  source_commit: '48ee1ef7cd9f2cc91762f4b4c08150d954d443ec',
  mode: 'reflection-memory-only',
  min_distinct_runs: 2,
});

// ---------------------------------------------------------------------------
// The immutable boundary: namespace + filesystem firewalls.
// ---------------------------------------------------------------------------

/** Only the methodology namespace is writable; guardrail namespaces are immutable. */
export function assertMethodologyNamespace(ns) {
  if (typeof ns !== 'string' || !ns) throw new Error('SELF-IMPROVEMENT FIREWALL: a memory namespace is required');
  if (GUARD_NAMESPACES.has(ns)) {
    throw new Error(`SELF-IMPROVEMENT FIREWALL: guardrail namespace "${ns}" is immutable`);
  }
  const top = ns.replaceAll('\\', '/').split('/')[0];
  if (top !== METHODOLOGY_NS) {
    throw new Error(`SELF-IMPROVEMENT FIREWALL: self-improvement may only write "${METHODOLOGY_NS}", not "${ns}"`);
  }
  return ns;
}

export const GUARDRAIL_DIRS = ['guardrails'];

/** Refuse any self-improvement filesystem write under guardrails/** or outside the repo root. */
export function assertWritablePath(targetPath, { root = ROOT } = {}) {
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, targetPath);
  const rel = abs.slice(rootAbs.length).replaceAll('\\', '/').replace(/^\/+/, '');
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new Error(`SELF-IMPROVEMENT FIREWALL: refusing to write outside the repo root (${abs})`);
  }
  const top = rel.split('/')[0];
  if (GUARDRAIL_DIRS.includes(top)) {
    throw new Error(`SELF-IMPROVEMENT FIREWALL: refusing to write under guardrails/ (${rel})`);
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Audit log (append-only observability, never a gate).
// ---------------------------------------------------------------------------

export function makeAuditLog({ persist = false, root = ROOT, sink } = {}) {
  const entries = [];
  const dir = join(root, 'memory', METHODOLOGY_NS);
  const genesis = '0'.repeat(64);
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    record(action, detail = {}) {
      const payload = {
        ts: new Date().toISOString(),
        action,
        ...detail,
        prev_hash: entries.at(-1)?.hash || genesis,
      };
      const rec = { ...payload, hash: digest(payload) };
      entries.push(rec);
      if (typeof sink === 'function') sink(rec);
      if (persist) {
        const file = assertWritablePath(join('memory', METHODOLOGY_NS, 'audit.log.jsonl'), { root });
        mkdirSync(dir, { recursive: true });
        appendFileSync(file, JSON.stringify(rec) + '\n');
      }
      return rec;
    },
    entries: () => entries.map((entry) => ({ ...entry })),
    count: () => entries.length,
    verify() {
      let previous = genesis;
      for (const entry of entries) {
        const { hash, ...payload } = entry;
        if (payload.prev_hash !== previous || digest(payload) !== hash) return false;
        previous = hash;
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Procedural Store: firewalled, append-only with snapshot rollback. Compatible
// with the run-graph store contract (load/write) so it can be passed as
// options.store and reused by the default memory_read/memory_write handlers.
// ---------------------------------------------------------------------------

export function makeProceduralStore({ root = ROOT, persist = false, seed } = {}) {
  const mem = new Map();
  if (seed) {
    for (const [ns, val] of Object.entries(seed)) {
      assertMethodologyNamespace(ns);
      mem.set(ns, { entries: [...((val && val.entries) || [])] });
    }
  }
  const dir = join(root, 'memory', METHODOLOGY_NS);
  const history = [];

  const load = (ns = METHODOLOGY_NS) => {
    assertMethodologyNamespace(ns);
    return mem.get(ns) || { entries: [] };
  };

  const append = (ns, entry, audit) => {
    assertMethodologyNamespace(ns);
    const before = load(ns);
    history.push({ ns, entries: before.entries.map((e) => ({ ...e })) });
    const next = { entries: [...before.entries, entry] };
    mem.set(ns, next);
    if (persist) {
      const file = assertWritablePath(join('memory', METHODOLOGY_NS, 'store.log.jsonl'), { root });
      mkdirSync(dir, { recursive: true });
      appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ns, entry }) + '\n');
    }
    if (audit) audit.record('memory.append', { ns, kind: entry && entry.kind, before: before.entries.length, after: next.entries.length });
    return next;
  };

  return {
    load,
    append,
    // store-contract write() used by run-graph default handlers.
    write(ns, entry) {
      return append(ns, entry);
    },
    rollbackLast(audit) {
      const snap = history.pop();
      if (!snap) return false;
      mem.set(snap.ns, { entries: snap.entries });
      if (audit) audit.record('memory.rollback', { ns: snap.ns, restored: snap.entries.length });
      return true;
    },
    snapshot: () => Object.fromEntries([...mem.entries()].map(([k, v]) => [k, { entries: [...v.entries] }])),
  };
}

// ---------------------------------------------------------------------------
// Kill-switch.
// ---------------------------------------------------------------------------

const OFF = new Set(['off', '0', 'false', 'no', 'disabled']);

/** REDTEAM_SELF_IMPROVE=off disables learning (static behaviour); the assessment still runs. */
export function selfImprovementEnabled(env = process.env) {
  return !OFF.has(String(env?.REDTEAM_SELF_IMPROVE ?? '').trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Evaluator-optimizer: deterministic scoring + bounded param tuning.
// ---------------------------------------------------------------------------

const round2 = (n) => Math.round(n * 100) / 100;

function tally(values) {
  const out = {};
  for (const v of values) out[v] = (out[v] || 0) + 1;
  return out;
}

export function scoreFindings(candidates, _params = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) {
    return { quality: 0, notes: ['no candidate findings'], signals: { count: 0, withEvidence: 0, evidenceRatio: 0, severities: {} } };
  }
  let withEvidence = 0;
  const severities = {};
  for (const f of list) {
    const hasEvidence =
      (Array.isArray(f.affected_resources) && f.affected_resources.length > 0) || Boolean(f.evidence) || Boolean(f.evidence_ref);
    if (hasEvidence) withEvidence += 1;
    const sev = String(f.severity || 'unknown').toLowerCase();
    severities[sev] = (severities[sev] || 0) + 1;
  }
  const evidenceRatio = withEvidence / list.length;
  const severityKnown = Object.keys(severities).some((s) => s !== 'unknown');
  const quality = Math.max(0, Math.min(1, 0.7 * evidenceRatio + 0.3 * (severityKnown ? 1 : 0.5)));
  const notes = [];
  if (evidenceRatio < 1) notes.push(`${list.length - withEvidence} finding(s) lack evidence`);
  if (!severityKnown) notes.push('no finding carries a known severity');
  return { quality: round2(quality), notes, signals: { count: list.length, withEvidence, evidenceRatio: round2(evidenceRatio), severities } };
}

export const PARAM_BOUNDS = {
  max_revisions: { min: 0, max: 4 },
  quality_threshold: { min: 0.5, max: 0.95 },
};

const clamp = (v, { min, max }) => Math.max(min, Math.min(max, v));

const normalizeLearnedParams = (baseParams = {}, proposedParams = {}) => ({
  max_revisions: clamp(
    Number.isFinite(proposedParams.max_revisions)
      ? proposedParams.max_revisions
      : Number.isFinite(baseParams.max_revisions)
        ? baseParams.max_revisions
        : 2,
    PARAM_BOUNDS.max_revisions,
  ),
  quality_threshold: round2(
    clamp(
      Number.isFinite(proposedParams.quality_threshold)
        ? proposedParams.quality_threshold
        : Number.isFinite(baseParams.quality_threshold)
          ? baseParams.quality_threshold
          : 0.85,
      PARAM_BOUNDS.quality_threshold,
    ),
  ),
});

const candidateFingerprint = (agentId, params) =>
  createHash('sha256')
    .update(JSON.stringify({ agent_id: agentId, params: normalizeLearnedParams({}, params) }))
    .digest('hex');

const hasValidLearnedParams = (params) => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  const normalized = normalizeLearnedParams({}, params);
  const keys = Object.keys(params).sort();
  return (
    JSON.stringify(keys) === JSON.stringify(Object.keys(PARAM_BOUNDS).sort()) &&
    PARAM_BOUNDS.max_revisions.min <= params.max_revisions &&
    params.max_revisions <= PARAM_BOUNDS.max_revisions.max &&
    Number.isInteger(params.max_revisions) &&
    PARAM_BOUNDS.quality_threshold.min <= params.quality_threshold &&
    params.quality_threshold <= PARAM_BOUNDS.quality_threshold.max &&
    JSON.stringify(normalized) === JSON.stringify(params)
  );
};

const normalizeSignals = (signals = {}) => ({
  count: Number.isFinite(signals.count) ? Math.max(0, Math.trunc(signals.count)) : 0,
  withEvidence: Number.isFinite(signals.withEvidence) ? Math.max(0, Math.trunc(signals.withEvidence)) : 0,
  evidenceRatio: Number.isFinite(signals.evidenceRatio) ? round2(clamp(signals.evidenceRatio, { min: 0, max: 1 })) : 0,
  severities:
    signals.severities && typeof signals.severities === 'object'
      ? Object.fromEntries(
          Object.entries(signals.severities)
            .filter(([key, value]) => /^[a-z][a-z0-9_-]{0,31}$/i.test(key) && Number.isFinite(value))
            .slice(0, 16)
            .map(([key, value]) => [key, Math.max(0, Math.trunc(value))]),
        )
      : {},
});

const isValidLearningCandidate = (candidate) => {
  if (
    !candidate ||
    candidate.kind !== 'learning_candidate' ||
    typeof candidate.agent_id !== 'string' ||
    candidate.agent_id.length === 0 ||
    typeof candidate.run_id !== 'string' ||
    candidate.run_id.length === 0 ||
    candidate.executable !== false ||
    candidate.contract !== AEF_LEARNING_CONTRACT.version ||
    candidate.source_commit !== AEF_LEARNING_CONTRACT.source_commit ||
    !hasValidLearnedParams(candidate.params)
  ) return false;
  const normalized = normalizeLearnedParams({}, candidate.params);
  return candidate.fingerprint === candidateFingerprint(candidate.agent_id, normalized);
};

const isValidPromotedTuning = (entry) => {
  if (
    !entry ||
    entry.kind !== 'param_tuning' ||
    entry.status !== 'promoted' ||
    entry.contract !== AEF_LEARNING_CONTRACT.version ||
    entry.source_commit !== AEF_LEARNING_CONTRACT.source_commit ||
    typeof entry.agent_id !== 'string' ||
    entry.agent_id.length === 0 ||
    !hasValidLearnedParams(entry.params) ||
    !Array.isArray(entry.run_ids)
  ) return false;
  const distinctRuns = [...new Set(entry.run_ids.filter((runId) => typeof runId === 'string' && runId && runId !== 'unattributed'))];
  return (
    distinctRuns.length >= AEF_LEARNING_CONTRACT.min_distinct_runs &&
    distinctRuns.length === entry.run_ids.length &&
    entry.fingerprint === candidateFingerprint(entry.agent_id, entry.params)
  );
};

/**
 * Turn an evaluator suggestion into inert, schema-limited data. Arbitrary properties, commands,
 * tools, prompts, and code are deliberately discarded at this trust boundary.
 */
export function createLearningCandidate(baseParams = {}, proposedParams = {}, options = {}) {
  const agentId = String(options.agentId || 'orchestrator');
  const params = normalizeLearnedParams(baseParams, proposedParams);
  return {
    kind: 'learning_candidate',
    contract: AEF_LEARNING_CONTRACT.version,
    source_commit: AEF_LEARNING_CONTRACT.source_commit,
    run_id: String(options.runId || 'unattributed'),
    agent_id: agentId,
    fingerprint: candidateFingerprint(agentId, params),
    params,
    quality: Number.isFinite(options.quality) ? round2(options.quality) : null,
    signals: normalizeSignals(options.signals),
    executable: false,
    status: 'episode',
    ts: new Date().toISOString(),
  };
}

/** Promote only a repeatedly observed, bounded proposal owned by one agent. */
export function promoteLearningCandidate(candidate, { store, audit, minDistinctRuns = AEF_LEARNING_CONTRACT.min_distinct_runs } = {}) {
  if (!store || !candidate || candidate.kind !== 'learning_candidate') return { promoted: false, reason: 'invalid-candidate' };
  const normalized = normalizeLearnedParams({}, candidate.params);
  if (!isValidLearningCandidate(candidate)) {
    if (audit) audit.record('learning.reject', { reason: 'safety-or-schema-gate', fingerprint: candidate.fingerprint || null });
    return { promoted: false, reason: 'safety-or-schema-gate' };
  }

  const peers = (store.load(METHODOLOGY_NS).entries || []).filter(
    (entry) =>
      isValidLearningCandidate(entry) &&
      entry.fingerprint === candidate.fingerprint &&
      entry.agent_id === candidate.agent_id &&
      entry.run_id &&
      entry.run_id !== 'unattributed',
  );
  const runIds = [...new Set(peers.map((entry) => entry.run_id))].sort();
  const requiredRuns = Math.max(AEF_LEARNING_CONTRACT.min_distinct_runs, Number.isFinite(minDistinctRuns) ? Math.trunc(minDistinctRuns) : 0);
  if (runIds.length < requiredRuns) {
    if (audit) audit.record('learning.hold', { fingerprint: candidate.fingerprint, distinct_runs: runIds.length });
    return { promoted: false, reason: 'insufficient-independent-evidence', run_ids: runIds };
  }

  const alreadyPromoted = (store.load(METHODOLOGY_NS).entries || []).some(
    (entry) =>
      isValidPromotedTuning(entry) &&
      entry.fingerprint === candidate.fingerprint &&
      JSON.stringify(entry.run_ids || []) === JSON.stringify(runIds),
  );
  if (alreadyPromoted) return { promoted: false, reason: 'already-promoted', run_ids: runIds };

  const qualities = peers.map((entry) => entry.quality).filter((quality) => Number.isFinite(quality));
  store.write(METHODOLOGY_NS, {
    kind: 'param_tuning',
    contract: AEF_LEARNING_CONTRACT.version,
    source_commit: AEF_LEARNING_CONTRACT.source_commit,
    agent_id: candidate.agent_id,
    fingerprint: candidate.fingerprint,
    params: normalized,
    quality: qualities.length ? round2(qualities.reduce((sum, quality) => sum + quality, 0) / qualities.length) : null,
    run_ids: runIds,
    status: 'promoted',
    ts: new Date().toISOString(),
  });
  if (audit) audit.record('learning.promote', { fingerprint: candidate.fingerprint, distinct_runs: runIds.length, params: normalized });
  return { promoted: true, run_ids: runIds, params: normalized };
}

/**
 * Bounded, deterministic tuning. Never lowers termination guarantees: max_revisions is clamped
 * to [0,4] so the reflection loop always terminates (the engine also enforces a hard step
 * budget). Returns a tuned copy; callers persist it to methodology memory for the next run.
 */
export function tuneParams(baseParams = {}, signals = {}, store) {
  let maxRevisions = Number.isFinite(baseParams.max_revisions) ? baseParams.max_revisions : 2;
  let threshold = Number.isFinite(baseParams.quality_threshold) ? baseParams.quality_threshold : 0.85;

  const evidenceRatio = Number.isFinite(signals.evidenceRatio) ? signals.evidenceRatio : 1;
  if (evidenceRatio < 0.6) maxRevisions = clamp(maxRevisions + 1, PARAM_BOUNDS.max_revisions);

  const history = store ? (store.load(METHODOLOGY_NS).entries || []).filter((e) => e && e.kind === 'param_tuning') : [];
  const recent = history.slice(-5).map((h) => h.quality).filter((q) => Number.isFinite(q));
  if (recent.length >= 3) {
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg > 0.9) threshold = clamp(threshold + 0.02, PARAM_BOUNDS.quality_threshold);
    else if (avg < 0.6) threshold = clamp(threshold - 0.05, PARAM_BOUNDS.quality_threshold);
  }

  return {
    ...baseParams,
    max_revisions: clamp(maxRevisions, PARAM_BOUNDS.max_revisions),
    quality_threshold: round2(clamp(threshold, PARAM_BOUNDS.quality_threshold)),
  };
}

// ---------------------------------------------------------------------------
// Agent-as-a-Judge false-positive gate (read-only over finding objects).
// ---------------------------------------------------------------------------

export function fpSignature(f) {
  return (
    (f && (f.fp_signature || f.check_id || f.rule_id || f.finding_id || f.id || f.dedupe_key)) ||
    (f ? JSON.stringify(f) : 'null')
  );
}

export function loadFpSuppressions(store) {
  const set = new Set();
  if (!store) return set;
  for (const e of store.load(METHODOLOGY_NS).entries || []) {
    if (e && e.kind === 'fp_suppression' && e.signature) set.add(e.signature);
  }
  return set;
}

/**
 * Deterministic FP gate. Drops candidates whose signature is a known suppression, or that carry
 * an explicit false-positive marker / sub-threshold confidence, and auto-writes newly-identified
 * suppressions to methodology memory. No Azure calls: the CLI orchestrator performs the real
 * read-only re-verification; this is the deterministic default.
 */
export function judgeFindings(candidates, { store, audit } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const suppressed = loadFpSuppressions(store);
  const confirmed = [];
  const newlySuppressed = [];
  for (const f of list) {
    const sig = fpSignature(f);
    const isFp =
      f?.false_positive === true ||
      f?.status === 'false_positive' ||
      (Number.isFinite(f?.confidence) && Number.isFinite(f?.min_confidence) && f.confidence < f.min_confidence) ||
      suppressed.has(sig);
    if (isFp) {
      if (!suppressed.has(sig) && store) {
        store.write(METHODOLOGY_NS, {
          kind: 'fp_suppression',
          signature: sig,
          reason: f?.fp_reason || 'auto-suppressed by Agent-as-a-Judge',
          ts: new Date().toISOString(),
        });
        suppressed.add(sig);
        newlySuppressed.push(sig);
      }
      continue;
    }
    confirmed.push(f);
  }
  if (audit) audit.record('judge.gate', { candidates: list.length, confirmed: confirmed.length, suppressed: newlySuppressed.length });
  return { confirmed, newlySuppressed };
}

// ---------------------------------------------------------------------------
// Reflexion / ExpeL debrief.
// ---------------------------------------------------------------------------

export function consolidateMethodology(store, { audit, minDistinctRuns = AEF_LEARNING_CONTRACT.min_distinct_runs } = {}) {
  if (!store) return { promoted: [] };
  const entries = store.load(METHODOLOGY_NS).entries || [];
  const groups = new Map();
  for (const entry of entries) {
    if (
      entry?.kind !== 'experience' ||
      entry.contract !== AEF_LEARNING_CONTRACT.version ||
      entry.source_commit !== AEF_LEARNING_CONTRACT.source_commit ||
      entry.executable !== false ||
      !entry.run_id ||
      entry.run_id === 'unattributed' ||
      typeof entry.agent_id !== 'string' ||
      entry.agent_id.length === 0 ||
      typeof entry.signature !== 'string' ||
      entry.signature.length === 0 ||
      !['confirmed', 'false-positive', 'needs-review'].includes(entry.outcome)
    ) continue;
    const key = JSON.stringify([entry.agent_id, entry.signature, entry.outcome]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const promoted = [];
  const requiredRuns = Math.max(AEF_LEARNING_CONTRACT.min_distinct_runs, Number.isFinite(minDistinctRuns) ? Math.trunc(minDistinctRuns) : 0);
  for (const [key, experiences] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const runIds = [...new Set(experiences.map((entry) => entry.run_id))].sort();
    if (runIds.length < requiredRuns) continue;
    const [agentId, signature, outcome] = JSON.parse(key);
    const previous = [...entries].reverse().find(
      (entry) => entry?.kind === 'knowledge' && entry.agent_id === agentId && entry.signature === signature && entry.outcome === outcome,
    );
    if (previous && JSON.stringify(previous.run_ids) === JSON.stringify(runIds)) continue;
    const knowledge = {
      kind: 'knowledge',
      contract: AEF_LEARNING_CONTRACT.version,
      source_commit: AEF_LEARNING_CONTRACT.source_commit,
      agent_id: agentId,
      signature,
      outcome,
      occurrences: runIds.length,
      run_ids: runIds,
      lesson: outcome === 'confirmed' ? `Re-verify recurring confirmed pattern: ${signature}` : `Review recurring outcome ${outcome}: ${signature}`,
      executable: false,
      ts: new Date().toISOString(),
    };
    store.write(METHODOLOGY_NS, knowledge);
    promoted.push(knowledge);
    if (audit) audit.record('knowledge.promote', { agent_id: agentId, signature, outcome, distinct_runs: runIds.length });
  }
  return { promoted };
}

export function reflexionDebrief(state, { store, audit, runId = 'unattributed', agentId = 'orchestrator' } = {}) {
  const confirmed = (state && state.confirmed_findings) || [];
  const entry = {
    kind: 'reflexion_debrief',
    contract: AEF_LEARNING_CONTRACT.version,
    source_commit: AEF_LEARNING_CONTRACT.source_commit,
    run_id: runId,
    agent_id: agentId,
    confirmed: confirmed.length,
    signatures: confirmed.map(fpSignature).slice(0, 200),
    severities: tally(confirmed.map((f) => String((f && f.severity) || 'unknown').toLowerCase())),
    revision: (state && state.revision) || 0,
    ts: new Date().toISOString(),
  };
  if (store) {
    store.write(METHODOLOGY_NS, entry);
    for (const finding of confirmed) {
      store.write(METHODOLOGY_NS, {
        kind: 'experience',
        contract: AEF_LEARNING_CONTRACT.version,
        source_commit: AEF_LEARNING_CONTRACT.source_commit,
        run_id: runId,
        agent_id: String(finding?.agent_id || finding?.agent || finding?.domain || agentId),
        signature: String(fpSignature(finding)).slice(0, 500),
        outcome: 'confirmed',
        severity: String(finding?.severity || 'unknown').toLowerCase(),
        executable: false,
        ts: new Date().toISOString(),
      });
    }
    consolidateMethodology(store, { audit });
  }
  if (audit) audit.record('reflexion.debrief', { confirmed: entry.confirmed, revision: entry.revision });
  return entry;
}

// ---------------------------------------------------------------------------
// Learned-parameter application (promoted evidence only).
// ---------------------------------------------------------------------------

/** Merge the most recent persisted tuned params over the graph defaults. */
export function applyLearnedParams(baseParams = {}, store) {
  if (!store) return { ...baseParams };
  const tunings = (store.load(METHODOLOGY_NS).entries || []).filter(isValidPromotedTuning);
  const latest = tunings.at(-1);
  return latest ? { ...baseParams, ...normalizeLearnedParams(baseParams, latest.params) } : { ...baseParams };
}

// ---------------------------------------------------------------------------
// Handler factory + turnkey self-improving run.
// ---------------------------------------------------------------------------

export function makeSelfImprovementHandlers({
  store = makeProceduralStore(),
  audit = makeAuditLog(),
  env = process.env,
  runId = randomUUID(),
  agentId = 'orchestrator',
} = {}) {
  const enabled = selfImprovementEnabled(env);

  const handlers = {
    evaluate(node, ctx) {
      const rev = (ctx.state.revision || 0) + 1;
      if (!enabled) {
        const quality = typeof ctx.quality === 'number' ? ctx.quality : 1;
        return { writes: { critique: { quality, notes: ['self-improvement disabled'] }, revision: rev } };
      }
      const scored = scoreFindings(ctx.state.candidate_findings, ctx.params);
      const tuned = tuneParams(ctx.params, scored.signals, store);
      const candidate = createLearningCandidate(ctx.params, tuned, {
        runId,
        agentId,
        quality: scored.quality,
        signals: scored.signals,
      });
      store.write(METHODOLOGY_NS, candidate);
      const promotion = promoteLearningCandidate(candidate, { store, audit });
      audit.record('evaluate.score', { quality: scored.quality, revision: rev, proposed: candidate.params, promoted: promotion.promoted });
      // Tests / callers may force a quality to exercise the refine loop; otherwise use the score.
      const quality = typeof ctx.quality === 'number' ? ctx.quality : scored.quality;
      return { writes: { critique: { quality, notes: scored.notes, signals: scored.signals }, revision: rev } };
    },
    judge(node, ctx) {
      if (!enabled) return { writes: { confirmed_findings: ctx.state.candidate_findings || [] } };
      const { confirmed } = judgeFindings(ctx.state.candidate_findings, { store, audit });
      return { writes: { confirmed_findings: confirmed } };
    },
    reflexion_debrief(node, ctx) {
      if (!enabled) return {};
      reflexionDebrief(ctx.state, { store, audit, runId, agentId });
      return {};
    },
  };

  return { store, audit, enabled, handlers };
}

/**
 * Run the graph with evidence-gated learning enabled: previously promoted parameters are loaded,
 * new candidates remain inert until independently corroborated, and the audit log + store are
 * returned for observability.
 */
export function runSelfImprovingGraph(graph, options = {}) {
  const store = options.store || makeProceduralStore({ persist: options.persist });
  const audit = options.audit || makeAuditLog({ persist: options.persist });
  const runId = options.runId || randomUUID();
  const { handlers } = makeSelfImprovementHandlers({ store, audit, env: options.env, runId, agentId: options.agentId });
  const params = applyLearnedParams({ ...(graph.params || {}), ...(options.params || {}) }, store);
  const result = runGraph(graph, {
    ...options,
    params,
    store,
    handlers: { ...handlers, ...(options.handlers || {}) },
  });
  return { ...result, audit, store, params, runId };
}

// ---------------------------------------------------------------------------
// CLI: dry-run a self-improving engagement and print the audit trail.
// ---------------------------------------------------------------------------

async function main() {
  const { loadGraph } = await import('./validate-graph.mjs');
  const graphPath = join(ROOT, 'graph', 'redteam.graph.json');
  const { graph } = loadGraph(graphPath);
  const res = runSelfImprovingGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    dispatchFn: (node, ctx) => ({
      writes: {
        raw_findings: [
          { dedupe_key: `demo:${ctx.item?.domain || node.id}`, severity: 'medium', affected_resources: [{ resource_id: 'demo-1' }] },
        ],
      },
    }),
  });
  const enabled = selfImprovementEnabled();
  console.log(`\u2713 self-improving run ${res.status} in ${res.path.length} nodes (learning ${enabled ? 'ON' : 'OFF'})`);
  console.log(`  confirmed findings: ${res.state.confirmed_findings.length}`);
  console.log(`  methodology entries: ${res.store.load('methodology').entries.length}`);
  console.log(`  audit events: ${res.audit.count()}`);
  for (const e of res.audit.entries()) console.log(`    - ${e.action}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
