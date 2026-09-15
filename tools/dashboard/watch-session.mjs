#!/usr/bin/env node
/**
 * Session progress watcher.
 *
 * The event producers wired into dispatch only fire at task boundaries, so a run whose
 * specialists work for fifteen minutes shows a frozen timeline in between — the dashboard
 * is honest, but the producer is missing. This watcher closes that gap for hosts that
 * dispatch agents directly instead of through the graph runner.
 *
 * It reports only what it actually observes on disk: a findings or evidence artifact
 * appearing or growing. It never invents heartbeats, never claims an agent is healthy,
 * and never reports progress for a file that did not change. A silent watcher means
 * nothing was written, which is itself the truth worth seeing.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEventWriter } from './events.mjs';

const WATCHED = ['findings/raw', 'evidence', 'inventory', 'reports'];

/**
 * Graph node each artifact belongs to. The roster nodes are keyed by domain, so a
 * findings file must resolve to its own domain node — attributing everything to the
 * shared fan-out node would light one blob and hide which specialist is working.
 */
const DOMAINS = new Set([
  'identity', 'network', 'compute', 'aks-container', 'data', 'web',
  'ai', 'easm', 'logging', 'governance', 'supplychain', 'email',
]);

/** Filenames that predate the roster naming, mapped to the node they belong to. */
const FILE_ALIASES = new Map([
  ['attack-surface', 'easm'],
  ['external-vuln', 'easm'],
  ['authorization', 'correlate'],
  ['rbac', 'correlate'],
  ['attack-paths', 'correlate'],
  ['aks', 'aks-container'],
  ['containers', 'aks-container'],
  ['container', 'aks-container'],
  ['reporting', 'report'],
  ['inventory', 'preflight_inventory'],
  ['resources', 'preflight_inventory'],
  ['account', 'preflight_inventory'],
]);

/** Recursively list real files under a directory; symlinks and unreadable entries are skipped. */
function listFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) listFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Resolve an artifact to the graph node that produced it. Attribution comes from the
 * path first, because evidence is written under evidence/raw/<domain>/ where the
 * directory names the producer and the filename does not.
 */
export function nodeFor(relPath, area) {
  const segments = String(relPath).split(/[\\/]/).filter(Boolean);
  const dirs = segments.slice(0, -1);
  for (const segment of dirs) {
    const dir = segment.toLowerCase();
    if (DOMAINS.has(dir)) return dir;
    if (FILE_ALIASES.has(dir)) return FILE_ALIASES.get(dir);
  }
  const stem = basename(String(relPath)).split('.')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (DOMAINS.has(stem)) return stem;
  if (FILE_ALIASES.has(stem)) return FILE_ALIASES.get(stem);
  for (const domain of DOMAINS) if (stem.startsWith(`${domain}-`)) return domain;
  // Compound names such as "rbac-graph" carry the producer in their leading segment.
  const lead = stem.split('-')[0];
  if (DOMAINS.has(lead)) return lead;
  if (FILE_ALIASES.has(lead)) return FILE_ALIASES.get(lead);
  if (area === 'reports') return 'report';
  if (area === 'inventory') return 'preflight_inventory';
  // An unattributable artifact belongs to the fan-out node rather than to a guess.
  return 'run_specialist';
}

/**
 * The run this session is already recording. A watcher observes an existing run, so
 * inventing its own run id would split the timeline in two and hide its events from
 * the view that is actually selected.
 */
export function detectRunId(sessionDir) {
  const log = join(sessionDir, 'runs', 'live-events.jsonl');
  if (!existsSync(log)) return null;
  try {
    const lines = readFileSync(log, 'utf8').split(/\r?\n/).filter(line => line.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const runId = JSON.parse(lines[i])?.run_id;
        if (typeof runId === 'string' && runId && !runId.startsWith('watch-')) return runId;
      } catch { /* a partially written line is not a usable run id */ }
    }
  } catch { /* an unreadable log simply yields no run to join */ }
  return null;
}

function countRecords(file) {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim()).length;
  } catch {
    return 0;
  }
}

export function scanSession(sessionDir) {
  const seen = new Map();
  for (const rel of WATCHED) {
    for (const file of listFiles(join(sessionDir, rel))) {
      try {
        const { size, mtimeMs } = statSync(file);
        // Attribution uses the session-relative path so a session directory that
        // happens to be named after a domain cannot masquerade as the producer.
        seen.set(file, { size, mtimeMs, area: rel, rel: relative(sessionDir, file) });
      } catch { /* the file vanished between listing and stat */ }
    }
  }
  return seen;
}

/**
 * Emit one event per observed artifact change. Returns the number of events written,
 * which is zero when nothing actually changed.
 */
export function diffAndEmit(previous, current, emit) {
  let emitted = 0;
  for (const [file, now] of current) {
    const before = previous.get(file);
    if (before && before.size === now.size && before.mtimeMs === now.mtimeMs) continue;
    const isFindings = now.area === 'findings/raw' && file.endsWith('.jsonl');
    const nodeId = nodeFor(now.rel || basename(file), now.area);
    const metrics = isFindings ? { findings: countRecords(file) } : { records: 1 };
    emit('tool.completed', {
      agent_id: nodeId,
      node_id: nodeId,
      status: 'completed',
      metrics,
      evidence_refs: [`${now.area}/${basename(file)}`],
    });
    emitted++;

    // Writing an artifact is a real transfer from the producer to the node that
    // consumes it, and the byte delta is measured, not estimated. Emitting it is
    // what makes the graph show data moving along its edges instead of sitting still.
    const delta = before ? Math.max(0, now.size - before.size) : now.size;
    const target = nodeId === 'run_specialist' || DOMAINS.has(nodeId) ? 'collect_raw' : null;
    if (target && delta > 0) {
      emit('message.sent', {
        from_agent: nodeId,
        to_agent: target,
        node_id: nodeId,
        status: 'completed',
        transfer: {
          kind: isFindings ? 'findings-data' : 'evidence-data',
          bytes: delta,
          outcome: 'sent',
        },
      });
      emitted++;
    }
  }
  return emitted;
}

export async function watchSession(sessionDir, { intervalMs = 5000, runId = 'watch', signal, engagementRoot, emitExisting = false } = {}) {
  const emit = createEventWriter(sessionDir, engagementRoot ? { runId, engagementRoot } : { runId });
  // Starting from an empty baseline reports artifacts already on disk. They were
  // genuinely produced, so attributing them to their node is a record of real work
  // rather than a replay of activity that never happened.
  let previous = emitExisting ? new Map() : scanSession(sessionDir);
  let total = 0;
  while (!signal?.aborted) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    if (signal?.aborted) break;
    const current = scanSession(sessionDir);
    total += diffAndEmit(previous, current, emit);
    previous = current;
  }
  return total;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const session = args[args.indexOf('--session') + 1];
  if (!args.includes('--session') || !session) {
    console.error('Usage: node tools/dashboard/watch-session.mjs --session engagements/<session> [--interval 5]');
    process.exit(2);
  }
  const intervalArg = args.includes('--interval') ? Number(args[args.indexOf('--interval') + 1]) : 5;
  const intervalMs = Number.isFinite(intervalArg) && intervalArg > 0 ? intervalArg * 1000 : 5000;
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => controller.abort());
  const explicitRun = args.includes('--run-id') ? args[args.indexOf('--run-id') + 1] : null;
  const runId = explicitRun || detectRunId(session) || `watch-${Date.now()}`;
  console.log(`Watching ${session} every ${intervalMs / 1000}s as run "${runId}" — emitting events only for observed artifact changes.`);
  await watchSession(session, {
    intervalMs,
    runId,
    signal: controller.signal,
    emitExisting: args.includes('--emit-existing'),
  });
}
