#!/usr/bin/env node
/**
 * build-cluster-targets.test.mjs — unit tests for the cluster allowlist builder and the
 * safe-kube-audit analysis passes. Standalone: `node build-cluster-targets.test.mjs`
 * (also runs under `node --test`).
 */

import assert from 'node:assert/strict';
import {
  buildClusterTargetsDoc,
  extractClusterTarget,
  isClusterTargetType,
  CLUSTER_TARGETS_SCHEMA,
} from './build-cluster-targets.mjs';
import {
  analyzeClusterAdminBindings,
  analyzePrivilegedPods,
  analyzeNamespacePsa,
} from './safe-kube-audit.mjs';

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }
function eq(a, b, msg) { assert.deepEqual(a, b, msg); passed++; }

// --- type predicate ---------------------------------------------------------------------
ok(isClusterTargetType('Microsoft.ContainerService/managedClusters'), 'AKS type recognized (case-insensitive)');
ok(isClusterTargetType('microsoft.containerregistry/registries'), 'ACR type recognized');
ok(!isClusterTargetType('microsoft.storage/storageaccounts'), 'unrelated type rejected');
ok(!isClusterTargetType(undefined), 'undefined type rejected');

// --- AKS extraction ---------------------------------------------------------------------
{
  const row = {
    name: 'Prod-AKS',
    resource_id: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/Prod-AKS',
    type: 'Microsoft.ContainerService/managedClusters',
    raw_json: JSON.stringify({ properties: { fqdn: 'prod-aks-abc.hcp.eastus.azmk8s.io' } }),
  };
  const { clusters, registries, target } = extractClusterTarget(row);
  ok(clusters.includes('prod-aks'), 'cluster short name lowercased');
  ok(clusters.some((c) => c.includes('/managedclusters/prod-aks')), 'cluster resource id included + lowercased');
  eq(registries, [], 'AKS row yields no registries');
  eq(target.kind, 'cluster', 'target kind cluster');
  eq(target.fqdn, 'prod-aks-abc.hcp.eastus.azmk8s.io', 'fqdn captured');
}

// --- ACR extraction (loginServer + short form) ------------------------------------------
{
  const row = {
    name: 'contosoreg',
    resource_id: '/subscriptions/s/.../registries/contosoreg',
    type: 'microsoft.containerregistry/registries',
    raw_json: JSON.stringify({ properties: { loginServer: 'ContosoReg.azurecr.io' } }),
  };
  const { clusters, registries, target } = extractClusterTarget(row);
  eq(clusters, [], 'ACR row yields no clusters');
  ok(registries.includes('contosoreg.azurecr.io'), 'login server lowercased');
  ok(registries.includes('contosoreg'), 'short registry name derived');
  eq(target.kind, 'registry', 'target kind registry');
  eq(target.login_server, 'contosoreg.azurecr.io', 'login server captured');
}

// --- ACR fallback when loginServer absent -----------------------------------------------
{
  const row = { name: 'fallbackreg', type: 'microsoft.containerregistry/registries', raw_json: '{}' };
  const { registries } = extractClusterTarget(row);
  ok(registries.includes('fallbackreg'), 'fallback short name');
  ok(registries.includes('fallbackreg.azurecr.io'), 'fallback fqdn derived');
}

// --- full doc build ---------------------------------------------------------------------
{
  const rows = [
    { name: 'aks1', resource_id: '/.../managedClusters/aks1', type: 'microsoft.containerservice/managedclusters', raw_json: '{}' },
    { name: 'reg1', type: 'microsoft.containerregistry/registries', raw_json: JSON.stringify({ properties: { loginServer: 'reg1.azurecr.io' } }) },
    { name: 'ignore', type: 'microsoft.storage/storageaccounts', raw_json: '{}' },
  ];
  const doc = buildClusterTargetsDoc(rows, { engagementId: 'ENG-1', sourceDb: 'x.db', now: new Date('2025-01-01T00:00:00Z') });
  eq(doc.schema, CLUSTER_TARGETS_SCHEMA, 'schema tag');
  eq(doc.engagement_id, 'ENG-1', 'engagement id passthrough');
  eq(doc.counts.resources_scanned, 2, 'storage account skipped');
  eq(doc.counts.clusters, 1, 'one cluster');
  eq(doc.counts.registries, 1, 'one registry');
  ok(doc.allowlist.clusters.includes('aks1'), 'cluster on allowlist');
  ok(doc.allowlist.registries.includes('reg1.azurecr.io'), 'registry on allowlist');
  ok(/^sha256:[0-9a-f]{64}$/.test(doc.content_hash), 'content hash present');
  // determinism: same input -> same hash
  const doc2 = buildClusterTargetsDoc(rows, { engagementId: 'ENG-1', sourceDb: 'x.db' });
  eq(doc.content_hash, doc2.content_hash, 'content hash is deterministic');
}

// --- empty input ------------------------------------------------------------------------
{
  const doc = buildClusterTargetsDoc([], {});
  eq(doc.allowlist.clusters.length, 0, 'no clusters');
  eq(doc.allowlist.registries.length, 0, 'no registries');
  ok(doc.content_hash.startsWith('sha256:'), 'still hashes empty allowlist');
}

// --- safe-kube-audit: cluster-admin binding analysis ------------------------------------
{
  const crb = {
    items: [
      { metadata: { name: 'sys' }, roleRef: { name: 'cluster-admin' }, subjects: [{ kind: 'Group', name: 'system:masters' }] },
      { metadata: { name: 'dev' }, roleRef: { name: 'cluster-admin' }, subjects: [{ kind: 'User', name: 'dev@contoso.com' }] },
      { metadata: { name: 'all' }, roleRef: { name: 'cluster-admin' }, subjects: [{ kind: 'Group', name: 'system:authenticated' }] },
      { metadata: { name: 'view' }, roleRef: { name: 'view' }, subjects: [{ kind: 'User', name: 'reader' }] },
    ],
  };
  const f = analyzeClusterAdminBindings(crb);
  eq(f.length, 2, 'system:masters ignored, dev-user + everyone flagged');
  ok(f.some((x) => x.severity === 'Critical' && /everyone/.test(x.title)), 'everyone binding is Critical');
  ok(f.some((x) => x.severity === 'High' && /dev@contoso.com/.test(x.title)), 'named user is High');
  ok(f.every((x) => x.id.startsWith('AZ-CNTR-')), 'finding id prefix');
}

// --- safe-kube-audit: privileged pod analysis -------------------------------------------
{
  const pods = {
    items: [
      { metadata: { name: 'kp', namespace: 'kube-system' }, spec: { hostNetwork: true } },
      { metadata: { name: 'bad', namespace: 'app' }, spec: { containers: [{ name: 'c', securityContext: { privileged: true } }] } },
      { metadata: { name: 'host', namespace: 'app' }, spec: { hostPID: true, volumes: [{ name: 'v', hostPath: { path: '/' } }], containers: [] } },
      { metadata: { name: 'ok', namespace: 'app' }, spec: { containers: [{ name: 'c', securityContext: { runAsNonRoot: true } }] } },
    ],
  };
  const f = analyzePrivilegedPods(pods);
  eq(f.length, 2, 'system ns skipped, benign pod skipped, 2 flagged');
  ok(f.some((x) => x.evidence.reasons.some((r) => /privileged/.test(r))), 'privileged container detected');
  ok(f.some((x) => x.evidence.reasons.includes('hostPID')), 'hostPID detected');
}

// --- safe-kube-audit: namespace PSA analysis --------------------------------------------
{
  const ns = {
    items: [
      { metadata: { name: 'kube-system' } },
      { metadata: { name: 'app', labels: { 'pod-security.kubernetes.io/enforce': 'restricted' } } },
      { metadata: { name: 'legacy', labels: {} } },
    ],
  };
  const f = analyzeNamespacePsa(ns);
  eq(f.length, 1, 'only legacy ns lacks enforced PSA');
  eq(f[0].namespace, 'legacy', 'legacy ns flagged');
}

console.log(`OK — ${passed} assertions passed`);
