import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evalPredicate, evaluateEntry } from './run-checks.mjs';
const packs=['storage','database','compute'].flatMap(domain=>JSON.parse(readFileSync(new URL(`../../checks/${domain}/predicates.json`,import.meta.url))).predicates);
const entry=id=>packs.find(p=>p.check_id===id);
const cases=[
 ['CHK-STOR-KV-NO-PURGE-PROTECTION',{enableSoftDelete:true,enablePurgeProtection:null},{enableSoftDelete:true,enablePurgeProtection:false}],
 ['CHK-STOR-NO-INFRA-ENCRYPTION',{requireInfrastructureEncryption:null},{requireInfrastructureEncryption:false}],
 ['CHK-DB-SQL-NO-ENTRA-ADMIN',{hasEntraAdmin:true,azureADOnlyAuthentication:null},{hasEntraAdmin:true,azureADOnlyAuthentication:false}],
 ['CHK-DB-SQL-NO-DEFENDER-VA',{alertPolicyState:'Enabled',vaRecurringScansEnabled:null,vaResultsStoreConfigured:null},{alertPolicyState:'Disabled'}],
 ['CHK-COMP-APPSVC-NO-AUTH',{authEnabled:null,publicNetworkAccess:'Enabled'},{authEnabled:false,publicNetworkAccess:'Enabled'}],
 ['CHK-COMP-VM-NO-DISK-ENCRYPTION',{encryptionAtHost:null,adeEnabled:null,hasUnmanagedDisk:false},{encryptionAtHost:false,adeEnabled:false,hasUnmanagedDisk:false}],
];
for(const [id,unknown,insecure] of cases)test(`${id}: incomplete API evidence does not create a finding; explicit insecure state does`,()=>{
 const p=entry(id);assert.ok(p);
 for(const row of [{},unknown]){assert.equal(evalPredicate(p.evaluate,row),false);assert.equal(evaluateEntry(p,{[id]:[{id:'/test',subscriptionId:'test',...row}]},{},'2026-01-01T00:00:00Z').findings.length,0);}
 assert.equal(evalPredicate(p.evaluate,insecure),true);
});
test('partial observations still prove independent insecure conditions',()=>{
 assert.equal(evalPredicate(entry('CHK-STOR-KV-NO-PURGE-PROTECTION').evaluate,{enableSoftDelete:false}),true);
 assert.equal(evalPredicate(entry('CHK-DB-SQL-NO-ENTRA-ADMIN').evaluate,{hasEntraAdmin:false}),true);
 assert.equal(evalPredicate(entry('CHK-COMP-VM-NO-DISK-ENCRYPTION').evaluate,{hasUnmanagedDisk:true}),true);
 assert.equal(evalPredicate(entry('CHK-COMP-APPSVC-NO-AUTH').evaluate,{authEnabled:false}),false);
});
test('documented shared-key default and deliberate missing-policy checks remain unchanged',()=>{
 assert.equal(evalPredicate(entry('CHK-STOR-SHARED-KEY').evaluate,{allowSharedKeyAccess:null}),true);
 assert.equal(evalPredicate(entry('CHK-STOR-NO-SAS-EXPIRATION-POLICY').evaluate,{sasExpirationPeriod:null}),true);
});

test('VM encryption requires both optional hardening states to be known disabled', () => {
  const predicate = entry('CHK-COMP-VM-NO-DISK-ENCRYPTION').evaluate;
  for (const row of [
    { encryptionAtHost: false, adeEnabled: null },
    { encryptionAtHost: null, adeEnabled: false },
    { encryptionAtHost: true, adeEnabled: false },
    { encryptionAtHost: false, adeEnabled: true },
  ]) assert.equal(evalPredicate(predicate, row), false);
});

test('SQL VA requires explicit disabled evidence for each independent condition', () => {
  const predicate = entry('CHK-DB-SQL-NO-DEFENDER-VA').evaluate;
  for (const row of [
    { vaRecurringScansEnabled: false },
    { vaResultsStoreConfigured: false },
    { alertPolicyState: 'disabled' },
  ]) assert.equal(evalPredicate(predicate, row), true);
  assert.equal(evalPredicate(predicate, { alertPolicyState: 'Unknown' }), false);
});
