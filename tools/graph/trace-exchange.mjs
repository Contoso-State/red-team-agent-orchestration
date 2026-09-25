import { randomUUID } from 'node:crypto';
import { normalizeModelUsage } from './model-usage.mjs';

/** Record application payload sizes and lifecycle, never message bodies or reasoning. */
export async function traceExchange({ agent, taskId, payload, emit, execute }) {
  const exchange_id = randomUUID();
  const started = performance.now();
  const base = { type: 'message.sent', agent_id: agent, task_id: taskId, exchange_id };
  let usage = normalizeModelUsage(), status = 'failed', settled = false;
  const onUsage = value => { if (!settled) usage = normalizeModelUsage(value); };
  emit({ ...base, from_agent: 'orchestrator', to_agent: agent,
    transfer: { kind: 'model-request', bytes: Buffer.byteLength(JSON.stringify(payload)), outcome: 'sent' } });
  try {
    const result = await execute({ onUsage });
    emit({ ...base, from_agent: agent, to_agent: 'orchestrator',
      transfer: { kind: 'model-response', bytes: Buffer.byteLength(JSON.stringify(result) ?? 'null'), outcome: 'received' },
      metrics: { duration_ms: Math.round(performance.now() - started) } });
    status = 'completed';
    return result;
  } catch (error) {
    emit({ ...base, from_agent: agent, to_agent: 'orchestrator', status: 'failed',
      transfer: { kind: 'model-response', bytes: 0, outcome: 'failed' },
      metrics: { duration_ms: Math.round(performance.now() - started) } });
    throw error;
  } finally {
    settled = true;
    emit({ ...base, type: 'model.usage', status, usage,
      metrics: { duration_ms: Math.round(performance.now() - started) } });
  }
}
