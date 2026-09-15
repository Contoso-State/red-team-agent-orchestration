#!/usr/bin/env node
/** Append metadata-only Agent Observatory events to one engagement session. */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENGAGEMENTS = join(ROOT, 'engagements');
const TYPES = new Set([
  'run.started', 'run.completed', 'run.failed', 'node.started', 'node.completed', 'node.failed',
  'agent.started', 'agent.completed', 'agent.failed', 'tool.allowed', 'tool.cached',
  'tool.completed', 'tool.failed', 'message.sent', 'task.dispatched', 'memory.retrieved',
  'memory.verified', 'memory.candidate', 'memory.promoted', 'memory.measured',
  'evaluation.completed', 'evolution.proposed', 'evolution.evaluated',
  'evolution.accepted', 'evolution.rejected',
]);
const METADATA_FIELDS = new Set([
  'agent_id', 'node_id', 'task_id', 'status', 'parent_agent_id', 'parent_task_id',
  'tool_name', 'decision', 'duration_ms', 'evidence_refs', 'metrics', 'attempt',
  // Handoff attribution. Without these the writer silently strips the only fields
  // the graph view uses to draw an edge, so real data movement is invisible.
  'from_agent', 'to_agent', 'exchange_id', 'transfer',
]);

function contained(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

export function createEventWriter(session, {
  runId = `run-${Date.now()}`,
  mode = 'live',
  runKind = 'assessment',
  engagementRoot = ENGAGEMENTS,
} = {}) {
  const allowedRoot = resolve(engagementRoot);
  const sessionDir = resolve(session);
  if (!contained(allowedRoot, sessionDir) || sessionDir === allowedRoot) {
    throw new Error('session must be one directory inside engagements/');
  }
  const runDir = join(sessionDir, 'runs');
  const eventFile = join(runDir, 'live-events.jsonl');
  mkdirSync(runDir, { recursive: true });
  let sequence = 0;
  try {
    const lines = readFileSync(eventFile, 'utf8').split(/\r?\n/).filter(Boolean);
    sequence = lines.length;
  } catch { /* new log */ }

  return (type, metadata = {}) => {
    if (!TYPES.has(type)) throw new Error(`unsupported event type "${type}"`);
    const safeMetadata = Object.fromEntries(
      Object.entries(metadata).filter(([key]) => METADATA_FIELDS.has(key)),
    );
    const event = {
      schema_version: 1,
      id: `${runId}-${++sequence}`,
      ts: new Date().toISOString(),
      session_id: basename(sessionDir),
      run_id: runId,
      type,
      mode,
      run_kind: runKind,
      ...safeMetadata,
    };
    appendFileSync(eventFile, `${JSON.stringify(event)}\n`);
    return event;
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    out[key.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv);
  if (!args.session || !args.type) {
    console.error('Usage: node tools/dashboard/events.mjs --session engagements/<session> --type <event> [--agent <id>] [--node <id>] [--status <status>] [--task <id>]');
    process.exit(2);
  }
  try {
    const write = createEventWriter(args.session, { runId: args.run || `manual-${Date.now()}` });
    const metadata = {};
    if (args.agent) metadata.agent_id = args.agent;
    if (args.node) metadata.node_id = args.node;
    if (args.status) metadata.status = args.status;
    if (args.task) metadata.task_id = args.task;
    write(args.type, metadata);
  } catch (error) {
    console.error(`Event writer: ${error.message}`);
    process.exit(1);
  }
}
