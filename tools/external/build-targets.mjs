#!/usr/bin/env node
/**
 * build-targets.mjs — generate the Azure-derived external target allowlist for the
 * External Vulnerability Agent (EVA).
 *
 * EVA is the only agent that sends real traffic to live endpoints. The non-negotiable
 * safeguard is that it may ONLY ever touch a host that maps back to an in-scope Azure
 * resource discovered during the engagement. This tool produces that allowlist:
 *
 *   engagements/<session>/scope/external-targets.json
 *
 * It reads the engagement datastore (read-only), walks the inventory, and — using a
 * deterministic, type-specific extractor registry — pulls the public FQDNs and public
 * IPs published by known internet-facing Azure resource types (App Service, Static Web
 * Apps, Storage static sites, Front Door / CDN, API Management, public IPs, container
 * instances/apps, container registries). Private endpoints, RFC1918/loopback/link-local
 * IPs, and any host that does not map to an in-scope resource are excluded by design.
 * There is NO free-form / generic host scraping: a host is only ever on the list because
 * a specific in-scope Azure resource published it.
 *
 * The downstream egress guardrail and the scope-locked scanner wrappers both consume the
 * `allowlist` block (and `content_hash`) emitted here. Nothing in this file touches Azure
 * or the network; it is a pure read over the local datastore.
 *
 * Safety: the output lives under engagements/<session>/ (gitignored). It contains real
 * target hostnames — never commit it.
 *
 * CLI:
 *   node tools/external/build-targets.mjs --db <path> --session <sessionDir> [--engagement <id>]
 *   node tools/external/build-targets.mjs --db <path> --out <file.json>
 *   node tools/external/build-targets.mjs --db <path> --session <dir> --print   (also echo doc)
 */

import { openDb } from '../datastore/db.mjs';
import {
  classifyCandidate,
  isPublicIpv4,
  isPublicIpv6,
  isPublicFqdn,
  parseIpv4,
} from './host-classify.mjs';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS_SCHEMA = 'external-targets/v1';

// Host / IP classification lives in host-classify.mjs (dependency-free, no datastore
// import) so the guardrails egress matcher can reuse it without loading node:sqlite.
// Re-exported here for backward compatibility with existing importers/tests.
export { classifyCandidate, isPublicIpv4, isPublicIpv6, isPublicFqdn, parseIpv4 };

// ---------------------------------------------------------------------------
// Per-type extractor registry. Each extractor receives the resource `properties`
// object and returns raw candidate strings tagged with the JSON path they came from.
// Only the resource TYPES listed here are ever inspected — there is no generic
// deep-scan, so an internal hostname buried in some other resource never leaks in.
// ---------------------------------------------------------------------------

const cand = (value, discovery) => (value ? { value, discovery } : null);
const arr = (x) => (Array.isArray(x) ? x : []);

const EXTRACTORS = {
  'microsoft.network/publicipaddresses': (p) => [
    cand(p?.ipAddress, 'publicIp.ipAddress'),
    cand(p?.dnsSettings?.fqdn, 'publicIp.dnsSettings.fqdn'),
  ],
  'microsoft.web/sites': (p) => [
    cand(p?.defaultHostName, 'site.defaultHostName'),
    ...arr(p?.hostNames).map((h) => cand(h, 'site.hostNames')),
    ...arr(p?.enabledHostNames).map((h) => cand(h, 'site.enabledHostNames')),
  ],
  'microsoft.web/sites/slots': (p) => [
    cand(p?.defaultHostName, 'slot.defaultHostName'),
    ...arr(p?.hostNames).map((h) => cand(h, 'slot.hostNames')),
  ],
  'microsoft.web/staticsites': (p) => [
    cand(p?.defaultHostname, 'staticSite.defaultHostname'),
    ...arr(p?.customDomains).map((d) => cand(typeof d === 'string' ? d : d?.name || d?.domainName, 'staticSite.customDomains')),
  ],
  'microsoft.storage/storageaccounts': (p) => [
    ...Object.entries(p?.primaryEndpoints || {}).map(([k, v]) => cand(v, `storage.primaryEndpoints.${k}`)),
    ...Object.entries(p?.secondaryEndpoints || {}).map(([k, v]) => cand(v, `storage.secondaryEndpoints.${k}`)),
  ],
  'microsoft.cdn/profiles/endpoints': (p) => [
    cand(p?.hostName, 'cdnEndpoint.hostName'),
    ...arr(p?.customDomains).map((d) => cand(d?.properties?.hostName || d?.hostName, 'cdnEndpoint.customDomains')),
  ],
  'microsoft.cdn/profiles/afdendpoints': (p) => [cand(p?.hostName, 'afdEndpoint.hostName')],
  'microsoft.cdn/profiles/customdomains': (p) => [cand(p?.hostName, 'afdCustomDomain.hostName')],
  'microsoft.network/frontdoors': (p) => [
    cand(p?.cName, 'frontDoor.cName'),
    ...arr(p?.frontendEndpoints).map((e) => cand(e?.properties?.hostName || e?.hostName, 'frontDoor.frontendEndpoints')),
  ],
  'microsoft.apimanagement/service': (p) => [
    cand(p?.gatewayUrl, 'apim.gatewayUrl'),
    cand(p?.gatewayRegionalUrl, 'apim.gatewayRegionalUrl'),
    cand(p?.portalUrl, 'apim.portalUrl'),
    cand(p?.developerPortalUrl, 'apim.developerPortalUrl'),
    cand(p?.managementApiUrl, 'apim.managementApiUrl'),
    ...arr(p?.hostnameConfigurations).map((h) => cand(h?.hostName, 'apim.hostnameConfigurations')),
  ],
  'microsoft.containerinstance/containergroups': (p) => [
    cand(p?.ipAddress?.type === 'Private' ? null : p?.ipAddress?.ip, 'containerGroup.ipAddress.ip'),
    cand(p?.ipAddress?.fqdn, 'containerGroup.ipAddress.fqdn'),
  ],
  'microsoft.app/containerapps': (p) => [
    cand(p?.configuration?.ingress?.external ? p?.configuration?.ingress?.fqdn : null, 'containerApp.ingress.fqdn'),
  ],
  'microsoft.containerregistry/registries': (p) => [
    cand(p?.loginServer, 'registry.loginServer'),
  ],
};

/** Resolve the `properties` object from a datastore resource row (raw_json string or object). */
function resolveProps(row) {
  if (row?.properties && typeof row.properties === 'object') return row.properties;
  let raw = row?.raw_json;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (raw && typeof raw === 'object') return raw.properties || raw;
  return {};
}

/**
 * Extract the public targets published by a single in-scope resource.
 * Returns [{ host, kind, url, source_resource_id, source_resource_type, discovery }].
 */
export function extractTargetsFromResource(row) {
  const type = String(row?.type || '').toLowerCase();
  const extractor = EXTRACTORS[type];
  if (!extractor) return [];
  const props = resolveProps(row);
  const out = [];
  const seen = new Set();
  for (const c of extractor(props)) {
    if (!c || !c.value) continue;
    const cls = classifyCandidate(c.value);
    if (!cls) continue;
    const key = `${cls.kind}|${cls.host}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      host: cls.host,
      kind: cls.kind,
      url: cls.url || (cls.kind === 'fqdn' ? `https://${cls.host}/` : null),
      source_resource_id: row.resource_id || row.id || null,
      source_resource_type: row.type || null,
      discovery: c.discovery,
    });
  }
  return out;
}

/** True if this resource type is one EVA knows how to extract internet-facing hosts from. */
export function isExternallyFacingType(type) {
  return Object.prototype.hasOwnProperty.call(EXTRACTORS, String(type || '').toLowerCase());
}

// ---------------------------------------------------------------------------
// Allowlist document assembly
// ---------------------------------------------------------------------------

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Build the full external-targets document from a list of resource rows.
 * Pure (no IO) so it is unit-testable. Dedupes targets by host across resources,
 * recording every source resource that published the host.
 */
export function buildTargetsDoc(rows, { engagementId = null, sourceDb = null, now = new Date() } = {}) {
  const byHost = new Map(); // host -> target with sources[]
  let resourcesScanned = 0;
  let resourcesWithTargets = 0;

  for (const row of rows || []) {
    if (!isExternallyFacingType(row?.type)) continue;
    resourcesScanned++;
    const targets = extractTargetsFromResource(row);
    if (targets.length) resourcesWithTargets++;
    for (const t of targets) {
      const existing = byHost.get(t.host);
      const source = { resource_id: t.source_resource_id, type: t.source_resource_type, discovery: t.discovery };
      if (existing) {
        if (!existing.sources.some((s) => s.resource_id === source.resource_id && s.discovery === source.discovery)) {
          existing.sources.push(source);
        }
      } else {
        byHost.set(t.host, { host: t.host, kind: t.kind, url: t.url, sources: [source] });
      }
    }
  }

  const targets = [...byHost.values()].sort((a, b) => a.host.localeCompare(b.host));
  const hosts = targets.filter((t) => t.kind === 'fqdn').map((t) => t.host).sort();
  const ips = targets.filter((t) => t.kind === 'ip').map((t) => t.host).sort();
  const allowlist = { hosts, ips };
  // The content hash fingerprints exactly the security-relevant allowlist so the egress
  // guardrail and scoped wrappers can detect tampering / staleness deterministically.
  const content_hash = 'sha256:' + sha256(JSON.stringify(allowlist));

  return {
    schema: TARGETS_SCHEMA,
    engagement_id: engagementId,
    generated_at: now.toISOString(),
    generator: 'tools/external/build-targets.mjs',
    source_db: sourceDb,
    counts: {
      resources_scanned: resourcesScanned,
      resources_with_targets: resourcesWithTargets,
      hosts: hosts.length,
      ips: ips.length,
    },
    allowlist,
    content_hash,
    targets,
    notes: [
      'Hosts are derived ONLY from in-scope Azure resources of known internet-facing types.',
      'Private endpoints (privatelink/*), RFC1918/loopback/link-local IPs, and wildcards are excluded.',
      'EVA active tiers and the egress guardrail are scope-locked to this allowlist.',
    ],
  };
}

/** Read in-scope resource rows from the engagement datastore. */
export function readResourceRows(db) {
  return db.prepare('SELECT resource_id, name, type, subscription_id, raw_json FROM resources').all();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).replace(/-/g, '_');
    out[key] = eq >= 0 ? a.slice(eq + 1) : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function resolveOut(args) {
  if (typeof args.out === 'string') return resolve(process.cwd(), args.out);
  if (typeof args.session === 'string') {
    return resolve(process.cwd(), join(args.session, 'scope', 'external-targets.json'));
  }
  // Infer the session dir from a db path like engagements/<session>/.../engagement.db
  if (typeof args.db === 'string') {
    const norm = args.db.replace(/\\/g, '/');
    const m = norm.match(/(.*engagements\/[^/]+)\//);
    if (m) return resolve(process.cwd(), join(m[1], 'scope', 'external-targets.json'));
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.db || typeof args.db !== 'string') {
    console.error('Error: --db <path> is required (read-only over the engagement datastore).');
    process.exit(1);
  }
  const out = resolveOut(args);
  if (!out) {
    console.error('Error: pass --session <sessionDir> or --out <file.json> (could not infer from --db).');
    process.exit(1);
  }

  const db = openDb(args.db, { create: false });
  let doc;
  try {
    let engagementId = typeof args.engagement === 'string' ? args.engagement : undefined;
    if (!engagementId) {
      try { engagementId = db.prepare("SELECT value FROM meta WHERE key='engagement_id'").get()?.value; } catch { /* ignore */ }
    }
    const rows = readResourceRows(db);
    doc = buildTargetsDoc(rows, { engagementId: engagementId || null, sourceDb: args.db });
  } finally {
    db.close();
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');

  // Summary to stdout intentionally omits the host list (it is sensitive target data).
  const summary = {
    wrote: out,
    engagement_id: doc.engagement_id,
    counts: doc.counts,
    content_hash: doc.content_hash,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (args.print) console.error('(--print) full document:\n' + JSON.stringify(doc, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
