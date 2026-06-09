#!/usr/bin/env node
// @ts-check
/**
 * generate-report.mjs — Interactive Azure red-team HTML report generator.
 *
 * Dependency-free (Node stdlib only). Reads the normalized findings.json (the
 * canonical source of truth) plus an optional explicit attack-path graph and
 * engagement metadata, and emits ONE self-contained, offline report.html:
 * embedded CSS/JS, an inline hand-rolled SVG attack-path graph, expandable
 * findings, severity/domain/status/text filtering, and print/PDF support.
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
 *     JS only toggles CSS classes for progressive enhancement.
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

import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';

const GENERATOR_VERSION = '1.0.0';

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
// SVG attack-path graph rendering (inline, hand-rolled, no libraries)
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

  // Edges first (under nodes).
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
      const lbl = truncate([e.label, e.technique].filter(Boolean).join(' · '), 22);
      svg += `<text x="${mx}" y="${y1 - 8}" text-anchor="middle" class="ap-edge-label">${escText(lbl)}</text>`;
    }
  }

  // Nodes.
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

function renderFindingRow(f) {
  const searchCorpus = [
    f.id, f.title, f.category, f.agent, f.severity, f.status,
    shortResource(f.resource_id), f.resource_id, f.check_id, f.description,
  ].join(' ').toLowerCase();

  const resShort = shortResource(f.resource_id);
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
  <div class="finding" id="row-${escAttr(slugId(f.id))}"
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
  // Inline SVG severity donut. No libraries.
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
// Page assembly
// ---------------------------------------------------------------------------

function buildHtml({ findings, paths, engagement, title, generatedAt, inputs }) {
  const counts = {};
  for (const sev of SEVERITY_ORDER) counts[sev] = 0;
  let openRisk = 0;
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
    if (OPEN_STATUSES.has(f.status)) openRisk++;
  }
  const total = findings.length;
  const topRisk = findings[0];

  const agents = [...new Set(findings.map((f) => f.agent))].sort();
  const statuses = [...new Set(findings.map((f) => f.status))].sort();

  // Severity summary cards.
  const sevCards = SEVERITY_ORDER.map(
    (sev) => `<button class="sevcard sev-${slugId(sev)}" data-filter-severity="${escAttr(sev)}">
      <span class="sevcard-n">${counts[sev]}</span>
      <span class="sevcard-l">${escText(sev)}</span>
    </button>`
  ).join('');

  // Date range from first/last seen.
  const seen = findings.flatMap((f) => [f.first_seen, f.last_seen]).filter(Boolean).sort();
  const dataRange = seen.length ? `${seen[0]} \u2014 ${seen[seen.length - 1]}` : '';

  const subList = Array.isArray(engagement.subscriptions)
    ? engagement.subscriptions
    : engagement.subscriptions
      ? [engagement.subscriptions]
      : [...new Set(findings.map((f) => f.subscription_id).filter(Boolean))];

  // Attack-paths section.
  const pathsHtml = paths.length
    ? paths.map((p) => {
        const fid = p.finding_id ? ` data-finding="${escAttr(p.finding_id)}"` : '';
        return `<article class="appath" id="path-${escAttr(slugId(p.id))}">
        <header class="appath-head">
          <div class="appath-titles">
            <h3>${sevPill(p.severity)} ${escText(p.id)} — ${escText(p.title)}</h3>
            <div class="appath-meta">
              ${p.entry ? `<span><span class="muted">Entry</span> ${escText(p.entry)}</span>` : ''}
              ${p.end_state ? `<span><span class="muted">End state</span> ${escText(p.end_state)}</span>` : ''}
              ${p.derived ? `<span class="derived-tag" title="Linearized from the finding's attack_path text; nodes are narrative steps, not validated topology">derived</span>` : ''}
            </div>
          </div>
          ${p.finding_id ? `<button class="link-btn" data-goto-finding="${escAttr(p.finding_id)}">View finding \u2192</button>` : ''}
        </header>
        <div class="appath-graph"${fid}>${renderPathSvg(p)}</div>
        ${p.break_chain ? `<div class="break-chain"><strong>Break the chain:</strong> ${escText(p.break_chain)}</div>` : ''}
      </article>`;
      }).join('')
    : `<p class="empty">No attack paths were correlated for this engagement.</p>`;

  const findingsHtml = findings.length
    ? findings.map(renderFindingRow).join('')
    : `<p class="empty">No findings in this dataset.</p>`;

  // Control coverage rollup.
  const mitre = new Set();
  const cis = new Set();
  for (const f of findings) {
    (f.controls.mitre || []).forEach((c) => mitre.add(c));
    (f.controls.cis_azure || []).forEach((c) => cis.add(c));
  }

  const warnHtml = warnings.length
    ? `<details class="warnings"><summary>${warnings.length} data warning(s)</summary><ul>${warnings
        .map((w) => `<li>${escText(w)}</li>`)
        .join('')}</ul></details>`
    : '';

  const csp = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escAttr(csp)}">
<meta name="referrer" content="no-referrer">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ctext y='14' font-size='14'%3E%E2%9B%8A%3C/text%3E%3C/svg%3E">
<title>${escText(title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <span class="brand-mark">⛊</span>
    <div>
      <div class="brand-title">${escText(title)}</div>
      <div class="brand-sub">Azure Red Team — interactive assessment report</div>
    </div>
  </div>
  <div class="topbar-actions no-print">
    <button id="expandAll" class="ghost">Expand all</button>
    <button id="collapseAll" class="ghost">Collapse all</button>
    <button id="printBtn" class="ghost">Print / PDF</button>
  </div>
</header>

<main>
  <section class="summary panel">
    <div class="summary-grid">
      <div class="summary-donut">${donut(counts, total)}</div>
      <div class="summary-sevs">${sevCards}</div>
      <div class="summary-kpis">
        <div class="kpi"><span class="kpi-n">${total}</span><span class="kpi-l">Findings</span></div>
        <div class="kpi"><span class="kpi-n">${openRisk}</span><span class="kpi-l">Open risk</span></div>
        <div class="kpi"><span class="kpi-n">${paths.length}</span><span class="kpi-l">Attack paths</span></div>
        <div class="kpi"><span class="kpi-n">${counts.Critical + counts.High}</span><span class="kpi-l">Critical + High</span></div>
      </div>
    </div>
    ${topRisk ? `<div class="toprisk">
      <span class="muted">Top risk</span>
      ${sevPill(topRisk.severity)}
      <a href="#row-${escAttr(slugId(topRisk.id))}" data-goto-finding="${escAttr(topRisk.id)}" class="toprisk-link">${escText(topRisk.id)} — ${escText(topRisk.title)}</a>
    </div>` : ''}
  </section>

  <nav class="tabs no-print" role="tablist">
    <a href="#attack-paths">Attack paths</a>
    <a href="#findings">Findings</a>
    <a href="#coverage">Coverage</a>
    <a href="#about">About</a>
  </nav>

  <section id="attack-paths" class="panel">
    <h2>Attack Paths</h2>
    <p class="section-note">Chained findings represent real, walkable compromise paths and are featured first. Severity reflects the end state. Click a node with a finding badge to jump to its detail.</p>
    ${pathsHtml}
  </section>

  <section id="findings" class="panel">
    <div class="findings-head">
      <h2>Findings</h2>
      <div class="filters no-print">
        <input type="search" id="search" placeholder="Search id, title, resource, domain…" aria-label="Search findings">
        <select id="agentFilter" aria-label="Filter by domain agent">
          <option value="">All domains</option>
          ${agents.map((a) => `<option value="${escAttr(a)}">${escText(a)}</option>`).join('')}
        </select>
        <select id="statusFilter" aria-label="Filter by status">
          <option value="">All statuses</option>
          ${statuses.map((s) => `<option value="${escAttr(s)}">${escText(s.replace(/_/g, ' '))}</option>`).join('')}
        </select>
        <div class="sevtoggles">
          ${SEVERITY_ORDER.map((s) => `<label class="sevtoggle sev-${slugId(s)}"><input type="checkbox" value="${escAttr(s)}" checked> ${escText(s[0])}</label>`).join('')}
        </div>
      </div>
    </div>
    <div class="result-count no-print" id="resultCount"></div>
    <div class="finding-list-headrow">
      <span>Sev</span><span>ID</span><span>Title</span><span>Domain</span><span>Resource</span><span>Status</span><span></span>
    </div>
    <div id="findingList">
      ${findingsHtml}
    </div>
    <p class="empty" id="noResults" hidden>No findings match the current filters.</p>
  </section>

  <section id="coverage" class="panel">
    <h2>Coverage &amp; Control Mapping</h2>
    <div class="cov-grid">
      <div>
        <h4>By domain</h4>
        <table class="cov-table">
          <thead><tr><th>Domain agent</th><th>Findings</th></tr></thead>
          <tbody>
            ${agents.map((a) => `<tr><td>${escText(a)}</td><td>${findings.filter((f) => f.agent === a).length}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div>
        <h4>By status</h4>
        <table class="cov-table">
          <thead><tr><th>Status</th><th>Findings</th></tr></thead>
          <tbody>
            ${statuses.map((s) => `<tr><td>${escText(s.replace(/_/g, ' '))}</td><td>${findings.filter((f) => f.status === s).length}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div>
        <h4>MITRE ATT&amp;CK techniques (${mitre.size})</h4>
        <div class="chips">${chips([...mitre].sort(), 'c-mitre') || '<span class="muted">none mapped</span>'}</div>
        <h4 style="margin-top:14px">CIS Azure controls (${cis.size})</h4>
        <div class="chips">${chips([...cis].sort(), 'c-cis') || '<span class="muted">none mapped</span>'}</div>
      </div>
    </div>
  </section>

  <section id="about" class="panel about">
    <h2>About this report</h2>
    <div class="about-grid">
      <div><span class="muted">Engagement</span><div>${escText(engagement.name || title)}</div></div>
      ${engagement.id ? `<div><span class="muted">Engagement ID</span><div>${escText(engagement.id)}</div></div>` : ''}
      ${engagement.mode ? `<div><span class="muted">Mode</span><div>${escText(engagement.mode)}</div></div>` : ''}
      <div><span class="muted">Generated</span><div>${escText(generatedAt)}</div></div>
      <div><span class="muted">Generator</span><div>generate-report.mjs v${escText(GENERATOR_VERSION)}</div></div>
      ${dataRange ? `<div><span class="muted">Evidence window</span><div>${escText(dataRange)}</div></div>` : ''}
      ${subList.length ? `<div class="about-wide"><span class="muted">Subscriptions in scope</span><div>${subList.map((s) => `<code>${escText(s)}</code>`).join(' ')}</div></div>` : ''}
      <div class="about-wide"><span class="muted">Inputs</span><div>${inputs.map((i) => `<code>${escText(i)}</code>`).join(' ')}</div></div>
    </div>
    <div class="provenance">
      <p><strong>Read-only assessment.</strong> All findings are derived from read-only configuration analysis of the target Azure environment. This report is rendered entirely from structured findings (the canonical <code>findings.json</code>); it is never hand-authored, so it always matches the evidence. Absence of a finding is not proof of absence of risk — see assessment coverage &amp; limitations.</p>
      <p class="muted small">This file is fully self-contained and offline: no external scripts, styles, fonts, or network calls. A restrictive Content-Security-Policy and <code>referrer: no-referrer</code> are enforced. Finding text is HTML-escaped per context and non-http references are rendered inert.</p>
      ${warnHtml}
    </div>
  </section>
</main>

<footer class="foot">
  <span>Generated by the Azure Red Team Agent Orchestration template · ${escText(generatedAt)}</span>
</footer>

<script type="application/json" id="report-meta">${jsonForScript({ generator: GENERATOR_VERSION, total, counts })}</script>
<script>
${JS}
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Embedded CSS
// ---------------------------------------------------------------------------

const CSS = `
:root{
  --bg:#0b0e14; --panel:#121722; --panel2:#0f1420; --line:#222b3a;
  --txt:#e6ebf2; --muted:#8a97ab; --accent:#ff3b52; --accent2:#ff6b3d;
  --crit:#ff2d55; --high:#ff7a18; --med:#ffc043; --low:#3da5ff; --info:#7c8aa3;
  --ok:#22c55e;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:linear-gradient(180deg,#080a0f,#0b0e14 240px);color:var(--txt);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
code{font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;font-size:.86em;
  background:#0a0d13;border:1px solid var(--line);border-radius:4px;padding:1px 5px;
  overflow-wrap:anywhere;word-break:break-word;}
h2{font-size:18px;margin:0 0 4px;letter-spacing:.2px}
h3{font-size:15px;margin:0}
h4{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 6px}
.muted{color:var(--muted)} .small{font-size:12px}
a{color:#7db5ff;text-decoration:none} a:hover{text-decoration:underline}

.topbar{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;align-items:center;
  padding:14px 24px;background:rgba(10,13,19,.86);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:12px}
.brand-mark{font-size:26px;color:var(--accent);filter:drop-shadow(0 0 8px rgba(255,59,82,.5))}
.brand-title{font-weight:700;font-size:16px}
.brand-sub{color:var(--muted);font-size:12px}
.topbar-actions{display:flex;gap:8px}
button.ghost,.link-btn{background:#161c28;border:1px solid var(--line);color:var(--txt);
  padding:6px 12px;border-radius:7px;cursor:pointer;font-size:12px}
button.ghost:hover,.link-btn:hover{border-color:var(--accent);color:#fff}

main{max-width:1180px;margin:0 auto;padding:22px 24px 60px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:0 0 20px;
  box-shadow:0 1px 0 rgba(255,255,255,.02) inset}
.section-note{color:var(--muted);margin:2px 0 16px;max-width:74ch}

/* summary */
.summary-grid{display:grid;grid-template-columns:auto 1fr auto;gap:26px;align-items:center}
.summary-sevs{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
.sevcard{display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:var(--panel2);
  border:1px solid var(--line);border-left-width:4px;border-radius:10px;padding:12px 14px;cursor:pointer;color:var(--txt)}
.sevcard:hover{border-color:var(--accent)}
.sevcard-n{font-size:24px;font-weight:700}
.sevcard-l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.sevcard.sev-critical{border-left-color:var(--crit)} .sevcard.sev-high{border-left-color:var(--high)}
.sevcard.sev-medium{border-left-color:var(--med)} .sevcard.sev-low{border-left-color:var(--low)}
.sevcard.sev-informational{border-left-color:var(--info)}
.summary-kpis{display:grid;grid-template-columns:repeat(2,auto);gap:10px 22px}
.kpi{display:flex;flex-direction:column}
.kpi-n{font-size:22px;font-weight:700} .kpi-l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.toprisk{display:flex;align-items:center;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
.toprisk-link{font-weight:600}

.donut-total{font-size:26px;font-weight:700;fill:var(--txt)}
.donut-label{font-size:10px;fill:var(--muted);text-transform:uppercase;letter-spacing:1px}
.donut-seg{transition:opacity .2s} .donut-empty{stroke:#1b2330}
.donut-critical{stroke:var(--crit)} .donut-high{stroke:var(--high)} .donut-medium{stroke:var(--med)}
.donut-low{stroke:var(--low)} .donut-informational{stroke:var(--info)}

.tabs{display:flex;gap:8px;margin:0 0 18px}
.tabs a{padding:8px 14px;background:var(--panel);border:1px solid var(--line);border-radius:9px;color:var(--muted)}
.tabs a:hover{color:#fff;border-color:var(--accent);text-decoration:none}

/* pills + badges */
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.3px}
.sev-critical{background:rgba(255,45,85,.16);color:#ff6b85;border:1px solid rgba(255,45,85,.5)}
.sev-high{background:rgba(255,122,24,.15);color:#ff9b52;border:1px solid rgba(255,122,24,.5)}
.sev-medium{background:rgba(255,192,67,.14);color:#ffd27a;border:1px solid rgba(255,192,67,.45)}
.sev-low{background:rgba(61,165,255,.14);color:#7dc0ff;border:1px solid rgba(61,165,255,.45)}
.sev-informational{background:rgba(124,138,163,.14);color:#aab6c8;border:1px solid rgba(124,138,163,.4)}
.badge{display:inline-block;padding:1px 8px;border-radius:6px;font-size:11px;border:1px solid var(--line);color:var(--muted)}
.status-open{color:#ff9b52;border-color:rgba(255,122,24,.4)}
.status-confirmed{color:#ff6b85;border-color:rgba(255,45,85,.4)}
.status-remediated{color:var(--ok);border-color:rgba(34,197,94,.4)}
.status-false_positive{color:var(--muted)}
.status-accepted_risk{color:#ffd27a;border-color:rgba(255,192,67,.4)}

/* attack paths */
.appath{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 16px}
.appath-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}
.appath-meta{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:6px}
.derived-tag{background:#1a2230;border:1px dashed var(--line);border-radius:5px;padding:0 6px;color:var(--muted)}
.appath-graph{overflow-x:auto;padding:6px 0}
.break-chain{margin-top:10px;padding:9px 12px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);
  border-radius:8px;font-size:13px}
.apgraph{display:block}
.ap-node rect{fill:#19212f;stroke:#2b3a4f;stroke-width:1.5}
.ap-entry rect{stroke:var(--accent);fill:rgba(255,59,82,.10)}
.ap-target rect{stroke:var(--crit);fill:rgba(255,45,85,.14)}
.ap-pivot rect{stroke:var(--med)} .ap-step rect{stroke:#3a4a60}
.ap-node-type{fill:var(--muted);font-size:9px;font-weight:700;letter-spacing:1px}
.ap-node-label{fill:var(--txt);font-size:12px;font-weight:600}
.ap-node-fid{fill:#7db5ff;font-size:10px}
.ap-edge{stroke:#3a4a60;stroke-width:2} .ap-arrow{fill:#3a4a60}
.ap-edge-label{fill:var(--muted);font-size:10px}
.ap-clickable{cursor:pointer}
.ap-clickable:hover rect{filter:brightness(1.3)}
.ap-clickable:focus{outline:none} .ap-clickable:focus rect{stroke:#7db5ff;stroke-width:2.5}

/* findings */
.findings-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.filters input[type=search],.filters select{background:var(--panel2);border:1px solid var(--line);color:var(--txt);
  padding:7px 10px;border-radius:8px;font-size:12px}
.filters input[type=search]{min-width:240px}
.sevtoggles{display:flex;gap:4px}
.sevtoggle{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;padding:5px 8px;border-radius:7px;
  border:1px solid var(--line);background:var(--panel2);cursor:pointer;user-select:none}
.sevtoggle input{accent-color:var(--accent);margin:0}
.result-count{color:var(--muted);font-size:12px;margin:12px 0 6px}
.finding-list-headrow{display:grid;grid-template-columns:84px 108px 1fr 130px 160px 96px 20px;gap:10px;
  padding:6px 12px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--line)}
.finding{border-bottom:1px solid var(--line)}
.finding-head{display:grid;grid-template-columns:84px 108px 1fr 130px 160px 96px 20px;gap:10px;align-items:center;
  width:100%;text-align:left;background:none;border:none;color:var(--txt);padding:11px 12px;cursor:pointer;font-size:13px}
.finding-head:hover{background:rgba(255,255,255,.03)}
.fh-id{font-family:Consolas,monospace;font-size:12px;color:#9fb2c9}
.fh-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fh-domain{color:var(--muted);font-size:12px}
.fh-res{color:#9fb2c9;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fh-caret{color:var(--muted);transition:transform .15s;justify-self:end}
.finding.open .fh-caret{transform:rotate(90deg);color:var(--accent)}
.finding.open .finding-head{background:rgba(255,59,82,.05)}
.finding-detail{padding:6px 16px 20px 16px;background:var(--panel2)}
.detail-meta{display:flex;gap:18px;flex-wrap:wrap;padding:10px 0 14px;border-bottom:1px solid var(--line);margin-bottom:14px}
.kv{font-size:12px} .kv .muted{margin-right:4px}
.detail-block{margin:0 0 14px;max-width:90ch}
.detail-block p{margin:0;overflow-wrap:anywhere}
.detail-block.rec{background:rgba(61,165,255,.06);border:1px solid rgba(61,165,255,.25);border-radius:8px;padding:12px 14px}
.resfull{display:inline-block;max-width:100%;overflow-wrap:anywhere}
.apsteps,.refs,.evidence{margin:0;padding-left:18px}
.apsteps li,.evidence li{margin:4px 0}
.evidence{list-style:none;padding:0}
.evidence li{background:#0d1119;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0}
.ev-source{font-size:11px;color:var(--med);font-weight:700;text-transform:uppercase;letter-spacing:.4px}
.ev-summary{margin-top:2px} .ev-ref{margin-top:4px;font-size:12px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;border:1px solid var(--line);background:#0d1119}
.c-mitre{color:#ff9b8a;border-color:rgba(255,107,61,.4)}
.c-cis{color:#8ad6ff;border-color:rgba(61,165,255,.4)}
.c-dfc{color:#c4a6ff;border-color:rgba(150,120,255,.4)}
.c-nist{color:#9fe6b4;border-color:rgba(34,197,94,.35)}
.ref-inert{color:var(--muted);text-decoration:line-through dotted}

.cov-grid{display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:24px}
.cov-table{width:100%;border-collapse:collapse;font-size:13px}
.cov-table th,.cov-table td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
.cov-table th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px}

.about-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 22px;margin-bottom:14px}
.about-grid .muted{font-size:11px;text-transform:uppercase;letter-spacing:.5px}
.about-wide{grid-column:1/-1}
.provenance{border-top:1px solid var(--line);padding-top:14px;color:var(--txt);max-width:90ch}
.provenance p{margin:0 0 8px}
.warnings{margin-top:10px}
.warnings summary{cursor:pointer;color:var(--med)}
.warnings ul{margin:8px 0 0;color:var(--muted);font-size:12px}

.empty{color:var(--muted);font-style:italic;padding:10px 0}
.foot{max-width:1180px;margin:0 auto;padding:18px 24px;color:var(--muted);font-size:12px;border-top:1px solid var(--line)}
.hidden-by-filter{display:none !important}
.flash{animation:flash 1.4s ease-out}
@keyframes flash{0%{background:rgba(255,59,82,.25)}100%{background:transparent}}

@media (max-width:880px){
  .summary-grid{grid-template-columns:1fr}
  .cov-grid{grid-template-columns:1fr}
  .finding-list-headrow,.finding-head{grid-template-columns:70px 1fr 84px 18px}
  .finding-list-headrow span:nth-child(2),.fh-id,
  .finding-list-headrow span:nth-child(4),.fh-domain,
  .finding-list-headrow span:nth-child(5),.fh-res{display:none}
}

@media print{
  :root{--bg:#fff;--panel:#fff;--panel2:#fff;--txt:#111;--muted:#555;--line:#ccc}
  body{background:#fff;color:#111}
  .no-print{display:none !important}
  .panel{break-inside:avoid;box-shadow:none;border-color:#ccc}
  .appath,.finding{break-inside:avoid}
  .finding-detail{display:block !important}
  .fh-caret{display:none}
  section{page-break-before:auto}
  #findings{page-break-before:always}
  .ap-node rect{fill:#f3f5f8}
  a{color:#0b57d0}
}
`;

// ---------------------------------------------------------------------------
// Embedded JS (progressive enhancement only — report works without it)
// ---------------------------------------------------------------------------

const JS = `
(function(){
  "use strict";
  var list = document.getElementById('findingList');
  var rows = Array.prototype.slice.call(document.querySelectorAll('.finding'));
  var search = document.getElementById('search');
  var agentF = document.getElementById('agentFilter');
  var statusF = document.getElementById('statusFilter');
  var sevBoxes = Array.prototype.slice.call(document.querySelectorAll('.sevtoggle input'));
  var countEl = document.getElementById('resultCount');
  var noRes = document.getElementById('noResults');

  function setExpanded(row, open){
    var head = row.querySelector('.finding-head');
    var detail = row.querySelector('.finding-detail');
    row.classList.toggle('open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if(open){ detail.removeAttribute('hidden'); } else { detail.setAttribute('hidden',''); }
  }

  rows.forEach(function(row){
    var head = row.querySelector('.finding-head');
    head.addEventListener('click', function(){
      setExpanded(row, !row.classList.contains('open'));
    });
  });

  var activeSevs = {};
  function readSevs(){ activeSevs = {}; sevBoxes.forEach(function(b){ if(b.checked) activeSevs[b.value]=1; }); }
  readSevs();

  function apply(){
    var q = (search && search.value || '').trim().toLowerCase();
    var ag = agentF && agentF.value || '';
    var st = statusF && statusF.value || '';
    var shown = 0;
    rows.forEach(function(row){
      var ok = true;
      if(!activeSevs[row.getAttribute('data-severity')]) ok = false;
      if(ok && ag && row.getAttribute('data-agent') !== ag) ok = false;
      if(ok && st && row.getAttribute('data-status') !== st) ok = false;
      if(ok && q && row.getAttribute('data-search').indexOf(q) === -1) ok = false;
      row.classList.toggle('hidden-by-filter', !ok);
      if(ok) shown++;
    });
    if(countEl) countEl.textContent = 'Showing ' + shown + ' of ' + rows.length + ' findings';
    if(noRes) noRes.hidden = shown !== 0;
  }

  var t;
  function debApply(){ clearTimeout(t); t = setTimeout(apply, 120); }
  if(search) search.addEventListener('input', debApply);
  if(agentF) agentF.addEventListener('change', apply);
  if(statusF) statusF.addEventListener('change', apply);
  sevBoxes.forEach(function(b){ b.addEventListener('change', function(){ readSevs(); apply(); }); });

  document.querySelectorAll('.sevcard').forEach(function(card){
    card.addEventListener('click', function(){
      var sev = card.getAttribute('data-filter-severity');
      sevBoxes.forEach(function(b){ b.checked = (b.value === sev); });
      readSevs(); apply();
      document.getElementById('findings').scrollIntoView({behavior:'smooth'});
    });
  });

  function revealFinding(id){
    var row = document.querySelector('.finding[data-finding-id="'+ (window.CSS && CSS.escape ? CSS.escape(id) : id) +'"]');
    if(!row){ return; }
    // If filters hide it, clear them so the click never silently fails.
    if(row.classList.contains('hidden-by-filter')){
      sevBoxes.forEach(function(b){ b.checked = true; });
      if(agentF) agentF.value = '';
      if(statusF) statusF.value = '';
      if(search) search.value = '';
      readSevs(); apply();
    }
    setExpanded(row, true);
    row.scrollIntoView({behavior:'smooth', block:'center'});
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
  }

  document.querySelectorAll('[data-goto-finding]').forEach(function(el){
    el.addEventListener('click', function(e){ e.preventDefault(); revealFinding(el.getAttribute('data-goto-finding')); });
  });
  document.querySelectorAll('.ap-clickable').forEach(function(node){
    function go(){ revealFinding(node.getAttribute('data-finding')); }
    node.addEventListener('click', go);
    node.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); go(); } });
  });

  var ea = document.getElementById('expandAll');
  var ca = document.getElementById('collapseAll');
  if(ea) ea.addEventListener('click', function(){ rows.forEach(function(r){ if(!r.classList.contains('hidden-by-filter')) setExpanded(r,true); }); });
  if(ca) ca.addEventListener('click', function(){ rows.forEach(function(r){ setExpanded(r,false); }); });
  var pb = document.getElementById('printBtn');
  if(pb) pb.addEventListener('click', function(){ window.print(); });

  apply();
})();
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(argv.slice(2));
  if (args.help || !args.findings) {
    console.log(usage());
    process.exit(args.findings ? 0 : 1);
  }

  const rawFindingsDoc = loadJson(args.findings, 'findings');
  const rawFindings = asArray(rawFindingsDoc);
  if (!rawFindings.length) warn('No findings found in the input — the report will be empty.');
  const findings = normalizeFindings(rawFindings);

  let explicitGraph = null;
  if (args.attackPaths) explicitGraph = loadJson(args.attackPaths, 'attack-paths');
  const paths = buildAttackPaths(findings, explicitGraph);

  const engagement = args.engagement ? loadEngagement(args.engagement) : {};
  if (!engagement.subscriptions) {
    const subs = [...new Set(findings.map((f) => f.subscription_id).filter(Boolean))];
    if (subs.length) engagement.subscriptions = subs;
  }

  const title = args.title || engagement.name || 'Azure Red Team Assessment';
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  const inputs = [args.findings, args.attackPaths, args.engagement].filter(Boolean);

  const html = buildHtml({ findings, paths, engagement, title, generatedAt, inputs });

  const out = args.out || args.findings.replace(/findings\.json$/i, 'report.html');
  const outPath = out === args.findings ? args.findings + '.report.html' : out;
  writeFileSync(outPath, html, 'utf8');

  console.log(`Report written: ${outPath}`);
  console.log(`  Findings: ${findings.length}  Attack paths: ${paths.length}`);
  if (warnings.length) {
    console.log(`  Warnings: ${warnings.length}`);
    for (const w of warnings) console.log(`    - ${w}`);
  }
}

main();
