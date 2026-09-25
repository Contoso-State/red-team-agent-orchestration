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
import { isIP } from 'node:net';

export const ADAPTER_SCHEMA = 'hexstrike-adapter/v1';
export const CAPABILITY = 'passive-http-observations';

const STATUSES = new Set(['completed', 'partial', 'failed']);
const TARGET_STATUSES = new Set(['completed', 'failed', 'skipped']);
const FINDING_SEVERITIES = new Set(['Critical', 'High', 'Medium', 'Low', 'Informational']);
const FINDING_CONFIDENCES = new Set(['High', 'Medium', 'Low']);
const FINDING_STATES = new Set(['open', 'confirmed', 'false_positive', 'remediated', 'accepted_risk']);
const REQUIRED_FINDING_FIELDS = [
  'id', 'title', 'severity', 'confidence', 'agent', 'category', 'resource_id',
  'subscription_id', 'description', 'attack_vector', 'recommendation', 'evidence',
  'status', 'first_seen',
];

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
  if (!allowlist.engagement_id || typeof allowlist.content_hash !== 'string' ||
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
    .replace(/\b(authorization|cookie|set-cookie|password|passwd|client_secret|access_token|refresh_token|api[_-]?key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|Bearer\s+[^\s,;]+|[^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(AccountKey|SharedAccessSignature|sig)=([^;&\s]+)/gi, '$1=[REDACTED]')
    .slice(0, 4000);
}

function validateFinding(finding, host, sourceIds) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) fail('finding must be an object.');
  const missing = REQUIRED_FINDING_FIELDS.filter((field) => finding[field] == null ||
    (typeof finding[field] === 'string' && !finding[field].trim()) ||
    (Array.isArray(finding[field]) && finding[field].length === 0));
  if (missing.length) fail(`finding is missing required field(s): ${missing.join(', ')}.`);
  if (!/^AZ-EVA-[0-9]{3}$/.test(finding.id)) fail(`finding '${finding.id}' must use the AZ-EVA-NNN ID format.`);
  for (const field of ['id', 'title', 'agent', 'category', 'resource_id', 'subscription_id',
    'description', 'attack_vector', 'recommendation', 'status', 'first_seen']) {
    if (typeof finding[field] !== 'string') fail(`finding '${finding.id}' field '${field}' must be a string.`);
  }
  if (!FINDING_SEVERITIES.has(finding.severity) ||
      !FINDING_CONFIDENCES.has(finding.confidence) ||
      !FINDING_STATES.has(finding.status)) fail(`finding '${finding.id}' has invalid enum values.`);
  if (finding.agent !== 'external-vuln') fail(`finding '${finding.id}' must use agent 'external-vuln'.`);
  if (!sourceIds.includes(finding.resource_id)) {
    fail(`finding '${finding.id}' resource is not a source resource for '${host}'.`);
  }
  const subscription = resourceSubscription(finding.resource_id);
  if (!subscription || subscription !== String(finding.subscription_id).toLowerCase()) {
    fail(`finding '${finding.id}' subscription does not match its Azure resource ID.`);
  }
  if (!Array.isArray(finding.evidence) || finding.evidence.some((item) =>
    !item || typeof item.source !== 'string' || !item.source.trim() ||
    typeof item.summary !== 'string' || !item.summary.trim())) {
    fail(`finding '${finding.id}' evidence must contain source and summary.`);
  }
  if (Number.isNaN(Date.parse(finding.first_seen))) fail(`finding '${finding.id}' first_seen is invalid.`);

  const normalized = structuredClone(finding);
  for (const field of ['title', 'category', 'description', 'attack_vector', 'recommendation', 'risk']) {
    if (normalized[field] != null) normalized[field] = redact(normalized[field]);
  }
  if (Array.isArray(normalized.references)) normalized.references = normalized.references.map(redact);
  normalized.evidence = normalized.evidence.map((evidence) => ({
    ...evidence,
    source: redact(evidence.source),
    summary: redact(evidence.summary),
  }));
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
    if (target.status !== 'completed' && (!target.reason || !String(target.reason).trim())) {
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
  if (result.status !== 'completed' && (!result.reason || !String(result.reason).trim())) {
    fail(`${result.status} result must include a reason for the coverage gap.`);
  }
  if (result.status === 'failed' && result.findings.length) {
    fail('failed result cannot promote findings; report partial if usable results exist.');
  }

  const findings = result.findings.map((entry) => {
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
    tool: { name: 'hexstrike-ai', version: result.tool.version.trim() },
    targets: completedTargets.map((target) => ({
      host: normalizeHost(target.host),
      status: target.status,
      ...(target.reason ? { reason: redact(target.reason) } : {}),
    })),
    findings,
    ...(result.reason ? { reason: redact(result.reason) } : {}),
  };
}
