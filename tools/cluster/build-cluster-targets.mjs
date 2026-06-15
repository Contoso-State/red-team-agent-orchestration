#!/usr/bin/env node
/**
 * build-cluster-targets.mjs — generate the Azure-derived cluster allowlist for the
 * Azure Container & Kubernetes Agent's hard-gated cluster-active lane (Lane 2).
 *
 * The cluster-active lane is the only one that reaches into a live AKS cluster / running
 * container or pulls + scans images. The non-negotiable safeguard is that it may ONLY ever
 * touch a cluster or registry that maps back to an in-scope Azure resource discovered during
 * the engagement. This tool produces that allowlist:
 *
 *   engagements/<session>/scope/cluster-targets.json
 *
 * It reads the engagement datastore (read-only) and, using a deterministic, type-specific
 * extractor, pulls the in-scope AKS managed clusters and Azure Container Registries. There is
 * NO free-form scraping: a cluster/registry is only ever on the list because a specific
 * in-scope Azure resource published it.
 *
 * The downstream cluster guardrail (cluster-core.mjs) and the scope-locked scanner wrapper
 * (Invoke-ScopedClusterScan.ps1) both consume the `allowlist` block (and `content_hash`)
 * emitted here. Nothing in this file touches Azure or the network; it is a pure read over the
 * local datastore.
 *
 * Safety: the output lives under engagements/<session>/ (gitignored). It contains real
 * cluster/registry identifiers — never commit it.
 *
 * CLI:
 *   node tools/cluster/build-cluster-targets.mjs --db <path> --session <sessionDir> [--engagement <id>]
 *   node tools/cluster/build-cluster-targets.mjs --db <path> --out <file.json>
 */

import { openDb } from '../datastore/db.mjs';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLUSTER_TARGETS_SCHEMA = 'cluster-targets/v1';

const AKS_TYPE = 'microsoft.containerservice/managedclusters';
const ACR_TYPE = 'microsoft.containerregistry/registries';

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

/** True if a resource type is an AKS cluster or ACR registry. */
export function isClusterTargetType(type) {
  const t = String(type || '').toLowerCase();
  return t === AKS_TYPE || t === ACR_TYPE;
}

/**
 * Extract the cluster / registry identifiers published by a single in-scope resource.
 * Returns { clusters:[...], registries:[...], target } where `target` describes it.
 */
export function extractClusterTarget(row) {
  const type = String(row?.type || '').toLowerCase();
  const name = String(row?.name || '').trim();
  const resourceId = String(row?.resource_id || row?.id || '').trim();
  const props = resolveProps(row);
  const clusters = [];
  const registries = [];
  let target = null;

  if (type === AKS_TYPE) {
    if (name) clusters.push(name.toLowerCase());
    if (resourceId) clusters.push(resourceId.toLowerCase());
    // The Entra-integrated API server FQDN, if present, is a useful context identifier.
    const fqdn = props?.fqdn || props?.privateFQDN || props?.azurePortalFQDN;
    target = { kind: 'cluster', name, resource_id: resourceId || null, fqdn: fqdn || null };
  } else if (type === ACR_TYPE) {
    const loginServer = String(props?.loginServer || '').trim().toLowerCase();
    if (loginServer) {
      registries.push(loginServer);
      registries.push(loginServer.replace(/\.azurecr\.io$/i, '')); // short name form
    } else if (name) {
      registries.push(name.toLowerCase());
      registries.push(`${name.toLowerCase()}.azurecr.io`);
    }
    target = { kind: 'registry', name, resource_id: resourceId || null, login_server: loginServer || null };
  }
  return { clusters, registries, target };
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Build the full cluster-targets document from a list of resource rows.
 * Pure (no IO) so it is unit-testable.
 */
export function buildClusterTargetsDoc(rows, { engagementId = null, sourceDb = null, now = new Date() } = {}) {
  const clusterSet = new Set();
  const registrySet = new Set();
  const targets = [];
  let resourcesScanned = 0;
  let clusterCount = 0;
  let registryCount = 0;

  for (const row of rows || []) {
    if (!isClusterTargetType(row?.type)) continue;
    resourcesScanned++;
    const { clusters, registries, target } = extractClusterTarget(row);
    for (const c of clusters) if (c) clusterSet.add(c);
    for (const r of registries) if (r) registrySet.add(r);
    if (target) {
      targets.push(target);
      if (target.kind === 'cluster') clusterCount++;
      else if (target.kind === 'registry') registryCount++;
    }
  }

  const clusters = [...clusterSet].sort();
  const registries = [...registrySet].sort();
  const allowlist = { clusters, registries };
  const content_hash = 'sha256:' + sha256(JSON.stringify(allowlist));

  return {
    schema: CLUSTER_TARGETS_SCHEMA,
    engagement_id: engagementId,
    generated_at: now.toISOString(),
    generator: 'tools/cluster/build-cluster-targets.mjs',
    source_db: sourceDb,
    counts: {
      resources_scanned: resourcesScanned,
      clusters: clusterCount,
      registries: registryCount,
      allowlist_clusters: clusters.length,
      allowlist_registries: registries.length,
    },
    allowlist,
    content_hash,
    targets: targets.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    notes: [
      'Clusters/registries are derived ONLY from in-scope AKS and ACR resources in the datastore.',
      'There is no free-form context scraping — a cluster/registry is on the list only because an in-scope Azure resource published it.',
      'The cluster-active lane and the cluster guardrail are scope-locked to this allowlist.',
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
    return resolve(process.cwd(), join(args.session, 'scope', 'cluster-targets.json'));
  }
  if (typeof args.db === 'string') {
    const norm = args.db.replace(/\\/g, '/');
    const m = norm.match(/(.*engagements\/[^/]+)\//);
    if (m) return resolve(process.cwd(), join(m[1], 'scope', 'cluster-targets.json'));
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
    doc = buildClusterTargetsDoc(rows, { engagementId: engagementId || null, sourceDb: args.db });
  } finally {
    db.close();
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');

  const summary = {
    wrote: out,
    engagement_id: doc.engagement_id,
    counts: doc.counts,
    content_hash: doc.content_hash,
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
