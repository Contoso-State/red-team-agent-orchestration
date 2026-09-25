/** Async canonical graph control plane. Live handlers are mandatory: no simulated defaults. */
import { initialState, applyWrite, inScopeRoster, defaultRouters } from './run-graph.mjs';
export async function runGraphAsync(graph, { handlers, scope, emit = () => {}, onCheckpoint = () => {}, concurrency = 3, maxSteps = 100, signal } = {}) {
  if (!handlers || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw Error('Live handlers and concurrency 1..16 required');
  const nodes = new Map(graph.nodes.map(n => [n.id,n]));
  for (const n of graph.nodes.filter(n => !['fanout','interrupt'].includes(n.kind) && !n.gated)) if (typeof handlers[n.id] !== 'function') throw Error(`Missing live handler: ${n.id}`);
  const edges = new Map(graph.edges.map(e => [e.from,e.to]));
  const conditional = new Map(graph.conditional_edges.map(e => [e.from,e]));
  const routers = defaultRouters(), state = initialState(graph), params = {...graph.params};
  const path=[]; let current=edges.get('START'),steps=0;
  const apply = (result,target=state) => { if (!result || typeof result !== 'object') throw Error('Live handler returned no result');for (const [channel,value] of Object.entries(result.writes || {})) applyWrite(target,graph,channel,value); };
  const invoke = async (node,item,taskSignal=signal,task_id=`${steps}`) => {
    taskSignal?.throwIfAborted();
    const agent_id=item?.domain || node.agent || node.id;
    const metadata={node_id:node.id,agent_id,task_id};
    emit({type:'agent.started',...metadata,status:'running'});
    let result;
    try {
      taskSignal?.throwIfAborted();
      result=await handlers[node.id](node,{graph,state:structuredClone(state),scope,params,item,signal:taskSignal});
      taskSignal?.throwIfAborted();
      // Validate writes before declaring agent success, without changing fan-in order.
      apply(result,structuredClone(state));
    } catch(error) {
      emit({type:'agent.failed',...metadata,status:'failed'});
      throw error;
    }
    emit({type:'agent.completed',...metadata,status:'completed'});return result;
  };
  while(current!=='END') {
    signal?.throwIfAborted();if(++steps>maxSteps)throw Error('Graph step budget exceeded');
    const node=nodes.get(current);if(!node)throw Error(`Unknown graph node ${current}`);path.push(current);
    const metadata={node_id:current,task_id:`${steps}`};
    emit({type:'node.started',...metadata,status:'running'});
    try {
      signal?.throwIfAborted();
      if(node.kind==='fanout') {
        const roster=inScopeRoster(graph,state),results=new Array(roster.length);
        const controller=new AbortController(),taskSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
        let cursor=0,failed=false,firstError;
        const workers=Array.from({length:Math.min(concurrency,roster.length)},async()=>{
          while(!failed&&!taskSignal.aborted&&cursor<roster.length) {
            const i=cursor++,task_id=`${steps}-${i}`;
            try {
              emit({type:'message.sent',node_id:node.id,from_agent:'orchestrator',to_agent:roster[i].domain,task_id,summary:'Scoped specialist task dispatched'});
              results[i]=await invoke(nodes.get(node.into),roster[i],taskSignal,task_id);
            } catch(error) {
              if(!failed) {failed=true;firstError=error;controller.abort(error);}
              throw error;
            }
          }
        });
        // Cancel siblings on the first failure, then await every started handler's cleanup.
        await Promise.allSettled(workers);
        if(failed)throw firstError;
        taskSignal.throwIfAborted();
        for(const result of results)apply(result);current=edges.get(node.into);
      } else if(node.kind==='interrupt') {
        const active=routers.route_active(state,params);if(active!=='none')throw Error('Live CLI supports read-only mode only; active lanes require separate authorization runtime');current=conditional.get(node.id).branches.none;
      } else {
        apply(await invoke(node));
        const condition=conditional.get(current);current=condition?condition.branches[routers[condition.router](state,params)]:edges.get(current);
      }
      signal?.throwIfAborted();
      if(!current)throw Error(`No outgoing transition for ${node.id}`);
      if(current!=='END'&&!nodes.has(current))throw Error(`Unknown graph node ${current}`);
      await onCheckpoint({step:steps,node:node.id,next:current,status:'done',ts:new Date().toISOString(),state:structuredClone(state)});
      signal?.throwIfAborted();
    } catch(error) {
      emit({type:'node.failed',...metadata,status:'failed'});
      throw error;
    }
    emit({type:'node.completed',...metadata,status:'completed'});
  }
  path.push('END');return {status:'completed',state,path,steps};
}
