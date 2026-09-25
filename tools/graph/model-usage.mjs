/** Metadata only: never copy result text, prompts, errors, or arbitrary provider fields. */
const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => record(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const cost = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;

/** Normalize an untrusted callback payload or event.usage; unknown is not zero. */
export function normalizeModelUsage(value) {
  const normalized = { source: 'native-runtime' };
  for (const field of TOKEN_FIELDS) normalized[field] = count(own(value, field));
  normalized.cost_usd = cost(own(value, 'cost_usd'));
  const models = own(value, 'models');
  normalized.models = Array.isArray(models)
    ? [...new Set(models.slice(0, 8).filter(model => typeof model === 'string' && MODEL_ID.test(model)))] : [];
  return normalized;
}

/**
 * Claude's final JSON result carries aggregate usage and total_cost_usd.
 * modelUsage is used only for identifiers: adding its counts would double count.
 * Native calls are independent, with tools/MCP disabled and no resumed session.
 * Cost is the native runtime's estimate, not an authoritative billing amount.
 * Reference: https://code.claude.com/docs/en/agent-sdk/cost-tracking
 */
export function extractNativeUsage(envelope) {
  const usage = own(envelope, 'usage');
  const modelUsage = own(envelope, 'modelUsage');
  const values = { cost_usd: own(envelope, 'total_cost_usd'), models: record(modelUsage) ? Object.keys(modelUsage).slice(0, 8) : [] };
  for (const field of TOKEN_FIELDS) values[field] = own(usage, field);
  return normalizeModelUsage(values);
}
