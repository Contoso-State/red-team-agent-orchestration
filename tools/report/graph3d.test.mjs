import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { project3D, isConditionalEdge, GRAPH3D_JS } from './graph3d.mjs';
test('perspective changes size with depth, rotation moves z into x, zoom preserves center',()=>{
  const near=project3D({x:100,y:0,z:-200},0,0,1,1000,500);
  const far=project3D({x:100,y:0,z:200},0,0,1,1000,500);
  assert.ok(near.scale>far.scale);
  assert.ok(near.x>far.x);
  const rotated=project3D({x:0,y:0,z:100},Math.PI/2,0,1,1000,500);
  assert.ok(Math.abs(rotated.x-600)<1e-8);
  assert.deepEqual(project3D({x:0,y:0,z:0},0,0,2,1000,500),{x:500,y:250,depth:0,scale:2});
  assert.ok(Number.isFinite(project3D({x:100,y:0,z:-2000},0,0,2,1000,500).x));
});
test('conditional labels remain visibly distinct without claiming other edges are exploits',()=>{
  for(const label of ['Assumption requiring separate validation','data access remains conditional','UNVERIFIED prerequisite','potential access','not observed exploit'])assert.equal(isConditionalEdge(label),true);
  assert.equal(isConditionalEdge('Exact principalId match in role assignments'),false);
  assert.equal(isConditionalEdge(''),false);
});
test('offline 3D report safely serializes hostile labels and retains semantic no-JS fallback',()=>{
  const dir=mkdtempSync(join(tmpdir(),'graph3d-'));
  try{
    const findings=join(dir,'findings.json'),paths=join(dir,'paths.json'),out=join(dir,'report.html');
    const hostile='</script><img src=x onerror=alert(1)>';
    writeFileSync(findings,'[]');
    writeFileSync(paths,JSON.stringify({paths:[{id:'P',title:'Modeled',nodes:[{id:'a',label:hostile,type:'entry'},{id:'b',label:'Target',type:'target'}],edges:[{from:'a',to:'b',label:'Conditional: '+hostile}]}]}));
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('./generate-report.mjs',import.meta.url)),'--findings',findings,'--attack-paths',paths,'--out',out],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const html=readFileSync(out,'utf8');
    assert.doesNotMatch(html,/<img src=x/);
    const data=JSON.parse(html.match(/<script type="application\/json" id="cg3d-data">(.*?)<\/script>/s)[1]);
    assert.equal(data.nodes[0].label,hostile);
    assert.equal(data.edges[0].conditional,true);
    assert.match(html,/<details class="cg3d-fallback" open>/);
    assert.match(html,/Solid lines do not establish successful exploitation/);
    assert.match(html,/aria-label="Select an attack graph node"/);
    assert.doesNotMatch(html,/<script[^>]+src=/);
    assert.match(html,/connect-src 'none'/);
    // Parse every executable script to catch interpolation/syntax breakage.
    for(const script of html.matchAll(/<script>(.*?)<\/script>/gs))new vm.Script(script[1]);
    vm.runInNewContext(GRAPH3D_JS,{document:{getElementById:()=>null}});
  }finally{rmSync(dir,{recursive:true,force:true});}
});
