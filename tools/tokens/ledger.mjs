#!/usr/bin/env node
/**
 * ledger.mjs — token accounting for an agentic red team engagement.
 *
 * Produces a per-report "total token usage" figure (input + output) so an
 * operator can see, and budget, what an engagement costs the model. This is the
 * accounting half of the token-optimization effort: the deterministic check
 * engine (tools/checks/run-checks.mjs) drives token cost DOWN by keeping raw
 * Azure JSON out of agent context; this ledger MEASURES the remaining,
 * agent-borne cost and reports a defensible total.
 *
 * Two sources of truth, in priority order:
 *   1. measured  — actual usage lines (engagements/<s>/runs/usage.jsonl), one
 *      JSON object per line: { phase, agent, input_tokens, output_tokens }.
 *      Emitted by a harness that records real model usage. Authoritative.
 *   2. estimated — when no measured line covers a component, estimate tokens as
 *      ceil(utf8_bytes / ratio) over the bytes that actually crossed the model
 *      boundary (system prompt + skill + compact check summary in; LLM-authored
 *      findings + narrative out). Engine-authored *.engine.jsonl is EXCLUDED —
 *      it never costs the model.
 *
 * If a run mixes both, method is reported as "hybrid".
 *
 * Output: reports/token-usage.json (schema "token-usage/v1"), consumed by
 * generate-report.mjs --token-usage to render the headline + cost section.
 *
 * Usage:
 *   node tools/tokens/ledger.mjs --session engagements/<s> [--repo .] \
 *     [--agents a,b,c] [--ratio 4.0] [--usage runs/usage.jsonl] [--out <path>]
 *
 * Read-only over inputs (only writes the token-usage.json). Dependency-free.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_RATIO = 4.0; // chars/bytes per token (conservative GPT/Claude-class default)

// ---------------------------------------------------------------------------
// Pure estimation
// ---------------------------------------------------------------------------

/** Estimate tokens for a string/object as ceil(utf8_bytes / ratio). */
export function estimateTokens(text, ratio = DEFAULT_RATIO) {
  if (text == null) return 0;
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  const bytes = Buffer.byteLength(s, 'utf8');
  const r = ratio > 0 ? ratio : DEFAULT_RATIO;
  return Math.ceil(bytes / r);
}

/** Normalize a token-bearing component. direction is 'input' | 'output'. */
export function component(label, { phase, agent, direction, tokens, bytes, method = 'estimated' }) {
  if (direction !== 'input' && direction !== 'output') {
    throw new Error(`component "${label}": direction must be input|output`);
  }
  const tok = Number.isFinite(tokens) ? tokens : 0;
  const c = {
    label,
    phase: phase || 'unattributed',
    agent: agent || '(shared)',
    direction,
    tokens: tok,
    method,
  };
  if (Number.isFinite(bytes)) c.bytes = bytes;
  return c;
}

/** Build a component straight from text, estimating its tokens. */
export function componentFromText(label, opts, ratio = DEFAULT_RATIO) {
  const text = opts.text == null ? '' : (typeof opts.text === 'string' ? opts.text : JSON.stringify(opts.text));
  const bytes = Buffer.byteLength(text, 'utf8');
  return component(label, { ...opts, bytes, tokens: estimateTokens(text, ratio), method: 'estimated' });
}

function rollup(components, keyFn) {
  const map = new Map();
  for (const c of components) {
    const key = keyFn(c);
    if (!map.has(key)) map.set(key, { key, input_tokens: 0, output_tokens: 0, total_tokens: 0 });
    const e = map.get(key);
    if (c.direction === 'input') e.input_tokens += c.tokens;
    else e.output_tokens += c.tokens;
    e.total_tokens = e.input_tokens + e.output_tokens;
  }
  return [...map.values()].sort((a, b) => b.total_tokens - a.total_tokens);
}

/**
 * Build the token-usage/v1 ledger from a flat list of normalized components.
 * method is auto-derived (measured/estimated/hybrid) unless overridden.
 */
export function buildLedger(components, { ratio = DEFAULT_RATIO, method, now, notes = [] } = {}) {
  const totals = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let anyMeasured = false;
  let anyEstimated = false;
  for (const c of components) {
    if (c.direction === 'input') totals.input_tokens += c.tokens;
    else totals.output_tokens += c.tokens;
    if (c.method === 'measured') anyMeasured = true; else anyEstimated = true;
  }
  totals.total_tokens = totals.input_tokens + totals.output_tokens;

  const derivedMethod = method
    || (anyMeasured && anyEstimated ? 'hybrid' : anyMeasured ? 'measured' : 'estimated');

  const per_phase = rollup(components, (c) => c.phase).map((e) => ({ phase: e.key, input_tokens: e.input_tokens, output_tokens: e.output_tokens, total_tokens: e.total_tokens }));
  const per_agent = rollup(components, (c) => c.agent).map((e) => ({ agent: e.key, input_tokens: e.input_tokens, output_tokens: e.output_tokens, total_tokens: e.total_tokens }));

  return {
    schema: 'token-usage/v1',
    method: derivedMethod,
    ratio,
    generated_at: now || new Date().toISOString(),
    totals,
    per_phase,
    per_agent,
    components: components.map((c) => ({ ...c })),
    notes: [
      derivedMethod === 'estimated'
        ? `Estimated at ~${ratio} bytes/token over content that crossed the model boundary. Engine-authored output excluded (costs ~0 model tokens).`
        : derivedMethod === 'measured'
          ? 'Measured from recorded model usage (runs/usage.jsonl).'
          : 'Hybrid: measured where recorded, estimated otherwise.',
      ...notes,
    ],
  };
}

// ---------------------------------------------------------------------------
// Measured usage
// ---------------------------------------------------------------------------

/** Parse a usage.jsonl into measured components. Tolerant of blank lines. */
export function parseMeasured(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; }
    const phase = rec.phase || 'measured';
    const agent = rec.agent || '(shared)';
    if (Number.isFinite(rec.input_tokens)) {
      out.push(component(`${phase}:${agent}:in`, { phase, agent, direction: 'input', tokens: rec.input_tokens, method: 'measured' }));
    }
    if (Number.isFinite(rec.output_tokens)) {
      out.push(component(`${phase}:${agent}:out`, { phase, agent, direction: 'output', tokens: rec.output_tokens, method: 'measured' }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Best-effort component collection from a session directory
// ---------------------------------------------------------------------------

function readIf(p) { try { return existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null; } catch { return null; } }
function listJson(dir) { try { return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []; } catch { return []; } }

/**
 * Walk a session directory + repo to assemble estimated input/output
 * components. Defensive: silently skips anything missing.
 *
 *  input  (model reads): agents/<agent>/system-prompt.md (dispatch),
 *                        findings/summary/<agent>.json   (triage)
 *  output (model wrote): findings/<agent>.json or findings/confirmed/<agent>.json (analysis)
 *  excluded:             findings/raw/*.engine.jsonl     (engine-authored)
 */
export function collectComponents({ sessionDir, repoRoot = '.', agents, ratio = DEFAULT_RATIO } = {}) {
  const components = [];
  const notes = [];
  const sumDir = join(sessionDir, 'findings', 'summary');
  const rawDir = join(sessionDir, 'findings', 'raw');
  const findDir = join(sessionDir, 'findings');
  const confDir = join(sessionDir, 'findings', 'confirmed');

  // Infer agents from triage summaries if not supplied.
  let agentList = Array.isArray(agents) ? agents.slice() : [];
  if (!agentList.length) agentList = listJson(sumDir).map((f) => basename(f, '.json'));

  for (const agent of agentList) {
    const sp = readIf(join(repoRoot, 'agents', agent, 'system-prompt.md'));
    if (sp) components.push(componentFromText(`system-prompt:${agent}`, { phase: 'dispatch', agent, direction: 'input', text: sp }, ratio));
    const summary = readIf(join(sumDir, `${agent}.json`));
    if (summary) components.push(componentFromText(`triage-summary:${agent}`, { phase: 'triage', agent, direction: 'input', text: summary }, ratio));
  }

  // Output: LLM-authored findings (top-level + confirmed/), excluding summary/ & raw/.
  const seen = new Set();
  for (const [dir, phase] of [[confDir, 'analysis'], [findDir, 'analysis']]) {
    for (const f of listJson(dir)) {
      const full = join(dir, f);
      if (full.startsWith(sumDir) || full.startsWith(rawDir)) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      const txt = readIf(full);
      if (!txt) continue;
      let agent = basename(f, '.json');
      try { const j = JSON.parse(txt); if (Array.isArray(j) && j[0]?.agent) agent = j[0].agent; else if (j?.agent) agent = j.agent; } catch { /* keep filename */ }
      components.push(componentFromText(`findings:${f}`, { phase, agent, direction: 'output', text: txt }, ratio));
    }
  }

  // Transparency: engine-authored output that was NOT charged to the model.
  let excludedTokens = 0;
  try {
    for (const f of (existsSync(rawDir) ? readdirSync(rawDir) : [])) {
      if (!f.endsWith('.engine.jsonl')) continue;
      const txt = readIf(join(rawDir, f));
      if (txt) excludedTokens += estimateTokens(txt, ratio);
    }
  } catch { /* ignore */ }
  if (excludedTokens > 0) notes.push(`Excluded ~${excludedTokens} tokens of engine-authored candidate findings (deterministic, ~0 model cost).`);

  return { components, notes };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    const val = eq >= 0 ? a.slice(eq + 1) : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    out[key] = val;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h || (!args.session && !args.usage)) {
    console.log('Usage: node tools/tokens/ledger.mjs --session <dir> [--repo .] [--agents a,b,c] [--ratio 4.0] [--usage runs/usage.jsonl] [--out reports/token-usage.json]');
    process.exit(args.session || args.usage ? 0 : 1);
  }
  const ratio = args.ratio ? Number(args.ratio) : DEFAULT_RATIO;
  const now = new Date().toISOString();
  const repoRoot = typeof args.repo === 'string' ? args.repo : '.';
  const agents = typeof args.agents === 'string' ? args.agents.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  let components = [];
  const notes = [];

  if (typeof args.session === 'string') {
    const collected = collectComponents({ sessionDir: args.session, repoRoot, agents, ratio });
    components.push(...collected.components);
    notes.push(...collected.notes);
  }

  // Measured override: paths are relative to --session when not absolute.
  if (typeof args.usage === 'string') {
    const usagePath = isAbsolute(args.usage) ? args.usage
      : (typeof args.session === 'string' ? join(args.session, args.usage) : resolve(args.usage));
    const txt = readIf(usagePath);
    if (txt) {
      const measured = parseMeasured(txt);
      const measuredKeys = new Set(measured.map((m) => `${m.phase}|${m.agent}|${m.direction}`));
      // Measured wins: drop estimated components that a measured line covers.
      components = components.filter((c) => !(c.method === 'estimated' && measuredKeys.has(`${c.phase}|${c.agent}|${c.direction}`)));
      components.push(...measured);
      notes.push(`Applied ${measured.length} measured usage component(s) from ${basename(usagePath)}.`);
    } else {
      notes.push(`Measured usage file not found: ${usagePath}`);
    }
  }

  const ledger = buildLedger(components, { ratio, now, notes });

  const outPath = typeof args.out === 'string' ? args.out
    : (typeof args.session === 'string' ? join(args.session, 'reports', 'token-usage.json') : 'token-usage.json');
  mkdirSync(isAbsolute(outPath) ? join(outPath, '..') : resolve(outPath, '..'), { recursive: true });
  writeFileSync(outPath, JSON.stringify(ledger, null, 2) + '\n');

  const { input_tokens, output_tokens, total_tokens } = ledger.totals;
  console.log(`Token usage (${ledger.method}): input ${input_tokens} · output ${output_tokens} · total ${total_tokens} tokens`);
  console.log(`Ledger -> ${outPath}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
