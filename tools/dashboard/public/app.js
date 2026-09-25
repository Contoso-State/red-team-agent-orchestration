import {resolveNode} from './node-resolver.mjs';
import {summarizeModelUsage} from './model-usage-summary.mjs';
const usageLabels = {input_tokens:'Input tokens',output_tokens:'Output tokens',cache_read_input_tokens:'Cache read tokens',cache_creation_input_tokens:'Cache write tokens',cost_usd:'Estimated cost (USD)'};
const $ = id => document.getElementById(id);
const COLORS = { orchestration: '#67e6dd', agent: '#b5a3ff', memory: '#b6eb9c', evolution: '#ffc280', failed: '#ff878c', idle: '#536274' };
const shortNames = { validate_scope:'Scope gate', memory_load:'Memory retrieval', preflight_inventory:'Inventory',build_security_context:'Security context', plan_specialists:'Dispatch', run_specialist:'Specialists', collect_raw:'Reduce', evaluate:'Evaluate', judge:'Evidence judge', authorize_active:'Authorization', eva_active:'External lane', cluster_active:'Cluster lane', correlate:'Attack paths', report:'Reporting', reflexion_debrief:'Memory debrief' };
const state = { packets: [], runSelection: '', timelineLimit: 100, memoryLimit: 100, events: [], topology: null, selected: '', replay: false, replayEvents: [], replayPosition: 0, replayTimer: null, filter: 'all', connected: false, logState: 'waiting', flashes: [], nodes: [], edges: [], yaw: -.18, pitch: .4, zoom: 1, latestRun: '', initial: true };
const canvas = $('graph'), ctx = canvas.getContext('2d');
let width = 600, height = 400, frame = null, projected = [], dragging = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const time = ts => new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
const label = value => shortNames[value] || String(value || '').replace(/^Red Team /, '').replaceAll('_',' ');
const currentEvents = () => state.replay ? state.replayEvents.slice(0, state.replayPosition) : state.events;
const currentRun = () => state.runSelection || [...currentEvents()].reverse().find(e => e.run_id)?.run_id;
const runEvents = () => { const run = currentRun(); return currentEvents().filter(e => !run || e.run_id === run); };

function matchNode(value) { return resolveNode(state.nodes,value); }
function eventNode(event) { return matchNode(event.node_id) || matchNode(event.agent_id); }
function eventsFor(node, events = runEvents()) { return events.filter(e => eventNode(e)?.id === node?.id || matchNode(e.from_agent)?.id===node?.id || matchNode(e.to_agent)?.id===node?.id); }
function selectedEvents() { const node=state.nodes.find(n=>n.id===state.selected); return node?eventsFor(node):runEvents(); }
function animateEvent(event) {
  if(event.run_id!==currentRun())return;
  const at=performance.now(),node=eventNode(event);
  if(node)state.flashes.push({id:node.id,at});
  const from=matchNode(event.from_agent),to=matchNode(event.to_agent);
  if(from&&to&&event.transfer)state.packets.push({from:from.id,to:to.id,at,bytes:event.transfer.bytes,kind:event.transfer.kind});
}
function nodeStatus(node) {
  if (runEvents().some(e => ['memory-review','code-evolution'].includes(e.run_kind))) {
    return eventsFor(node).length ? 'observed' : 'unobserved';
  }
  const events = eventsFor(node), last = [...events].reverse().find(e => /\.(started|completed|failed)$/.test(e.type) && !e.type.startsWith('tool.'));
  if (!last) return events.length ? 'observed' : 'unobserved';
  if (last.type.endsWith('.failed')) return 'failed';
  if (last.type.endsWith('.completed')) return 'completed';
  // A terminal run must not leave stale started badges as current work.
  const terminal = [...runEvents()].reverse().find(e => e.type.startsWith('run.'));
  if (terminal && ['run.completed','run.failed'].includes(terminal.type)) return 'incomplete';
  return 'running';
}

function buildTopology(topology) {
  state.topology = topology;
  // Coordinates are a 3-D arrangement of canonical topology, not execution data.
  const core = topology.nodes;
  state.nodes = core.map((n,i) => ({ ...n, type:n.kind.startsWith('memory') ? 'memory' : 'orchestration', x:-250 + (i/(core.length-1))*500, y:-65+Math.sin(i*.85)*45, z:-65+Math.cos(i*.85)*40 }));
  topology.roster.forEach((n,i) => { const a = (i/topology.roster.length)*Math.PI*2; state.nodes.push({ ...n, id:n.domain, type:'agent', x:Math.cos(a)*220, y:80+Math.sin(a)*35, z:Math.sin(a)*155 }); });
  const auxiliary=[['aef_consolidate','AEF consolidate','memory'],['aef_retrieve','AEF retrieve','memory'],['aef_reflect','AEF reflect','memory'],['evolution_propose','Propose code','evolution'],['evolution_evaluate','Test candidate','evolution'],['evolution_apply','Accept or reject','evolution']];
  auxiliary.forEach(([id,title,type],i)=>{shortNames[id]=title;state.nodes.push({id,kind:'runtime-extension',type,x:-260+i*105,y:-165,z:65});});
  state.edges = topology.edges.filter(e => state.nodes.some(n=>n.id===e.from) && state.nodes.some(n=>n.id===e.to)).map(e=>({...e,type:'flow'}));
  for(const n of topology.roster) state.edges.push({ from:'plan_specialists',to:n.domain,type:'dispatch' },{ from:n.domain,to:'collect_raw',type:'reduce' });
  state.edges.push({ from:'memory_load',to:'plan_specialists',type:'memory' },{ from:'reflexion_debrief',to:'memory_load',type:'memory' });
  state.edges.push({from:'memory_load',to:'aef_consolidate',type:'memory'},{from:'aef_consolidate',to:'aef_retrieve',type:'memory'},{from:'aef_retrieve',to:'aef_reflect',type:'memory'},{from:'evolution_propose',to:'evolution_evaluate',type:'extension'},{from:'evolution_evaluate',to:'evolution_apply',type:'extension'});
  $('agent-select').replaceChildren(el('option','All agents'));
  $('agent-select').firstChild.value='';
  for (const node of state.nodes) { const option = el('option',label(node.agent || node.id)); option.value=node.id; $('agent-select').append(option); }
  scheduleDraw();
}

function draw() {
  frame=null; ctx.clearRect(0,0,width,height);
  const scale=Math.min(width/720,height/420)*state.zoom;
  function project(p) { const x=p.x*Math.cos(state.yaw)+p.z*Math.sin(state.yaw), z=-p.x*Math.sin(state.yaw)+p.z*Math.cos(state.yaw), y=p.y*Math.cos(state.pitch)-z*Math.sin(state.pitch), depth=p.y*Math.sin(state.pitch)+z*Math.cos(state.pitch); const perspective=850/(850+depth); return {x:width/2+x*scale*perspective,y:height/2+y*scale*perspective-8,z:depth,s:perspective}; }
  // Static depth grid reinforces the spatial view; it never implies activity.
  ctx.lineWidth=.6; ctx.strokeStyle='#526a8021';
  for(let x=-340;x<=340;x+=40){const a=project({x,y:135,z:-240}),b=project({x,y:135,z:240});ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  for(let z=-240;z<=240;z+=40){const a=project({x:-340,y:135,z}),b=project({x:340,y:135,z});ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  projected=state.nodes.map(n=>({...n,...project(n)}));
  const positions=new Map(projected.map(n=>[n.id,n]));
  const statuses=new Map(projected.map(n=>[n.id,nodeStatus(n)]));
  for(const edge of state.edges){const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)continue; const selected=state.selected && (a.id===state.selected||b.id===state.selected);ctx.strokeStyle=selected?'#67e6dd66':edge.type==='memory'?'#b6eb9c28':'#7891ac20';ctx.lineWidth=selected?1.1:.7;ctx.setLineDash(edge.type==='memory'?[3,5]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}ctx.setLineDash([]);
  // Handoff edges exist only when a real event explicitly names both peers.
  const handoffs=runEvents().filter(e=>e.from_agent&&e.to_agent).slice(-30);
  for(const event of handoffs){const from=matchNode(event.from_agent),to=matchNode(event.to_agent),a=positions.get(from?.id),b=positions.get(to?.id);if(!a||!b)continue;ctx.strokeStyle='#67e6dd75';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();const t=.6,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,angle=Math.atan2(b.y-a.y,b.x-a.x);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.cos(angle-.5)*6,y-Math.sin(angle-.5)*6);ctx.lineTo(x-Math.cos(angle+.5)*6,y-Math.sin(angle+.5)*6);ctx.closePath();ctx.fillStyle='#67e6dd';ctx.fill();}
  const now=performance.now();state.packets=state.packets.filter(p=>now-p.at<2400);
  canvas.dataset.packetCount=String(state.packets.length);
  $('packet-status').textContent=state.packets.length?`${state.packets.length} ${state.replay?'recorded exchanges replaying':'exchanges arriving'} · sizes in agent lens`:'Packets appear on recorded exchanges · idle between events';
  for(const packet of state.packets){const a=positions.get(packet.from),b=positions.get(packet.to);if(!a||!b)continue;const t=reducedMotion?.5:(now-packet.at)/2400, color=packet.kind==='code-candidate'?COLORS.evolution:packet.kind.startsWith('memory')?COLORS.memory:COLORS.orchestration;ctx.strokeStyle=color+'88';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=12;ctx.beginPath();ctx.arc(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,4.5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
  state.flashes=state.flashes.filter(f=>now-f.at<1300);
  for(const node of [...projected].sort((a,b)=>b.z-a.z)){
    const status=statuses.get(node.id),selected=node.id===state.selected,observed=status!=='unobserved';const color=status==='failed'?COLORS.failed:COLORS[node.type]; const radius=(node.type==='agent'?5:6.5)*node.s;
    ctx.globalAlpha=selected?1:observed?.95:.48;
    if(selected||observed){const glow=ctx.createRadialGradient(node.x,node.y,0,node.x,node.y,radius*4);glow.addColorStop(0,color+'32');glow.addColorStop(1,color+'00');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(node.x,node.y,radius*4,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle=observed?color:'#162331';ctx.strokeStyle=color;ctx.lineWidth=selected?2:1;ctx.beginPath();ctx.arc(node.x,node.y,radius,0,Math.PI*2);ctx.fill();ctx.stroke();
    if(selected){ctx.strokeStyle=color+'80';ctx.lineWidth=1;ctx.beginPath();ctx.arc(node.x,node.y,radius+5,0,Math.PI*2);ctx.stroke();}
    const flash=state.flashes.find(f=>f.id===node.id);if(flash&&!reducedMotion){const progress=(now-flash.at)/1300;ctx.strokeStyle=color;ctx.globalAlpha=1-progress;ctx.beginPath();ctx.arc(node.x,node.y,radius+progress*25,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}
  }
  // Place labels in screen space after projecting the nodes. Priority goes to
  // the selected node and observed work; the agent selector always lists all nodes.
  const labelBoxes=[];
  const labelNodes=[...projected].sort((a,b)=>(b.id===state.selected)-(a.id===state.selected)||(statuses.get(b.id)!=='unobserved')-(statuses.get(a.id)!=='unobserved'));
  for(const node of labelNodes){
    const selected=node.id===state.selected,observed=statuses.get(node.id)!=='unobserved',text=label(node.domain||node.id);
    ctx.font=`${selected?'600':'400'} 12px system-ui`;ctx.textAlign='center';
    const w=ctx.measureText(text).width+8,h=18;
    const candidates=[22,-20,40,-38,58,-56].map(offset=>({x:Math.max(w/2+4,Math.min(width-w/2-4,node.x)),y:node.y+offset}));
    const position=candidates.find(p=>{
      const box={left:p.x-w/2,right:p.x+w/2,top:p.y-h/2,bottom:p.y+h/2};
      return box.top>4&&box.bottom<height-4&&!labelBoxes.some(b=>box.left<b.right+3&&box.right>b.left-3&&box.top<b.bottom+3&&box.bottom>b.top-3)&&!projected.some(n=>n.x+8>box.left&&n.x-8<box.right&&n.y+8>box.top&&n.y-8<box.bottom);
    });
    if(!position)continue;
    const {x,y}=position;labelBoxes.push({left:x-w/2,right:x+w/2,top:y-h/2,bottom:y+h/2});
    if(Math.abs(y-node.y)>25){ctx.globalAlpha=.5;ctx.strokeStyle=COLORS[node.type];ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(node.x,node.y);ctx.lineTo(x,y+(y>node.y?-9:9));ctx.stroke();}
    ctx.globalAlpha=.88;ctx.fillStyle='#101823';ctx.fillRect(x-w/2,y-h/2,w,h);
    ctx.globalAlpha=selected?1:observed?.95:.7;ctx.fillStyle=selected?'#ffffff':'#bccddd';ctx.fillText(text,x,y+4);
  }
  ctx.globalAlpha=1;if(state.packets.length || (state.flashes.length&&!reducedMotion))scheduleDraw();
}
function scheduleDraw(){if(frame===null)frame=requestAnimationFrame(draw);}
function resize(){const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);width=rect.width;height=rect.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);scheduleDraw();}
new ResizeObserver(resize).observe(canvas);
canvas.addEventListener('pointerdown',e=>{dragging={x:e.clientX,y:e.clientY,moved:0};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-dragging.x,dy=e.clientY-dragging.y;dragging.moved+=Math.abs(dx)+Math.abs(dy);state.yaw+=dx*.006;state.pitch=Math.max(-1,Math.min(1.15,state.pitch+dy*.005));dragging.x=e.clientX;dragging.y=e.clientY;scheduleDraw();});
canvas.addEventListener('pointerup',e=>{if(dragging&&dragging.moved<5){const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;const node=[...projected].reverse().find(n=>Math.hypot(n.x-x,n.y-y)<16);selectAgent(node?.id||'');}dragging=null;});
canvas.addEventListener('pointercancel',()=>{dragging=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();state.zoom=Math.max(.55,Math.min(1.75,state.zoom-e.deltaY*.001));scheduleDraw();},{passive:false});
canvas.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')state.yaw-=.1;else if(e.key==='ArrowRight')state.yaw+=.1;else if(e.key==='ArrowUp')state.pitch=Math.max(-1,state.pitch-.1);else if(e.key==='ArrowDown')state.pitch=Math.min(1.15,state.pitch+.1);else return;e.preventDefault();scheduleDraw();});
$('reset-view').addEventListener('click',()=>{state.yaw=-.18;state.pitch=.4;state.zoom=1;scheduleDraw();});
function selectAgent(id){state.selected=id;$('agent-select').value=id;render();}
$('agent-select').addEventListener('change',e=>selectAgent(e.target.value));
$('event-filter').addEventListener('change',e=>{state.filter=e.target.value;renderTimeline();});

function render(){
  const events=selectedEvents(),run=runEvents(),last=run.at(-1),terminal=[...run].reverse().find(e=>e.type.startsWith('run.')),mode=run.find(e=>e.mode)?.mode;
  renderRunOptions();
  const evolution=run.some(e=>e.run_kind==='code-evolution');
  const memoryReview=run.some(e=>e.run_kind==='memory-review');
  $('session-subtitle').textContent=evolution?'Bounded local code evolution; fixed routing tests, no model training':memoryReview?'Local evidence verification; no Azure or model calls':'One team. Every handoff. Evidence behind every outcome.';
  const badge=$('mode-badge');badge.className='badge';
  if(state.replay){badge.textContent='HISTORY REPLAY';badge.classList.add('replay');}
  else if(evolution){badge.textContent=terminal?.type==='run.completed'?'CODE EVOLUTION COMPLETE':terminal?.type==='run.failed'?'CODE EVOLUTION FAILED':'CODE EVOLUTION RUNNING';badge.classList.add(terminal?.type==='run.failed'?'failed':'neutral');}
  else if(memoryReview){badge.textContent=terminal?.type==='run.completed'?'MEMORY REVIEW COMPLETE':terminal?.type==='run.failed'?'MEMORY REVIEW FAILED':'LOCAL MEMORY REVIEW';badge.classList.add(terminal?.type==='run.failed'?'failed':terminal?.type==='run.completed'?'completed':'neutral');}
  else if(mode==='dry-run'){badge.textContent='DRY RUN · RECORDED';badge.classList.add('neutral');}
  else if(terminal?.type==='run.failed'){badge.textContent='RUN FAILED';badge.classList.add('failed');}
  else if(terminal?.type==='run.completed'){badge.textContent='RUN COMPLETE · IDLE';badge.classList.add('completed');}
  else if(terminal?.type==='run.started'){badge.textContent=mode==='live'?'LIVE RUN · LAST REPORTED':'RECORDED RUN · LAST REPORTED';badge.classList.add('live');}
  else{badge.textContent=events.length?'RECORDED EVENTS · IDLE':'WAITING FOR EVENTS';badge.classList.add('neutral');}
  $('last-event').textContent=last?`Last event ${time(last.ts)}`:'No activity recorded';
  $('stat-events').textContent=events.length;
  $('stat-running').textContent=state.nodes.filter(n=>nodeStatus(n)==='running').length;
  $('stat-complete').textContent=memoryReview?0:new Set(run.filter(e=>e.type==='agent.completed').map(e=>e.agent_id||e.node_id)).size;
  const memoryCounts={retrieved:0,candidate:0,promoted:0,measured:0,verified:0};
  for(const event of events.filter(e=>e.type.startsWith('memory.'))){const stage=event.type.split('.')[1];if(stage in memoryCounts)memoryCounts[stage]+=event.metrics?.[stage==='retrieved'?'records':stage==='verified'?'evidenceFiles':'count'] ?? 1;}
  for(const key of ['retrieved','candidate','promoted','measured'])$(`memory-${key}`).textContent=memoryCounts[key];
  $('stat-promoted').textContent=memoryCounts.promoted;
  $('memory-verification').textContent=`${memoryCounts.verified} evidence references checked · verification does not measure improvement`;
  $('graph-empty').hidden=events.length>0;
  $('graph-status').textContent=state.replay?'Recorded history playback':last?`Latest ${time(last.ts)} · no synthetic activity`:'No recorded activity';
  $('replay').disabled=state.events.length===0||state.replay;$('live').hidden=!state.replay;$('replay-bar').hidden=!state.replay;
  $('replay-position').max=state.replayEvents.length;$('replay-position').value=state.replayPosition;$('replay-count').textContent=`${state.replayPosition} / ${state.replayEvents.length}`;
  renderInspector();renderTimeline();renderMemory();renderUsage();renderEvaluation();renderEvolution();scheduleDraw();
}
function usageValue(field,value){return value===null||value===undefined?'Unavailable':field==='cost_usd'?`$${value.toLocaleString(undefined,{minimumFractionDigits:4,maximumFractionDigits:6})}`:value.toLocaleString();}
function renderUsage(){
  const summary=summarizeModelUsage(selectedEvents()),cards=$('usage-cards');cards.replaceChildren();
  $('usage-count').textContent=`${summary.invocations} model exchanges · ${summary.usageRecords} usage records in this selection`;
  for(const [field,metric] of Object.entries(summary.fields)){
    const card=el('article');card.append(el('h3',usageLabels[field]),el('strong',usageValue(field,metric.value)),el('p',`${metric.reported} / ${summary.invocations} exchanges reported`));cards.append(card);
  }
  const missing=summary.invocations-summary.usableRecords;
  $('usage-gaps').textContent=(summary.invocations===0?'No correlated model calls recorded in this selection.':`${missing} ${missing===1?'exchange has':'exchanges have'} no reported usage values.`)+`${summary.conflicts?` ${summary.conflicts} conflicting exchanges excluded.`:''}${summary.uncorrelated?` ${summary.uncorrelated} uncorrelated events excluded.`:''}`;
}
function addDetail(list,title,value){list.append(el('dt',title),el('dd',value));}
function recordDetails(event) {
  const details=el('details',undefined,'record-details');
  details.append(el('summary','Inspect provenance and recorded data'));
  const data=el('dl');
  addDetail(data,'Recorded at',new Date(event.ts).toISOString());
  addDetail(data,'Event',`${event.type} · ${event.id}`);
  if(event.run_id)addDetail(data,'Run',event.run_id);
  if(event.task_id)addDetail(data,'Task',event.task_id);
  if(event.exchange_id)addDetail(data,'Exchange',event.exchange_id);
  if(event.from_agent)addDetail(data,'From',label(event.from_agent));
  if(event.to_agent)addDetail(data,'To',label(event.to_agent));
  if(event.transfer){
    if(event.transfer.kind)addDetail(data,'Payload kind',label(event.transfer.kind));
    if(Number.isFinite(event.transfer.bytes))addDetail(data,'Payload size',`${event.transfer.bytes.toLocaleString()} bytes`);
    if(event.transfer.outcome)addDetail(data,'Delivery',label(event.transfer.outcome));
  }
  if(event.evaluation){
    addDetail(data,'Score meaning','Model judgment of evidence sufficiency and finding quality');
    addDetail(data,'Graph decision',label(event.evaluation.route||'unrecorded'));
    addDetail(data,'Learning gain','Unproven · no controlled comparison');
  }
  if(event.memory){
    if(event.memory.outcome)addDetail(data,'Memory state',label(event.memory.outcome));
    if(event.memory.environment_key)addDetail(data,'Environment',event.memory.environment_key);
    if(event.memory.source_ids?.length)addDetail(data,'Source runs',event.memory.source_ids.join(' · '));
  }
  if(event.usage){
    addDetail(data,'Usage source','Native runtime metadata');
    if(event.status)addDetail(data,'Invocation outcome',label(event.status));
    for(const [field,title] of Object.entries(usageLabels))addDetail(data,title,usageValue(field,event.usage[field]));
    addDetail(data,'Models',event.usage.models?.join(' · ')||'Unavailable');
    addDetail(data,'Cost meaning','Runtime estimate; not a billing statement');
  }
  details.append(data);
  for(const [index,ref] of (event.evidence_refs||[]).entries()){
    const link=el('a',ref);link.href=`/api/evidence?event=${encodeURIComponent(event.cursor)}&index=${index}`;
    link.target='_blank';link.rel='noopener';link.title='Recorded reference metadata';details.append(link);
  }
  if(!event.evidence_refs?.length)details.append(el('small','No evidence references recorded.','record-stamp'));
  return details;
}
function metricChips(event){
  const chips=el('div',undefined,'metric-chips');
  for(const [key,value] of Object.entries(event.metrics||{})){
    const name=key==='promoted'&&(event.type==='memory.retrieved'||event.run_kind==='memory-review')?'previously promoted':
      ['holdout_total','challenge_total'].includes(key)?'known routing cases':key.replaceAll('_',' ');
    chips.append(el('span',`${name}: ${value.toLocaleString()}`,'metric-chip'));
  }
  if(event.transfer&&Number.isFinite(event.transfer.bytes))chips.append(el('span',`${event.transfer.bytes.toLocaleString()} bytes · ${event.transfer.outcome||'recorded'}`,'metric-chip'));
  return chips;
}
function renderInspector(){
  const node=state.nodes.find(n=>n.id===state.selected),events=node?eventsFor(node):runEvents(),last=events.at(-1),status=node?nodeStatus(node):'overview';
  $('agent-name').textContent=node?label(node.agent||node.id):'Team overview';$('agent-state').textContent=status.toUpperCase();$('agent-state').className=`badge ${status}`;
  $('agent-description').textContent=node?`${node.type==='agent'?'Specialist':'Graph node'} · ${label(node.id)}. Status comes from the most recent recorded lifecycle event; it is not a liveness check.`:'Select an agent to inspect task transitions, handoffs, and evidence references. Unobserved nodes have no recorded execution.';
  const details=$('agent-details');details.replaceChildren();addDetail(details,'Events',String(events.length));addDetail(details,'Last recorded',last?new Date(last.ts).toLocaleString():'Not observed');if(last?.task_id)addDetail(details,'Task',last.task_id);if(last?.run_id)addDetail(details,'Run',last.run_id);
  const handoffs=events.filter(e=>e.from_agent||e.to_agent).slice(-20).reverse(),feed=$('handoffs');feed.replaceChildren();
  for(const e of handoffs){const item=el('div',`${label(e.from_agent||'Unspecified')} → ${label(e.to_agent||'Unspecified')}`,'mini-event handoff-record');item.append(el('small',`${new Date(e.ts).toLocaleString()} · ${e.type}${e.task_id?` · ${e.task_id}`:''}`),metricChips(e),recordDetails(e));feed.append(item);}if(!handoffs.length)feed.append(el('div','No communication events recorded.','empty'));
  const evidence=$('evidence');evidence.replaceChildren();const refs=new Map();
  for(const e of [...events].reverse())for(const [index,ref]of e.evidence_refs.entries())if(!refs.has(ref))refs.set(ref,{e,index});
  for(const [ref,{e,index}] of refs){const a=el('a',ref);a.href=`/api/evidence?event=${encodeURIComponent(e.cursor)}&index=${index}`;a.target='_blank';a.rel='noopener';a.title='Open recorded reference metadata; artifact contents are not served';evidence.append(a);}
  if(!refs.size)evidence.append(el('div','No evidence references recorded.','empty'));

}
function renderTimeline(){
  let events=selectedEvents();if(state.filter!=='all')events=events.filter(e=>e.type.startsWith(state.filter+'.')||(state.filter==='message'&&e.from_agent&&e.to_agent));
  const container=$('timeline');container.replaceChildren();
  $('timeline-count').textContent=`${events.length.toLocaleString()} matching records · showing latest ${Math.min(events.length,state.timelineLimit)} · local time; expand for UTC provenance`;
  $('timeline-more').hidden=events.length<=state.timelineLimit;
  for(const e of events.slice(-state.timelineLimit).reverse()){
    const row=el('div',undefined,'timeline-row'),stamp=el('time',time(e.ts));stamp.dateTime=e.ts;stamp.title=new Date(e.ts).toISOString();row.append(stamp,el('span','',`event-dot ${e.type.split('.')[0]} ${e.type.endsWith('failed')?'failed':''}`));
    const text=el('div',undefined,'event-text');text.append(el('strong',e.from_agent&&e.to_agent?`${label(e.from_agent)} → ${label(e.to_agent)}`:label(e.agent_id||e.node_id||'Orchestrator')));
    text.append(el('p',`${e.summary}${e.task_id?` · task ${e.task_id}`:''}`),metricChips(e),recordDetails(e));row.append(text,el('span',e.type,'event-kind'));container.append(row);
  }
  if(!events.length){const empty=el('div',state.events.length?'No matching events.':'Waiting for the first event.','empty large');empty.append(el('small','This view never simulates agent work.'));container.append(empty);}
}
function renderMemory(){
  const all=selectedEvents().filter(e=>e.type.startsWith('memory.')||e.node_id?.startsWith('aef_'));
  const stage=$('memory-filter').value;
  const matching=all.filter(e=>stage==='all'||e.type===`memory.${stage}`);
  const events=matching.slice(-state.memoryLimit).reverse(),container=$('memory-feed');container.replaceChildren();
  $('memory-count').textContent=`${matching.length.toLocaleString()} matching memory records · ${new Set(matching.map(e=>e.run_id).filter(Boolean)).size} runs · showing latest ${events.length}`;
  $('memory-more').hidden=matching.length<=state.memoryLimit;
  for(const event of events){
    const item=el('article',undefined,'mini-event memory-record');
    item.append(el('strong',`${label(event.type.split('.')[1])} · ${label(event.node_id||event.agent_id||'Methodology memory')}`));
    const stamp=el('time',new Date(event.ts).toLocaleString(),'record-stamp');stamp.dateTime=event.ts;stamp.title=new Date(event.ts).toISOString();
    item.append(stamp,metricChips(event));
    if(event.memory?.source_ids?.length)item.append(el('small',`${event.memory.source_ids.length} recorded source runs`,'record-stamp'));
    item.append(recordDetails(event));container.append(item);
  }
  if(!events.length)container.append(el('div',all.length?'No records for this memory stage.':'No memory outcomes recorded.','empty'));
}
$('memory-filter').addEventListener('change',renderMemory);

$('replay').addEventListener('click',()=>{state.runSelection=currentRun();state.replayEvents=state.events.filter(e=>e.run_id===state.runSelection);state.replay=true;state.replayPosition=0;state.flashes=[];state.packets=[];render();clearInterval(state.replayTimer);state.replayTimer=setInterval(()=>{if(state.replayPosition>=state.replayEvents.length){clearInterval(state.replayTimer);return;}const e=state.replayEvents[state.replayPosition++];animateEvent(e);render();},800);});
$('live').addEventListener('click',()=>{state.replay=false;state.runSelection='';clearInterval(state.replayTimer);state.flashes=[];state.packets=[];render();});
$('replay-position').addEventListener('input',e=>{clearInterval(state.replayTimer);state.replayPosition=Number(e.target.value);state.flashes=[];state.packets=[];render();});
const stream=new EventSource('/api/events');
stream.addEventListener('open',()=>{state.connected=true;$('connection').textContent='Stream connected';$('connection').className='connection connected';});
stream.addEventListener('error',()=>{state.connected=false;$('connection').textContent='Disconnected · retrying';$('connection').className='connection offline';});
stream.addEventListener('snapshot',message=>{const data=JSON.parse(message.data);state.events=data.events;state.logState=data.log_state;$('session').textContent=data.session_id;$('retention').textContent=`Latest ${data.retained_limit.toLocaleString()} events retained`;buildTopology(data.topology);health(data);render();});
stream.addEventListener('activity',message=>{const event=JSON.parse(message.data);if(state.events.some(e=>e.cursor===event.cursor))return;state.events.push(event);if(state.events.length>2000)state.events.shift();if(!state.replay)animateEvent(event);render();});
stream.addEventListener('reset',()=>{state.events=[];state.flashes=[];state.packets=[];clearInterval(state.replayTimer);state.replay=false;render();});
stream.addEventListener('health',message=>health(JSON.parse(message.data)));
function renderRunOptions(){
  const runs=[...new Map(state.events.filter(e=>e.run_id).map(e=>[e.run_id,e])).entries()].reverse(), select=$('run-select');
  select.replaceChildren(el('option','Follow latest run'));select.firstChild.value='';
  for(const [id,e] of runs){const option=el('option',`${label(e.run_kind||'assessment')} · ${time(e.ts)} · ${id.slice(0,8)}`);option.value=id;select.append(option);} select.value=state.runSelection;
}
function renderEvaluation(){
  const events=selectedEvents().filter(e=>e.type==='evaluation.completed'),container=$('evaluation-feed');container.replaceChildren();
  for(const event of events){
    const row=el('article',undefined,'mini-event');
    row.append(el('strong',`Round ${event.metrics.revision??'?'} · model score ${event.metrics.quality??'?'} / 1 · ${label(event.evaluation?.route||'decision unrecorded')}`));
    row.append(el('small',`${new Date(event.ts).toLocaleString()} · ${event.metrics.candidates??'?'} candidates reviewed`,'record-stamp'),recordDetails(event));container.append(row);
  }
  $('evaluation-count').textContent=`${events.length} evaluation rounds in this selection`;
  if(!events.length)container.append(el('p','No evaluator scores recorded in this selection. A local memory review does not evaluate Azure finding quality.','empty'));
}
function renderEvolution(){
  const events=selectedEvents().filter(e=>e.type.startsWith('evolution.')),container=$('evolution-feed');container.replaceChildren();
  for(const event of events){const row=el('article',undefined,'mini-event');row.append(el('strong',label(event.type)),metricChips(event),recordDetails(event));container.append(row);}
  if(!events.length)container.append(el('p','No code-evolution decisions in this selection. Choose a code evolution run above.','empty'));
}
$('run-select').addEventListener('change',e=>{state.runSelection=e.target.value;clearInterval(state.replayTimer);state.replay=false;state.packets=[];state.flashes=[];state.timelineLimit=100;state.memoryLimit=100;render();});
$('timeline-more').addEventListener('click',()=>{state.timelineLimit+=100;renderTimeline();});
$('memory-more').addEventListener('click',()=>{state.memoryLimit+=100;renderMemory();});
function health(data){state.logState=data.log_state;$('data-health').textContent=`Source ${data.log_state}${data.dropped?` · ${data.dropped} invalid or oversized records omitted`:''} · append-only JSONL`;}
// Rail selection sync: the rail previously hard-coded `selected` on the graph
// icon, so navigating to another panel left the wrong section highlighted.
// Track the panel nearest the top of the viewport and mirror it on the rail.
const railLinks=[...document.querySelectorAll('.rail a[href^="#"]')];
function syncRail(){
 const panels=railLinks.map(a=>({a,el:document.querySelector(a.getAttribute('href'))})).filter(p=>p.el);
 if(!panels.length)return;
 let best=panels[0],bestTop=Infinity;
 for(const p of panels){const top=p.el.getBoundingClientRect().top;const d=Math.abs(top-80);if(top<window.innerHeight&&d<bestTop){bestTop=d;best=p;}}
 // Panels sharing a row (activity and memory sit side by side) have the same
 // offset, so nearest-top alone always picks the left one. An explicit hash
 // target wins while its panel is on screen.
 const hashed=panels.find(p=>p.a.getAttribute('href')===location.hash);
 if(hashed){const r=hashed.el.getBoundingClientRect();if(r.top<window.innerHeight&&r.bottom>0)best=hashed;}
 for(const {a} of panels)a.classList.toggle('selected',a===best.a);
}
addEventListener('scroll',()=>requestAnimationFrame(syncRail),{passive:true});
addEventListener('hashchange',()=>setTimeout(syncRail,50));
addEventListener('resize',()=>requestAnimationFrame(syncRail),{passive:true});
syncRail();

// Findings panel. Assessment output is untrusted model text, so every string
// below reaches the DOM through el()/textContent and never innerHTML. The
// endpoint may answer with a bare array or {findings:[...]}; both are accepted
// and anything else is reported as unreadable rather than guessed at.
const SEVERITY_ORDER=['Critical','High','Medium','Low','Informational'];
const severityName=value=>SEVERITY_ORDER.find(s=>s.toLowerCase()===String(value??'').trim().toLowerCase())||'';
const severityClass=name=>`sev-${(name||'unrated').toLowerCase()}`;
const findingText=(value,fallback)=>{const text=typeof value==='string'?value.trim():Number.isFinite(value)?String(value):'';return text||fallback;};
// Drill-down state. The findings array is fetched once by loadFindings(); every
// filter change re-renders from that in-memory array and never refetches.
const findingsState={all:[],filter:null};
// Same status rule the summary tile counts with: a blank status is treated as
// still open. This records what the session wrote down; it is not a
// remediation claim.
const isOpenFinding=f=>{const st=String(f.status||'').toLowerCase();return !st||st==='open'||st==='unresolved'||st==='confirmed';};
const findingSeverity=f=>severityName(f.severity)||'Unrated';
const filterKey=filter=>filter?`${filter.kind}:${filter.value}`:'all';
const sameFilter=(a,b)=>filterKey(a)===filterKey(b);
function matchesFilter(finding,filter){
  if(!filter)return true;
  if(filter.kind==='open')return isOpenFinding(finding);
  if(filter.kind==='severity')return findingSeverity(finding)===filter.value;
  return true;
}
function applyFindingsFilter(filter){
  // Exactly one filter at a time; re-selecting the active one returns to all.
  const active=document.activeElement;
  const focusKey=active?.dataset?.filterKey;
  const focusScope=active?.closest?.('#findings-kpis,#findings-severity,#findings-count')?.id;
  findingsState.filter=sameFilter(findingsState.filter,filter)?null:filter;
  renderFindings();
  // Re-rendering replaces the control that was just used, so put focus back on
  // its equivalent, preferring the group it came from. "Clear filter" has no
  // equivalent once cleared, so focus falls back to the total tile.
  if(focusKey)for(const id of [focusScope,'findings-kpis','findings-severity']){
    for(const node of (id?document.getElementById(id):null)?.querySelectorAll('button')||[])
      if(node.dataset.filterKey===focusKey&&!node.disabled)return node.focus();
  }
}
// Real buttons, so the drill-down is reachable by keyboard and reports its
// pressed state. A control with nothing behind it is disabled, never a
// dead-looking button.
function filterButton(cls,filter,enabled){
  const button=el('button',undefined,cls);
  button.type='button';
  button.dataset.filterKey=filterKey(filter);
  const active=enabled!==false&&sameFilter(findingsState.filter,filter);
  button.setAttribute('aria-pressed',String(active));
  if(enabled===false)button.disabled=true;
  else button.addEventListener('click',()=>applyFindingsFilter(filter));
  return button;
}
function renderSeveritySummary(findings){
  const row=$('findings-severity');row.replaceChildren();
  const counts=new Map(SEVERITY_ORDER.map(s=>[s,0]));let unrated=0;
  for(const finding of findings){const name=severityName(finding.severity);if(name)counts.set(name,counts.get(name)+1);else unrated++;}
  const entries=[...counts];if(unrated)entries.push(['Unrated',unrated]);
  for(const [name,total] of entries){
    const chip=filterButton(`severity-chip ${severityClass(name)}${total?'':' zero'}`,{kind:'severity',value:name,label:name},total>0);
    chip.title=total?`Show only ${name} findings`:`No ${name} findings recorded in this session`;
    chip.append(el('span',name,'severity-name'),el('strong',total.toLocaleString()));
    row.append(chip);
  }
}
function renderKpis(findings){
  const box=$('findings-kpis');if(!box)return;box.replaceChildren();
  // Mirrors the generated report's summary tiles. "Open" counts recorded status,
  // it is not a remediation claim.
  const open=findings.filter(isOpenFinding).length;
  const worst=SEVERITY_ORDER.find(n=>findings.some(f=>severityName(f.severity)===n))||'None';
  const tiles=[
    [String(findings.length),'Total findings',null,findings.length>0,'Show every recorded finding'],
    // Selectable even at zero: "no finding is recorded as open" is itself a
    // result worth being able to see, and the empty state says so plainly.
    [String(open),'Open / unresolved',{kind:'open',value:'open',label:'Open / unresolved'},findings.length>0,'Show only findings whose recorded status is open, unresolved or confirmed'],
    [worst,'Highest severity',worst==='None'?null:{kind:'severity',value:worst,label:worst},worst!=='None',worst==='None'?'No severity rating recorded in this session':`Show only ${worst} findings`]
  ];
  for(const [n,l,filter,enabled,hint] of tiles){
    const tile=filterButton('report-kpi',filter,enabled);
    tile.title=hint;
    tile.append(el('span',n,'kpi-n'),el('span',l,'kpi-l'));
    box.append(tile);
  }
}
function renderFindingsCount(visible,total,filter){
  const line=$('findings-count');line.replaceChildren();
  if(!filter){line.append(el('span',`${total.toLocaleString()} findings recorded in this session`));return;}
  line.append(el('span',`Showing ${visible.toLocaleString()} of ${total.toLocaleString()} findings · ${filter.label}`));
  const clear=el('button','Clear filter','filter-clear');
  clear.type='button';clear.dataset.filterKey='all';
  clear.addEventListener('click',()=>applyFindingsFilter(null));
  line.append(clear);
}
function renderFindings(){
  const all=findingsState.all,filter=findingsState.filter;
  // Summary counts always describe the whole session, so one drill-down can be
  // swapped for another without losing the totals.
  renderSeveritySummary(all);
  renderKpis(all);
  const findings=filter?all.filter(f=>matchesFilter(f,filter)):all;
  renderFindingsCount(findings.length,all.length,filter);
  const feed=$('findings-feed');feed.replaceChildren();
  for(const finding of findings){
    const name=severityName(finding.severity);
    const item=el('article',undefined,`report-finding ${severityClass(name)}`),head=el('div',undefined,'finding-head');
    head.append(el('span',name||'Unrated',`sev-pill ${severityClass(name)}`),el('span',findingText(finding.id,'No id recorded'),'finding-id'));
    item.append(head,el('strong',findingText(finding.title,'No title recorded'),'finding-title'));
    item.append(el('small',`Check ${findingText(finding.check_id,'not recorded')} · resource group ${findingText(finding.resource_group,'not recorded')}`,'record-stamp'));
    const details=el('details',undefined,'record-details');
    details.append(el('summary','Evidence, recommendation and affected resource'));
    const data=el('dl');
    addDetail(data,'Description',findingText(finding.description,'Not recorded'));
    addDetail(data,'Recommendation',findingText(finding.recommendation,'Not recorded'));
    addDetail(data,'Resource ID',findingText(finding.resource_id,'Not recorded'));
    details.append(data);item.append(details);feed.append(item);
  }
  if(!findings.length){
    // A filter with no rows says nothing about the environment, and neither
    // does an empty session; both messages have to stay explicit about that.
    const empty=el('p',filter?'No findings match this filter.':'No findings in this session. That is the recorded output of this run; it is not a statement about the environment.','empty');
    if(filter)empty.append(el('small','Other recorded findings remain under the other filters. This is a view of the recorded output, not a clean result.'));
    feed.append(empty);
  }
}
async function loadFindings(){
  try{
    const response=await fetch('/api/findings',{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    const findings=Array.isArray(data)?data:Array.isArray(data?.findings)?data.findings:null;
    if(!findings)throw new Error('unrecognized findings payload');
    findingsState.all=findings.filter(f=>f&&typeof f==='object');
    findingsState.filter=null;
    renderFindings();
  }catch(error){
    findingsState.all=[];findingsState.filter=null;
    $('findings-kpis').replaceChildren();
    $('findings-severity').replaceChildren();
    $('findings-count').textContent='Recorded findings could not be read';
    $('findings-feed').replaceChildren(el('p',`This view could not read /api/findings (${error.message}). Nothing is shown in place of the recorded output.`,'empty'));
  }
}
loadFindings();
