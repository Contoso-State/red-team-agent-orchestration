#!/usr/bin/env node
/**
 * Offline HexStrike adapter boundary.
 *
 * This module validates Azure-derived target scope and normalizes a documented
 * internal result envelope. It deliberately has no transport, network, process,
 * or HexStrike protocol implementation. Live use requires a separately reviewed
 * transport that is covered by the existing EVA authorization and egress gates.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';

export const ADAPTER_SCHEMA = 'hexstrike-adapter/v1';
export const CAPABILITY = 'passive-http-observations';

const STATUSES = new Set(['completed', 'partial', 'failed']);
const TARGET_STATUSES = new Set(['completed', 'failed', 'skipped']);
const FINDING_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/finding.schema.json', import.meta.url), 'utf8'));

function fail(message) {
  throw new Error(`HexStrike adapter: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) fail(`${label} has unsupported field(s): ${unexpected.join(', ')}.`);
}

function normalizeHost(value) {
  if (typeof value !== 'string' || !value.trim()) fail('target host must be a non-empty string.');
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  const unwrapped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (host.includes('/') || /[\s*?#@]/.test(host) ||
      (host.includes(':') && isIP(unwrapped) !== 6)) {
    fail(`invalid target host '${value}'.`);
  }
  return host;
}

function hashAllowlist(allowlist) {
  const canonical = JSON.stringify({ hosts: allowlist.hosts, ips: allowlist.ips });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function resourceSubscription(resourceId) {
  return typeof resourceId === 'string'
    ? resourceId.match(/^\/subscriptions\/([^/]+)\/resourceGroups\/[^/]+\/providers\/[^/]+\/.+$/i)?.[1]?.toLowerCase() ?? null
    : null;
}

function allowedTargets(allowlist) {
  if (!allowlist || allowlist.schema !== 'external-targets/v1' ||
      !allowlist.allowlist || !Array.isArray(allowlist.targets) ||
      !Array.isArray(allowlist.allowlist.hosts) || !Array.isArray(allowlist.allowlist.ips)) {
    fail('invalid external-targets/v1 allowlist document.');
  }
  if (typeof allowlist.engagement_id !== 'string' || !allowlist.engagement_id.trim() ||
      typeof allowlist.content_hash !== 'string' ||
      hashAllowlist(allowlist.allowlist) !== allowlist.content_hash) {
    fail('allowlist engagement or content hash is missing or invalid.');
  }
  const hosts = new Set([...allowlist.allowlist.hosts, ...allowlist.allowlist.ips].map(normalizeHost));
  const targetMap = new Map();
  for (const target of allowlist.targets) {
    const host = normalizeHost(target?.host);
    if (!hosts.has(host)) fail(`target '${host}' is not in the allowlist host/IP set.`);
    if (targetMap.has(host) || !Array.isArray(target.sources)) {
      fail(`target '${host}' is duplicated or has invalid source provenance.`);
    }
    const sources = [...new Set(target.sources
      .map((source) => source?.resource_id)
      .filter((id) => typeof id === 'string' && id.trim()))].sort();
    if (!sources.length || sources.some((id) => !resourceSubscription(id))) {
      fail(`target '${host}' has no valid Azure resource provenance.`);
    }
    targetMap.set(host, sources);
  }
  return { hosts, targetMap };
}

/** Build a typed request using only entries in a verified Azure-derived allowlist. */
export function buildRequest(allowlist, selectedHosts = undefined) {
  const { targetMap } = allowedTargets(allowlist);
  if (selectedHosts !== undefined && !Array.isArray(selectedHosts)) fail('selected hosts must be an array.');
  const selected = selectedHosts === undefined
    ? [...targetMap.keys()]
    : selectedHosts.map(normalizeHost);
  if (!selected.length) fail('at least one allowlisted target is required.');
  if (new Set(selected).size !== selected.length) fail('duplicate target host.');
  const targets = selected.sort().map((host) => {
    const sources = targetMap.get(host);
    if (!sources) fail(`target '${host}' is not derived from this allowlist.`);
    return { host, source_resource_ids: sources };
  });
  return {
    schema: ADAPTER_SCHEMA,
    capability: CAPABILITY,
    engagement_id: allowlist.engagement_id,
    allowlist_hash: allowlist.content_hash,
    targets,
  };
}

function redact(value) {
  return String(value)
    // A credential header can contain multiple cookies, Basic auth, or quoted
    // values. Removing just its first token leaves credentials behind.
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\b["']?\s*[:=]\s*[^\r\n]*/gi, '$1: [REDACTED]')
    .replace(/\b(authorization|cookie|set-cookie|password|passwd|client_secret|access_token|refresh_token|api[_-]?key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|Bearer\s+[^\s,;]+|[^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/\b(password|passwd|client_secret|access_token|refresh_token|api[_-]?key)["']\s*:\s*(?:"[^"]*"|'[^']*')/gi, '$1: [REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(AccountKey|SharedAccessSignature|sig)=([^;&\s]+)/gi, '$1=[REDACTED]')
    .slice(0, 4000);
}

function redactTree(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactTree);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactTree(item)]));
  }
  return value;
}

function isDateTime(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts || parts[0] !== value) return false;
  const [, year, month, day, hour, minute, second, , offsetHour = 0, offsetMinute = 0] = parts;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 &&
    Number(day) <= days[Number(month) - 1] && Number(hour) <= 23 && Number(minute) <= 59 &&
    Number(second) <= 59 && Number(offsetHour) <= 23 && Number(offsetMinute) <= 59;
}

function isUri(value) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value) || /[\s\u0000-\u001f]/.test(value) || /%(?![0-9a-f]{2})/i.test(value)) return false;
  try { new URL(value); return true; } catch { return false; }
}

// Validate the types, enums, patterns and formats used by the canonical finding
// schema. This adapter additionally rejects unknown keys at every object level;
// raw tool payloads are never copied into a promoted finding.
function validateFindingFields(value, schema, label = 'finding') {
  if (schema.type === 'object') {
    exactKeys(value, Object.keys(schema.properties ?? {}), label);
    const missing = (schema.required ?? []).filter((key) => !Object.hasOwn(value, key));
    if (missing.length) fail(`${label} is missing required field(s): ${missing.join(', ')}.`);
    for (const [key, item] of Object.entries(value)) {
      validateFindingFields(item, schema.properties[key], `${label}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail(`${label} must be an array.`);
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`${label} has too few items.`);
    value.forEach((item, index) => validateFindingFields(item, schema.items, `${label}[${index}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`${label} has an invalid format.`);
    if (schema.format === 'date-time' && !isDateTime(value)) fail(`${label} must be an RFC3339 date-time.`);
    if (schema.format === 'uri' && !isUri(value)) fail(`${label} must be an absolute URI.`);
  } else {
    fail(`${label} uses an unsupported canonical schema type.`);
  }
  if (schema.enum && !schema.enum.includes(value)) fail(`${label} has an invalid enum value.`);
}

function validateFinding(finding, host, sourceIds) {
  validateFindingFields(finding, FINDING_SCHEMA);
  if (!/^AZ-EVA-[0-9]{3}$/.test(finding.id)) fail(`finding '${finding.id}' must use the AZ-EVA-NNN ID format.`);
  if (finding.agent !== 'external-vuln') fail(`finding '${finding.id}' must use agent 'external-vuln'.`);
  if (!sourceIds.includes(finding.resource_id)) {
    fail(`finding '${finding.id}' resource is not a source resource for '${host}'.`);
  }
  const subscription = resourceSubscription(finding.resource_id);
  if (!subscription || subscription !== String(finding.subscription_id).toLowerCase()) {
    fail(`finding '${finding.id}' subscription does not match its Azure resource ID.`);
  }
  if (finding.affected_resources) {
    if (!finding.affected_resources.some((resource) => resource.resource_id === finding.resource_id)) {
      fail(`finding '${finding.id}' affected_resources must include its representative resource.`);
    }
    for (const resource of finding.affected_resources) {
      if (!sourceIds.includes(resource.resource_id)) {
        fail(`finding '${finding.id}' affected resource is not a source resource for '${host}'.`);
      }
      if (resource.subscription_id !== undefined &&
          resource.subscription_id.toLowerCase() !== resourceSubscription(resource.resource_id)) {
        fail(`finding '${finding.id}' affected resource subscription does not match its Azure resource ID.`);
      }
    }
  }

  const normalized = redactTree(finding);
  const provenance = `HexStrike ${CAPABILITY} (${host})`;
  if (!normalized.evidence.some((evidence) => evidence.source === provenance)) {
    normalized.evidence.push({ source: provenance, summary: 'Normalized from the validated adapter result.' });
  }
  return normalized;
}

/**
 * Validate and normalize the adapter's internal result envelope.
 * `completed` with no findings means a successful zero-finding result; `partial`
 * and `failed` remain explicit and are never converted into a clean result.
 */
export function normalizeResult(request, result) {
  exactKeys(request, ['schema', 'capability', 'engagement_id', 'allowlist_hash', 'targets'], 'request');
  if (!request || request.schema !== ADAPTER_SCHEMA || request.capability !== CAPABILITY ||
      typeof request.engagement_id !== 'string' || !request.engagement_id.trim() ||
      !/^sha256:[a-f0-9]{64}$/.test(request.allowlist_hash) ||
      !Array.isArray(request.targets) || !request.targets.length) fail('invalid adapter request.');
  for (const target of request.targets) {
    exactKeys(target, ['host', 'source_resource_ids'], 'request target');
  }
  exactKeys(result, ['schema', 'capability', 'status', 'tool', 'targets', 'findings', 'reason'], 'result');
  if (!result || result.schema !== ADAPTER_SCHEMA || result.capability !== CAPABILITY ||
      !STATUSES.has(result.status)) fail('invalid result envelope or status.');
  exactKeys(result.tool, ['name', 'version'], 'result tool');
  if (!result.tool || result.tool.name !== 'hexstrike-ai' ||
      typeof result.tool.version !== 'string' || !result.tool.version.trim()) {
    fail('tool name and version provenance are required.');
  }
  const requestTargets = new Map(request.targets.map((target) => [
    normalizeHost(target.host),
    target.source_resource_ids,
  ]));
  if (requestTargets.size !== request.targets.length ||
      [...requestTargets.values()].some((ids) => !Array.isArray(ids) || !ids.length ||
        ids.some((id) => !resourceSubscription(id)) || new Set(ids).size !== ids.length)) {
    fail('request targets must be unique and retain valid Azure resource provenance.');
  }
  if (!Array.isArray(result.targets) || !Array.isArray(result.findings)) {
    fail('result targets and findings must be arrays.');
  }
  const completedTargets = result.targets;
  const seen = new Set();
  for (const target of completedTargets) {
    exactKeys(target, ['host', 'status', 'reason'], 'result target');
    const host = normalizeHost(target?.host);
    if (!requestTargets.has(host)) fail(`result target '${host}' was not requested.`);
    if (seen.has(host)) fail(`duplicate result target '${host}'.`);
    seen.add(host);
    if (!TARGET_STATUSES.has(target.status)) fail(`target '${host}' has invalid status.`);
    if (target.reason !== undefined && typeof target.reason !== 'string') fail(`target '${host}' reason must be a string.`);
    if (target.status !== 'completed' && (!target.reason || !target.reason.trim())) {
      fail(`target '${host}' with status '${target.status}' must include a reason.`);
    }
  }
  if (result.status === 'completed' &&
      (completedTargets.length !== requestTargets.size ||
       completedTargets.some((target) => target.status !== 'completed'))) {
    fail('completed result must report every requested target as completed.');
  }
  if (result.status === 'partial' && !completedTargets.length) {
    fail('partial result must report at least one attempted target.');
  }
  if (result.reason !== undefined && typeof result.reason !== 'string') fail('result reason must be a string.');
  if (result.status !== 'completed' && (!result.reason || !result.reason.trim())) {
    fail(`${result.status} result must include a reason for the coverage gap.`);
  }
  if (result.status === 'failed' && result.findings.length) {
    fail('failed result cannot promote findings; report partial if usable results exist.');
  }

  const findings = result.findings.map((entry) => {
    exactKeys(entry, ['target_host', 'finding'], 'result finding');
    const host = normalizeHost(entry?.target_host);
    const sourceIds = requestTargets.get(host);
    if (!sourceIds) fail(`finding target '${host}' was not requested.`);
    if (!seen.has(host) || completedTargets.find((target) => normalizeHost(target.host) === host)?.status !== 'completed') {
      fail(`finding target '${host}' is not marked completed.`);
    }
    return validateFinding(entry.finding, host, sourceIds);
  });
  return {
    schema: ADAPTER_SCHEMA,
    capability: CAPABILITY,
    status: result.status,
    tool: { name: 'hexstrike-ai', version: redact(result.tool.version.trim()) },
    targets: completedTargets.map((target) => ({
      host: normalizeHost(target.host),
      status: target.status,
      ...(target.reason ? { reason: redact(target.reason) } : {}),
    })),
    findings,
    ...(result.reason ? { reason: redact(result.reason) } : {}),
  };
}
