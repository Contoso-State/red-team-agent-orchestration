#!/usr/bin/env node
/**
 * Dispatcher-owned Agent Observatory lifecycle producer.
 *
 * The session watcher observes artifact writes only. It cannot know when a
 * dispatched agent really started, completed, or failed, so hosts that bypass
 * the graph runner should call this helper at their dispatch boundaries.
 */
import { pathToFileURL } from 'node:url';
import { createEventWriter } from './events.mjs';
import { detectRunId } from './watch-session.mjs';

const STATES = new Set(['started', 'completed', 'failed']);
const TYPES = new Set([...STATES].map(state => `agent.${state}`));
const DEFAULT_STATUS = {
  'agent.started': 'running',
  'agent.completed': 'completed',
  'agent.failed': 'failed',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    out[key.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function normalizeType(value) {
  const type = String(value || '').trim();
  if (STATES.has(type)) return `agent.${type}`;
  if (TYPES.has(type)) return type;
  throw new Error('--type must be one of started, completed, failed, agent.started, agent.completed, or agent.failed');
}

function validateRunId(runId) {
  if (runId === undefined || runId === null) return null;
  if (typeof runId !== 'string') throw new Error('--run-id must be a string');
  const normalized = String(runId).trim();
  if (!normalized) throw new Error('--run-id must be a non-empty string');
  if (/\s/.test(normalized)) throw new Error('--run-id must not contain whitespace');
  return normalized;
}

function validateRequiredString(value, flag) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${flag} is required`);
  return value.trim();
}

function optionalString(value, flag) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${flag} must be a string`);
  const normalized = value.trim();
  return normalized || undefined;
}

/**
 * Append one dispatcher-observed lifecycle event.
 *
 * By default the helper joins the most recent non-watcher run already recorded
 * in the session log. That keeps dispatcher lifecycle events and watcher artifact
 * events in the run selected by the dashboard instead of fragmenting counters.
 */
export function emitAgentLifecycle(sessionDir, {
  type,
  agentId,
  nodeId,
  taskId,
  status,
  runId,
  mode = 'live',
  runKind = 'assessment',
  engagementRoot,
} = {}) {
  const session = validateRequiredString(sessionDir, '--session');
  const eventType = normalizeType(type);
  const normalizedAgent = validateRequiredString(agentId, '--agent');
  const explicitRunId = validateRunId(runId);
  const resolvedRunId = explicitRunId || detectRunId(session) || `lifecycle-${Date.now()}`;
  const write = createEventWriter(session, { runId: resolvedRunId, mode, runKind, engagementRoot });
  return write(eventType, {
    agent_id: normalizedAgent,
    node_id: optionalString(nodeId, '--node'),
    task_id: optionalString(taskId, '--task'),
    status: optionalString(status, '--status') || DEFAULT_STATUS[eventType],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv);
  if (!args.session || !args.type || !args.agent) {
    console.error('Usage: node tools/dashboard/agent-lifecycle.mjs --session engagements/<session> --type <started|completed|failed> --agent <id> [--node <id>] [--task <id>] [--status <status>] [--run-id <id>]');
    process.exit(2);
  }
  try {
    emitAgentLifecycle(args.session, {
      type: args.type,
      agentId: args.agent,
      nodeId: args.node,
      taskId: args.task,
      status: args.status,
      runId: args['run-id'] || args.run,
    });
  } catch (error) {
    console.error(`Agent lifecycle writer: ${error.message}`);
    process.exit(1);
  }
}
