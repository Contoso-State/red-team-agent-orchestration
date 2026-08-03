#!/usr/bin/env node
/**
 * validate-findings.mjs — strict pre-flight validator for assessment artifacts.
 *
 * Validates a findings.json (and optionally an attack-paths.json) against the
 * essential constraints in schemas/finding.schema.json and
 * schemas/attack-path.schema.json BEFORE report generation, so authoring
 * mistakes fail fast instead of rendering into a polished-but-wrong report.
 *
 * Usage:
 *   node tools/validate-findings.mjs --findings <path> [--attack-paths <path>]
 *
 * Exit codes:
 *   0  all good (warnings allowed)
 *   1  one or more hard schema violations
 *   2  bad invocation / unreadable input
 *
 * Dependency-free (Node standard library only). Read-only: only reads inputs.
 */

import { readFileSync } from 'node:fs';
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';

const SEVERITIES = new Set(['Critical', 'High', 'Medium', 'Low', 'Informational']);
const CONFIDENCES = new Set(['High', 'Medium', 'Low']);
const STATUSES = new Set(['open', 'confirmed', 'false_positive', 'remediated', 'accepted_risk']);
const NODE_TYPES = new Set(['entry', 'pivot', 'target', 'step']);
export const AGENTS = new Set([
  'inventory-scope', 'identity-posture', 'authorization-attack-path', 'network-exposure',
  'compute-platform', 'aks-container', 'data-protection', 'web-exposure', 'ai-foundry', 'attack-surface',
  'external-vuln', 'logging-coverage', 'email-security', 'governance-posture',
  'devops-supplychain', 'reporting',
]);
const FINDING_ID_RE = /^AZ-[A-Z]+-[0-9]{3}$/;
const FINDING_CLASS_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PATH_ID_RE = /^AZ-PATH-[0-9]{3}$/;
const REQUIRED = [
  'id', 'title', 'severity', 'confidence', 'agent', 'category',
  'resource_id', 'subscription_id', 'description', 'attack_vector',
  'recommendation', 'evidence', 'status', 'first_seen',
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--findings') out.findings = argv[++i];
    else if (a === '--attack-paths') out.attackPaths = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function loadJson(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`Error: could not read ${label} at "${path}": ${err.message}`);
    process.exit(2);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`Error: ${label} at "${path}" is not valid JSON: ${err.message}`);
    process.exit(2);
  }
}

function asFindings(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.findings)) return raw.findings;
  console.error('Error: findings must be an array or an object with a "findings" array.');
  process.exit(2);
}

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warnMsg = (m) => warnings.push(m);

function validateFindings(list) {
  const seen = new Set();
  const findingIndex = new Map();
  list.forEach((f, idx) => {
    const where = f && f.id ? `finding "${f.id}"` : `finding #${idx + 1}`;
    if (!f || typeof f !== 'object') { err(`${where}: not an object.`); return; }
    for (const key of REQUIRED) {
      const v = f[key];
      const empty = v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
      if (empty) err(`${where}: missing required field "${key}".`);
    }
    if (f.id != null) {
      if (!FINDING_ID_RE.test(String(f.id))) err(`${where}: id "${f.id}" must match ^AZ-[A-Z]+-[0-9]{3}$.`);
      if (seen.has(f.id)) err(`${where}: duplicate id "${f.id}".`);
      seen.add(f.id);
    }
    if (f.severity != null && !SEVERITIES.has(f.severity)) err(`${where}: severity "${f.severity}" not in ${[...SEVERITIES].join('/')}.`);
    if (f.confidence != null && !CONFIDENCES.has(f.confidence)) err(`${where}: confidence "${f.confidence}" not in ${[...CONFIDENCES].join('/')}.`);
    if (f.status != null && !STATUSES.has(f.status)) err(`${where}: status "${f.status}" not in ${[...STATUSES].join('/')}.`);
    if (f.agent != null && !AGENTS.has(f.agent)) err(`${where}: agent "${f.agent}" not a known agent enum value.`);
    if (f.first_seen != null && String(f.first_seen).trim() !== '' && Number.isNaN(Date.parse(f.first_seen))) {
      err(`${where}: first_seen "${f.first_seen}" is not a valid date-time.`);
    }
    if (f.last_seen != null && String(f.last_seen).trim() !== '' && Number.isNaN(Date.parse(f.last_seen))) {
      err(`${where}: last_seen "${f.last_seen}" is not a valid date-time.`);
    }
    if (f.evidence != null && !Array.isArray(f.evidence)) err(`${where}: evidence must be an array.`);
    if (f.attack_path != null && !Array.isArray(f.attack_path)) err(`${where}: attack_path must be an array.`);
    if (f.references != null && !Array.isArray(f.references)) err(`${where}: references must be an array.`);
    if (Array.isArray(f.evidence)) {
      f.evidence.forEach((e, i) => {
        if (!e || typeof e !== 'object') { err(`${where}: evidence[${i}] is not an object.`); return; }
        if (!e.source || String(e.source).trim() === '') err(`${where}: evidence[${i}] missing "source".`);
        if (!e.summary || String(e.summary).trim() === '') err(`${where}: evidence[${i}] missing "summary".`);
      });
    }
    if (f.finding_class != null && f.finding_class !== '' && !FINDING_CLASS_RE.test(String(f.finding_class))) {
      err(`${where}: finding_class "${f.finding_class}" must match ^[a-z0-9]+(-[a-z0-9]+)*$.`);
    }
    if (f.dedupe_key != null && typeof f.dedupe_key !== 'string') err(`${where}: dedupe_key must be a string.`);
    if (f.affected_resources != null) {
      if (!Array.isArray(f.affected_resources)) {
        err(`${where}: affected_resources must be an array.`);
      } else {
        const affectedIds = new Set();
        f.affected_resources.forEach((a, i) => {
          if (!a || typeof a !== 'object' || Array.isArray(a)) { err(`${where}: affected_resources[${i}] is not an object.`); return; }
          if (!a.resource_id || String(a.resource_id).trim() === '') err(`${where}: affected_resources[${i}] missing "resource_id".`);
          else affectedIds.add(String(a.resource_id));
        });
        // The representative resource_id must be one of the affected instances (aggregation invariant).
        if (f.affected_resources.length && f.resource_id != null && String(f.resource_id).trim() !== '' && !affectedIds.has(String(f.resource_id))) {
          err(`${where}: resource_id "${f.resource_id}" must match one of affected_resources[].resource_id.`);
        }
      }
    }
    if (String(f.id ?? '').startsWith('AZ-PATH-') && !(Array.isArray(f.attack_path) && f.attack_path.length)) {
      warnMsg(`${where}: AZ-PATH finding has an empty attack_path[].`);
    }
    if (f.id != null) {
      const affected = new Set();
      if (f.resource_id != null && String(f.resource_id).trim() !== '') affected.add(String(f.resource_id));
      if (Array.isArray(f.affected_resources)) {
        for (const a of f.affected_resources) {
          if (a && a.resource_id) affected.add(String(a.resource_id));
        }
      }
      findingIndex.set(String(f.id), { affected, aggregated: Array.isArray(f.affected_resources) && f.affected_resources.length > 0 });
    }
  });
  return findingIndex;
}

function validateAttackPaths(doc, findingIndex) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.paths)) {
    err('attack-paths: must be an object with a "paths" array.');
    return;
  }
  if (doc.generated != null && String(doc.generated).trim() !== '' && Number.isNaN(Date.parse(doc.generated))) {
    err('attack-paths: generated is not a valid date-time.');
  }
  doc.paths.forEach((p, idx) => {
    const where = p && p.id ? `path "${p.id}"` : `path #${idx + 1}`;
    for (const key of ['id', 'title', 'severity', 'nodes']) {
      const v = p ? p[key] : undefined;
      const empty = v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
      if (empty) err(`${where}: missing required field "${key}".`);
    }
    if (p && p.id != null && !PATH_ID_RE.test(String(p.id))) err(`${where}: id must match ^AZ-PATH-[0-9]{3}$.`);
    if (p && p.severity != null && !SEVERITIES.has(p.severity)) err(`${where}: severity "${p.severity}" invalid.`);
    if (p && p.finding_id != null && !FINDING_ID_RE.test(String(p.finding_id))) err(`${where}: finding_id must match ^AZ-[A-Z]+-[0-9]{3}$.`);
    if (p && p.nodes != null && !Array.isArray(p.nodes)) { err(`${where}: nodes must be an array.`); return; }
    if (p && p.edges != null && !Array.isArray(p.edges)) err(`${where}: edges must be an array.`);
    const nodeIds = new Set();
    if (p && Array.isArray(p.nodes)) {
      p.nodes.forEach((n, i) => {
        if (!n || !n.id) { err(`${where}: nodes[${i}] missing "id".`); return; }
        if (!n.label) err(`${where}: nodes[${i}] missing "label".`);
        if (n.type != null && !NODE_TYPES.has(n.type)) err(`${where}: nodes[${i}].type "${n.type}" not in ${[...NODE_TYPES].join('/')}.`);
        if (n.finding_id != null && !FINDING_ID_RE.test(String(n.finding_id))) err(`${where}: nodes[${i}].finding_id must match ^AZ-[A-Z]+-[0-9]{3}$.`);
        if (n.finding_id != null && findingIndex && findingIndex.size) {
          const fi = findingIndex.get(String(n.finding_id));
          if (!fi) {
            warnMsg(`${where}: nodes[${i}].finding_id "${n.finding_id}" does not match any finding.`);
          } else if (n.resource_id != null && String(n.resource_id).trim() !== '' && fi.aggregated && !fi.affected.has(String(n.resource_id))) {
            err(`${where}: nodes[${i}].resource_id "${n.resource_id}" is not in finding "${n.finding_id}" affected_resources[]; an aggregated finding's path node must traverse a specific affected instance.`);
          }
        }
        nodeIds.add(n.id);
      });
    }
    if (p && Array.isArray(p.edges)) {
      p.edges.forEach((e, i) => {
        if (!e || !e.from || !e.to) { err(`${where}: edges[${i}] missing from/to.`); return; }
        if (!nodeIds.has(e.from)) err(`${where}: edges[${i}].from "${e.from}" is not a declared node id.`);
        if (!nodeIds.has(e.to)) err(`${where}: edges[${i}].to "${e.to}" is not a declared node id.`);
        if (e.finding_id != null && !FINDING_ID_RE.test(String(e.finding_id))) err(`${where}: edges[${i}].finding_id must match ^AZ-[A-Z]+-[0-9]{3}$.`);
      });
    }
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.findings) {
    console.log('Usage: node tools/validate-findings.mjs --findings <path> [--attack-paths <path>]');
    process.exit(args.help ? 0 : 2);
  }
  const findingIndex = validateFindings(asFindings(loadJson(args.findings, 'findings')));
  if (args.attackPaths) validateAttackPaths(loadJson(args.attackPaths, 'attack-paths'), findingIndex);

  for (const w of warnings) console.error('warning: ' + w);
  if (errors.length) {
    console.error(`\n${errors.length} validation error(s):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.error(`OK: artifacts are schema-valid${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
  process.exit(0);
}

// Run only as a CLI; importing for tests must not execute main().
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) main();
