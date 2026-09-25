import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('./generate-report.mjs', import.meta.url));
test('coverage distinguishes inventory from assessment and escapes untrusted notes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'report-coverage-'));
  try {
    const findings = join(dir, 'findings.json'), inventory = join(dir, 'inventory.json'), coverage = join(dir, 'coverage.json'), out = join(dir, 'report.html');
    writeFileSync(findings, '[]');
    writeFileSync(inventory, JSON.stringify([{ type: 'example/resource', count: 371 }]));
    writeFileSync(coverage, JSON.stringify({counts: {assessed: 7, partial: 2, unavailable: 3, not_applicable: 4}, notes: ['<script>alert("x")</script>']}));
    const args = [cli, '--findings', findings, '--inventory-summary', inventory, '--coverage-summary', coverage, '--out', out];
    assert.equal(spawnSync(process.execPath, args, {encoding:'utf8'}).status, 0);
    const html = readFileSync(out,'utf8');
    assert.match(html, /Resources inventoried/);
    assert.doesNotMatch(html, /Resources assessed/);
    assert.match(html, /assessed: 7 · partial: 2 · unavailable: 3 · not applicable: 4/);
    assert.match(html, /coverage gaps, not passes/);
    assert.match(html, /&lt;script&gt;alert/);
    assert.doesNotMatch(html, /<script>alert/);
    writeFileSync(coverage, JSON.stringify({counts:{assessed:-1},notes:[]}));
    assert.notEqual(spawnSync(process.execPath,args,{encoding:'utf8'}).status,0);
    assert.equal(spawnSync(process.execPath,[cli,'--findings',findings,'--out',out],{encoding:'utf8'}).status,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
