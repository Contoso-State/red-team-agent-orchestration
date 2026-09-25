/** Versioned attribution contract, outside the allowed mutation surface. */
export const ALIASES = Object.freeze({
  orchestrator:'plan_specialists', evaluator:'evaluate', 'independent-judge':'judge',
  'inventory-scope':'preflight_inventory', 'identity-posture':'identity',
  'authorization-attack-path':'correlate', 'network-exposure':'network',
  'compute-platform':'compute', 'aks-container':'aks-container', 'data-protection':'data',
  'web-exposure':'web', 'ai-foundry':'ai', 'attack-surface':'easm',
  'external-vuln':'external-vuln', 'logging-coverage':'logging', 'email-security':'email',
  'governance-posture':'governance', 'devops-supplychain':'supplychain', reporting:'report',
});
export function contractCases(nodes) {
  const golden = nodes.flatMap(n => [n.id,n.agent,n.domain].filter(Boolean).map(input=>({input,expected:n.id}))).filter((v,i,a)=>a.findIndex(x=>x.input===v.input)===i);
  const known = Object.entries(ALIASES).filter(([,id])=>nodes.some(n=>n.id===id));
  return {golden:[...golden,{input:'unknown-agent',expected:null},{input:'',expected:null}],
    challenge:known.flatMap(([name,id])=>[{input:name,expected:id},{input:`  ${name.toUpperCase()}  `,expected:id}])};
}
