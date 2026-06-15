#!/usr/bin/env node
/**
 * ingest.test.mjs — regression checks for datastore findings replacement semantics.
 * Run: node tools/datastore/ingest.test.mjs
 */

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

let pass = 0;
const ok = (v, msg) => { assert.ok(v, msg); pass++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); pass++; };

function run(args, expectedExit = 0) {
  const out = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (out.status !== expectedExit) {
    console.error(`Command failed: node ${args.join(' ')}`);
    if (out.stdout) console.error(out.stdout);
    if (out.stderr) console.error(out.stderr);
  }
  eq(out.status, expectedExit, `exit code for: node ${args.join(' ')}`);
  return out;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function finding(id, dedupeKey, resourceId, title) {
  return {
    id,
    title,
    severity: 'High',
    confidence: 'High',
    dedupe_key: dedupeKey,
    agent: 'network-exposure',
    category: 'network',
    check_id: id,
    subscription_id: '00000000-0000-0000-0000-000000000001',
    resource_id: resourceId,
    description: 'test',
    attack_vector: 'test',
    recommendation: 'test',
    status: 'open',
    first_seen: '2026-06-15T00:00:00.000Z',
    last_seen: '2026-06-15T00:00:00.000Z',
    evidence: [{ source: 'unit-test', summary: 'seeded' }],
    affected_resources: [{ resource_id: resourceId, subscription_id: '00000000-0000-0000-0000-000000000001' }],
  };
}

function exportedFindings(dbPath, outPath) {
  run(['tools/datastore/export.mjs', '--db', dbPath, '--out', outPath]);
  return JSON.parse(readFileSync(outPath, 'utf8'));
}

const temp = mkdtempSync(join(tmpdir(), 'rt-datastore-ingest-test-'));
try {
  const db = join(temp, 'engagement.db');
  const rawDir = join(temp, 'findings', 'raw');
  const emptyRaw = join(temp, 'empty-raw');
  const out = join(temp, 'findings-export.json');
  const oldFile = join(rawDir, 'old.json');
  const newFile = join(rawDir, 'new.json');

  mkdirSync(rawDir, { recursive: true });
  mkdirSync(emptyRaw, { recursive: true });

  writeJson(oldFile, [finding('AZ-NET-001', 'old-fp', '/subscriptions/sub-a/resourceGroups/rg/providers/Microsoft.Network/publicIPAddresses/pip-old', 'Old false positive')]);
  writeJson(newFile, [finding('AZ-NET-002', 'real-1', '/subscriptions/sub-a/resourceGroups/rg/providers/Microsoft.Network/networkSecurityGroups/nsg-new', 'Current finding')]);

  // Default ingest remains additive: both records persist across sequential ingests.
  run(['tools/datastore/ingest.mjs', '--db', db, '--findings', oldFile]);
  run(['tools/datastore/ingest.mjs', '--db', db, '--findings', newFile]);
  let findings = exportedFindings(db, out);
  eq(findings.length, 2, 'default ingest is additive across sequential ingests');
  eq(new Set(findings.map((f) => f.id)), new Set(['AZ-NET-001', 'AZ-NET-002']), 'additive ingest preserves both findings');

  // Replace mode wipes prior findings and reloads only the requested source.
  run(['tools/datastore/ingest.mjs', '--db', db, '--findings', newFile, '--replace-findings']);
  findings = exportedFindings(db, out);
  eq(findings.length, 1, 'replace mode removes stale prior findings');
  eq(findings[0].id, 'AZ-NET-002', 'replace mode keeps only current findings input');

  // Replace mode with an empty findings directory is a valid zero-findings snapshot.
  run(['tools/datastore/ingest.mjs', '--db', db, '--findings', emptyRaw, '--replace-findings']);
  findings = exportedFindings(db, out);
  eq(findings.length, 0, 'replace mode supports explicit zero-findings snapshots');

  // Replace mode must fail loudly when the findings source path is missing.
  const missing = run(
    ['tools/datastore/ingest.mjs', '--db', db, '--findings', join(temp, 'does-not-exist'), '--replace-findings'],
    1
  );
  ok((missing.stderr || '').includes('--replace-findings requires an existing findings file or directory'), 'replace mode emits explicit missing-source error');

  console.log(`OK — ${pass} assertions passed`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
