#!/usr/bin/env node
/**
 * scope-brief.mjs — turn a raw inventory into an operator-facing scope brief.
 *
 * At estate scale (thousands of resources per subscription) the first question is
 * "how big is this and where is the risk concentrated?" This tool reduces the
 * inventory the Inventory & Scope agent already produced
 * (`engagements/<session>/inventory/resources.json`, the canonical array written
 * by Export-Inventory.ps1) into a compact, queryable brief:
 *
 *   - counts: total resources, distinct types / resource groups / regions / subscriptions
 *   - rollups: by type, by region, by resource group, by subscription
 *   - exposure: potential internet-facing types (heuristic, confirm with network checks)
 *   - fan-out tail: types that typically need per-resource data-plane `az` calls
 *   - paging flags: any type whose count exceeds the 1,000-row ARG page limit
 *
 * It mirrors the ARG `summarize ... by type/resourceGroup/location` rollups (see
 * tools/resource-graph/queries.md) so the same brief can be produced either from
 * the on-disk inventory (default) or by feeding ARG summarize output back in.
 *
 * This is the Inventory & Scope agent's primary downstream output: the orchestrator
 * and domain agents read the brief (a reduce summary), NOT the raw inventory.
 *
 * Usage:
 *   node tools/resource-graph/scope-brief.mjs --inventory <resources.json> [--out <dir>] [--top N]
 *   node tools/resource-graph/scope-brief.mjs --inventory inv.json --exposure exposure.json
 *
 * Options:
 *   --inventory <path>   Canonical inventory array (required). Each item: { id, name,
 *                        type, resourceGroup, subscriptionId, location, kind, tags }.
 *                        Also accepts JSONL (one object per line) and an ARG result
 *                        object of the form { data: [ ... ] }.
 *   --exposure  <path>   Optional ARG exposure result (array, JSONL, or { data: [] }).
 *                        Rows with an `id`/`resourceId` refine the exposure section
 *                        with confirmed internet-facing resources.
 *   --out       <dir>    Output directory (default: the inventory file's directory).
 *                        Writes scope-brief.json and scope-brief.md.
 *   --top       <N>      Rows per rollup table in the markdown (default 30). The JSON
 *                        always contains every row.
 *   --stdout             Print the markdown brief to stdout instead of writing files.
 *
 * Read-only. Dependency-free.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute, resolve } from 'node:path';

const PAGE_LIMIT = 1000; // ARG returns at most 1,000 rows per page

// Potential internet-facing resource types (heuristic by type only — a public LB or
// app service may in fact be locked down; confirm with the network-exposure ARG checks).
const INTERNET_REACHABLE = new Set([
  'microsoft.network/publicipaddresses',
  'microsoft.network/applicationgateways',
  'microsoft.network/loadbalancers',
  'microsoft.network/frontdoors',
  'microsoft.cdn/profiles',
  'microsoft.apimanagement/service',
  'microsoft.web/sites',
  'microsoft.web/staticsites',
  'microsoft.app/containerapps',
  'microsoft.containerservice/managedclusters',
  'microsoft.network/bastionhosts',
  'microsoft.network/virtualnetworkgateways',
  'microsoft.network/vpngateways',
  'microsoft.network/expressroutegateways',
]);

// Types whose deep checks typically require a per-resource control-plane / data-plane
// `az` call (Defender plan, KV network model, storage data-plane, etc.) — i.e. the
// expensive, sampled tail that runs through the bounded fan-out helper.
const DATA_PLANE_HEAVY = new Set([
  'microsoft.storage/storageaccounts',
  'microsoft.keyvault/vaults',
  'microsoft.sql/servers',
  'microsoft.documentdb/databaseaccounts',
  'microsoft.dbforpostgresql/flexibleservers',
  'microsoft.dbforpostgresql/servers',
  'microsoft.dbformysql/flexibleservers',
  'microsoft.dbformysql/servers',
  'microsoft.cache/redis',
  'microsoft.cognitiveservices/accounts',
  'microsoft.recoveryservices/vaults',
  'microsoft.containerregistry/registries',
]);

function parseArgs(argv) {
  const out = { top: 30 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const take = (key) => (eq >= 0 ? a.slice(eq + 1) : argv[++i]);
    if (a === '--inventory' || a.startsWith('--inventory=')) out.inventory = take('inventory');
    else if (a === '--exposure' || a.startsWith('--exposure=')) out.exposure = take('exposure');
    else if (a === '--out' || a.startsWith('--out=')) out.out = take('out');
    else if (a === '--top' || a.startsWith('--top=')) out.top = parseInt(take('top'), 10) || 30;
    else if (a === '--stdout') out.stdout = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  return [
    'scope-brief.mjs — reduce an inventory into an operator-facing scope brief.',
    '',
    'Usage:',
    '  node tools/resource-graph/scope-brief.mjs --inventory <resources.json> [--out <dir>] [--top N]',
    '',
    'Options:',
    '  --inventory <path>  Canonical inventory array / JSONL / ARG { data:[] } (required).',
    '  --exposure  <path>  Optional ARG exposure result to confirm internet-facing resources.',
    '  --out       <dir>   Output dir (default: inventory file dir). Writes scope-brief.json/.md.',
    '  --top       <N>     Rows per rollup table in markdown (default 30; JSON is always full).',
    '  --stdout            Print markdown to stdout instead of writing files.',
  ].join('\n');
}

// Accept a JSON array, a JSONL stream, or an ARG result object { data: [...] }.
function loadRecords(path) {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  if (raw[0] === '[') return JSON.parse(raw);
  if (raw[0] === '{') {
    const obj = JSON.parse(raw);
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.rows)) return obj.rows;
    return [obj];
  }
  // JSONL
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function lc(s) {
  return (s == null ? '' : String(s)).toLowerCase();
}

function tally(records, keyFn) {
  const m = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function distinct(records, keyFn) {
  const s = new Set();
  for (const r of records) {
    const k = keyFn(r);
    if (k != null && k !== '') s.add(k);
  }
  return s;
}

function buildBrief(records, exposureRows) {
  const byType = tally(records, (r) => lc(r.type));
  const byRegion = tally(records, (r) => lc(r.location) || 'unknown');
  const byRg = tally(
    records,
    (r) => `${lc(r.subscriptionId)}/${r.resourceGroup || 'unknown'}`,
  ).map(({ key, count }) => {
    const slash = key.indexOf('/');
    return {
      subscriptionId: key.slice(0, slash),
      resourceGroup: key.slice(slash + 1),
      count,
    };
  });

  // Per-subscription rollup with its own distinct type count.
  const subMap = new Map();
  for (const r of records) {
    const sub = lc(r.subscriptionId) || 'unknown';
    if (!subMap.has(sub)) subMap.set(sub, { subscriptionId: sub, count: 0, types: new Set() });
    const e = subMap.get(sub);
    e.count++;
    if (r.type) e.types.add(lc(r.type));
  }
  const bySubscription = [...subMap.values()]
    .map((e) => ({ subscriptionId: e.subscriptionId, count: e.count, typeCount: e.types.size }))
    .sort((a, b) => b.count - a.count);

  // Paging flags — any type over the 1,000-row ARG page limit needs paged checks.
  const pagingRequired = byType
    .filter((t) => t.count > PAGE_LIMIT)
    .map((t) => ({ type: t.key, count: t.count }));

  // Exposure (heuristic by type). If an ARG exposure result is supplied, also report
  // the confirmed internet-facing set.
  const internetFacingTypes = byType
    .filter((t) => INTERNET_REACHABLE.has(t.key))
    .map((t) => ({ type: t.key, count: t.count }));
  const internetFacingTotal = internetFacingTypes.reduce((n, t) => n + t.count, 0);

  let exposureConfirmed = null;
  if (exposureRows && exposureRows.length) {
    const ids = new Set();
    for (const r of exposureRows) {
      const id = lc(r.id || r.resourceId || r.resourceid);
      if (id) ids.add(id);
    }
    const confByType = tally(exposureRows, (r) => lc(r.type));
    exposureConfirmed = {
      total: ids.size,
      byType: confByType.map(({ key, count }) => ({ type: key, count })),
    };
  }

  // Per-resource data-plane fan-out tail — the expensive, sampled candidates.
  const fanOutByType = byType
    .filter((t) => DATA_PLANE_HEAVY.has(t.key))
    .map((t) => ({ type: t.key, count: t.count }));
  const fanOutTotal = fanOutByType.reduce((n, t) => n + t.count, 0);

  return {
    generated_at: new Date().toISOString(),
    totals: {
      resources: records.length,
      types: distinct(records, (r) => lc(r.type)).size,
      resourceGroups: distinct(
        records,
        (r) => `${lc(r.subscriptionId)}/${r.resourceGroup || ''}`,
      ).size,
      regions: distinct(records, (r) => lc(r.location)).size,
      subscriptions: distinct(records, (r) => lc(r.subscriptionId)).size,
    },
    bySubscription,
    byType: byType.map(({ key, count }) => ({ type: key, count })),
    byRegion: byRegion.map(({ key, count }) => ({ region: key, count })),
    byResourceGroup: byRg,
    paging: { page_limit: PAGE_LIMIT, types_over_limit: pagingRequired },
    exposure: {
      note: 'Internet-facing list is a heuristic by resource TYPE — confirm with the network-exposure / web-exposure ARG checks before reporting.',
      internet_facing_types: internetFacingTypes,
      internet_facing_total: internetFacingTotal,
      confirmed: exposureConfirmed,
    },
    fanout_tail: {
      note: 'Types whose deep checks usually need a per-resource data-plane `az` call. This is the expensive, sampled tail — run through Invoke-BoundedFanout.ps1 within scale.* budgets.',
      by_type: fanOutByType,
      total: fanOutTotal,
    },
  };
}

const N = (n) => n.toLocaleString('en-US');

function table(rows, headers, fmt, top) {
  const shown = rows.slice(0, top);
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = shown.map((r) => `| ${fmt(r).join(' | ')} |`).join('\n');
  let md = [head, sep, body].filter(Boolean).join('\n');
  if (rows.length > shown.length) md += `\n\n_+ ${N(rows.length - shown.length)} more (see scope-brief.json)._`;
  return md;
}

function renderMarkdown(b, top) {
  const t = b.totals;
  const lines = [];
  lines.push('# Scope brief');
  lines.push('');
  lines.push(`_Generated ${b.generated_at}_`);
  lines.push('');
  lines.push(
    `**${N(t.resources)} resources** · ${N(t.types)} types · ${N(t.resourceGroups)} resource groups · ${N(t.regions)} regions · ${N(t.subscriptions)} subscription(s)`,
  );
  lines.push('');

  if (b.paging.types_over_limit.length) {
    lines.push(`> ⚠️ **${b.paging.types_over_limit.length} type(s) exceed the ${N(b.paging.page_limit)}-row ARG page limit** — their checks MUST page (deterministic \`order by\`):`);
    lines.push('>');
    for (const p of b.paging.types_over_limit.slice(0, 15)) {
      lines.push(`> - \`${p.type}\` — ${N(p.count)}`);
    }
    lines.push('');
  }

  lines.push('## By subscription');
  lines.push('');
  lines.push(table(b.bySubscription, ['Subscription', 'Resources', 'Types'], (r) => [
    `\`${r.subscriptionId}\``,
    N(r.count),
    N(r.typeCount),
  ], top));
  lines.push('');

  lines.push('## Top resource types');
  lines.push('');
  lines.push(table(b.byType, ['Type', 'Count'], (r) => [`\`${r.type}\``, N(r.count)], top));
  lines.push('');

  lines.push('## By region');
  lines.push('');
  lines.push(table(b.byRegion, ['Region', 'Count'], (r) => [r.region, N(r.count)], top));
  lines.push('');

  lines.push('## Top resource groups');
  lines.push('');
  lines.push(table(b.byResourceGroup, ['Resource group', 'Subscription', 'Count'], (r) => [
    r.resourceGroup,
    `\`${r.subscriptionId}\``,
    N(r.count),
  ], top));
  lines.push('');

  lines.push('## Potential internet-facing surface (heuristic)');
  lines.push('');
  lines.push(`_${b.exposure.note}_`);
  lines.push('');
  if (b.exposure.internet_facing_types.length) {
    lines.push(`Potential internet-facing resources by type — **${N(b.exposure.internet_facing_total)}** total:`);
    lines.push('');
    lines.push(table(b.exposure.internet_facing_types, ['Type', 'Count'], (r) => [`\`${r.type}\``, N(r.count)], top));
  } else {
    lines.push('_No commonly internet-facing resource types found in the inventory._');
  }
  lines.push('');
  if (b.exposure.confirmed) {
    lines.push(`Confirmed internet-facing (from ARG exposure result): **${N(b.exposure.confirmed.total)}** resources.`);
    lines.push('');
    if (b.exposure.confirmed.byType.length) {
      lines.push(table(b.exposure.confirmed.byType, ['Type', 'Count'], (r) => [`\`${r.type}\``, N(r.count)], top));
      lines.push('');
    }
  }

  lines.push('## Per-resource fan-out tail (sampled)');
  lines.push('');
  lines.push(`_${b.fanout_tail.note}_`);
  lines.push('');
  if (b.fanout_tail.by_type.length) {
    lines.push(`Candidate per-resource calls if every instance is checked — **${N(b.fanout_tail.total)}** max:`);
    lines.push('');
    lines.push(table(b.fanout_tail.by_type, ['Type', 'Count'], (r) => [`\`${r.type}\``, N(r.count)], top));
  } else {
    lines.push('_No data-plane-heavy resource types found in the inventory._');
  }
  lines.push('');

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.inventory) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }
  const invPath = isAbsolute(args.inventory) ? args.inventory : resolve(process.cwd(), args.inventory);
  const records = loadRecords(invPath);
  if (!Array.isArray(records)) {
    console.error('Error: inventory did not parse to a list of resources.');
    process.exit(1);
  }
  const exposureRows = args.exposure ? loadRecords(resolve(process.cwd(), args.exposure)) : null;

  const brief = buildBrief(records, exposureRows);
  const md = renderMarkdown(brief, args.top);

  if (args.stdout) {
    process.stdout.write(md + '\n');
    return;
  }

  const outDir = args.out
    ? isAbsolute(args.out)
      ? args.out
      : resolve(process.cwd(), args.out)
    : dirname(invPath);
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, 'scope-brief.json');
  const mdPath = join(outDir, 'scope-brief.md');
  writeFileSync(jsonPath, JSON.stringify(brief, null, 2) + '\n');
  writeFileSync(mdPath, md + '\n');
  console.log(`Scope brief written:\n  ${jsonPath}\n  ${mdPath}`);
  console.log(
    `\n${N(brief.totals.resources)} resources · ${N(brief.totals.types)} types · ${N(brief.totals.subscriptions)} sub(s)` +
      (brief.paging.types_over_limit.length
        ? ` · ${brief.paging.types_over_limit.length} type(s) need paging`
        : ''),
  );
}

main();
