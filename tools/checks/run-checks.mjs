#!/usr/bin/env node
/**
 * run-checks.mjs — deterministic, zero-LLM security check engine.
 *
 * This is the "script-accelerated" half of the agent-led red team. A domain
 * agent DISPATCHES this engine for its predicate-backed checks instead of
 * pulling raw Azure JSON into context and hand-evaluating every resource. The
 * engine:
 *   1. loads one or more predicate packs (schemas/predicate-pack.schema.json),
 *   2. evaluates each check's predicate against candidate rows (an ARG/az query
 *      result the caller already produced, or a cached fact set),
 *   3. aggregates matched rows into findings (one per finding_class x
 *      subscription, affected_resources[] unioned),
 *   4. writes schema-valid candidate findings to
 *      findings/raw/<agent>.engine.jsonl, and
 *   5. writes a COMPACT triage summary to findings/summary/<agent>.json — the
 *      few-hundred-token artifact the agent actually reads.
 *
 * The agent then confirms / contextualizes / suppresses over the summary; it
 * never sees the raw rows. Predicate-backed checks therefore cost ~0 LLM tokens
 * to evaluate.
 *
 * Usage:
 *   node tools/checks/run-checks.mjs --predicates checks/storage/predicates.json \
 *     --rows rows.json [--agent data-protection] [--session engagements/<s>] \
 *     [--out <dir>] [--dry-run]
 *
 * --rows is a JSON object keyed by check_id, each value an array of candidate
 * rows (or { "rows": [...] }). A bare array applies to every loaded check.
 *
 * Read-only. Dependency-free (node:* only). Never calls Azure itself.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Predicate evaluation (pure)
// ---------------------------------------------------------------------------

/** Safely resolve a dot-path into a nested object. Returns undefined on miss. */
export function getPath(obj, path) {
  if (obj == null || typeof path !== 'string' || path === '') return undefined;
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Parse a dotted/underscored version-ish string (TLS1_2, 1.2) into numbers. */
function versionParts(v) {
  return String(v).match(/\d+/g)?.map(Number) ?? [];
}
function versionLt(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

const norm = (s) => String(s).toLowerCase();

/** Evaluate a single leaf comparison against a row. */
function evalLeaf(leaf, row) {
  const actual = getPath(row, leaf.field);
  const v = leaf.value;
  switch (leaf.op) {
    case 'exists': return actual !== undefined && actual !== null;
    case 'missing': return actual === undefined || actual === null;
    case 'eq': return actual === v;
    case 'ne': return actual !== v;
    case 'eqi': return actual != null && norm(actual) === norm(v);
    case 'in': return Array.isArray(v) && v.includes(actual);
    case 'ini': return Array.isArray(v) && actual != null && v.map(norm).includes(norm(actual));
    case 'nin': return Array.isArray(v) && !v.includes(actual);
    case 'gt': return typeof actual === 'number' && actual > v;
    case 'gte': return typeof actual === 'number' && actual >= v;
    case 'lt': return typeof actual === 'number' && actual < v;
    case 'lte': return typeof actual === 'number' && actual <= v;
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(v);
      return actual != null && String(actual).includes(String(v));
    case 'ncontains':
      if (Array.isArray(actual)) return !actual.includes(v);
      return actual == null || !String(actual).includes(String(v));
    case 'regex': return actual != null && new RegExp(v).test(String(actual));
    case 'version_lt': return actual != null && versionLt(actual, v);
    default: throw new Error(`Unknown predicate op: ${leaf.op}`);
  }
}

/** Evaluate a predicate (all/any/not/leaf) against a row → boolean. */
export function evalPredicate(pred, row) {
  if (pred == null || typeof pred !== 'object') throw new Error('Invalid predicate');
  if (Array.isArray(pred.all)) return pred.all.every((p) => evalPredicate(p, row));
  if (Array.isArray(pred.any)) return pred.any.some((p) => evalPredicate(p, row));
  if (pred.not !== undefined) return !evalPredicate(pred.not, row);
  if (typeof pred.field === 'string' && typeof pred.op === 'string') return evalLeaf(pred, row);
  throw new Error('Predicate is neither all/any/not nor a leaf');
}

// ---------------------------------------------------------------------------
// Row normalization + finding assembly
// ---------------------------------------------------------------------------

const firstDefined = (...xs) => xs.find((x) => x !== undefined && x !== null);

/** Map an arbitrary ARG/az row to the affected_resources[] entry shape. */
export function rowToAffected(row) {
  const out = {
    resource_id: firstDefined(row.resource_id, row.id, row.resourceId, ''),
  };
  const sub = firstDefined(row.subscription_id, row.subscriptionId);
  const rg = firstDefined(row.resource_group, row.resourceGroup);
  const type = firstDefined(row.type, row.resourceType);
  const region = firstDefined(row.region, row.location);
  const name = firstDefined(row.name);
  if (sub != null) out.subscription_id = sub;
  if (rg != null) out.resource_group = rg;
  if (type != null) out.type = type;
  if (region != null) out.region = region;
  if (name != null) out.name = name;
  return out;
}

/** Build a compact, redaction-safe evidence string from evidence_fields. */
export function evidenceSummary(entry, row) {
  const parts = [];
  for (const f of entry.evidence_fields || []) {
    const val = getPath(row, f);
    if (val === undefined) continue;
    const short = f.includes('.') ? f.slice(f.lastIndexOf('.') + 1) : f;
    parts.push(`${short}=${JSON.stringify(val)}`);
  }
  return parts.join('; ') || 'predicate matched';
}

const PAD = (n) => String(n).padStart(3, '0');

/**
 * Build a schema-valid candidate finding for one (finding_class, subscription)
 * group of matched rows.
 */
export function buildFinding(entry, subscriptionId, rows, seq, now) {
  const affected = rows.map(rowToAffected);
  const rep = affected[0] || { resource_id: '' };
  const dedupeSub = subscriptionId || 'tenant';
  const evidenceRows = rows.slice(0, 3).map((r) => evidenceSummary(entry, r));
  const finding = {
    id: `${entry.id_prefix}-${PAD(seq)}`,
    title: entry.title,
    severity: entry.severity_default,
    confidence: entry.confidence || 'High',
    agent: entry.agent,
    category: entry.category || entry.domain || 'General',
    check_id: entry.check_id,
    finding_class: entry.finding_class,
    dedupe_key: `${entry.finding_class}:${dedupeSub}`,
    resource_id: rep.resource_id,
    subscription_id: subscriptionId || '',
    description: entry.description || entry.title,
    attack_vector: entry.attack_vector || 'See methodology.',
    recommendation: entry.recommendation || 'Remediate per the linked control.',
    evidence: [{
      source: `deterministic check engine (${entry.query?.method || 'config'})`,
      summary: `${rows.length} resource(s) match ${entry.check_id}: ${evidenceRows.join(' | ')}${rows.length > 3 ? ' …' : ''}`,
    }],
    affected_resources: affected,
    status: 'open',
    first_seen: now,
  };
  if (rep.resource_group) finding.resource_group = rep.resource_group;
  if (rep.region) finding.region = rep.region;
  if (entry.controls) {
    const c = {};
    if (entry.controls.cis_azure) c.cis_azure = entry.controls.cis_azure;
    if (entry.controls.mitre) c.mitre = entry.controls.mitre;
    if (Object.keys(c).length) finding.controls = c;
  }
  return finding;
}

/** Pull the candidate rows for a check from the --rows payload. */
export function rowsForCheck(rowsPayload, checkId) {
  if (Array.isArray(rowsPayload)) return rowsPayload;
  if (rowsPayload && typeof rowsPayload === 'object') {
    const v = rowsPayload[checkId];
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.rows)) return v.rows;
  }
  return undefined; // not provided → check not run this pass
}

/**
 * Evaluate one predicate entry against its rows. Returns
 * { ran, findings[], matched, scanned } where ran=false means no rows supplied.
 */
export function evaluateEntry(entry, rowsPayload, seqState, now) {
  const rows = rowsForCheck(rowsPayload, entry.check_id);
  if (rows === undefined) return { ran: false, findings: [], matched: 0, scanned: 0 };
  const matched = rows.filter((r) => evalPredicate(entry.evaluate, r));
  // Group matched rows by subscription so one misconfig class across many
  // subscriptions becomes one finding per subscription (scaling.md aggregation).
  const bySub = new Map();
  for (const r of matched) {
    const sub = firstDefined(r.subscription_id, r.subscriptionId, '') || '';
    if (!bySub.has(sub)) bySub.set(sub, []);
    bySub.get(sub).push(r);
  }
  const findings = [];
  for (const [sub, group] of bySub) {
    const prefix = entry.id_prefix;
    seqState[prefix] = (seqState[prefix] || 0) + 1;
    findings.push(buildFinding(entry, sub, group, seqState[prefix], now));
  }
  return { ran: true, findings, matched: matched.length, scanned: rows.length };
}

/** Build the compact per-agent triage summary the agent reads. */
export function buildSummary(results, now) {
  const checks = results.map((res) => ({
    check_id: res.entry.check_id,
    finding_class: res.entry.finding_class,
    title: res.entry.title,
    severity: res.entry.severity_default,
    ran: res.ran,
    scanned: res.scanned,
    matched: res.matched,
    findings: res.findings.map((f) => ({
      id: f.id,
      subscription_id: f.subscription_id,
      affected_count: f.affected_resources.length,
      representative_resource_id: f.resource_id,
      evidence_sample: f.evidence[0].summary,
    })),
  }));
  const totalFindings = results.reduce((a, r) => a + r.findings.length, 0);
  const notRun = checks.filter((c) => !c.ran).map((c) => c.check_id);
  return {
    schema: 'check-summary/v1',
    generated_at: now,
    engine: 'deterministic (zero-LLM)',
    checks_evaluated: checks.filter((c) => c.ran).length,
    checks_not_run: notRun,
    total_findings: totalFindings,
    triage_note: 'Engine-produced candidates. Confirm/contextualize/suppress over THIS summary; do not load raw rows into context.',
    checks,
  };
}

// ---------------------------------------------------------------------------
// Pack loading + CLI
// ---------------------------------------------------------------------------

export function loadPack(text) {
  const pack = JSON.parse(text);
  if (!pack || !Array.isArray(pack.predicates)) throw new Error('Predicate pack must have a predicates[] array');
  for (const p of pack.predicates) p.domain = p.domain || pack.domain;
  return pack;
}

function discoverPackFiles(p) {
  const abs = isAbsolute(p) ? p : resolve(p);
  if (!existsSync(abs)) throw new Error(`Predicates path not found: ${p}`);
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs).filter((f) => f.endsWith('predicates.json')).map((f) => join(abs, f));
  }
  return [abs];
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2));
    const val = eq >= 0 ? a.slice(eq + 1) : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    out[key] = val;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h || !args.predicates) {
    console.log('Usage: node tools/checks/run-checks.mjs --predicates <file|dir> --rows <rows.json> [--agent A] [--session <dir>] [--out <dir>] [--dry-run]');
    process.exit(args.help || args.h ? 0 : 1);
  }
  const now = new Date().toISOString();
  const packFiles = discoverPackFiles(args.predicates);
  let entries = [];
  for (const f of packFiles) entries.push(...loadPack(readFileSync(f, 'utf8')).predicates);
  if (typeof args.agent === 'string') entries = entries.filter((e) => e.agent === args.agent);
  if (typeof args.check === 'string') entries = entries.filter((e) => e.check_id === args.check);
  if (!entries.length) { console.error('No predicate entries matched the filters.'); process.exit(1); }

  let rowsPayload = {};
  if (typeof args.rows === 'string') rowsPayload = JSON.parse(readFileSync(args.rows, 'utf8'));

  const seqState = {};
  const results = [];
  const allFindings = [];
  const agents = new Set();
  for (const entry of entries) {
    const res = evaluateEntry(entry, rowsPayload, seqState, now);
    results.push({ entry, ...res });
    for (const f of res.findings) { allFindings.push(f); agents.add(f.agent); }
  }

  const summary = buildSummary(results, now);

  if (args['dry-run']) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Resolve output dir: --out, else --session, else cwd.
  const base = typeof args.out === 'string' ? args.out
    : typeof args.session === 'string' ? args.session : '.';
  const rawDir = join(base, 'findings', 'raw');
  const sumDir = join(base, 'findings', 'summary');
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(sumDir, { recursive: true });

  const agentName = typeof args.agent === 'string' ? args.agent
    : (agents.size === 1 ? [...agents][0] : (entries[0]?.agent || 'engine'));
  const rawPath = join(rawDir, `${agentName}.engine.jsonl`);
  const sumPath = join(sumDir, `${agentName}.json`);
  writeFileSync(rawPath, allFindings.map((f) => JSON.stringify(f)).join('\n') + (allFindings.length ? '\n' : ''));
  writeFileSync(sumPath, JSON.stringify(summary, null, 2) + '\n');

  console.log(`Engine: ${summary.checks_evaluated} checks evaluated, ${summary.total_findings} candidate finding(s) -> ${rawPath}`);
  console.log(`Triage summary -> ${sumPath}`);
  if (summary.checks_not_run.length) {
    console.log(`Not run (no rows supplied): ${summary.checks_not_run.join(', ')}`);
  }
}

// Run only as a CLI; importing for tests does not execute main().
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
