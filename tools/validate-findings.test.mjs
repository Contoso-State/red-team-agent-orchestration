#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./validate-findings.mjs', import.meta.url));

function finding(id) {
  return {
    id,
    title: 'Test finding',
    severity: 'Medium',
    confidence: 'High',
    agent: 'network-exposure',
    category: 'network',
    resource_id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Network/networkSecurityGroups/nsg',
    subscription_id: 'sub',
    description: 'Description',
    attack_vector: 'Attack vector',
    recommendation: 'Recommendation',
    evidence: [{ source: 'unit-test', summary: 'Evidence' }],
    status: 'open',
    first_seen: '2026-09-15T00:00:00Z',
  };
}

function run(path) {
  return spawnSync(process.execPath, [SCRIPT, '--findings', path], { encoding: 'utf8' });
}

test('accepts JSONL findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validate-findings-'));
  try {
    const path = join(dir, 'findings.jsonl');
    writeFileSync(path, `${JSON.stringify(finding('AZ-NET-001'))}\n${JSON.stringify(finding('AZ-NET-002'))}\n`);
    assert.equal(run(path).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts an empty JSONL file as zero findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validate-findings-'));
  try {
    const path = join(dir, 'empty.jsonl');
    writeFileSync(path, '');
    assert.equal(run(path).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
