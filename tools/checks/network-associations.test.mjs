import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evalPredicate} from './run-checks.mjs';
const predicate=(pack,id)=>JSON.parse(readFileSync(new URL(`../../checks/${pack}/predicates.json`,import.meta.url))).predicates.find(p=>p.check_id===id).evaluate;
test('ARG empty-string subnet association is missing; special subnets excluded',()=>{
 const p=predicate('network','CHK-NET-SUBNET-NO-NSG');
 assert.equal(evalPredicate(p,{name:'workload',nsgId:''}),true);
 assert.equal(evalPredicate(p,{name:'workload',nsgId:null}),true);
 assert.equal(evalPredicate(p,{name:'workload',nsgId:'/nsg/attached'}),false);
 assert.equal(evalPredicate(p,{name:'GatewaySubnet',nsgId:''}),false);
});
test('orphan IP handles ARG empty strings but preserves NAT gateway association',()=>{
 const p=predicate('easm','CHK-EASM-PUBLIC-IP-UNUSED');
 assert.equal(evalPredicate(p,{ipConfigurationId:'',natGatewayId:''}),true);
 assert.equal(evalPredicate(p,{ipConfigurationId:null,natGatewayId:null}),true);
 assert.equal(evalPredicate(p,{ipConfigurationId:'/nic/ipconfig',natGatewayId:''}),false);
 assert.equal(evalPredicate(p,{ipConfigurationId:'',natGatewayId:'/natgateway'}),false);
});
