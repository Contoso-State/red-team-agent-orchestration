// graph-parity.test.mjs — W5: the generator surfaces the canonical graph-engineering
// standard into the per-platform files, derived from graph/redteam.graph.json (so it can
// never drift), and identically across runtimes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { plan, loadGraphMeta, graphReferenceMarkdown } from './build-agent-defs.mjs';
import { KNOWN_AGENTS } from '../report/generate-report.mjs';
import { AGENTS } from '../validate-findings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const norm = (s) => s.replace(/\r\n/g, '\n');
const graph = JSON.parse(readFileSync(join(ROOT, 'graph', 'redteam.graph.json'), 'utf8'));

const CLAUDE_REF = join('.claude', 'commands', 'redteam-graph.md');
const CURSOR_REF = join('.cursor', 'rules', '01-redteam-graph.mdc');

function findFile(platformPlan, relPath) {
  return platformPlan.files.find((f) => f.path === relPath);
}

test('loadGraphMeta is derived from the canonical graph (no hard-coded drift)', () => {
  const meta = loadGraphMeta();
  assert.equal(meta.name, graph.name);
  assert.equal(meta.version, graph.version);
  assert.equal(meta.nodeCount, graph.nodes.length);
  assert.equal(meta.specialistCount, graph.roster.length);
  assert.equal(meta.maxRevisions, graph.params.max_revisions);
  assert.equal(meta.qualityThreshold, graph.params.quality_threshold);
});

test('the derived facts actually appear in the reference body', () => {
  const meta = loadGraphMeta();
  const body = graphReferenceMarkdown(meta);
  // A graph change (nodes/roster/params) forces the reference — and --check — to change.
  assert.match(body, new RegExp(`\\b${graph.nodes.length} nodes\\b`));
  assert.match(body, new RegExp(`\\b${graph.roster.length}-specialist\\b`));
  assert.match(body, new RegExp(`max_revisions=${graph.params.max_revisions}\\b`));
  assert.match(body, new RegExp(`quality_threshold=${graph.params.quality_threshold}\\b`));
  assert.match(body, new RegExp(`\`${graph.name}\` v${graph.version}`));
});

test('the reference names every canonical graph artifact + the immutable boundary', () => {
  const body = graphReferenceMarkdown(loadGraphMeta());
  for (const ref of [
    'graph/redteam.graph.json',
    'tools/graph/run-graph.mjs',
    'tools/graph/validate-graph.mjs',
    'tools/graph/self-improve.mjs',
    'integrations/langgraph/',
    'memory/methodology/',
    'guardrails/guard.mjs',
  ]) {
    assert.ok(body.includes(ref), `reference should mention ${ref}`);
  }
  // The one thing the self-improving graph must never be able to rewrite.
  assert.match(body, /read-only enforcement/i);
  assert.match(body, /never (modify|rewrite)/i);
  // Self-improvement posture: auto-applied, no PR/gate.
  assert.match(body, /NO pull request and NO human gate/);
});

test('Claude and Cursor both carry the graph reference, embedding the identical body', () => {
  const plans = plan(['claude', 'cursor', 'codex']);

  const claudeRef = findFile(plans.claude, CLAUDE_REF);
  const cursorRef = findFile(plans.cursor, CURSOR_REF);
  assert.ok(claudeRef, 'Claude should emit .claude/commands/redteam-graph.md');
  assert.ok(cursorRef, 'Cursor should emit .cursor/rules/01-redteam-graph.mdc');

  const body = graphReferenceMarkdown(loadGraphMeta());
  assert.ok(claudeRef.content.includes(body), 'Claude ref embeds the shared body');
  assert.ok(cursorRef.content.includes(body), 'Cursor ref embeds the shared body');

  // Cursor must apply the standard always (posture-level), Claude exposes it as context.
  assert.match(cursorRef.content, /^alwaysApply: true$/m);
});

test('Codex is intentionally skills-only (orchestration is native to AGENTS.md)', () => {
  const plans = plan(['codex']);
  assert.equal(plans.codex.files.length, 0);
  assert.ok(plans.codex.dirs.length > 0);
});

// --- agent-enum parity: schemas/finding.schema.json is the single source of truth.
// The report generator (lenient Notes) and the strict validator each keep a copy of
// that enum; both must stay identical to the schema, and every predicate pack's
// `agent` slug must be a member. This guards the drift that let an `aks-container`
// finding slip past the report enum while the pack, agent card, and graph roster all
// used it.
function schemaAgentEnum() {
  const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'finding.schema.json'), 'utf8'));
  const seek = (o) => {
    if (o && typeof o === 'object') {
      if (o.properties?.agent?.enum) return o.properties.agent.enum;
      for (const v of Object.values(o)) { const r = seek(v); if (r) return r; }
    }
    return null;
  };
  const e = seek(schema);
  assert.ok(Array.isArray(e) && e.length, 'finding.schema.json must define an agent enum');
  return e;
}

function packAgentSlugs() {
  const checksDir = join(ROOT, 'checks');
  const slugs = new Set();
  for (const pack of readdirSync(checksDir)) {
    let text;
    try { text = readFileSync(join(checksDir, pack, 'predicates.json'), 'utf8'); } catch { continue; }
    for (const p of JSON.parse(text).predicates || []) if (p.agent) slugs.add(p.agent);
  }
  return slugs;
}

test('report + validator agent enums stay identical to the schema source of truth', () => {
  const schemaEnum = [...schemaAgentEnum()].sort();
  assert.deepEqual([...KNOWN_AGENTS].sort(), schemaEnum,
    'generate-report KNOWN_AGENTS drifted from schemas/finding.schema.json');
  assert.deepEqual([...AGENTS].sort(), schemaEnum,
    'validate-findings AGENTS drifted from schemas/finding.schema.json');
});

test('every predicate-pack agent slug is a permitted agent enum value', () => {
  const enumSet = schemaAgentEnum();
  for (const slug of packAgentSlugs()) {
    assert.ok(enumSet.includes(slug), `pack agent "${slug}" is not in the finding schema agent enum`);
    assert.ok(KNOWN_AGENTS.has(slug), `pack agent "${slug}" is missing from report KNOWN_AGENTS`);
    assert.ok(AGENTS.has(slug), `pack agent "${slug}" is missing from validator AGENTS`);
  }
});

test('on-disk generated references match the plan (no drift vs committed output)', () => {
  const plans = plan(['claude', 'cursor']);
  for (const [platform, relPath] of [
    ['claude', CLAUDE_REF],
    ['cursor', CURSOR_REF],
  ]) {
    const planned = findFile(plans[platform], relPath);
    const onDisk = readFileSync(join(ROOT, relPath), 'utf8');
    assert.equal(
      norm(onDisk),
      norm(planned.content),
      `${relPath} on disk is stale — run: node tools/agents/build-agent-defs.mjs`,
    );
  }
});
