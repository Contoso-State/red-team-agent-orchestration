/** Inert, environment-isolated workshop memory. Never edits prompts, policy or parameters. */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { retrieveWithAEF } from './aef-bridge.mjs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
const hash = x => createHash('sha256').update(x).digest('hex');
const inside = (base, p) => p.startsWith(base + sep);
const token = x => typeof x === 'string' && /^[a-zA-Z0-9_.:-]{1,180}$/.test(x);
const disabled = () => ['off','0','false','no','disabled'].includes(String(process.env.REDTEAM_SELF_IMPROVE || '').toLowerCase());
export function createWorkshopMemory({root, session, environment, runId, onEvent = () => {}}) {
  root = realpathSync(root); session = realpathSync(resolve(root, session));
  const engagements = realpathSync(join(root, 'engagements'));
  if (dirname(session) !== engagements || !token(runId)) throw Error('Memory requires an engagement session and attributed run ID');
  const tenant = environment.tenantId?.toLowerCase(), subscriptions = [...new Set(environment.subscriptionIds?.map(x => x.toLowerCase()))].sort();
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  if (!uuid.test(tenant || '') || !subscriptions.length || subscriptions.some(x => !uuid.test(x))) throw Error('Memory requires explicit tenant and subscription scope');
  const environmentKey = hash(JSON.stringify({tenant, subscriptions, mode:environment.mode || 'read-only'}));
  const dir = join(session, 'memory', 'methodology');
  const safeDir = () => { for (const p of [join(session,'memory'),dir]) { if (existsSync(p) && !inside(session,realpathSync(p))) throw Error('Memory path escapes engagement'); mkdirSync(p,{recursive:true}); } };
  const file = join(dir, runId + '.json');
  const event = (agent, stage, metrics, refs=[], sourceIds=[runId]) => onEvent({type:'memory.'+stage,agent_id:agent,summary:`Environment-scoped memory ${stage}; evidence verification is not measured improvement.`,evidence_refs:refs,memory:{stage,environment_key:environmentKey,outcome:stage==='verified'?'evidence-integrity-verified':'inert',source_ids:sourceIds},metrics});
  function validEvidence(base, e) { try { if (!e || isAbsolute(e.path) || !/^[a-f0-9]{64}$/.test(e.sha256)) return false; const p=resolve(base,e.path); return inside(base,p)&&inside(base,realpathSync(p))&&hash(readFileSync(p))===e.sha256; } catch {return false;} }
  function history() {
    const out=[];
    for(const ent of readdirSync(engagements,{withFileTypes:true}).filter(x=>x.isDirectory())) {
      const base=join(engagements,ent.name), m=join(base,'memory','methodology');
      if(!existsSync(m)||!inside(realpathSync(base),realpathSync(m))) continue;
      for(const name of readdirSync(m).filter(x=>x.endsWith('.json'))) try {
        const p=join(m,name); if(!inside(realpathSync(base),realpathSync(p)))continue;
        const doc=JSON.parse(readFileSync(p));
        if(doc.version!==1||doc.environmentKey!==environmentKey||!token(doc.runId))continue;
        for(const r of doc.records||[]) if(token(r.agent)&&token(r.checkId)&&/^[a-f0-9]{64}$/.test(r.signature)&&['confirmed','suppressed','coverage-gap'].includes(r.outcome)&&Array.isArray(r.evidence)&&r.evidence.length&&r.evidence.every(e=>validEvidence(base,e))) out.push({agent:r.agent,checkId:r.checkId,signature:r.signature,outcome:r.outcome,evidence:r.evidence.map(e=>({path:e.path,sha256:e.sha256})),runId:doc.runId,sourceSession:relative(root,base)});
      }catch{/* Malformed or unavailable histories are never reusable evidence. */}
    }
    return out;
  }
  function knowledge(records) {
    const buckets=new Map(); for(const r of records){const k=JSON.stringify([r.agent,r.checkId,r.signature,r.outcome]);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(r);}
    return [...buckets.values()].filter(rs=>new Set(rs.map(r=>r.runId)).size>=2).map(rs=>({agent:rs[0].agent,checkId:rs[0].checkId,signature:rs[0].signature,outcome:rs[0].outcome,sourceRunIds:[...new Set(rs.map(r=>r.runId))],status:'corroborated-observation',improvementVerified:false}));
  }
  return {
    environmentKey,
    retrieve(agent) {
      if(!token(agent))throw Error('Invalid agent');
      const records=disabled()?[]:history().filter(r=>r.agent===agent&&r.runId!==runId),lessons=knowledge(records);
      // Keep a local, immutable provenance snapshot so cross-session retrievals
      // are inspectable without expanding the dashboard's file-serving boundary.
      const local=records.filter(r=>resolve(root,r.sourceSession)===session);
      const refs=[...new Set(local.flatMap(r=>['memory/methodology/'+r.runId+'.json',...r.evidence.map(e=>e.path)]))];
      if(records.length) {
        safeDir();
        const audit=JSON.stringify({kind:'retrieval-audit',environmentKey,runId,agent,records,improvementVerified:false},null,2)+'\n';
        const auditFile=join(dir,`${runId}.retrieval-${agent}-${hash(audit)}.json`);
        if(existsSync(auditFile)) {
          if(realpathSync(auditFile)!==auditFile||readFileSync(auditFile,'utf8')!==audit)throw Error('Retrieval audit conflict');
        } else writeFileSync(auditFile,audit,{mode:0o600,flag:'wx'});
        refs.unshift(relative(session,auditFile));
      }
      const sourceIds=[...new Set(records.map(r=>r.runId))];
      event(agent,'retrieved',{records:records.length,promoted:lessons.length},refs,sourceIds);
      if(records.length)event(agent,'verified',{records:records.length,evidenceFiles:records.reduce((n,r)=>n+r.evidence.length,0)},refs,sourceIds);
      return {environmentKey,records,knowledge:lessons,improvementVerified:false};
    },
    recordDebrief({agent,observations}) {
      if(disabled())return {disabled:true,candidateCount:0,promotedCount:0,improvementVerified:false};
      if(!token(agent)||!Array.isArray(observations))throw Error('Invalid debrief attribution');
      const records=observations.map(o=>{if(!token(o.checkId)||!token(o.signature)||!['confirmed','suppressed','coverage-gap'].includes(o.outcome)||!Array.isArray(o.evidence)||!o.evidence.length||!o.evidence.every(e=>validEvidence(session,e)))throw Error('Debrief requires verified local evidence and inert bounded fields');return {agent,checkId:o.checkId,signature:hash(o.signature),outcome:o.outcome,evidence:o.evidence.map(e=>({path:e.path,sha256:e.sha256}))};});
      safeDir();if(existsSync(file)&&!inside(session,realpathSync(file)))throw Error('Memory file escapes engagement');
      const prior=existsSync(file)?JSON.parse(readFileSync(file)):null;
      if(prior&&(prior.environmentKey!==environmentKey||prior.runId!==runId))throw Error('Run attribution conflict');
      const merged=[...(prior?.records||[]),...records]; const unique=[...new Map(merged.map(r=>[JSON.stringify([r.agent,r.checkId,r.signature,r.outcome]),r])).values()];
      const before=knowledge(history());writeFileSync(file,JSON.stringify({version:1,environmentKey,runId,records:unique},null,2)+'\n',{mode:0o600});
      event(agent,'verified',{evidenceFiles:records.reduce((n,r)=>n+r.evidence.length,0)},records.flatMap(r=>r.evidence.map(e=>e.path)));event(agent,'candidate',{count:records.length},[relative(session,file)]);
      const after=knowledge(history()),newly=after.filter(x=>!before.some(y=>JSON.stringify([y.agent,y.checkId,y.signature,y.outcome])===JSON.stringify([x.agent,x.checkId,x.signature,x.outcome])));
      if(newly.length)event(agent,'promoted',{count:newly.length},[relative(session,file)]);
      return {candidateCount:records.length,promotedCount:newly.length,knowledge:after.filter(x=>x.agent===agent),improvementVerified:false};
    }
  };
}
export function createLiveMemoryHooks({sessionDir,runId,scope,emit,retrieveAEF=retrieveWithAEF}) {
  const session=realpathSync(sessionDir), root=dirname(dirname(session));
  const store=createWorkshopMemory({root,session,runId,environment:{tenantId:scope.tenantId,subscriptionIds:scope.subscriptionIds||[scope.subscriptionId],mode:scope.mode},onEvent:emit});
  return {
    async load(){
      const agents=['inventory-scope','identity-posture','authorization-attack-path','network-exposure','compute-platform','aks-container','data-protection','web-exposure','ai-foundry','attack-surface','external-vuln','logging-coverage','email-security','governance-posture','devops-supplychain','reporting'];
      if(disabled()) return {
        environmentKey:store.environmentKey,disabled:true,engine:null,sourceCommit:null,
        agents:Object.fromEntries(agents.map(a=>[a,{environmentKey:store.environmentKey,records:[],knowledge:[],context:[],improvementVerified:false}])),
        improvementVerified:false
      };
      const observations=Object.fromEntries(agents.map(a=>[a,store.retrieve(a)]));
      const aef=await retrieveAEF({session,runId,environmentKey:store.environmentKey,agents:observations,emit});
      return {environmentKey:store.environmentKey,engine:aef.engine,sourceCommit:aef.sourceCommit,agents:Object.fromEntries(agents.map(a=>[a,{...observations[a],context:aef.agents[a].context,checkpointRun:aef.agents[a].checkpointRun}])),improvementVerified:false};
    },
    async record(state) {
      if(disabled())return {disabled:true,results:[],improvementVerified:false};
      const results=[], findings=state.confirmed_findings||[], raw=join(session,'findings','raw');
      const judgePaths=state.memory_judge_artifacts || ['findings/judged.jsonl'];
      function matchingEvidence(paths, f) {
        const evidence=[];
        for(const name of paths) try {
          if(isAbsolute(name))continue;
          const p=resolve(session,name);
          if(!inside(session,p)||!inside(session,realpathSync(p)))continue;
          const bytes=readFileSync(p);
          const parsed=name.endsWith('.jsonl')?bytes.toString().trim().split('\n').filter(Boolean).map(JSON.parse):JSON.parse(bytes);
          const rows=Array.isArray(parsed)?parsed:parsed.findings||[];
          if(rows.some(x=>x.id===f.id&&x.agent===f.agent&&x.check_id===f.check_id)) evidence.push({path:relative(session,p),sha256:hash(bytes)});
        }catch{/* Missing/malformed evidence does not attest an outcome. */}
        return evidence;
      }
      const rawPaths=existsSync(raw)?readdirSync(raw).filter(n=>n.endsWith('.jsonl')).map(n=>relative(session,join(raw,n))):[];
      for(const agent of [...new Set(findings.map(f=>f.agent))]) {
        const observations=[];
        for(const f of findings.filter(x=>x.agent===agent)) {
          const source=matchingEvidence(rawPaths,f),judged=matchingEvidence(judgePaths,f);
          if(source.length&&judged.length&&token(f.check_id)) observations.push({checkId:f.check_id,signature:hash(f.dedupe_key||f.finding_class||f.check_id),outcome:'confirmed',evidence:[...source,...judged]});
        }
        if(observations.length)results.push({agent,...store.recordDebrief({agent,observations})});
      }
      return {results,improvementVerified:false};
    }
  };
}
