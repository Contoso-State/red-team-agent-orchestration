#!/usr/bin/env node
/**
 * coverage.mjs — aggregate canonical coverage records into a coverage matrix.
 *
 * A partial or sampled run must be honest about what it did and did not assess.
 * This tool folds per-check coverage records into the domain × check ×
 * subscription × resource type matrix described in knowledge/scaling.md.
 *
 * Usage:
 *   node tools/orchestration/coverage.mjs --from coverage.json [--from more.jsonl] [--out <dir>]
 *   node tools/orchestration/coverage.mjs --stamp domain=<d>,check_id=<c>,subscription_id=<s> --from fanout.json --stdout
 *
 * Options:
 *   --from  <path>    Coverage records file (repeatable). Accepts JSON array,
 *                    JSONL, an object { data: [...] }, or a single object.
 *   --stamp <k=v,...> Defaults stamped onto subsequently loaded --from files
 *                    when records are missing domain/check_id/subscription_id.
 *   --out   <dir>    Output dir (default: current dir). Writes coverage.json/.md.
 *   --stdout         Print markdown to stdout instead of writing files.
 *   --help, -h       Show this help.
 *
 * Read-only. Dependency-free.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';

const STATUSES = [
  'assessed',
  'skipped-by-scope',
  'skipped-by-budget',
  'failed',
  'permission-denied',
  'sampled',
  'partial',
];
const STATUS_SET = new Set(STATUSES);
const STAMP_FIELDS = ['domain', 'check_id', 'subscription_id'];
const REQUIRED_FIELDS = ['domain', 'check_id', 'subscription_id', 'type', 'status'];
const GAP_LIMIT = 50;

function parseArgs(argv) {
  const out = { from: [] };
  let stamp = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const take = (key) => (eq >= 0 ? a.slice(eq + 1) : argv[++i]);
    if (a === '--from' || a.startsWith('--from=')) {
      out.from.push({ path: take('from'), stamp: { ...stamp } });
    } else if (a === '--stamp' || a.startsWith('--stamp=')) {
      stamp = parseStamp(take('stamp'));
    } else if (a === '--out' || a.startsWith('--out=')) {
      out.out = take('out');
    } else if (a === '--stdout') {
      out.stdout = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function usage() {
  return [
    'coverage.mjs — aggregate coverage records into a coverage matrix.',
    '',
    'Usage:',
    '  node tools/orchestration/coverage.mjs --from <coverage.json|jsonl> [--from more.json] [--out <dir>]',
    '  node tools/orchestration/coverage.mjs --stamp domain=<d>,check_id=<c>,subscription_id=<s> --from fanout.json --stdout',
    '',
    'Options:',
    '  --from  <path>    Coverage records file (repeatable). JSON array / JSONL / { data:[] }.',
    '  --stamp <k=v,...> Stamp missing domain/check_id/subscription_id on subsequent --from files.',
    '  --out   <dir>     Output dir (default current dir). Writes coverage.json and coverage.md.',
    '  --stdout          Print markdown to stdout instead of writing files.',
  ].join('\n');
}

function parseStamp(text) {
  const stamp = {};
  for (const part of String(text || '').split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (STAMP_FIELDS.includes(key) && value) stamp[key] = value;
  }
  return stamp;
}

// Accept a JSON array, a JSONL stream, an ARG result object { data: [...] }, or a single object.
function loadRecords(path) {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  if (raw[0] === '[') return JSON.parse(raw);
  if (raw[0] === '{') {
    try {
      const obj = JSON.parse(raw);
      if (Array.isArray(obj.data)) return obj.data;
      if (Array.isArray(obj.rows)) return obj.rows;
      return [obj];
    } catch (err) {
      // A JSONL file also starts with "{"; fall through to line-by-line parsing.
    }
  }
  // JSONL
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function abs(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function present(v) {
  return v != null && String(v).trim() !== '';
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function lc(v) {
  return str(v).toLowerCase();
}

function countOf(v) {
  if (v == null || v === '') return 1;
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.trunc(n));
}

function normalizeRecord(record, stamp, source, index) {
  const r = { ...record };
  for (const f of STAMP_FIELDS) {
    if (!present(r[f]) && present(stamp[f])) r[f] = stamp[f];
  }
  if (!present(r.subscription_id) && present(r.subscriptionId)) r.subscription_id = r.subscriptionId;

  const normalized = {
    domain: str(r.domain),
    check_id: str(r.check_id),
    subscription_id: str(r.subscription_id),
    type: lc(r.type),
    status: lc(r.status),
    count: countOf(r.count),
    reason: str(r.reason),
  };

  const missing = REQUIRED_FIELDS.filter((f) => !present(normalized[f]));
  if (missing.length) {
    throw new Error(`${source}: record ${index + 1} missing required field(s): ${missing.join(', ')}`);
  }
  if (!STATUS_SET.has(normalized.status)) {
    throw new Error(`${source}: record ${index + 1} has unsupported status '${normalized.status}'`);
  }
  return normalized;
}

function keyOf(r) {
  return [r.domain, r.check_id, r.subscription_id, r.type, r.status].join('\u0000');
}

function compareCell(a, b) {
  return (
    a.domain.localeCompare(b.domain) ||
    a.check_id.localeCompare(b.check_id) ||
    a.subscription_id.localeCompare(b.subscription_id) ||
    a.type.localeCompare(b.type) ||
    a.status.localeCompare(b.status)
  );
}

function buildCoverage(records) {
  const groups = new Map();
  for (const r of records) {
    const key = keyOf(r);
    if (!groups.has(key)) groups.set(key, { ...r, count: 0, reasons: new Set() });
    const g = groups.get(key);
    g.count += r.count;
    if (r.reason) g.reasons.add(r.reason);
  }

  const cells = [...groups.values()].sort(compareCell);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let totalResources = 0;
  for (const c of cells) {
    byStatus[c.status] += c.count;
    totalResources += c.count;
  }
  const assessedPct = totalResources === 0 ? 0 : Math.round((byStatus.assessed / totalResources) * 1000) / 10;

  return {
    generated_at: new Date().toISOString(),
    matrix: cells.map((c) => ({
      domain: c.domain,
      check_id: c.check_id,
      subscription_id: c.subscription_id,
      type: c.type,
      status: c.status,
      count: c.count,
    })),
    summary: {
      by_status: byStatus,
      total_cells: cells.length,
      total_resources: totalResources,
      assessed_pct: assessedPct,
    },
    _gaps: cells
      .filter((c) => c.status !== 'assessed')
      .map((c) => ({ ...c, reason: [...c.reasons].join('; ') })),
  };
}

const N = (n) => Number(n || 0).toLocaleString('en-US');

function md(v) {
  return String(v == null || v === '' ? '—' : v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function table(rows, headers, fmt) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${fmt(r).map(md).join(' | ')} |`).join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Coverage');
  lines.push('');
  lines.push(`_Generated ${report.generated_at}_`);
  lines.push('');
  lines.push('## By status');
  lines.push('');
  lines.push(table(STATUSES.map((status) => ({ status, count: report.summary.by_status[status] })), ['Status', 'Count'], (r) => [r.status, N(r.count)]));
  lines.push('');
  lines.push(`**assessed_pct:** ${report.summary.assessed_pct.toFixed(1)}%`);
  lines.push('');
  lines.push(`Total coverage cells: **${N(report.summary.total_cells)}** · Total represented resources: **${N(report.summary.total_resources)}**`);
  lines.push('');
  lines.push('## Gaps');
  lines.push('');

  const gaps = report._gaps;
  if (!gaps.length) {
    lines.push('_No non-assessed coverage cells._');
    return lines.join('\n');
  }

  const shown = gaps.slice(0, GAP_LIMIT);
  lines.push(table(shown, ['Domain', 'Check', 'Subscription', 'Type', 'Status', 'Count', 'Reason'], (r) => [
    r.domain,
    r.check_id,
    r.subscription_id,
    r.type,
    r.status,
    N(r.count),
    r.reason,
  ]));
  if (gaps.length > shown.length) {
    lines.push('');
    lines.push(`_+${N(gaps.length - shown.length)} more (see coverage.json)._`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.from.length) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const records = [];
  try {
    for (const input of args.from) {
      const source = abs(input.path);
      const loaded = loadRecords(source);
      if (!Array.isArray(loaded)) throw new Error(`${source}: did not parse to a list of coverage records.`);
      loaded.forEach((r, i) => records.push(normalizeRecord(r, input.stamp, source, i)));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const report = buildCoverage(records);
  const json = {
    generated_at: report.generated_at,
    matrix: report.matrix,
    summary: report.summary,
  };
  const markdown = renderMarkdown(report);

  if (args.stdout) {
    process.stdout.write(markdown + '\n');
    return;
  }

  const outDir = args.out ? abs(args.out) : process.cwd();
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, 'coverage.json');
  const mdPath = join(outDir, 'coverage.md');
  writeFileSync(jsonPath, JSON.stringify(json, null, 2) + '\n');
  writeFileSync(mdPath, markdown + '\n');
  console.log(`Coverage written:\n  ${jsonPath}\n  ${mdPath}`);
  console.log(`${N(report.summary.total_resources)} represented resources · ${report.summary.assessed_pct.toFixed(1)}% assessed`);
}

main();
