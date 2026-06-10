#!/usr/bin/env node
// Unit tests for build-targets.mjs — the Azure-derived external allowlist generator.
// Run: node tools/external/build-targets.test.mjs
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyCandidate, isPublicIpv4, isPublicIpv6, isPublicFqdn,
  extractTargetsFromResource, buildTargetsDoc, isExternallyFacingType, readResourceRows,
} from './build-targets.mjs';
import { initDb } from '../datastore/db.mjs';

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); pass++; };

// --- public vs private IPv4 ---
['20.51.1.2', '4.150.0.1', '52.168.10.1'].forEach((ip) => ok(isPublicIpv4(ip), `public ipv4: ${ip}`));
['10.0.0.4', '172.16.5.9', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '192.0.2.5']
  .forEach((ip) => ok(!isPublicIpv4(ip), `private/reserved ipv4 excluded: ${ip}`));

// --- public vs private IPv6 ---
ok(isPublicIpv6('2603:1030:9:1::1'), 'public ipv6');
['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1'].forEach((ip) => ok(!isPublicIpv6(ip), `private ipv6 excluded: ${ip}`));

// --- public vs private FQDN ---
['app.azurewebsites.net', 'shop.contoso.com', 'api.example.io'].forEach((h) => ok(isPublicFqdn(h), `public fqdn: ${h}`));
[
  'db.privatelink.database.windows.net', // private endpoint
  'host.internal.cloudapp.net',
  'service.cluster.local',
  'foo.local',
  'nodot',
  '*.wildcard.com',
  '10.0.0.4',
].forEach((h) => ok(!isPublicFqdn(h), `non-public fqdn excluded: ${h}`));

// --- classifyCandidate normalizes URLs, ports, paths ---
eq(classifyCandidate('https://app.azurewebsites.net/admin').host, 'app.azurewebsites.net', 'url -> host');
eq(classifyCandidate('https://app.azurewebsites.net/admin').url, 'https://app.azurewebsites.net/admin', 'url retained');
eq(classifyCandidate('app.contoso.com:8443').host, 'app.contoso.com', 'port stripped');
eq(classifyCandidate('shop.contoso.com/cart').host, 'shop.contoso.com', 'bare host+path');
eq(classifyCandidate('20.51.1.2').kind, 'ip', 'ip kind');
eq(classifyCandidate('127.0.0.1'), null, 'loopback -> null');
eq(classifyCandidate('localhost'), null, 'localhost -> null');

// --- per-resource extraction (the core scope-lock) ---
const appService = {
  resource_id: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Web/sites/myapp',
  type: 'Microsoft.Web/sites',
  raw_json: JSON.stringify({ properties: { defaultHostName: 'myapp.azurewebsites.net', hostNames: ['myapp.azurewebsites.net', 'www.contoso.com'] } }),
};
const appTargets = extractTargetsFromResource(appService);
ok(appTargets.some((t) => t.host === 'myapp.azurewebsites.net'), 'app service default host extracted');
ok(appTargets.some((t) => t.host === 'www.contoso.com'), 'app service custom host extracted');
ok(appTargets.every((t) => t.source_resource_id === appService.resource_id), 'every target maps to its source resource');

const publicIp = {
  resource_id: '/subscriptions/s/.../publicIPAddresses/pip1',
  type: 'Microsoft.Network/publicIPAddresses',
  raw_json: JSON.stringify({ properties: { ipAddress: '20.51.1.2', dnsSettings: { fqdn: 'pip1.eastus.cloudapp.azure.com' } } }),
};
const pipTargets = extractTargetsFromResource(publicIp);
ok(pipTargets.some((t) => t.host === '20.51.1.2' && t.kind === 'ip'), 'public IP extracted');
ok(pipTargets.some((t) => t.host === 'pip1.eastus.cloudapp.azure.com'), 'public IP fqdn extracted');

// private IP on a public IP resource (e.g. unassigned) is dropped
const privIp = { resource_id: '/x/pip2', type: 'Microsoft.Network/publicIPAddresses', raw_json: JSON.stringify({ properties: { ipAddress: '10.1.2.3' } }) };
eq(extractTargetsFromResource(privIp).length, 0, 'private IP dropped');

// storage static website endpoint is in, blob/etc public DNS in; private endpoint NOT (different host)
const storage = {
  resource_id: '/x/sa', type: 'Microsoft.Storage/storageAccounts',
  raw_json: JSON.stringify({ properties: { primaryEndpoints: { blob: 'https://sa.blob.core.windows.net/', web: 'https://sa.z1.web.core.windows.net/' } } }),
};
const stTargets = extractTargetsFromResource(storage);
ok(stTargets.some((t) => t.host === 'sa.z1.web.core.windows.net'), 'storage $web endpoint extracted');
ok(stTargets.some((t) => t.host === 'sa.blob.core.windows.net'), 'storage blob endpoint extracted');

// container app with internal ingress is excluded; external included
const internalCA = { resource_id: '/x/ca1', type: 'Microsoft.App/containerApps', raw_json: JSON.stringify({ properties: { configuration: { ingress: { external: false, fqdn: 'ca1.internal.azurecontainerapps.io' } } } }) };
eq(extractTargetsFromResource(internalCA).length, 0, 'internal container app ingress excluded');
const externalCA = { resource_id: '/x/ca2', type: 'Microsoft.App/containerApps', raw_json: JSON.stringify({ properties: { configuration: { ingress: { external: true, fqdn: 'ca2.azurecontainerapps.io' } } } }) };
ok(extractTargetsFromResource(externalCA).some((t) => t.host === 'ca2.azurecontainerapps.io'), 'external container app ingress included');

// non-internet-facing types are never inspected
ok(!isExternallyFacingType('Microsoft.Compute/virtualMachines'), 'VM type not externally facing');
const vm = { resource_id: '/x/vm', type: 'Microsoft.Compute/virtualMachines', raw_json: JSON.stringify({ properties: { osProfile: { computerName: 'secret-internal-host.contoso.com' } } }) };
eq(extractTargetsFromResource(vm).length, 0, 'VM internal hostname never leaks into the allowlist');

// --- buildTargetsDoc dedupes + emits allowlist + content hash ---
const doc = buildTargetsDoc([appService, publicIp, privIp, storage, vm], { engagementId: 'ENG-1' });
eq(doc.schema, 'external-targets/v1', 'schema tag');
ok(doc.allowlist.hosts.includes('myapp.azurewebsites.net'), 'allowlist hosts populated');
ok(doc.allowlist.ips.includes('20.51.1.2'), 'allowlist ips populated');
ok(!doc.allowlist.hosts.includes('secret-internal-host.contoso.com'), 'internal host absent from allowlist');
ok(/^sha256:[0-9a-f]{64}$/.test(doc.content_hash), 'content hash present');
// deterministic: same input -> same hash
eq(buildTargetsDoc([appService, publicIp, privIp, storage, vm], { engagementId: 'ENG-1', now: new Date(0) }).content_hash, doc.content_hash, 'hash is deterministic over allowlist');
// dedupe across two resources publishing the same host
const dup = buildTargetsDoc([appService, { ...appService, resource_id: '/x/app2' }]);
eq(dup.allowlist.hosts.filter((h) => h === 'myapp.azurewebsites.net').length, 1, 'shared host deduped');
ok(dup.targets.find((t) => t.host === 'myapp.azurewebsites.net').sources.length >= 2, 'both source resources recorded');

// --- end-to-end over a real datastore ---
const dir = mkdtempSync(join(tmpdir(), 'eva-targets-'));
const dbPath = join(dir, 'engagement.db');
const db = initDb(dbPath, { engagementId: 'ENG-E2E' });
const ins = db.prepare('INSERT INTO resources (resource_id, name, type, raw_json) VALUES (?,?,?,?)');
ins.run(appService.resource_id, 'myapp', appService.type, appService.raw_json);
ins.run(privIp.resource_id, 'pip2', privIp.type, privIp.raw_json);
ins.run(vm.resource_id, 'vm', vm.type, vm.raw_json);
const rows = readResourceRows(db);
const e2e = buildTargetsDoc(rows, { engagementId: 'ENG-E2E', sourceDb: dbPath });
db.close();
ok(e2e.allowlist.hosts.includes('myapp.azurewebsites.net'), 'e2e: app host on allowlist');
eq(e2e.allowlist.ips.length, 0, 'e2e: private IP not on allowlist');
ok(!e2e.allowlist.hosts.includes('secret-internal-host.contoso.com'), 'e2e: VM internal host excluded');

console.log(`OK — ${pass} build-targets assertions passed`);
