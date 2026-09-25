/** Summaries cover only retained, selected exchanges; absent usage is never zero. */
export const USAGE_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'cost_usd'];

function numeric(value, key) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
    && (key === 'cost_usd' || Number.isSafeInteger(value)) ? value : null;
}

export function summarizeModelUsage(events) {
  const exchanges = new Map();
  let uncorrelated = 0;
  for (const event of events) {
    if (event.type !== 'model.usage' && !(event.type === 'message.sent' && event.transfer?.kind === 'model-request')) continue;
    if (!event.run_id || !event.exchange_id) { uncorrelated++; continue; }
    const key = JSON.stringify([event.run_id, event.exchange_id]);
    const exchange = exchanges.get(key) || { values: null, conflict: false };
    if (event.type === 'model.usage') {
      const values = USAGE_FIELDS.map(field => numeric(event.usage?.[field], field));
      if (exchange.values && JSON.stringify(exchange.values) !== JSON.stringify(values)) exchange.conflict = true;
      exchange.values = values;
    }
    exchanges.set(key, exchange);
  }
  const result = { invocations: exchanges.size, usageRecords: 0, usableRecords: 0, conflicts: 0, uncorrelated, fields: {} };
  for (const field of USAGE_FIELDS) result.fields[field] = { value: null, reported: 0 };
  for (const exchange of exchanges.values()) {
    if (exchange.conflict) { result.conflicts++; continue; }
    if (!exchange.values) continue;
    result.usageRecords++;
    if (exchange.values.some(value => value !== null)) result.usableRecords++;
    USAGE_FIELDS.forEach((field, index) => {
      if (exchange.values[index] === null) return;
      const metric = result.fields[field];
      metric.value = (metric.value ?? 0) + exchange.values[index];
      metric.reported++;
    });
  }
  return result;
}
