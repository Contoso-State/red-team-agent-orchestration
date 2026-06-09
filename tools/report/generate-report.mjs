#!/usr/bin/env node
// @ts-check
/**
 * generate-report.mjs — Professional Azure red-team HTML report generator.
 *
 * Dependency-free (Node stdlib only). Reads the normalized findings.json (the
 * canonical source of truth) plus an optional explicit attack-path graph and
 * engagement metadata, and emits ONE self-contained, offline report.html laid
 * out as a print-first consulting deliverable: cover page, table of contents,
 * executive summary, attack paths, findings, prioritized recommendations, an
 * asset/scope inventory, a consolidated interactive attack graph, and method
 * appendices. All embedded CSS/JS, all SVG hand-rolled, no external assets.
 *
 * Security posture (this is a pentest deliverable opened in a browser, and
 * finding text can originate from an attacker-controlled Azure environment):
 *   - No external/CDN/network references at all — works fully offline, never
 *     phones home. A restrictive CSP + no-referrer meta enforce this.
 *   - Every interpolated value is escaped for its exact context (HTML text,
 *     HTML attribute, URL, JSON-in-script, SVG text). No raw interpolation.
 *   - references[] are rendered as links ONLY when http(s); anything else is
 *     shown as inert escaped text (blocks javascript:/data:/file: etc.).
 *   - All content is server-side rendered so the report works with JS disabled;
 *     JS only adds progressive enhancements (filtering, graph pan/zoom).
 *
 * Usage:
 *   node tools/report/generate-report.mjs \
 *     --findings engagements/<session>/reports/findings.json \
 *     [--attack-paths engagements/<session>/reports/attack-paths.json] \
 *     [--engagement engagements/<session>/engagement.yaml] \
 *     [--out engagements/<session>/reports/report.html]
 *
 * Read-only: only reads the input files and writes the single --out file.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv } from 'node:process';

// Agents permitted by schemas/finding.schema.json. Kept in sync with that enum.
// Used only to surface authoring mistakes as visible Notes (the generator stays
// lenient and still renders; tools/validate-findings.mjs is the strict gate).
const KNOWN_AGENTS = new Set([
  'inventory-scope',
  'identity-posture',
  'authorization-attack-path',
  'network-exposure',
  'compute-platform',
  'data-protection',
  'web-exposure',
  'ai-foundry',
  'attack-surface',
  'logging-coverage',
  'email-security',
  'governance-posture',
  'devops-supplychain',
  'reporting',
]);
const FINDING_ID_RE = /^AZ-[A-Z]+-[0-9]{3}$/;

const GENERATOR_VERSION = '2.0.0';

const SEVERITY_RANK = {
  Critical: 5,
  High: 4,
  Medium: 3,
  Low: 2,
  Informational: 1,
};
const CONFIDENCE_RANK = { High: 3, Medium: 2, Low: 1 };
const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Informational'];
// Statuses that count toward the executive risk posture (open risk).
const OPEN_STATUSES = new Set(['open', 'confirmed', 'accepted_risk']);

// ---------------------------------------------------------------------------
// Context-specific escaping. Never interpolate a raw value; always pick one.
// ---------------------------------------------------------------------------

/** Escape for HTML text-node content. */
function escText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Escape for a double-quoted HTML attribute value. */
function escAttr(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Return a safe href, or null if the URL is not an allowed protocol.
 * Only http/https are linkable; everything else (javascript:, data:, file:,
 * vbscript:, protocol-relative, malformed) is rejected so it renders as text.
 */
function safeHref(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    return null;
  }
  return null;
}

/** Escape a value for safe embedding inside a <script type="application/json">. */
function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/** Make a value safe to use as an HTML/SVG id or class fragment (lowercased so
 *  it matches the lowercase CSS class selectors). */
function slugId(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--findings') out.findings = args[++i];
    else if (a === '--attack-paths') out.attackPaths = args[++i];
    else if (a === '--engagement') out.engagement = args[++i];
    else if (a === '--out') out.out = args[++i];
    else if (a === '--title') out.title = args[++i];
    else if (a === '-h' || a === '--help') out.help = true;
    else if (a.startsWith('--findings=')) out.findings = a.slice(11);
    else if (a.startsWith('--attack-paths=')) out.attackPaths = a.slice(15);
    else if (a.startsWith('--engagement=')) out.engagement = a.slice(13);
    else if (a.startsWith('--out=')) out.out = a.slice(6);
    else if (a.startsWith('--title=')) out.title = a.slice(8);
  }
  return out;
}

function usage() {
  return [
    'Azure red-team HTML report generator',
    '',
    'Usage:',
    '  node tools/report/generate-report.mjs --findings <findings.json> [options]',
    '',
    'Options:',
    '  --findings <path>       Normalized findings.json (required)',
    '  --attack-paths <path>   Explicit attack-path graph JSON (optional)',
    '  --engagement <path>     engagement.yaml/.json for metadata (optional)',
    '  --out <path>            Output HTML (default: alongside findings as report.html)',
    '  --title <text>          Override report title',
    '  -h, --help              Show this help',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Input loading + lightweight (dependency-free) validation
// ---------------------------------------------------------------------------

const warnings = [];
function warn(msg) {
  warnings.push(msg);
}

function loadJson(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Could not read ${label} at "${path}": ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} at "${path}" is not valid JSON: ${err.message}`);
  }
}

/**
 * Minimal YAML/JSON metadata reader for engagement files. We only need a few
 * scalar fields (name, id, mode, date) and a subscriptions list, so we do a
 * tiny line-based parse rather than pulling in a YAML dependency.
 */
function loadEngagement(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    warn(`Engagement metadata not loaded (${err.message}); deriving from findings.`);
    return {};
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      warn(`Engagement file "${path}" looked like JSON but did not parse; ignoring.`);
      return {};
    }
  }
  const meta = {};
  const subs = [];
  let inSubs = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (inSubs && listItem && indent >= 2) {
      subs.push(stripQuotes(listItem[1].trim()));
      continue;
    }
    if (indent === 0) inSubs = false;
    const kv = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    if (key === 'subscriptions' && val === '') {
      inSubs = true;
      continue;
    }
    if (['name', 'id', 'mode', 'date', 'client', 'scope'].includes(key) && val) {
      meta[key] = stripQuotes(val);
    }
  }
  if (subs.length) meta.subscriptions = subs;
  return meta;
}

function stripQuotes(v) {
  return String(v).replace(/^["']|["']$/g, '');
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object' && Array.isArray(v.findings)) return v.findings;
  return [];
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeFindings(rawFindings) {
  const findings = [];
  const seenIds = new Set();
  for (const f of rawFindings) {
    if (!f || typeof f !== 'object') {
      warn('Skipped a finding that was not an object.');
      continue;
    }
    const id = String(f.id ?? '').trim() || `UNKNOWN-${findings.length + 1}`;
    if (seenIds.has(id)) warn(`Duplicate finding id "${id}" — both are shown.`);
    seenIds.add(id);
    if (!FINDING_ID_RE.test(id)) {
      warn(`Finding "${id}" does not match the required id pattern AZ-<DOMAIN>-<NNN>.`);
    }
    if (f.agent != null && !KNOWN_AGENTS.has(String(f.agent))) {
      warn(`Finding "${id}" has agent "${f.agent}" which is not a known agent enum value.`);
    }
    for (const req of ['title', 'category', 'resource_id', 'subscription_id', 'description', 'attack_vector', 'recommendation', 'first_seen']) {
      if (f[req] == null || String(f[req]).trim() === '') {
        warn(`Finding "${id}" is missing required field "${req}".`);
      }
    }
    if (!Array.isArray(f.evidence) || f.evidence.length === 0) {
      warn(`Finding "${id}" has no evidence[]; findings should cite at least one source.`);
    }
    const severity = SEVERITY_RANK[f.severity] ? f.severity : 'Informational';
    if (!SEVERITY_RANK[f.severity]) {
      warn(`Finding "${id}" has unknown/missing severity "${f.severity}"; treated as Informational.`);
    }
    const attackPath = Array.isArray(f.attack_path)
      ? f.attack_path.map((s) => String(s)).filter(Boolean)
      : [];
    if (id.startsWith('AZ-PATH-') && attackPath.length === 0) {
      warn(`Attack-path finding "${id}" has an empty attack_path[].`);
    }
    findings.push({
      id,
      title: String(f.title ?? '(untitled)'),
      severity,
      severityRank: SEVERITY_RANK[severity],
      confidence: CONFIDENCE_RANK[f.confidence] ? f.confidence : 'Medium',
      agent: String(f.agent ?? 'unknown'),
      category: String(f.category ?? 'Uncategorized'),
      check_id: f.check_id ? String(f.check_id) : '',
      resource_id: String(f.resource_id ?? ''),
      subscription_id: String(f.subscription_id ?? ''),
      resource_group: f.resource_group ? String(f.resource_group) : '',
      region: f.region ? String(f.region) : '',
      description: String(f.description ?? ''),
      attack_vector: String(f.attack_vector ?? ''),
      risk: f.risk ? String(f.risk) : '',
      recommendation: String(f.recommendation ?? ''),
      evidence: Array.isArray(f.evidence) ? f.evidence : [],
      attack_path: attackPath,
      controls: f.controls && typeof f.controls === 'object' ? f.controls : {},
      references: Array.isArray(f.references) ? f.references : [],
      status: typeof f.status === 'string' ? f.status : 'open',
      first_seen: f.first_seen ? String(f.first_seen) : '',
      last_seen: f.last_seen ? String(f.last_seen) : '',
    });
  }
  // Sort: severity desc, confidence desc, attack-path first, id asc.
  findings.sort((a, b) => {
    if (b.severityRank !== a.severityRank) return b.severityRank - a.severityRank;
    const ac = CONFIDENCE_RANK[a.confidence] || 0;
    const bc = CONFIDENCE_RANK[b.confidence] || 0;
    if (bc !== ac) return bc - ac;
    const ap = a.id.startsWith('AZ-PATH-') ? 1 : 0;
    const bp = b.id.startsWith('AZ-PATH-') ? 1 : 0;
    if (bp !== ap) return bp - ap;
    return a.id.localeCompare(b.id);
  });
  return findings;
}

function shortResource(resourceId) {
  if (!resourceId) return '';
  const parts = resourceId.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : resourceId;
}

// ---------------------------------------------------------------------------
// Attack-path graph construction (explicit authoritative, then derived)
// ---------------------------------------------------------------------------

function buildAttackPaths(findings, explicitGraph) {
  const paths = [];
  const coveredFindingIds = new Set();

  if (explicitGraph && Array.isArray(explicitGraph.paths)) {
    for (const p of explicitGraph.paths) {
      if (!p || !Array.isArray(p.nodes) || p.nodes.length === 0) {
        warn(`Explicit attack path "${p?.id ?? '?'}" has no nodes; skipped.`);
        continue;
      }
      const nodeIds = new Set(p.nodes.map((n) => n.id));
      const edges = Array.isArray(p.edges) ? p.edges : [];
      for (const e of edges) {
        if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
          warn(`Attack path "${p.id}" has an edge referencing a missing node (${e.from} -> ${e.to}).`);
        }
      }
      for (const n of p.nodes) {
        if (n.finding_id && !findings.some((f) => f.id === n.finding_id)) {
          warn(`Attack-path node in "${p.id}" references unknown finding "${n.finding_id}".`);
        }
      }
      if (p.finding_id) coveredFindingIds.add(p.finding_id);
      paths.push({
        id: String(p.id ?? `PATH-${paths.length + 1}`),
        title: String(p.title ?? p.id ?? 'Attack path'),
        severity: SEVERITY_RANK[p.severity] ? p.severity : 'High',
        entry: p.entry ? String(p.entry) : '',
        end_state: p.end_state ? String(p.end_state) : '',
        break_chain: p.break_chain ? String(p.break_chain) : '',
        finding_id: p.finding_id ? String(p.finding_id) : '',
        derived: false,
        nodes: p.nodes.map((n, i) => ({
          id: String(n.id ?? `n${i}`),
          label: String(n.label ?? n.id ?? `Step ${i + 1}`),
          type: ['entry', 'pivot', 'target', 'step'].includes(n.type)
            ? n.type
            : i === 0
              ? 'entry'
              : i === p.nodes.length - 1
                ? 'target'
                : 'pivot',
          resource_id: n.resource_id ? String(n.resource_id) : '',
          finding_id: n.finding_id ? String(n.finding_id) : '',
        })),
        edges: edges.map((e) => ({
          from: String(e.from),
          to: String(e.to),
          label: e.label ? String(e.label) : '',
          technique: e.technique ? String(e.technique) : '',
          finding_id: e.finding_id ? String(e.finding_id) : '',
        })),
      });
    }
  }

  // Derive linear chains from AZ-PATH findings not already represented above.
  for (const f of findings) {
    const isPathFinding = f.id.startsWith('AZ-PATH-') || f.attack_path.length > 0;
    if (!isPathFinding) continue;
    if (coveredFindingIds.has(f.id)) continue;
    if (f.attack_path.length === 0) continue;
    const nodes = f.attack_path.map((step, i) => ({
      id: `${f.id}-n${i}`,
      label: step,
      type: i === 0 ? 'entry' : i === f.attack_path.length - 1 ? 'target' : 'step',
      resource_id: '',
      finding_id: f.id,
    }));
    const edges = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({ from: nodes[i].id, to: nodes[i + 1].id, label: '', technique: '', finding_id: f.id });
    }
    paths.push({
      id: f.id,
      title: f.title,
      severity: f.severity,
      entry: nodes[0].label,
      end_state: nodes[nodes.length - 1].label,
      break_chain: f.recommendation,
      finding_id: f.id,
      derived: true,
      nodes,
      edges,
    });
  }

  paths.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  return paths;
}

// ---------------------------------------------------------------------------
// SVG per-path graph rendering (inline, hand-rolled, no libraries)
// ---------------------------------------------------------------------------

const NODE_W = 168;
const NODE_H = 64;
const GAP_X = 88;
const PAD = 28;
const LANE_H = NODE_H + 64;

function truncate(label, max) {
  const s = String(label);
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function renderPathSvg(path) {
  const n = path.nodes.length;
  const width = PAD * 2 + n * NODE_W + (n - 1) * GAP_X;
  const height = PAD * 2 + LANE_H;
  const cy = PAD + LANE_H / 2;
  const pos = new Map();
  path.nodes.forEach((node, i) => {
    pos.set(node.id, { x: PAD + i * (NODE_W + GAP_X), y: cy - NODE_H / 2 });
  });

  let svg = `<svg class="apgraph" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escAttr('Attack path: ' + path.title)}">`;
  svg += `<defs><marker id="arrow-${slugId(path.id)}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" class="ap-arrow"/></marker></defs>`;

  for (const e of path.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2 - 4}" y2="${y2}" class="ap-edge" marker-end="url(#arrow-${slugId(path.id)})"/>`;
    if (e.label || e.technique) {
      const mx = (x1 + x2) / 2;
      const lbl = truncate([e.label, e.technique].filter(Boolean).join(' \u00b7 '), 22);
      svg += `<text x="${mx}" y="${y1 - 8}" text-anchor="middle" class="ap-edge-label">${escText(lbl)}</text>`;
    }
  }

  path.nodes.forEach((node) => {
    const p = pos.get(node.id);
    const clickable = node.finding_id ? ' ap-clickable' : '';
    const fattr = node.finding_id ? ` data-finding="${escAttr(node.finding_id)}" tabindex="0" role="button"` : '';
    const titleParts = [node.label];
    if (node.resource_id) titleParts.push(node.resource_id);
    if (node.finding_id) titleParts.push('Finding ' + node.finding_id);
    svg += `<g class="ap-node ap-${escAttr(node.type)}${clickable}"${fattr}>`;
    svg += `<title>${escText(titleParts.join('\n'))}</title>`;
    svg += `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="9"/>`;
    svg += `<text x="${p.x + NODE_W / 2}" y="${p.y + 22}" text-anchor="middle" class="ap-node-type">${escText(node.type.toUpperCase())}</text>`;
    const label = truncate(node.label, 24);
    svg += `<text x="${p.x + NODE_W / 2}" y="${p.y + 42}" text-anchor="middle" class="ap-node-label">${escText(label)}</text>`;
    if (node.finding_id) {
      svg += `<text x="${p.x + NODE_W / 2}" y="${p.y + 56}" text-anchor="middle" class="ap-node-fid">${escText(node.finding_id)}</text>`;
    }
    svg += `</g>`;
  });

  svg += `</svg>`;
  return svg;
}

// ---------------------------------------------------------------------------
// HTML fragments
// ---------------------------------------------------------------------------

function sevPill(sev) {
  return `<span class="pill sev sev-${slugId(sev)}">${escText(sev)}</span>`;
}

function statusBadge(status) {
  return `<span class="badge status status-${slugId(status)}">${escText(status.replace(/_/g, ' '))}</span>`;
}

function chips(items, cls) {
  if (!items || !items.length) return '';
  return items
    .map((c) => `<span class="chip ${cls}">${escText(c)}</span>`)
    .join('');
}

function renderReferences(refs) {
  if (!refs || !refs.length) return '';
  const items = refs
    .map((r) => {
      const href = safeHref(r);
      if (href) {
        return `<li><a href="${escAttr(href)}" rel="noopener noreferrer" target="_blank">${escText(r)}</a></li>`;
      }
      return `<li><span class="ref-inert" title="Non-http reference rendered as text">${escText(r)}</span></li>`;
    })
    .join('');
  return `<div class="detail-block"><h4>References</h4><ul class="refs">${items}</ul></div>`;
}

function renderEvidence(evidence) {
  if (!evidence || !evidence.length) return '';
  const rows = evidence
    .map((e) => {
      const source = escText(e?.source ?? '');
      const summary = escText(e?.summary ?? '');
      const ref = e?.raw_ref
        ? `<div class="ev-ref"><span class="muted">ref:</span> <code>${escText(e.raw_ref)}</code></div>`
        : '';
      return `<li><div class="ev-source">${source}</div><div class="ev-summary">${summary}</div>${ref}</li>`;
    })
    .join('');
  return `<div class="detail-block"><h4>Evidence</h4><ul class="evidence">${rows}</ul></div>`;
}

function controlsSummary(controls) {
  const out = [];
  if (controls.mitre?.length) out.push(chips(controls.mitre, 'c-mitre'));
  if (controls.cis_azure?.length) out.push(chips(controls.cis_azure, 'c-cis'));
  if (controls.defender_for_cloud?.length) out.push(chips(controls.defender_for_cloud, 'c-dfc'));
  if (controls.nist_800_53?.length) out.push(chips(controls.nist_800_53, 'c-nist'));
  if (!out.length) return '';
  return `<div class="detail-block"><h4>Control mapping</h4><div class="chips">${out.join('')}</div></div>`;
}

/** Render one finding row. `anchor` is a precomputed, collision-safe DOM id. */
function renderFindingRow(f, anchor) {
  const searchCorpus = [
    f.id, f.title, f.category, f.agent, f.severity, f.status,
    shortResource(f.resource_id), f.resource_id, f.check_id, f.description,
  ].join(' ').toLowerCase();

  const resShort = shortResource(f.resource_id);
  const rowId = anchor || `finding-${slugId(f.id)}`;
  const detailId = `detail-${slugId(f.id)}`;

  let detail = '';
  if (f.description) detail += `<div class="detail-block"><h4>Description</h4><p>${escText(f.description)}</p></div>`;
  if (f.attack_vector) detail += `<div class="detail-block"><h4>Attack vector</h4><p>${escText(f.attack_vector)}</p></div>`;
  if (f.attack_path.length) {
    const steps = f.attack_path.map((s) => `<li>${escText(s)}</li>`).join('');
    detail += `<div class="detail-block"><h4>Attack path</h4><ol class="apsteps">${steps}</ol></div>`;
  }
  if (f.risk) detail += `<div class="detail-block"><h4>Risk</h4><p>${escText(f.risk)}</p></div>`;
  detail += renderEvidence(f.evidence);
  if (f.recommendation) detail += `<div class="detail-block rec"><h4>Recommendation</h4><p>${escText(f.recommendation)}</p></div>`;
  detail += controlsSummary(f.controls);
  detail += renderReferences(f.references);

  const meta = [
    f.check_id ? `<span class="kv"><span class="muted">Check</span> ${escText(f.check_id)}</span>` : '',
    f.resource_group ? `<span class="kv"><span class="muted">RG</span> ${escText(f.resource_group)}</span>` : '',
    f.region ? `<span class="kv"><span class="muted">Region</span> ${escText(f.region)}</span>` : '',
    f.subscription_id ? `<span class="kv"><span class="muted">Sub</span> ${escText(f.subscription_id)}</span>` : '',
  ].filter(Boolean).join('');
  const resFull = f.resource_id
    ? `<div class="detail-block"><h4>Resource</h4><code class="resfull">${escText(f.resource_id)}</code></div>`
    : '';

  return `
  <div class="finding" id="${escAttr(rowId)}"
       data-severity="${escAttr(f.severity)}"
       data-severity-rank="${f.severityRank}"
       data-agent="${escAttr(f.agent)}"
       data-category="${escAttr(f.category)}"
       data-status="${escAttr(f.status)}"
       data-finding-id="${escAttr(f.id)}"
       data-search="${escAttr(searchCorpus)}">
    <button class="finding-head" aria-expanded="false" aria-controls="${escAttr(detailId)}">
      <span class="fh-sev">${sevPill(f.severity)}</span>
      <span class="fh-id">${escText(f.id)}</span>
      <span class="fh-title">${escText(f.title)}</span>
      <span class="fh-domain">${escText(f.category)}</span>
      <span class="fh-res" title="${escAttr(f.resource_id)}">${escText(resShort)}</span>
      <span class="fh-status">${statusBadge(f.status)}</span>
      <span class="fh-caret" aria-hidden="true">\u203a</span>
    </button>
    <div class="finding-detail" id="${escAttr(detailId)}" hidden>
      <div class="detail-meta">
        <span class="kv"><span class="muted">Confidence</span> ${escText(f.confidence)}</span>
        <span class="kv"><span class="muted">Agent</span> ${escText(f.agent)}</span>
        ${meta}
      </div>
      ${resFull}
      ${detail}
    </div>
  </div>`;
}

function donut(counts, total) {
  const size = 132;
  const r = 52;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  let segs = '';
  for (const sev of SEVERITY_ORDER) {
    const v = counts[sev] || 0;
    if (!v || !total) continue;
    const frac = v / total;
    const len = frac * circ;
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="donut-seg donut-${slugId(sev)}" stroke-width="18" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"><title>${escText(sev)}: ${v}</title></circle>`;
    offset += len;
  }
  if (!total) {
    segs = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="donut-empty" stroke-width="18"/>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="donut" role="img" aria-label="Findings by severity">
    ${segs}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-total">${total}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="donut-label">findings</text>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Resource / scope parsing + asset inventory
// ---------------------------------------------------------------------------

/**
 * Tolerant, non-throwing ARM resource-id parser. Handles subscription,
 * resource-group-only, provider resources (incl. nested type/name pairs),
 * tenant-scoped ids (no providers segment), and management-group scope. Falls
 * back to the finding's subscription/resource-group; truly unparseable ids are
 * bucketed under "Unparsed / non-ARM scope". Never throws.
 */
function parseResourceId(resourceId, finding) {
  const raw = String(resourceId || '').trim();
  const fallbackSub = finding && finding.subscription_id ? String(finding.subscription_id) : '';
  const fallbackRg = finding && finding.resource_group ? String(finding.resource_group) : '';
  const result = {
    raw,
    scope: 'unknown',
    subscriptionId: fallbackSub,
    resourceGroup: fallbackRg,
    tenantId: '',
    provider: '',
    resourceType: '',
    displayType: '',
    name: '',
    bucket: 'Unparsed / non-ARM scope',
  };
  if (!raw) {
    result.name = finding && finding.id ? String(finding.id) : '(unscoped)';
    result.displayType = 'finding';
    result.scope = 'finding';
    result.bucket = result.name;
    return result;
  }
  const parts = raw.split('/').filter(Boolean);
  const lower = parts.map((p) => p.toLowerCase());
  const idxOf = (kw) => lower.indexOf(kw);

  const subIdx = idxOf('subscriptions');
  if (subIdx !== -1 && parts[subIdx + 1]) result.subscriptionId = parts[subIdx + 1];
  const rgIdx = idxOf('resourcegroups');
  if (rgIdx !== -1 && parts[rgIdx + 1]) result.resourceGroup = parts[rgIdx + 1];
  const tenantIdx = idxOf('tenants');
  if (tenantIdx !== -1 && parts[tenantIdx + 1]) result.tenantId = parts[tenantIdx + 1];
  const mgIdx = idxOf('managementgroups');
  const provIdx = idxOf('providers');

  if (provIdx !== -1 && parts[provIdx + 1]) {
    result.provider = parts[provIdx + 1];
    const rest = parts.slice(provIdx + 2);
    if (rest.length) {
      const typeParts = [];
      let lastName = '';
      for (let i = 0; i < rest.length; i++) {
        if (i % 2 === 0) typeParts.push(rest[i]);
        else lastName = rest[i];
      }
      result.resourceType = typeParts.join('/');
      result.displayType = result.resourceType ? result.provider + '/' + result.resourceType : result.provider;
      result.name = lastName || rest[rest.length - 1];
    } else {
      result.displayType = result.provider;
      result.name = parts[parts.length - 1];
    }
    result.scope = 'resource';
    result.bucket = result.displayType;
    return result;
  }

  // Tenant-scoped (no providers segment), e.g. /tenants/{id}/directoryRoles/{name}
  if (tenantIdx !== -1) {
    const rest = parts.slice(tenantIdx + 2);
    if (rest.length >= 2) {
      result.resourceType = rest[0];
      result.name = rest[rest.length - 1];
    } else if (rest.length === 1) {
      result.resourceType = rest[0];
      result.name = rest[0];
    }
    result.scope = 'tenant';
    result.displayType = result.resourceType ? 'tenant/' + result.resourceType : 'tenant';
    result.bucket = result.displayType;
    return result;
  }

  if (mgIdx !== -1) {
    result.scope = 'managementGroup';
    result.name = parts[mgIdx + 1] || '';
    result.displayType = 'managementGroups';
    result.bucket = 'managementGroups';
    return result;
  }

  if (rgIdx !== -1) {
    result.scope = 'resourceGroup';
    result.displayType = 'resourceGroups';
    result.name = result.resourceGroup;
    result.bucket = 'resourceGroups';
    return result;
  }

  if (subIdx !== -1) {
    result.scope = 'subscription';
    result.displayType = 'subscriptions';
    result.name = result.subscriptionId;
    result.bucket = 'subscriptions';
    return result;
  }

  result.name = parts[parts.length - 1];
  result.displayType = 'other';
  return result;
}

/**
 * Build the asset/scope inventory: dedupe assets by normalized resource_id
 * (findings with no resource_id become their own row), aggregate finding ids
 * and the worst severity per asset, and roll up per-scope counts.
 */
function buildAssetInventory(findings) {
  const assets = new Map();
  const scopeMap = new Map();
  for (const f of findings) {
    const parsed = parseResourceId(f.resource_id, f);
    const key = f.resource_id ? f.resource_id.toLowerCase() : 'finding:' + f.id;
    let a = assets.get(key);
    if (!a) {
      a = {
        key,
        name: parsed.name || shortResource(f.resource_id) || f.id,
        displayType: parsed.displayType || 'other',
        scope: parsed.scope,
        subscriptionId: parsed.subscriptionId,
        resourceGroup: parsed.resourceGroup,
        tenantId: parsed.tenantId,
        resourceId: f.resource_id,
        findingIds: [],
        maxSevRank: 0,
        maxSev: 'Informational',
      };
      assets.set(key, a);
    }
    a.findingIds.push(f.id);
    if (f.severityRank > a.maxSevRank) {
      a.maxSevRank = f.severityRank;
      a.maxSev = f.severity;
    }
    const scopeLabel = parsed.tenantId
      ? 'Tenant ' + parsed.tenantId
      : parsed.subscriptionId
        ? 'Subscription ' + parsed.subscriptionId
        : '(unscoped)';
    let s = scopeMap.get(scopeLabel);
    if (!s) {
      s = { label: scopeLabel, assets: new Set(), findings: 0 };
      scopeMap.set(scopeLabel, s);
    }
    s.assets.add(key);
    s.findings++;
  }
  const assetList = [...assets.values()].sort((a, b) => {
    if (b.maxSevRank !== a.maxSevRank) return b.maxSevRank - a.maxSevRank;
    if (a.displayType !== b.displayType) return a.displayType.localeCompare(b.displayType);
    return a.name.localeCompare(b.name);
  });
  const scopes = [...scopeMap.values()]
    .map((s) => ({ label: s.label, assets: s.assets.size, findings: s.findings }))
    .sort((a, b) => b.findings - a.findings);
  return { assets: assetList, scopes };
}

// ---------------------------------------------------------------------------
// Prioritized recommendations
// ---------------------------------------------------------------------------

function normRecText(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.;:,]+$/, '');
}

/**
 * Group findings into actionable recommendations keyed by check_id (preferred)
 * or normalized recommendation text, then bucket into priority tiers.
 * chainFindingIds carries the ids that participate in an explicit attack path.
 */
function buildRecommendations(findings, chainFindingIds) {
  const groups = new Map();
  for (const f of findings) {
    if (!f.recommendation) continue;
    const key = f.check_id ? 'check:' + f.check_id.toLowerCase() : 'rec:' + normRecText(f.recommendation);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        recommendation: f.recommendation,
        category: f.category,
        findingIds: [],
        maxSevRank: 0,
        maxSev: 'Informational',
        chainRelevant: false,
        controls: { mitre: new Set(), cis_azure: new Set(), defender_for_cloud: new Set(), nist_800_53: new Set() },
      };
      groups.set(key, g);
    }
    g.findingIds.push(f.id);
    if (f.severityRank > g.maxSevRank) {
      g.maxSevRank = f.severityRank;
      g.maxSev = f.severity;
      g.recommendation = f.recommendation;
      g.category = f.category;
    }
    if (chainFindingIds.has(f.id)) g.chainRelevant = true;
    for (const k of Object.keys(g.controls)) {
      (f.controls[k] || []).forEach((c) => g.controls[k].add(c));
    }
  }
  const all = [...groups.values()];
  const tierOf = (g) => {
    if (g.maxSev === 'Critical' || (g.maxSev === 'High' && g.chainRelevant)) return 1;
    if (g.maxSev === 'High' || g.maxSev === 'Medium') return 2;
    return 3;
  };
  for (const g of all) g.tier = tierOf(g);
  const sortFn = (a, b) => {
    if (b.maxSevRank !== a.maxSevRank) return b.maxSevRank - a.maxSevRank;
    if (a.chainRelevant !== b.chainRelevant) return a.chainRelevant ? -1 : 1;
    return b.findingIds.length - a.findingIds.length;
  };
  return [1, 2, 3].map((t) => ({ tier: t, items: all.filter((g) => g.tier === t).sort(sortFn) }));
}

// ---------------------------------------------------------------------------
// Executive summary (safe, evidence-bounded sentences only)
// ---------------------------------------------------------------------------

function buildExecSummary(findings, paths, counts, total, openRisk, chainFindingIds) {
  const out = [];
  if (total === 0) {
    out.push('No findings were present in the supplied dataset. This does not prove absence of risk; it reflects only what the assessment evaluated.');
    return out;
  }
  const sevParts = SEVERITY_ORDER.filter((s) => counts[s]).map((s) => counts[s] + ' ' + s);
  out.push('The assessment recorded ' + total + ' finding' + (total === 1 ? '' : 's') +
    ' in the in-scope environment' + (sevParts.length ? ' (' + sevParts.join(', ') + ')' : '') + '.');

  const explicit = paths.filter((p) => !p.derived);
  const modeled = explicit.length ? explicit : paths;
  if (modeled.length) {
    const p = modeled[0];
    out.push('The highest-severity modeled attack path, ' + p.id + ' (' + p.severity + '), ' +
      (p.title ? '\u201c' + p.title + ',\u201d ' : '') + 'traces a route' +
      (p.end_state ? ' ending in ' + p.end_state : '') + '.');
  }

  const byDomain = new Map();
  for (const f of findings) byDomain.set(f.category, (byDomain.get(f.category) || 0) + 1);
  let topDomain = null;
  let topN = 0;
  let tie = false;
  for (const [d, count] of byDomain) {
    if (count > topN) { topN = count; topDomain = d; tie = false; }
    else if (count === topN) tie = true;
  }
  if (topDomain && !tie) {
    out.push('The ' + topDomain + ' domain accounts for the largest share of findings (' + topN + ').');
  }

  out.push(openRisk + ' of ' + total + ' findings are in an open or unresolved state and warrant remediation tracking.');

  if (chainFindingIds.size) {
    out.push(chainFindingIds.size + ' finding' + (chainFindingIds.size === 1 ? '' : 's') +
      ' participate in at least one modeled attack path and should be prioritized to break those chains.');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Consolidated attack-graph model + layered layout + SVG rendering
// ---------------------------------------------------------------------------

const CG_NODE_W = 172;
const CG_NODE_H = 62;
const CG_GAP_X = 90;
const CG_LANE = 104;
const CG_PAD = 32;

/**
 * Merge EXPLICIT (non-derived) attack paths into a single deduplicated graph.
 * Nodes are keyed canonically by resource_id, else finding_id, else a
 * path-local synthetic id. Edges are deduped; both nodes and edges accumulate
 * the set of path ids they belong to. Applies a size cap for readability.
 */
function buildGraphModel(paths, findingsById) {
  const explicit = paths.filter((p) => !p.derived);
  const nodeMap = new Map();
  const edgeMap = new Map();

  for (const p of explicit) {
    const localToKey = new Map();
    for (const node of p.nodes) {
      let key;
      if (node.resource_id) key = 'res:' + node.resource_id.toLowerCase();
      else if (node.finding_id) key = 'find:' + node.finding_id;
      else key = 'pn:' + p.id + ':' + node.id;
      localToKey.set(node.id, key);
      let n = nodeMap.get(key);
      if (!n) {
        n = {
          key,
          label: node.label,
          type: node.type,
          resourceId: node.resource_id,
          findingId: node.finding_id,
          severity: '',
          severityRank: 0,
          paths: new Set(),
          x: 0, y: 0, rank: 0, order: 0,
        };
        nodeMap.set(key, n);
      }
      if (node.finding_id && !n.findingId) n.findingId = node.finding_id;
      const fid = n.findingId;
      if (fid && findingsById.has(fid)) {
        const f = findingsById.get(fid);
        if (f.severityRank > n.severityRank) {
          n.severityRank = f.severityRank;
          n.severity = f.severity;
        }
      }
      n.paths.add(p.id);
    }
    for (const e of p.edges) {
      const fromKey = localToKey.get(e.from);
      const toKey = localToKey.get(e.to);
      if (!fromKey || !toKey || fromKey === toKey) continue;
      const ekey = fromKey + '\u0000' + toKey;
      let edge = edgeMap.get(ekey);
      if (!edge) {
        edge = { from: fromKey, to: toKey, label: e.label, technique: e.technique, paths: new Set(), back: false };
        edgeMap.set(ekey, edge);
      } else if (!edge.label && e.label) {
        edge.label = e.label;
      }
      edge.paths.add(p.id);
    }
  }

  const nodes = [...nodeMap.values()];
  const edges = [...edgeMap.values()];
  const capped = nodes.length > 50 || edges.length > 90;
  return { nodes, edges, capped, pathCount: explicit.length };
}

/**
 * Deterministic layered DAG layout. Ranks nodes by longest path (topological),
 * detects back-edges via DFS coloring, then runs barycenter sweeps to reduce
 * crossings. Mutates node x/y/rank/order. Returns canvas dimensions.
 */
function layoutGraph(model) {
  const { nodes, edges } = model;
  if (!nodes.length) return { width: CG_PAD * 2, height: CG_PAD * 2 };
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const adj = new Map(nodes.map((n) => [n.key, []]));
  const indeg = new Map(nodes.map((n) => [n.key, 0]));
  for (const e of edges) {
    if (adj.has(e.from)) adj.get(e.from).push(e.to);
  }

  // DFS back-edge detection (white=0, gray=1, black=2).
  const color = new Map(nodes.map((n) => [n.key, 0]));
  const edgeByPair = new Map(edges.map((e) => [e.from + '\u0000' + e.to, e]));
  function dfs(key) {
    color.set(key, 1);
    for (const to of adj.get(key) || []) {
      const c = color.get(to);
      if (c === 1) {
        const e = edgeByPair.get(key + '\u0000' + to);
        if (e) e.back = true;
      } else if (c === 0) {
        dfs(to);
      }
    }
    color.set(key, 2);
  }
  for (const n of nodes) if (color.get(n.key) === 0) dfs(n.key);

  // Forward edges only for ranking.
  const fwd = edges.filter((e) => !e.back);
  for (const e of fwd) indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
  const rank = new Map(nodes.map((n) => [n.key, 0]));
  const queue = nodes.filter((n) => (indeg.get(n.key) || 0) === 0).map((n) => n.key);
  const fadj = new Map(nodes.map((n) => [n.key, []]));
  for (const e of fwd) fadj.get(e.from).push(e.to);
  const indegWork = new Map(indeg);
  while (queue.length) {
    const k = queue.shift();
    for (const to of fadj.get(k)) {
      rank.set(to, Math.max(rank.get(to), rank.get(k) + 1));
      indegWork.set(to, indegWork.get(to) - 1);
      if (indegWork.get(to) === 0) queue.push(to);
    }
  }
  for (const n of nodes) n.rank = rank.get(n.key) || 0;

  const layers = [];
  for (const n of nodes) {
    (layers[n.rank] || (layers[n.rank] = [])).push(n);
  }
  for (const layer of layers) {
    if (!layer) continue;
    layer.sort((a, b) => (b.severityRank - a.severityRank) || a.label.localeCompare(b.label));
    layer.forEach((n, i) => { n.order = i; });
  }

  // Barycenter sweeps using forward-edge predecessors.
  const preds = new Map(nodes.map((n) => [n.key, []]));
  for (const e of fwd) preds.get(e.to).push(e.from);
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let r = 1; r < layers.length; r++) {
      const layer = layers[r];
      if (!layer) continue;
      for (const n of layer) {
        const ps = preds.get(n.key);
        if (ps.length) {
          const avg = ps.reduce((s, k) => s + (byKey.get(k).order || 0), 0) / ps.length;
          n._bary = avg;
        } else {
          n._bary = n.order;
        }
      }
      layer.sort((a, b) => (a._bary - b._bary) || (b.severityRank - a.severityRank));
      layer.forEach((n, i) => { n.order = i; });
    }
  }

  const maxRows = Math.max(...layers.filter(Boolean).map((l) => l.length));
  const height = CG_PAD * 2 + maxRows * CG_LANE;
  layers.forEach((layer, r) => {
    if (!layer) return;
    const totalH = layer.length * CG_LANE;
    const top = CG_PAD + (height - CG_PAD * 2 - totalH) / 2;
    layer.forEach((n, i) => {
      n.x = CG_PAD + r * (CG_NODE_W + CG_GAP_X);
      n.y = top + i * CG_LANE + (CG_LANE - CG_NODE_H) / 2;
    });
  });
  const width = CG_PAD * 2 + layers.length * CG_NODE_W + (layers.length - 1) * CG_GAP_X;
  return { width, height };
}

function renderConsolidatedGraph(model, layout) {
  if (!model.pathCount) {
    return '<p class="empty">No explicit attack paths were supplied, so no consolidated graph is available. Derived single-finding chains are shown in the Attack Paths section.</p>';
  }
  const byKey = new Map(model.nodes.map((n) => [n.key, n]));
  if (model.capped) {
    const rows = model.nodes
      .slice()
      .sort((a, b) => b.severityRank - a.severityRank)
      .map((n) => `<tr><td>${escText(n.label)}</td><td>${n.findingId ? escText(n.findingId) : '<span class="muted">\u2014</span>'}</td><td>${n.severity ? sevPill(n.severity) : '<span class="muted">\u2014</span>'}</td></tr>`)
      .join('');
    return `<p class="note">The consolidated graph is large (${model.nodes.length} nodes, ${model.edges.length} edges) and is shown as a node table for readability.</p>
    <table class="restable"><thead><tr><th>Node</th><th>Finding</th><th>Severity</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  let svg = `<svg id="cgSvg" class="cgraph" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="Consolidated attack graph">`;
  svg += `<defs><marker id="cg-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="cg-arrowhead"/></marker></defs>`;
  svg += `<g class="cg-viewport">`;

  for (const e of model.edges) {
    const a = byKey.get(e.from);
    const b = byKey.get(e.to);
    if (!a || !b) continue;
    const pathsAttr = escAttr([...e.paths].join(' '));
    if (e.back) {
      const x1 = a.x;
      const y1 = a.y + CG_NODE_H / 2;
      const x2 = b.x + CG_NODE_W;
      const y2 = b.y + CG_NODE_H / 2;
      const my = Math.min(y1, y2) - 30;
      svg += `<path d="M${x1},${y1} C${x1 - 50},${my} ${x2 + 50},${my} ${x2},${y2}" class="cg-edge cg-back" data-paths="${pathsAttr}" marker-end="url(#cg-arrow)"/>`;
    } else {
      const x1 = a.x + CG_NODE_W;
      const y1 = a.y + CG_NODE_H / 2;
      const x2 = b.x;
      const y2 = b.y + CG_NODE_H / 2;
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2 - 4}" y2="${y2}" class="cg-edge" data-paths="${pathsAttr}" marker-end="url(#cg-arrow)"/>`;
      if (e.label || e.technique) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - 6;
        svg += `<text x="${mx}" y="${my}" text-anchor="middle" class="cg-edge-label">${escText(truncate([e.label, e.technique].filter(Boolean).join(' \u00b7 '), 20))}</text>`;
      }
    }
  }

  for (const n of model.nodes) {
    const sevClass = n.severity ? ' sev-' + slugId(n.severity) : ' sev-none';
    const clickable = n.findingId ? ' cg-clickable' : '';
    const attrs = n.findingId
      ? ` data-finding="${escAttr(n.findingId)}" tabindex="0" role="button"`
      : '';
    const pathsAttr = escAttr([...n.paths].join(' '));
    const tip = [n.label];
    if (n.resourceId) tip.push(n.resourceId);
    if (n.findingId) tip.push('Finding ' + n.findingId + (n.severity ? ' (' + n.severity + ')' : ''));
    svg += `<g class="cg-node${sevClass}${clickable}" data-paths="${pathsAttr}"${attrs}>`;
    svg += `<title>${escText(tip.join('\n'))}</title>`;
    svg += `<rect x="${n.x}" y="${n.y}" width="${CG_NODE_W}" height="${CG_NODE_H}" rx="10"/>`;
    svg += `<text x="${n.x + 12}" y="${n.y + 22}" class="cg-node-type">${escText(String(n.type || 'node').toUpperCase())}</text>`;
    svg += `<text x="${n.x + 12}" y="${n.y + 40}" class="cg-node-label">${escText(truncate(n.label, 22))}</text>`;
    if (n.findingId) {
      svg += `<text x="${n.x + 12}" y="${n.y + 55}" class="cg-node-fid">${escText(n.findingId)}</text>`;
    }
    svg += `</g>`;
  }

  svg += `</g></svg>`;
  return svg;
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: 'exec-summary', num: '1', label: 'Executive Summary' },
  { id: 'attack-paths', num: '2', label: 'Attack Paths' },
  { id: 'findings', num: '3', label: 'Findings' },
  { id: 'recommendations', num: '4', label: 'Recommendations' },
  { id: 'resources', num: '5', label: 'Resources & Scope' },
  { id: 'attack-graph', num: '6', label: 'Consolidated Attack Graph' },
  { id: 'appendix-coverage', num: 'A', label: 'Appendix A · Coverage & Controls' },
  { id: 'appendix-methodology', num: 'B', label: 'Appendix B · Methodology & Limitations' },
  { id: 'appendix-about', num: 'C', label: 'Appendix C · About This Report' },
];

const TIER_META = {
  1: { label: 'Immediate', sub: 'Critical exposure or active attack-path participation', cls: 'tier-1' },
  2: { label: 'Short-term', sub: 'Material risk to address in the current remediation cycle', cls: 'tier-2' },
  3: { label: 'Hardening', sub: 'Lower-severity posture and defense-in-depth improvements', cls: 'tier-3' },
};

function buildAnchors(findings) {
  const used = new Set();
  const map = new Map();
  for (const f of findings) {
    let base = 'finding-' + slugId(f.id);
    let candidate = base;
    let i = 2;
    while (used.has(candidate)) {
      candidate = base + '-' + i;
      i++;
    }
    used.add(candidate);
    map.set(f.id, candidate);
  }
  return map;
}

function buildChainFindingIds(paths) {
  const ids = new Set();
  for (const p of paths) {
    if (p.derived) continue;
    if (p.finding_id) ids.add(p.finding_id);
    for (const n of p.nodes) if (n.finding_id) ids.add(n.finding_id);
    for (const e of p.edges) if (e.finding_id) ids.add(e.finding_id);
  }
  return ids;
}

function renderCoverage(findings) {
  const byDomain = new Map();
  for (const f of findings) {
    let d = byDomain.get(f.category);
    if (!d) { d = { category: f.category, total: 0, counts: {} }; byDomain.set(f.category, d); }
    d.total++;
    d.counts[f.severity] = (d.counts[f.severity] || 0) + 1;
  }
  const rows = [...byDomain.values()]
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category))
    .map((d) => {
      const sevCells = SEVERITY_ORDER.map((s) => `<td class="num">${d.counts[s] ? d.counts[s] : '<span class="muted">\u00b7</span>'}</td>`).join('');
      return `<tr><td>${escText(d.category)}</td><td class="num">${d.total}</td>${sevCells}</tr>`;
    })
    .join('');
  const sevHead = SEVERITY_ORDER.map((s) => `<th class="num">${escText(s.slice(0, 4))}</th>`).join('');

  const fw = { mitre: new Set(), cis_azure: new Set(), defender_for_cloud: new Set(), nist_800_53: new Set() };
  for (const f of findings) {
    for (const k of Object.keys(fw)) (f.controls[k] || []).forEach((c) => fw[k].add(c));
  }
  const fwBlocks = [];
  if (fw.mitre.size) fwBlocks.push(`<div class="fw"><h4>MITRE ATT&amp;CK</h4><div class="chips">${chips([...fw.mitre].sort(), 'c-mitre')}</div></div>`);
  if (fw.cis_azure.size) fwBlocks.push(`<div class="fw"><h4>CIS Azure</h4><div class="chips">${chips([...fw.cis_azure].sort(), 'c-cis')}</div></div>`);
  if (fw.defender_for_cloud.size) fwBlocks.push(`<div class="fw"><h4>Defender for Cloud</h4><div class="chips">${chips([...fw.defender_for_cloud].sort(), 'c-dfc')}</div></div>`);
  if (fw.nist_800_53.size) fwBlocks.push(`<div class="fw"><h4>NIST 800-53</h4><div class="chips">${chips([...fw.nist_800_53].sort(), 'c-nist')}</div></div>`);

  return `
    <table class="restable cov">
      <thead><tr><th>Domain</th><th class="num">Findings</th>${sevHead}</tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No findings.</td></tr>'}</tbody>
    </table>
    ${fwBlocks.length ? `<div class="fw-grid">${fwBlocks.join('')}</div>` : '<p class="muted">No control-framework mappings were supplied.</p>'}`;
}

function buildHtml(findings, paths, meta, title) {
  const total = findings.length;
  const counts = {};
  for (const s of SEVERITY_ORDER) counts[s] = 0;
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const openRisk = findings.filter((f) => OPEN_STATUSES.has(String(f.status).toLowerCase())).length;

  const findingsById = new Map(findings.map((f) => [f.id, f]));
  const chainFindingIds = buildChainFindingIds(paths);
  const anchors = buildAnchors(findings);

  const inventory = buildAssetInventory(findings);
  const recs = buildRecommendations(findings, chainFindingIds);
  const summary = buildExecSummary(findings, paths, counts, total, openRisk, chainFindingIds);
  const graphModel = buildGraphModel(paths, findingsById);
  const graphLayout = graphModel.capped ? { width: 0, height: 0 } : layoutGraph(graphModel);

  const genDate = new Date().toISOString();
  const docTitle = meta.name || title || 'Azure Cloud Security Assessment';
  const subs = Array.isArray(meta.subscriptions) ? meta.subscriptions : [];

  // ---- Cover -------------------------------------------------------------
  const sevChipsCover = SEVERITY_ORDER
    .filter((s) => counts[s])
    .map((s) => `<span class="cover-sev sev-${slugId(s)}">${counts[s]} ${escText(s)}</span>`)
    .join('');
  const coverMetaRows = [
    meta.client ? ['Client', meta.client] : null,
    meta.id ? ['Engagement ID', meta.id] : null,
    meta.mode ? ['Mode', meta.mode] : ['Mode', 'read-only-assessment'],
    meta.date ? ['Assessment date', meta.date] : null,
    subs.length ? ['Subscriptions', subs.join('  ·  ')] : null,
  ].filter(Boolean)
    .map(([k, v]) => `<div class="cm-row"><span class="cm-k">${escText(k)}</span><span class="cm-v">${escText(v)}</span></div>`)
    .join('');

  const printToc = SECTIONS
    .map((s) => `<li><span class="pt-num">${escText(s.num)}</span><span class="pt-label">${escText(s.label)}</span></li>`)
    .join('');

  const cover = `
  <header class="cover">
    <div class="cover-top">
      <div class="brand"><span class="brand-mark" aria-hidden="true">\u26ca</span><span class="brand-name">Azure Red Team</span></div>
      <span class="confidential">CONFIDENTIAL</span>
    </div>
    <div class="cover-main">
      <p class="cover-kicker">Cloud Security Assessment</p>
      <h1 class="cover-title">${escText(docTitle)}</h1>
      <div class="cover-meta">${coverMetaRows}</div>
      <div class="cover-sevs">${sevChipsCover || '<span class="muted">No findings recorded.</span>'}</div>
    </div>
    <div class="cover-foot">
      <div class="cover-toc">
        <h2>Contents</h2>
        <ol class="print-toc">${printToc}</ol>
      </div>
      <p class="disclaimer">Read-only assessment. This report is generated from supplied, read-only findings and methodology output; it performs no live scanning and contains no exploit payloads. Distribution is restricted to authorized recipients.</p>
    </div>
  </header>`;

  // ---- Action bar + sidebar TOC -----------------------------------------
  const actionbar = `
  <div class="actionbar no-print">
    <button id="btnExpand" class="ab-btn">Expand all</button>
    <button id="btnCollapse" class="ab-btn">Collapse all</button>
    <button id="btnPrint" class="ab-btn ab-primary">Print / Save PDF</button>
  </div>`;

  const tocLinks = SECTIONS
    .map((s) => `<li><a href="#${escAttr(s.id)}" data-section="${escAttr(s.id)}"><span class="toc-num">${escText(s.num)}</span><span class="toc-label">${escText(s.label)}</span></a></li>`)
    .join('');
  const toc = `<nav class="toc no-print" aria-label="Table of contents"><div class="toc-inner"><h2>Contents</h2><ol>${tocLinks}</ol></div></nav>`;

  // ---- §1 Executive summary ---------------------------------------------
  const sevCards = SEVERITY_ORDER
    .map((s) => `<div class="sevcard sev-${slugId(s)}" data-severity="${escAttr(s)}" role="button" tabindex="0"><span class="sc-n">${counts[s] || 0}</span><span class="sc-l">${escText(s)}</span></div>`)
    .join('');
  const summaryHtml = summary.map((p) => `<p>${escText(p)}</p>`).join('');
  const sec1 = `
  <section id="exec-summary" class="section">
    <div class="sec-head"><span class="sec-num">1</span><h2>Executive Summary</h2></div>
    <div class="exec-grid">
      <div class="exec-prose">${summaryHtml}</div>
      <aside class="exec-stats">
        ${donut(counts, total)}
        <div class="kpis">
          <div class="kpi"><span class="kpi-n">${total}</span><span class="kpi-l">Total findings</span></div>
          <div class="kpi"><span class="kpi-n">${openRisk}</span><span class="kpi-l">Open / unresolved</span></div>
          <div class="kpi"><span class="kpi-n">${chainFindingIds.size}</span><span class="kpi-l">In attack paths</span></div>
        </div>
      </aside>
    </div>
    <div class="sevcards">${sevCards}</div>
  </section>`;

  // ---- §2 Attack paths ---------------------------------------------------
  let pathsHtml;
  if (!paths.length) {
    pathsHtml = '<p class="empty">No attack paths were supplied or derived from the findings.</p>';
  } else {
    pathsHtml = paths.map((p) => {
      const fid = p.finding_id && anchors.has(p.finding_id) ? anchors.get(p.finding_id) : '';
      const jump = fid ? `<button class="linkbtn ap-jump" data-target="${escAttr(fid)}">View finding ${escText(p.finding_id)} \u203a</button>` : '';
      const tags = [
        p.derived ? '<span class="tag tag-derived">derived</span>' : '<span class="tag tag-explicit">modeled</span>',
        p.entry ? `<span class="kv"><span class="muted">Entry</span> ${escText(truncate(p.entry, 48))}</span>` : '',
        p.end_state ? `<span class="kv"><span class="muted">End state</span> ${escText(truncate(p.end_state, 48))}</span>` : '',
      ].filter(Boolean).join('');
      const breakChain = p.break_chain ? `<div class="ap-break"><span class="muted">Break the chain:</span> ${escText(p.break_chain)}</div>` : '';
      return `
      <article class="appath">
        <div class="appath-head">
          <span class="ap-sev">${sevPill(p.severity)}</span>
          <span class="ap-id">${escText(p.id)}</span>
          <span class="ap-title">${escText(p.title)}</span>
          ${jump}
        </div>
        <div class="ap-tags">${tags}</div>
        <div class="ap-scroll">${renderPathSvg(p)}</div>
        ${breakChain}
      </article>`;
    }).join('');
  }
  const sec2 = `
  <section id="attack-paths" class="section">
    <div class="sec-head"><span class="sec-num">2</span><h2>Attack Paths</h2></div>
    <p class="sec-intro">Modeled routes an adversary could take through the environment. Nodes linked to a finding are clickable and jump to the detailed finding.</p>
    ${pathsHtml}
  </section>`;

  // ---- §3 Findings -------------------------------------------------------
  const agents = [...new Set(findings.map((f) => f.agent))].sort();
  const domains = [...new Set(findings.map((f) => f.category))].sort();
  const agentOpts = agents.map((a) => `<option value="${escAttr(a)}">${escText(a)}</option>`).join('');
  const domainOpts = domains.map((d) => `<option value="${escAttr(d)}">${escText(d)}</option>`).join('');
  const findingRows = findings.map((f) => renderFindingRow(f, anchors.get(f.id))).join('');
  const sec3 = `
  <section id="findings" class="section">
    <div class="sec-head"><span class="sec-num">3</span><h2>Findings</h2></div>
    <div class="filters no-print">
      <input type="search" id="fSearch" placeholder="Search findings\u2026" aria-label="Search findings">
      <select id="fSeverity" aria-label="Filter by severity"><option value="">All severities</option>${SEVERITY_ORDER.map((s) => `<option value="${escAttr(s)}">${escText(s)}</option>`).join('')}</select>
      <select id="fDomain" aria-label="Filter by domain"><option value="">All domains</option>${domainOpts}</select>
      <select id="fAgent" aria-label="Filter by agent"><option value="">All agents</option>${agentOpts}</select>
      <span class="filter-count" id="fCount"></span>
    </div>
    <div class="findings" id="findingList">${findingRows || '<p class="empty">No findings.</p>'}</div>
  </section>`;

  // ---- §4 Recommendations ------------------------------------------------
  const recTiers = recs.map((tier) => {
    const tm = TIER_META[tier.tier];
    if (!tier.items.length) return '';
    const items = tier.items.map((g) => {
      const fids = g.findingIds.map((id) => {
        const anc = anchors.get(id);
        return anc ? `<button class="linkbtn rec-fid" data-target="${escAttr(anc)}">${escText(id)}</button>` : `<span class="rec-fid-static">${escText(id)}</span>`;
      }).join('');
      const ctrlChips = [
        chips([...g.controls.mitre].sort(), 'c-mitre'),
        chips([...g.controls.cis_azure].sort(), 'c-cis'),
        chips([...g.controls.defender_for_cloud].sort(), 'c-dfc'),
        chips([...g.controls.nist_800_53].sort(), 'c-nist'),
      ].join('');
      const chainTag = g.chainRelevant ? '<span class="tag tag-chain">breaks attack path</span>' : '';
      return `
      <div class="rec">
        <div class="rec-top">${sevPill(g.maxSev)}<span class="rec-cat">${escText(g.category)}</span>${chainTag}</div>
        <p class="rec-text">${escText(g.recommendation)}</p>
        <div class="rec-foot">
          <div class="rec-fids"><span class="muted">Addresses:</span> ${fids}</div>
          ${ctrlChips ? `<div class="chips rec-ctrls">${ctrlChips}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    return `
    <div class="rec-tier ${tm.cls}">
      <div class="tier-head"><span class="tier-badge">${escText(tm.label)}</span><span class="tier-sub">${escText(tm.sub)}</span></div>
      <div class="rec-list">${items}</div>
    </div>`;
  }).join('');
  const sec4 = `
  <section id="recommendations" class="section">
    <div class="sec-head"><span class="sec-num">4</span><h2>Recommendations</h2></div>
    <p class="sec-intro">Findings consolidated into prioritized, actionable remediations. Items flagged <em>breaks attack path</em> sever a modeled chain and are weighted higher.</p>
    ${recTiers || '<p class="empty">No recommendations were derived from the findings.</p>'}
  </section>`;

  // ---- §5 Resources & scope ---------------------------------------------
  const scopeChips = inventory.scopes
    .map((s) => `<div class="scope-chip"><span class="scope-label">${escText(s.label)}</span><span class="scope-nums">${s.assets} asset${s.assets === 1 ? '' : 's'} · ${s.findings} finding${s.findings === 1 ? '' : 's'}</span></div>`)
    .join('');
  const assetRows = inventory.assets.map((a) => {
    const fids = a.findingIds.map((id) => {
      const anc = anchors.get(id);
      return anc ? `<button class="linkbtn rec-fid" data-target="${escAttr(anc)}">${escText(id)}</button>` : escText(id);
    }).join(' ');
    const scopeText = a.tenantId ? 'tenant:' + a.tenantId : a.subscriptionId ? a.subscriptionId : '\u2014';
    return `<tr>
      <td>${sevPill(a.maxSev)}</td>
      <td><span class="asset-name" title="${escAttr(a.resourceId)}">${escText(a.name)}</span></td>
      <td><code class="asset-type">${escText(a.displayType)}</code></td>
      <td class="asset-scope">${escText(scopeText)}</td>
      <td>${fids}</td>
    </tr>`;
  }).join('');
  const sec5 = `
  <section id="resources" class="section">
    <div class="sec-head"><span class="sec-num">5</span><h2>Resources &amp; Scope</h2></div>
    <p class="sec-intro">Assets referenced by findings, deduplicated and ranked by worst observed severity, with a roll-up of in-scope tenants and subscriptions.</p>
    <div class="scope-strip">${scopeChips || '<span class="muted">No scope information available.</span>'}</div>
    <table class="restable">
      <thead><tr><th>Severity</th><th>Asset</th><th>Type</th><th>Scope</th><th>Findings</th></tr></thead>
      <tbody>${assetRows || '<tr><td colspan="5" class="muted">No assets.</td></tr>'}</tbody>
    </table>
  </section>`;

  // ---- §6 Consolidated attack graph -------------------------------------
  const graphSvg = renderConsolidatedGraph(graphModel, graphLayout);
  const graphControls = (graphModel.pathCount && !graphModel.capped)
    ? `<div class="cg-controls no-print">
        <button id="cgZoomIn" class="ab-btn" aria-label="Zoom in">+</button>
        <button id="cgZoomOut" class="ab-btn" aria-label="Zoom out">\u2212</button>
        <button id="cgFit" class="ab-btn">Fit</button>
        <button id="cgReset" class="ab-btn">Reset</button>
        <span class="cg-hint">Drag to pan · scroll to zoom · click a node to open its finding</span>
      </div>`
    : '';
  const legend = (graphModel.pathCount && !graphModel.capped)
    ? `<div class="cg-legend">${SEVERITY_ORDER.map((s) => `<span class="cg-leg sev-${slugId(s)}">${escText(s)}</span>`).join('')}<span class="cg-leg cg-leg-back">back-edge (loop)</span></div>`
    : '';
  const sec6 = `
  <section id="attack-graph" class="section">
    <div class="sec-head"><span class="sec-num">6</span><h2>Consolidated Attack Graph</h2></div>
    <p class="sec-intro">All modeled attack paths merged into a single graph. Shared assets are deduplicated so cross-path pivots are visible at a glance.</p>
    ${graphControls}
    ${legend}
    <div class="cg-frame" id="cgFrame">${graphSvg}</div>
  </section>`;

  // ---- Appendices --------------------------------------------------------
  const appA = `
  <section id="appendix-coverage" class="section appendix">
    <div class="sec-head"><span class="sec-num">A</span><h2>Appendix A · Coverage &amp; Controls</h2></div>
    <p class="sec-intro">Finding distribution across security domains and the control frameworks referenced by the findings.</p>
    ${renderCoverage(findings)}
  </section>`;

  const appB = `
  <section id="appendix-methodology" class="section appendix">
    <div class="sec-head"><span class="sec-num">B</span><h2>Appendix B · Methodology &amp; Limitations</h2></div>
    <div class="prose">
      <p>This assessment was produced by a coordinated team of read-only Azure security agents. Each agent specializes in a domain (identity, network, storage, RBAC, logging, AI, web, and governance) and contributes structured findings to a shared evidence model. An orchestrator deduplicates overlapping observations and an attack-path analyst correlates findings into multi-step chains.</p>
      <h3>Scope</h3>
      <p>Only resources and configurations represented in the supplied findings dataset are in scope. Tenants and subscriptions listed on the cover define the engagement boundary.</p>
      <h3>Approach</h3>
      <p>The methodology is read-only and evidence-driven: configuration and posture are evaluated against documented control baselines and known attack techniques. No exploitation, write operations, or live credential use is performed, and no exploit payloads are included.</p>
      <h3>Limitations</h3>
      <p>Absence of a finding is not proof of security; it reflects only what was evaluated with the supplied inputs. Severity and confidence are analytical judgments. Attack paths are models intended to prioritize remediation, not guarantees of exploitability. Findings should be validated against the live environment before remediation is finalized.</p>
    </div>
  </section>`;

  const appC = `
  <section id="appendix-about" class="section appendix">
    <div class="sec-head"><span class="sec-num">C</span><h2>Appendix C · About This Report</h2></div>
    <div class="prose">
      <p>This document is a self-contained HTML report. It loads no external scripts, styles, fonts, or network resources, and is safe to open offline or archive as evidence. Use <em>Print / Save PDF</em> to produce a paginated copy.</p>
      <table class="restable about">
        <tbody>
          <tr><td>Generated</td><td>${escText(genDate)}</td></tr>
          <tr><td>Generator version</td><td>${escText(GENERATOR_VERSION)}</td></tr>
          <tr><td>Findings</td><td>${total}</td></tr>
          <tr><td>Attack paths</td><td>${paths.length} (${paths.filter((p) => !p.derived).length} modeled, ${paths.filter((p) => p.derived).length} derived)</td></tr>
        </tbody>
      </table>
      ${warnings.length ? `<div class="warnbox"><h4>Generation notes (${warnings.length})</h4><ul>${warnings.map((w) => `<li>${escText(w)}</li>`).join('')}</ul></div>` : ''}
    </div>
  </section>`;

  const metaJson = jsonForScript({
    generator: GENERATOR_VERSION,
    generated: genDate,
    title: docTitle,
    total,
    counts,
    openRisk,
    chainFindings: chainFindingIds.size,
  });

  const favicon = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text y="13" font-size="13">\u26ca</text></svg>'
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${escText(docTitle)}</title>
<link rel="icon" href="${escAttr(favicon)}">
<style>${CSS}</style>
<noscript><style>
  .finding-detail{display:block !important}
  .fh-caret,.filters,.actionbar,.cg-controls,.cg-hint{display:none !important}
</style></noscript>
</head>
<body>
${cover}
${actionbar}
<div class="layout">
${toc}
<main class="doc">
${sec1}
${sec2}
${sec3}
${sec4}
${sec5}
${sec6}
${appA}
${appB}
${appC}
</main>
</div>
<script type="application/json" id="report-meta">${metaJson}</script>
<script>${JS}</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Styles (light, print-first consulting theme)
// ---------------------------------------------------------------------------

const CSS = `
:root{
  --page:#f4f6f9; --panel:#fff; --panel2:#f8fafc; --line:#e2e8f0; --line2:#cbd5e1;
  --txt:#0f172a; --txt2:#1a2230; --muted:#5b6b80; --navy:#16365c; --navy2:#1e3a5f;
  --crit:#b91c1c; --high:#c2410c; --med:#b45309; --low:#1d4ed8; --info:#475569; --ok:#15803d;
  --radius:10px; --shadow:0 1px 2px rgba(15,23,42,.06),0 4px 16px rgba(15,23,42,.05);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0; background:var(--page); color:var(--txt);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
h1,h2,h3,h4{color:var(--txt2); line-height:1.25; margin:0}
a{color:var(--navy2); text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.85em}
.muted{color:var(--muted)}
.num{text-align:right; font-variant-numeric:tabular-nums}
.empty,.note{color:var(--muted); background:var(--panel2); border:1px dashed var(--line2); border-radius:var(--radius); padding:14px 16px}

/* Cover */
.cover{
  max-width:920px; margin:28px auto 0; background:linear-gradient(160deg,var(--navy) 0%,var(--navy2) 60%,#27496e 100%);
  color:#eef3f9; border-radius:16px; padding:34px 40px 30px; box-shadow:var(--shadow);
}
.cover-top{display:flex; justify-content:space-between; align-items:center}
.brand{display:flex; align-items:center; gap:10px; font-weight:600; letter-spacing:.02em}
.brand-mark{font-size:22px}
.confidential{font-size:11px; font-weight:700; letter-spacing:.16em; border:1px solid rgba(255,255,255,.45); padding:4px 10px; border-radius:6px}
.cover-main{margin:30px 0 26px}
.cover-kicker{margin:0 0 8px; text-transform:uppercase; letter-spacing:.18em; font-size:12px; color:#a9c2e0}
.cover-title{font-size:34px; font-weight:700; margin:0 0 22px; color:#fff}
.cover-meta{display:grid; grid-template-columns:1fr 1fr; gap:6px 28px; max-width:720px}
.cm-row{display:flex; gap:10px; font-size:13.5px; padding:4px 0; border-bottom:1px solid rgba(255,255,255,.12)}
.cm-k{color:#a9c2e0; min-width:118px}
.cm-v{color:#fff}
.cover-sevs{margin-top:20px; display:flex; flex-wrap:wrap; gap:8px}
.cover-sev{font-size:12.5px; font-weight:600; padding:5px 11px; border-radius:999px; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.2)}
.cover-foot{display:grid; grid-template-columns:1fr 1.1fr; gap:28px; margin-top:8px; padding-top:22px; border-top:1px solid rgba(255,255,255,.18)}
.cover-toc h2{color:#cfe0f2; font-size:13px; text-transform:uppercase; letter-spacing:.12em; margin-bottom:8px}
.print-toc{list-style:none; margin:0; padding:0; columns:1}
.print-toc li{display:flex; gap:10px; font-size:13px; padding:3px 0; color:#dbe7f4}
.pt-num{color:#9fc; opacity:.8; min-width:18px; color:#a9c2e0}
.disclaimer{font-size:12px; line-height:1.5; color:#c4d4e6; margin:0}

/* Action bar */
.actionbar{max-width:1180px; margin:18px auto 0; display:flex; gap:8px; justify-content:flex-end; padding:0 24px}
.ab-btn{background:var(--panel); color:var(--txt2); border:1px solid var(--line2); border-radius:7px; padding:7px 13px; font-size:13px; cursor:pointer}
.ab-btn:hover{background:var(--panel2); border-color:var(--navy2)}
.ab-primary{background:var(--navy2); color:#fff; border-color:var(--navy2)}
.ab-primary:hover{background:var(--navy)}

/* Layout */
.layout{max-width:1180px; margin:18px auto 60px; padding:0 24px; display:grid; grid-template-columns:228px 1fr; gap:30px; align-items:start}
.toc{position:sticky; top:18px}
.toc-inner{background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:16px 14px; box-shadow:var(--shadow)}
.toc-inner h2{font-size:12px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); margin-bottom:10px}
.toc ol{list-style:none; margin:0; padding:0}
.toc li a{display:flex; gap:9px; align-items:baseline; padding:6px 8px; border-radius:6px; color:var(--txt2); font-size:13.5px; border-left:2px solid transparent}
.toc li a:hover{background:var(--panel2); text-decoration:none}
.toc li a.active{background:#eaf1fa; border-left-color:var(--navy2); color:var(--navy2); font-weight:600}
.toc-num{color:var(--muted); min-width:16px; font-variant-numeric:tabular-nums}
.doc{min-width:0}

/* Sections */
.section{background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:24px 26px; margin-bottom:22px; box-shadow:var(--shadow)}
.sec-head{display:flex; align-items:center; gap:12px; margin-bottom:14px; padding-bottom:12px; border-bottom:2px solid var(--line)}
.sec-num{display:grid; place-items:center; width:30px; height:30px; border-radius:8px; background:var(--navy2); color:#fff; font-weight:700; font-size:15px}
.sec-head h2{font-size:21px}
.sec-intro{color:var(--muted); margin:0 0 18px; max-width:78ch}
.appendix .sec-num{background:#475569}

/* Exec summary */
.exec-grid{display:grid; grid-template-columns:1fr 280px; gap:26px; align-items:start}
.exec-prose p{margin:0 0 12px}
.exec-prose p:first-child{font-size:16px; color:var(--txt)}
.exec-stats{display:flex; flex-direction:column; align-items:center; gap:14px; background:var(--panel2); border:1px solid var(--line); border-radius:var(--radius); padding:18px}
.kpis{display:flex; gap:10px; width:100%; justify-content:space-around}
.kpi{display:flex; flex-direction:column; align-items:center}
.kpi-n{font-size:22px; font-weight:700; color:var(--navy2)}
.kpi-l{font-size:11px; color:var(--muted); text-align:center}
.donut-total{font-size:26px; font-weight:700; fill:var(--txt2)}
.donut-label{font-size:11px; fill:var(--muted)}
.donut-empty{stroke:var(--line2)}
.donut-critical{stroke:var(--crit)} .donut-high{stroke:var(--high)} .donut-medium{stroke:var(--med)} .donut-low{stroke:var(--low)} .donut-informational{stroke:var(--info)}
.sevcards{display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin-top:20px}
.sevcard{display:flex; flex-direction:column; align-items:center; gap:2px; padding:12px 8px; border-radius:var(--radius); border:1px solid var(--line); background:var(--panel2); cursor:pointer; border-top:3px solid var(--line2)}
.sevcard:hover{box-shadow:var(--shadow)}
.sevcard.active{box-shadow:0 0 0 2px var(--navy2)}
.sc-n{font-size:24px; font-weight:700}
.sc-l{font-size:12px; color:var(--muted)}
.sevcard.sev-critical{border-top-color:var(--crit)} .sevcard.sev-critical .sc-n{color:var(--crit)}
.sevcard.sev-high{border-top-color:var(--high)} .sevcard.sev-high .sc-n{color:var(--high)}
.sevcard.sev-medium{border-top-color:var(--med)} .sevcard.sev-medium .sc-n{color:var(--med)}
.sevcard.sev-low{border-top-color:var(--low)} .sevcard.sev-low .sc-n{color:var(--low)}
.sevcard.sev-informational{border-top-color:var(--info)} .sevcard.sev-informational .sc-n{color:var(--info)}

/* Pills / badges / chips */
.pill{display:inline-block; font-size:11.5px; font-weight:700; padding:2px 9px; border-radius:999px; white-space:nowrap}
.sev-critical{background:#fdeaea; color:var(--crit); border:1px solid #f3c4c4}
.sev-high{background:#fdf0e7; color:var(--high); border:1px solid #f4cdb0}
.sev-medium{background:#fdf6e3; color:var(--med); border:1px solid #efdca4}
.sev-low{background:#e8f0fe; color:var(--low); border:1px solid #c3d6fb}
.sev-informational{background:#eef2f6; color:var(--info); border:1px solid #d3dbe4}
.badge{display:inline-block; font-size:11px; font-weight:600; padding:2px 8px; border-radius:6px; background:var(--panel2); border:1px solid var(--line2); color:var(--muted)}
.status-open,.status-confirmed{background:#fdeaea; color:var(--crit); border-color:#f3c4c4}
.status-remediated,.status-resolved,.status-closed{background:#e7f6ec; color:var(--ok); border-color:#bfe3cb}
.chips{display:flex; flex-wrap:wrap; gap:6px}
.chip{font-size:11px; padding:2px 8px; border-radius:6px; border:1px solid var(--line2); background:var(--panel2); color:var(--txt2)}
.c-mitre{background:#f3eafc; border-color:#dcc6f2; color:#6b21a8}
.c-cis{background:#e8f0fe; border-color:#c3d6fb; color:#1d4ed8}
.c-dfc{background:#e7f6ec; border-color:#bfe3cb; color:#15803d}
.c-nist{background:#fef4e6; border-color:#f0d8af; color:#b45309}
.tag{font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:2px 8px; border-radius:6px}
.tag-explicit{background:#e8f0fe; color:#1d4ed8} .tag-derived{background:#eef2f6; color:var(--info)}
.tag-chain{background:#fdeaea; color:var(--crit)}
.kv{font-size:12.5px; color:var(--txt2)}
.linkbtn{background:none; border:none; color:var(--navy2); cursor:pointer; font:inherit; font-size:12.5px; padding:0}
.linkbtn:hover{text-decoration:underline}

/* Attack paths */
.appath{border:1px solid var(--line); border-radius:var(--radius); padding:16px; margin-bottom:16px; background:var(--panel2)}
.appath-head{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px}
.ap-id{font-weight:700; font-size:13px; color:var(--navy2)}
.ap-title{font-weight:600}
.ap-jump{margin-left:auto}
.ap-tags{display:flex; gap:14px; flex-wrap:wrap; margin-bottom:12px}
.ap-scroll{overflow-x:auto; padding:6px 2px}
.ap-break{margin-top:10px; font-size:13px; background:#e7f6ec; border:1px solid #bfe3cb; border-radius:8px; padding:8px 12px}
.apgraph,.cgraph{font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.ap-edge,.cg-edge{stroke:var(--line2); stroke-width:2; fill:none}
.ap-arrow,.cg-arrowhead{fill:var(--line2)}
.ap-edge-label,.cg-edge-label{fill:var(--muted); font-size:10px; font-weight:600}
.ap-node rect,.cg-node rect{fill:#fff; stroke:var(--line2); stroke-width:1.5}
.ap-node-type,.cg-node-type{fill:var(--muted); font-size:9px; font-weight:700; letter-spacing:.06em}
.ap-node-label,.cg-node-label{fill:var(--txt2); font-size:11.5px; font-weight:600}
.ap-node-fid,.cg-node-fid{fill:var(--navy2); font-size:10px; font-weight:600}
.ap-entry rect{fill:#eaf1fa; stroke:var(--navy2)}
.ap-target rect{fill:#fdeaea; stroke:var(--crit)}
.ap-clickable,.cg-clickable{cursor:pointer}
.ap-clickable:hover rect,.cg-clickable:hover rect{stroke-width:2.5; filter:drop-shadow(0 1px 3px rgba(15,23,42,.18))}

/* Findings */
.filters{display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:16px}
.filters input,.filters select{background:var(--panel); border:1px solid var(--line2); border-radius:7px; padding:7px 10px; font:inherit; font-size:13px; color:var(--txt)}
.filters input[type=search]{flex:1; min-width:200px}
.filter-count{font-size:12.5px; color:var(--muted); margin-left:auto}
.finding{border:1px solid var(--line); border-radius:var(--radius); margin-bottom:8px; overflow:hidden; background:var(--panel)}
.finding-head{display:grid; grid-template-columns:auto 92px 1fr 130px 150px 96px auto; gap:12px; align-items:center; width:100%; text-align:left; background:none; border:none; padding:12px 14px; cursor:pointer; font:inherit; color:var(--txt)}
.finding-head:hover{background:var(--panel2)}
.fh-id{font-weight:700; font-size:12.5px; color:var(--navy2)}
.fh-title{font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.fh-domain{font-size:12px; color:var(--muted)}
.fh-res{font-size:12px; color:var(--muted); font-family:ui-monospace,monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.fh-caret{justify-self:end; color:var(--muted); transition:transform .15s}
.finding.open .fh-caret{transform:rotate(90deg)}
.flash{animation:flash 1.2s ease-out}
@keyframes flash{0%{box-shadow:0 0 0 3px var(--navy2)}100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}}
.finding-detail{padding:4px 16px 18px; border-top:1px solid var(--line); background:var(--panel2)}
.detail-meta{display:flex; flex-wrap:wrap; gap:14px; padding:12px 0; color:var(--txt2)}
.detail-block{margin:12px 0}
.detail-block h4{font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin-bottom:5px}
.detail-block p{margin:0}
.detail-block.rec{background:#e7f6ec; border:1px solid #bfe3cb; border-radius:8px; padding:10px 12px}
.detail-block.rec h4{color:var(--ok)}
.resfull{display:block; background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:7px 9px; word-break:break-all}
.apsteps,.refs,.evidence{margin:0; padding-left:18px}
.evidence{list-style:none; padding-left:0}
.evidence li{border-left:2px solid var(--line2); padding:4px 0 4px 12px; margin-bottom:8px}
.ev-source{font-weight:600; font-size:13px}
.ev-summary{font-size:13px}
.ev-ref{font-size:12px; margin-top:2px}
.ref-inert{color:var(--muted)}

/* Recommendations */
.rec-tier{border:1px solid var(--line); border-radius:var(--radius); margin-bottom:16px; overflow:hidden}
.tier-head{display:flex; align-items:baseline; gap:12px; padding:11px 16px; background:var(--panel2); border-bottom:1px solid var(--line)}
.tier-badge{font-weight:700; font-size:13px; padding:3px 11px; border-radius:6px; color:#fff}
.tier-1 .tier-badge{background:var(--crit)} .tier-2 .tier-badge{background:var(--high)} .tier-3 .tier-badge{background:var(--info)}
.tier-sub{font-size:12.5px; color:var(--muted)}
.rec-list{padding:12px 16px; display:grid; gap:10px}
.rec{border:1px solid var(--line); border-radius:8px; padding:12px 14px; background:var(--panel)}
.rec-top{display:flex; align-items:center; gap:10px; margin-bottom:6px}
.rec-cat{font-size:12.5px; color:var(--muted)}
.rec-text{margin:0 0 8px; font-size:14px}
.rec-foot{display:flex; flex-direction:column; gap:6px}
.rec-fids{font-size:12.5px; display:flex; flex-wrap:wrap; gap:8px; align-items:baseline}

/* Resources */
.scope-strip{display:flex; flex-wrap:wrap; gap:10px; margin-bottom:16px}
.scope-chip{border:1px solid var(--line2); border-radius:8px; padding:8px 12px; background:var(--panel2)}
.scope-label{display:block; font-weight:600; font-size:13px}
.scope-nums{font-size:12px; color:var(--muted)}
.restable{width:100%; border-collapse:collapse; font-size:13px}
.restable th{text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); padding:8px 10px; border-bottom:2px solid var(--line)}
.restable td{padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top}
.restable tbody tr:hover{background:var(--panel2)}
.asset-name{font-weight:600}
.asset-type{font-size:11.5px; color:var(--muted)}
.asset-scope{font-family:ui-monospace,monospace; font-size:11.5px; color:var(--muted)}
.cov td:first-child{font-weight:600}

/* Consolidated graph */
.cg-controls{display:flex; align-items:center; gap:8px; margin-bottom:10px}
.cg-hint{font-size:12px; color:var(--muted); margin-left:6px}
.cg-legend{display:flex; flex-wrap:wrap; gap:12px; margin-bottom:12px; font-size:12px}
.cg-leg{display:inline-flex; align-items:center; gap:6px; color:var(--txt2)}
.cg-leg::before{content:""; width:11px; height:11px; border-radius:3px; display:inline-block; background:var(--line2)}
.cg-leg.sev-critical::before{background:var(--crit)} .cg-leg.sev-high::before{background:var(--high)} .cg-leg.sev-medium::before{background:var(--med)} .cg-leg.sev-low::before{background:var(--low)} .cg-leg.sev-informational::before{background:var(--info)}
.cg-leg-back::before{background:repeating-linear-gradient(90deg,var(--muted) 0 3px,transparent 3px 6px)}
.cg-frame{border:1px solid var(--line); border-radius:var(--radius); background:var(--panel2); overflow:hidden; touch-action:none}
.cgraph{display:block; width:100%; height:auto; min-height:240px; cursor:grab}
.cgraph:active{cursor:grabbing}
.cg-node rect{fill:#fff}
.cg-node.sev-critical rect{stroke:var(--crit); stroke-width:2}
.cg-node.sev-high rect{stroke:var(--high); stroke-width:2}
.cg-node.sev-medium rect{stroke:var(--med); stroke-width:2}
.cg-node.sev-low rect{stroke:var(--low); stroke-width:2}
.cg-node.sev-informational rect{stroke:var(--info)}
.cg-node.sev-none rect{stroke:var(--line2); stroke-dasharray:4 3}
.cg-back{stroke:var(--muted); stroke-width:1.6; stroke-dasharray:5 4}
.cg-node.cg-hi rect{stroke-width:3; filter:drop-shadow(0 1px 4px rgba(15,23,42,.22))}
.cg-edge.cg-hi{stroke:var(--navy2); stroke-width:3}

/* Prose / appendix */
.prose p{margin:0 0 12px; max-width:80ch}
.prose h3{font-size:15px; margin:16px 0 6px}
.restable.about td:first-child{font-weight:600; width:200px; color:var(--muted)}
.fw-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin-top:18px}
.fw h4{font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-bottom:6px}
.warnbox{margin-top:18px; background:#fdf6e3; border:1px solid #efdca4; border-radius:8px; padding:12px 14px}
.warnbox h4{color:var(--med); font-size:13px; margin-bottom:6px}
.warnbox ul{margin:0; padding-left:18px; font-size:13px}

/* Responsive */
@media (max-width:980px){
  .layout{grid-template-columns:1fr}
  .toc{display:none}
  .exec-grid{grid-template-columns:1fr}
  .cover-meta{grid-template-columns:1fr}
  .cover-foot{grid-template-columns:1fr}
  .sevcards{grid-template-columns:repeat(2,1fr)}
  .finding-head{grid-template-columns:auto 1fr auto; gap:8px}
  .fh-domain,.fh-res,.fh-status{display:none}
}

/* Print */
@media print{
  body{background:#fff}
  .no-print{display:none !important}
  .cover{box-shadow:none; border-radius:0; margin:0; color:#fff}
  .layout{display:block; max-width:none; margin:0; padding:0}
  .section{box-shadow:none; border-radius:0; border:none; border-top:1.5px solid var(--line); break-inside:avoid; page-break-inside:avoid; margin:0 0 14px}
  .finding{break-inside:avoid}
  .appath{break-inside:avoid}
  .cg-viewport{transform:none !important}
  .cg-frame{overflow:visible}
  .finding-detail{display:block !important}
  .finding .fh-caret{display:none}
  a{color:var(--txt2)}
}
`;

// ---------------------------------------------------------------------------
// Client behavior (progressive enhancement). Embedded as a string, so it must
// use ONLY single quotes + concatenation (no backticks, no ${}) and must never
// contain the literal closing-script sequence.
// ---------------------------------------------------------------------------

const JS = `
(function(){
  'use strict';
  var findingsEl = document.getElementById('findingList');

  function setOpen(finding, open){
    var btn = finding.querySelector('.finding-head');
    var detail = finding.querySelector('.finding-detail');
    if(!btn || !detail) return;
    if(open){ finding.classList.add('open'); detail.hidden = false; btn.setAttribute('aria-expanded','true'); }
    else { finding.classList.remove('open'); detail.hidden = true; btn.setAttribute('aria-expanded','false'); }
  }

  if(findingsEl){
    findingsEl.addEventListener('click', function(e){
      var btn = e.target.closest('.finding-head');
      if(!btn) return;
      var finding = btn.closest('.finding');
      setOpen(finding, !finding.classList.contains('open'));
    });
  }

  var btnExpand = document.getElementById('btnExpand');
  var btnCollapse = document.getElementById('btnCollapse');
  var btnPrint = document.getElementById('btnPrint');
  function allFindings(){ return document.querySelectorAll('.finding'); }
  if(btnExpand) btnExpand.addEventListener('click', function(){ allFindings().forEach(function(f){ setOpen(f, true); }); });
  if(btnCollapse) btnCollapse.addEventListener('click', function(){ allFindings().forEach(function(f){ setOpen(f, false); }); });
  if(btnPrint) btnPrint.addEventListener('click', function(){ window.print(); });

  // Filtering
  var fSearch = document.getElementById('fSearch');
  var fSeverity = document.getElementById('fSeverity');
  var fDomain = document.getElementById('fDomain');
  var fAgent = document.getElementById('fAgent');
  var fCount = document.getElementById('fCount');

  function applyFilters(){
    var q = (fSearch && fSearch.value ? fSearch.value : '').trim().toLowerCase();
    var sev = fSeverity && fSeverity.value ? fSeverity.value : '';
    var dom = fDomain && fDomain.value ? fDomain.value : '';
    var agent = fAgent && fAgent.value ? fAgent.value : '';
    var shown = 0;
    var list = allFindings();
    for(var i=0;i<list.length;i++){
      var f = list[i];
      var ok = true;
      if(sev && f.getAttribute('data-severity') !== sev) ok = false;
      if(ok && dom && f.getAttribute('data-category') !== dom) ok = false;
      if(ok && agent && f.getAttribute('data-agent') !== agent) ok = false;
      if(ok && q && (f.getAttribute('data-search')||'').indexOf(q) < 0) ok = false;
      f.style.display = ok ? '' : 'none';
      if(ok) shown++;
    }
    if(fCount) fCount.textContent = shown + ' of ' + list.length + ' shown';
    syncSevCards(sev);
  }
  if(fSearch) fSearch.addEventListener('input', applyFilters);
  if(fSeverity) fSeverity.addEventListener('change', applyFilters);
  if(fDomain) fDomain.addEventListener('change', applyFilters);
  if(fAgent) fAgent.addEventListener('change', applyFilters);

  function syncSevCards(sev){
    var cards = document.querySelectorAll('.sevcard');
    for(var i=0;i<cards.length;i++){
      if(sev && cards[i].getAttribute('data-severity') === sev) cards[i].classList.add('active');
      else cards[i].classList.remove('active');
    }
  }
  function toggleSevCard(card){
    if(!fSeverity) return;
    var s = card.getAttribute('data-severity');
    fSeverity.value = (fSeverity.value === s) ? '' : s;
    applyFilters();
    var anchor = document.getElementById('findings');
    if(anchor) anchor.scrollIntoView({behavior:'smooth', block:'start'});
  }
  document.querySelectorAll('.sevcard').forEach(function(c){
    c.addEventListener('click', function(){ toggleSevCard(c); });
    c.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggleSevCard(c); } });
  });

  // Reveal a specific finding (clearing filters so it is never hidden).
  function clearFilters(){
    if(fSearch) fSearch.value='';
    if(fSeverity) fSeverity.value='';
    if(fDomain) fDomain.value='';
    if(fAgent) fAgent.value='';
    applyFilters();
  }
  function revealById(domId){
    var el = document.getElementById(domId);
    if(!el) return;
    clearFilters();
    if(el.classList.contains('finding')) setOpen(el, true);
    el.scrollIntoView({behavior:'smooth', block:'center'});
    el.classList.add('flash');
    window.setTimeout(function(){ el.classList.remove('flash'); }, 1200);
  }
  function revealByFindingId(fid){
    var el = document.querySelector('.finding[data-finding-id="' + (window.CSS && CSS.escape ? CSS.escape(fid) : fid) + '"]');
    if(el) revealById(el.id);
  }

  document.addEventListener('click', function(e){
    var lb = e.target.closest('.linkbtn[data-target]');
    if(lb){ e.preventDefault(); revealById(lb.getAttribute('data-target')); return; }
    var node = e.target.closest('.ap-clickable[data-finding]');
    if(node){ revealByFindingId(node.getAttribute('data-finding')); }
  });
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Enter' && e.key !== ' ') return;
    var node = e.target.closest('.ap-clickable[data-finding]');
    if(node){ e.preventDefault(); revealByFindingId(node.getAttribute('data-finding')); }
  });

  // Consolidated graph: pan / zoom / hover-highlight / click-to-reveal.
  (function(){
    var svg = document.getElementById('cgSvg');
    if(!svg) return;
    var vp = svg.querySelector('.cg-viewport');
    if(!vp) return;
    var scale = 1, tx = 0, ty = 0;
    function apply(){ vp.setAttribute('transform', 'translate(' + tx + ',' + ty + ') scale(' + scale + ')'); }
    function reset(){ scale = 1; tx = 0; ty = 0; apply(); }
    function zoom(factor, cx, cy){
      var ns = Math.min(2.5, Math.max(0.4, scale * factor));
      if(ns === scale) return;
      if(typeof cx === 'number'){ tx = cx - (cx - tx) * (ns/scale); ty = cy - (cy - ty) * (ns/scale); }
      scale = ns; apply();
    }
    var zi = document.getElementById('cgZoomIn');
    var zo = document.getElementById('cgZoomOut');
    var zf = document.getElementById('cgFit');
    var zr = document.getElementById('cgReset');
    if(zi) zi.addEventListener('click', function(){ zoom(1.2); });
    if(zo) zo.addEventListener('click', function(){ zoom(1/1.2); });
    if(zf) zf.addEventListener('click', reset);
    if(zr) zr.addEventListener('click', reset);

    var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    svg.addEventListener('pointerdown', function(e){
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY; ox = tx; oy = ty;
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', function(e){
      if(!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if(Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      tx = ox + dx; ty = oy + dy; apply();
    });
    function endDrag(e){ if(dragging){ dragging = false; try{ svg.releasePointerCapture(e.pointerId); }catch(_e){} } }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('wheel', function(e){
      e.preventDefault();
      var rect = svg.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.1 : 1/1.1, e.clientX - rect.left, e.clientY - rect.top);
    }, {passive:false});

    function paths(el){ return (el.getAttribute('data-paths')||'').split(' ').filter(Boolean); }
    function highlight(on, ps){
      var els = svg.querySelectorAll('[data-paths]');
      for(var i=0;i<els.length;i++){
        var match = false, mine = paths(els[i]);
        for(var j=0;j<ps.length;j++){ if(mine.indexOf(ps[j]) >= 0){ match = true; break; } }
        if(on && match) els[i].classList.add('cg-hi'); else els[i].classList.remove('cg-hi');
      }
    }
    svg.querySelectorAll('.cg-node').forEach(function(n){
      n.addEventListener('mouseenter', function(){ highlight(true, paths(n)); });
      n.addEventListener('mouseleave', function(){ highlight(false, paths(n)); });
      n.addEventListener('click', function(){
        if(moved) return;
        var fid = n.getAttribute('data-finding');
        if(fid) revealByFindingId(fid);
      });
      n.addEventListener('keydown', function(e){
        if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); var fid = n.getAttribute('data-finding'); if(fid) revealByFindingId(fid); }
      });
    });
    window.addEventListener('beforeprint', reset);
  })();

  // Scroll-spy TOC (fails silently if unsupported).
  try{
    var links = document.querySelectorAll('.toc a[data-section]');
    var map = {};
    links.forEach(function(a){ map[a.getAttribute('data-section')] = a; });
    function setActive(id){
      links.forEach(function(a){ a.classList.remove('active'); });
      if(map[id]) map[id].classList.add('active');
    }
    if('IntersectionObserver' in window){
      var io = new IntersectionObserver(function(entries){
        for(var i=0;i<entries.length;i++){ if(entries[i].isIntersecting){ setActive(entries[i].target.id); } }
      }, {rootMargin:'-40% 0px -55% 0px', threshold:0});
      document.querySelectorAll('main.doc .section').forEach(function(s){ io.observe(s); });
    }
  }catch(_e){}

  applyFilters();
})();
`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!args.findings) {
    console.error('Error: --findings is required.\n');
    console.error(usage());
    process.exit(1);
  }
  let findings;
  let paths;
  let meta;
  try {
    const rawFindings = asArray(loadJson(args.findings, 'findings'));
    const explicitGraph = args.attackPaths ? loadJson(args.attackPaths, 'attack-paths') : null;
    meta = args.engagement ? loadEngagement(args.engagement) : {};
    findings = normalizeFindings(rawFindings);
    paths = buildAttackPaths(findings, explicitGraph);
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(1);
  }
  const html = buildHtml(findings, paths, meta, args.title);
  const outPath = args.out || 'report.html';
  try {
    const outDir = dirname(outPath);
    if (outDir && outDir !== '.') mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, html, 'utf8');
  } catch (err) {
    console.error('Error: could not write "' + outPath + '": ' + err.message);
    process.exit(1);
  }
  const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.error('Report written to ' + outPath + ' (' + sizeKb + ' KB, ' + findings.length + ' findings, ' + paths.length + ' paths).');
  if (warnings.length) {
    console.error('Notes (' + warnings.length + '):');
    for (const w of warnings) console.error('  - ' + w);
  }
}

main();
