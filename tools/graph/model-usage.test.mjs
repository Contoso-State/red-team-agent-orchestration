import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNativeUsage, normalizeModelUsage } from './model-usage.mjs';

const unavailable = { source: 'native-runtime', input_tokens: null, output_tokens: null,
  cache_read_input_tokens: null, cache_creation_input_tokens: null, cost_usd: null, models: [] };

test('usage normalization preserves unavailable rather than inventing zero', () => {
  for (const value of [undefined, null, [], 'private', 12, {}]) {
    assert.deepEqual(normalizeModelUsage(value), unavailable);
    assert.deepEqual(extractNativeUsage(value), unavailable);
  }
  assert.deepEqual(normalizeModelUsage({ usage: { input_tokens: 12 } }), unavailable);
  assert.deepEqual(normalizeModelUsage({ input_tokens: 0, cost_usd: 0 }), { ...unavailable, input_tokens: 0, cost_usd: 0 });
});

test('usage counts are nonnegative safe integers and costs are bounded finite numbers', () => {
  for (const input_tokens of [-1, 1.5, '100', true, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeModelUsage({ input_tokens }).input_tokens, null);
  }
  for (const cost_usd of [-1, '0.25', true, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeModelUsage({ cost_usd }).cost_usd, null);
  }
  assert.equal(normalizeModelUsage({ input_tokens: Number.MAX_SAFE_INTEGER }).input_tokens, Number.MAX_SAFE_INTEGER);
  assert.equal(normalizeModelUsage({ cost_usd: 0.0123 }).cost_usd, 0.0123);
});

test('usage metadata omits arbitrary payloads and limits model identifiers', () => {
  const value = normalizeModelUsage({ source: 'PRIVATE_SOURCE', input_tokens: 7, prompt: 'PRIVATE_PROMPT', result: 'PRIVATE_RESULT',
    models: ['claude-model-1', 'claude-model-1', 'PRIVATE MODEL TEXT', '<script>PRIVATE_SCRIPT</script>', 'https://private.example/key', 'x'.repeat(121), 'claude-model-2', 'claude-model-3', 'claude-model-4'] });
  assert.deepEqual(value.models, ['claude-model-1', 'claude-model-2', 'claude-model-3']);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|private\.example/);
  assert.equal(normalizeModelUsage({ models: Array.from({ length: 50 }, (_, i) => `model-${i}`) }).models.length, 8);
  assert.deepEqual(normalizeModelUsage(Object.create({ input_tokens: 7, cost_usd: 9 })), unavailable);
  assert.deepEqual(normalizeModelUsage(Object.defineProperty({}, 'input_tokens', { get() { throw Error('no getter execution'); } })), unavailable);
});

test('native result uses aggregate totals once and never sums per-model duplicates', () => {
  const value = extractNativeUsage({ usage: { input_tokens: 101, output_tokens: 23, cache_read_input_tokens: 8, cache_creation_input_tokens: 4, private_field: 'PRIVATE_USAGE' },
    total_cost_usd: 0.034, modelUsage: { 'claude-model-1': { inputTokens: 101, outputTokens: 23, costUSD: 0.034 } },
    result: 'PRIVATE_RESULT', errors: ['PRIVATE_ERROR'], structured_output: { private: 'PRIVATE_DATA' } });
  assert.deepEqual(value, { source: 'native-runtime', input_tokens: 101, output_tokens: 23, cache_read_input_tokens: 8, cache_creation_input_tokens: 4, cost_usd: 0.034, models: ['claude-model-1'] });
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE/);
  assert.equal(extractNativeUsage({ modelUsage: { model: { inputTokens: 10 } } }).input_tokens, null);
});
