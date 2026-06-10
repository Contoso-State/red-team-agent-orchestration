#!/usr/bin/env node
/**
 * estimate-cost.mjs — preflight cost / time estimate for large Azure runs.
 *
 * Before a large run, estimate and surface the number of ARG queries, expected
 * pages per check, the per-resource data-plane call budget, and projected
 * runtime at the configured concurrency, so an operator knows whether a run is
 * ~10 minutes or several hours and can narrow scope first.
 *
 * Usage:
 *   node tools/orchestration/estimate-cost.mjs --scope-brief <scope-brief.json> [--out estimate.json]
 *   node tools/orchestration/estimate-cost.mjs --scope-brief scope-brief.json --engagement engagement.yaml --domains 4
 *
 * Options:
 *   --scope-brief <path>       scope-brief.mjs JSON output (required).
 *   --engagement  <path>      Optional engagement.yaml; parses scale.* and scope.domains.
 *   --concurrency <N>         Per-resource data-plane call concurrency (default 8).
 *   --sample-per-type <N>     Per-type sampling cap; 0 = no cap (default 0).
 *   --max-resource-calls <N>  Total per-resource call cap; 0 = unlimited (default 0).
 *   --checks-per-domain <N>   ARG checks per domain estimate (default 8).
 *   --domains <N>             Assessment domain count (default 12, or scope.domains length).
 *   --out <file>              Write machine-readable JSON estimate.
 *   --stdout                  Print the human summary (default behavior).
 *   --help, -h                Show this help.
 *
 * Read-only. Dependency-free.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_SAMPLE_PER_TYPE = 0;
const DEFAULT_MAX_RESOURCE_CALLS = 0;
const DEFAULT_CHECKS_PER_DOMAIN = 8;
const DEFAULT_DOMAINS = 12;
const DEFAULT_PAGE_LIMIT = 1000;

const ARG_SECONDS_PER_PAGE = 1.0; // Estimated wall-clock seconds for one ARG page when not throttled.
const ARG_THROTTLE_QUERIES = 15; // Conservative ARG query allowance per throttle window.
const ARG_THROTTLE_WINDOW_SECONDS = 5; // Conservative ARG throttle window duration in seconds.
const AZ_SECONDS_PER_CALL_LOW = 0.8; // Optimistic per-resource `az` control-plane/data-plane call seconds.
const AZ_SECONDS_PER_CALL_HIGH = 2.5; // Pessimistic per-resource `az` control-plane/data-plane call seconds.

function parseArgs(argv) {
  const out = { flags: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const take = (key) => (eq >= 0 ? a.slice(eq + 1) : argv[++i]);
    if (a === '--scope-brief' || a.startsWith('--scope-brief=')) out.scopeBrief = take('scope-brief');
    else if (a === '--engagement' || a.startsWith('--engagement=')) out.engagement = take('engagement');
    else if (a === '--concurrency' || a.startsWith('--concurrency=')) out.flags.concurrency = takeInt(take('concurrency'), 1);
    else if (a === '--sample-per-type' || a.startsWith('--sample-per-type=')) out.flags.sample_per_type = takeInt(take('sample-per-type'), 0);
    else if (a === '--max-resource-calls' || a.startsWith('--max-resource-calls=')) out.flags.max_resource_calls = takeInt(take('max-resource-calls'), 0);
    else if (a === '--checks-per-domain' || a.startsWith('--checks-per-domain=')) out.flags.checks_per_domain = takeInt(take('checks-per-domain'), 0);
    else if (a === '--domains' || a.startsWith('--domains=')) out.flags.domains = takeInt(take('domains'), 0);
    else if (a === '--out' || a.startsWith('--out=')) out.out = take('out');
    else if (a === '--stdout') out.stdout = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  for (const [key, value] of Object.entries(out.flags)) {
    if (value == null) delete out.flags[key];
  }
  return out;
}

function usage() {
  return [
    'estimate-cost.mjs — preflight cost / time estimate for a large run.',
    '',
    'Usage:',
    '  node tools/orchestration/estimate-cost.mjs --scope-brief <scope-brief.json> [--engagement engagement.yaml] [--out estimate.json]',
    '',
    'Options:',
    '  --scope-brief <path>       scope-brief.mjs JSON output (required).',
    '  --engagement  <path>      Optional engagement.yaml; parses scale.* and scope.domains.',
    '  --concurrency <N>         Per-resource data-plane call concurrency (default 8).',
    '  --sample-per-type <N>     Per-type sampling cap; 0 = no cap (default 0).',
    '  --max-resource-calls <N>  Total per-resource call cap; 0 = unlimited (default 0).',
    '  --checks-per-domain <N>   ARG checks per domain estimate (default 8).',
    '  --domains <N>             Assessment domain count (default 12, or scope.domains length).',
    '  --out <file>              Write machine-readable JSON estimate.',
    '  --stdout                  Print the human summary (default behavior).',
  ].join('\n');
}

function takeInt(value, min) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < min) return undefined;
  return n;
}

function abs(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function stripComment(line) {
  return line.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '');
}

function indentOf(line) {
  return line.match(/^\s*/)[0].length;
}

function finishDomainList(config, count) {
  if (count > 0) config.domains = count;
}

function parseInlineList(text) {
  const m = text.match(/^\[(.*)\]$/);
  if (!m) return undefined;
  const inner = m[1].trim();
  if (!inner) return 0;
  return inner.split(',').map((s) => s.trim()).filter(Boolean).length;
}

function parseEngagement(path) {
  const config = {};
  const lines = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  let inScale = false;
  let scaleIndent = -1;
  let inScope = false;
  let scopeIndent = -1;
  let inDomains = false;
  let domainsIndent = -1;
  let domainCount = 0;

  for (const original of lines) {
    const line = stripComment(original);
    if (!line.trim()) continue;
    const indent = indentOf(line);
    const trimmed = line.trim();

    if (inDomains && indent <= domainsIndent && !trimmed.startsWith('- ')) {
      finishDomainList(config, domainCount);
      inDomains = false;
      domainCount = 0;
    }
    if (inScale && indent <= scaleIndent) inScale = false;
    if (inScope && indent <= scopeIndent) inScope = false;

    if (/^scale:\s*$/.test(trimmed)) {
      inScale = true;
      scaleIndent = indent;
      continue;
    }
    if (/^scope:\s*$/.test(trimmed)) {
      inScope = true;
      scopeIndent = indent;
      continue;
    }

    if (inScale) {
      const m = trimmed.match(/^(sample_per_type|max_resource_calls|concurrency):\s*(\d+)\s*$/);
      if (m) config[m[1]] = Number.parseInt(m[2], 10);
    }

    if (inScope && !inDomains) {
      const m = trimmed.match(/^domains:\s*(.*)$/);
      if (m) {
        const rest = m[1].trim();
        if (!rest) {
          inDomains = true;
          domainsIndent = indent;
          domainCount = 0;
        } else {
          const count = parseInlineList(rest);
          if (count && count > 0) config.domains = count;
        }
        continue;
      }
    }

    if (inDomains && indent > domainsIndent && trimmed.startsWith('- ')) {
      const item = trimmed.slice(2).trim();
      if (item) domainCount++;
    }
  }
  if (inDomains) finishDomainList(config, domainCount);
  return config;
}

function mergeConfig(args) {
  const config = {
    concurrency: DEFAULT_CONCURRENCY,
    sample_per_type: DEFAULT_SAMPLE_PER_TYPE,
    max_resource_calls: DEFAULT_MAX_RESOURCE_CALLS,
    checks_per_domain: DEFAULT_CHECKS_PER_DOMAIN,
    domains: DEFAULT_DOMAINS,
  };
  if (args.engagement) Object.assign(config, parseEngagement(abs(args.engagement)));
  Object.assign(config, args.flags);
  return config;
}

function loadBrief(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function countOf(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function buildEstimate(brief, config, scopeBriefPath, engagementPath) {
  const pageLimit = countOf(brief?.paging?.page_limit) || DEFAULT_PAGE_LIMIT;
  const typesOverLimit = Array.isArray(brief?.paging?.types_over_limit) ? brief.paging.types_over_limit : [];
  const fanoutByType = Array.isArray(brief?.fanout_tail?.by_type) ? brief.fanout_tail.by_type : [];

  const argQueries = config.domains * config.checks_per_domain;
  const extraPages = typesOverLimit.reduce((sum, row) => {
    const count = countOf(row.count);
    return sum + Math.max(0, Math.ceil(count / pageLimit) - 1);
  }, 0);
  const argPages = argQueries + extraPages;

  let perResourceCalls = fanoutByType.reduce((sum, row) => {
    const count = countOf(row.count);
    const sampled = config.sample_per_type > 0 ? Math.min(count, config.sample_per_type) : count;
    return sum + sampled;
  }, 0);
  if (config.max_resource_calls > 0) perResourceCalls = Math.min(perResourceCalls, config.max_resource_calls);

  const argSeconds = Math.max(
    argPages * ARG_SECONDS_PER_PAGE,
    (argPages / ARG_THROTTLE_QUERIES) * ARG_THROTTLE_WINDOW_SECONDS,
  );
  const resourceSecondsLow = (perResourceCalls * AZ_SECONDS_PER_CALL_LOW) / config.concurrency;
  const resourceSecondsHigh = (perResourceCalls * AZ_SECONDS_PER_CALL_HIGH) / config.concurrency;
  const runtimeMinLow = round1((argSeconds + resourceSecondsLow) / 60);
  const runtimeMinHigh = round1((argSeconds + resourceSecondsHigh) / 60);

  return {
    inputs: {
      scope_brief: scopeBriefPath,
      engagement: engagementPath || null,
      resources: countOf(brief?.totals?.resources),
      types: countOf(brief?.totals?.types),
      resourceGroups: countOf(brief?.totals?.resourceGroups),
      regions: countOf(brief?.totals?.regions),
      subscriptions: countOf(brief?.totals?.subscriptions),
      domains: config.domains,
      checks_per_domain: config.checks_per_domain,
      concurrency: config.concurrency,
      sample_per_type: config.sample_per_type,
      max_resource_calls: config.max_resource_calls,
      page_limit: pageLimit,
      types_over_limit: typesOverLimit.length,
      fanout_tail_types: fanoutByType.length,
    },
    estimate: {
      arg_queries: argQueries,
      arg_pages: argPages,
      per_resource_calls: perResourceCalls,
      runtime_min_low: runtimeMinLow,
      runtime_min_high: runtimeMinHigh,
    },
  };
}

const N = (n) => Number(n || 0).toLocaleString('en-US');

function runtimeRange(low, high) {
  if (high > 90) return `${(low / 60).toFixed(1)}–${(high / 60).toFixed(1)} hours`;
  return `${low.toFixed(1)}–${high.toFixed(1)} minutes`;
}

function verdict(high) {
  if (high <= 15) return 'Fast (<15 min)';
  if (high <= 90) return 'Moderate';
  return 'Long-running — consider narrowing scope (scope.resource_types / scope.domains / scale.sample_per_type).';
}

function renderHuman(result) {
  const i = result.inputs;
  const e = result.estimate;
  const lines = [];
  lines.push('# Preflight cost / time estimate');
  lines.push('');
  lines.push(`Scope: ${N(i.resources)} resources · ${N(i.types)} types · ${N(i.resourceGroups)} resource groups · ${N(i.regions)} regions · ${N(i.subscriptions)} subscription(s)`);
  lines.push(`ARG queries: ${N(e.arg_queries)} (${N(i.domains)} domain(s) × ${N(i.checks_per_domain)} checks/domain)`);
  lines.push(`Expected ARG pages: ${N(e.arg_pages)} (${N(i.types_over_limit)} type(s) over the ${N(i.page_limit)}-row ARG page limit)`);
  lines.push(`Per-resource data-plane call budget: ${N(e.per_resource_calls)} (${N(i.fanout_tail_types)} fan-out tail type(s), sample_per_type ${N(i.sample_per_type)}, max_resource_calls ${N(i.max_resource_calls)})`);
  lines.push(`Projected runtime at concurrency ${N(i.concurrency)}: ${runtimeRange(e.runtime_min_low, e.runtime_min_high)}`);
  lines.push(`Verdict: ${verdict(e.runtime_min_high)}`);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.scopeBrief) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  let result;
  try {
    const scopeBriefPath = abs(args.scopeBrief);
    const engagementPath = args.engagement ? abs(args.engagement) : null;
    const brief = loadBrief(scopeBriefPath);
    const config = mergeConfig(args);
    result = buildEstimate(brief, config, scopeBriefPath, engagementPath);
    if (args.out) writeFileSync(abs(args.out), JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  process.stdout.write(renderHuman(result) + '\n');
}

main();
