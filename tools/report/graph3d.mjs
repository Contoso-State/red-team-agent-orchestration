// Offline progressive enhancement. Projection is shared with regression tests.
export function project3D(point, yaw, pitch, zoom, width, height) {
  const x = point.x * Math.cos(yaw) + point.z * Math.sin(yaw);
  const z = -point.x * Math.sin(yaw) + point.z * Math.cos(yaw);
  const y = point.y * Math.cos(pitch) - z * Math.sin(pitch);
  const depth = point.y * Math.sin(pitch) + z * Math.cos(pitch);
  const scale = 850 / Math.max(250, 850 + depth) * zoom;
  return { x: width / 2 + x * scale, y: height / 2 + y * scale, depth, scale };
}
export function isConditionalEdge(label) {
  return /conditional|assum|unverified|unproven|prerequisite|not (?:tested|observed|confirmed)|potential|hypothe/i.test(label || '');
}
function initGraph3D(project3D) {
  const canvas = document.getElementById('cg3d');
  const data = document.getElementById('cg3d-data');
  if (!canvas || !data) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const model = JSON.parse(data.textContent);
  if (!model.nodes.length) return;
  const shell = document.getElementById('cg3d-shell');
  shell.hidden = false;
  const fallback = document.querySelector('.cg3d-fallback');
  if(fallback){
    fallback.open = false;
    let wasOpen = false;
    window.addEventListener('beforeprint',()=>{wasOpen=fallback.open;fallback.open=true;});
    window.addEventListener('afterprint',()=>{fallback.open=wasOpen;});
  }
  let yaw = -.32, pitch = .25, zoom = 1, selected = 0, projected = [], drag = null, moved = false;
  const colors = { Critical:'#fb7185', High:'#ff9270', Medium:'#f8ca70', Low:'#69c9fa', Informational:'#a7b4ce' };
  const positions = model.nodes.map((n,i) => ({x:n.px,y:n.py,z:n.pz}));
  const index = new Map(model.nodes.map((n,i)=>[n.key,i]));
  const details = document.getElementById('cg3d-detail');
  const list = document.getElementById('cg3d-nodes');
  function select(i) {
    selected = i;
    const n = model.nodes[i];
    details.replaceChildren();
    function line(tag,text) { const el = document.createElement(tag); el.textContent = text; details.appendChild(el); }
    line('small', 'NODE ' + (i+1) + ' / ' + model.nodes.length + ' · ' + n.type.toUpperCase());
    line('h3',n.label);
    line('p','Finding severity: ' + (n.severity || 'Not assigned') + '. Severity describes the finding, not proven compromise.');
    if(n.resourceId) line('p',n.resourceId);
    line('p','Paths: ' + n.paths.join(', '));
    if(n.findingId) {
      const a = document.createElement('button'); a.type='button'; a.className='ab-btn'; a.textContent='Open finding ' + n.findingId;
      // Reuse the report's established reveal action through an inert data attribute.
      a.classList.add('ap-clickable'); a.setAttribute('data-finding',n.findingId);
      details.appendChild(a);
    }
    line('h4','Supplied relationships');
    model.edges.filter(e=>e.from===n.key||e.to===n.key).forEach(e=>{
      const other=model.nodes[index.get(e.from===n.key?e.to:e.from)];
      line('p',(e.from===n.key?'→ ':'← ') + other.label + '\n' + (e.conditional?'CONDITIONAL · ':'RELATIONSHIP · ') + (e.label||'No relationship evidence label supplied') + (e.technique?' · '+e.technique:''));
    });
    [...list.children].forEach((b,j)=>b.setAttribute('aria-pressed',String(j===i)));
    draw();
  }
  model.nodes.forEach((n,i)=>{const b=document.createElement('button'); b.type='button';b.textContent=String(i+1).padStart(2,'0')+' · '+n.label;b.onclick=()=>select(i);list.appendChild(b);});
  function draw() {
    const w=canvas.clientWidth, h=canvas.clientHeight, dpr=Math.min(window.devicePixelRatio||1,2);
    if(!w||!h)return;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const fit=Math.min(w/1000,h/520);
    projected=positions.map(p=>project3D(p,yaw,pitch,zoom*fit,w,h));
    // Perspective floor grid gives a stable depth reference without inventing graph edges.
    ctx.strokeStyle='rgba(114,151,201,.12)';ctx.lineWidth=1;
    for(let k=-600;k<=600;k+=100){
      [[{x:k,y:160,z:-450},{x:k,y:160,z:450}],[{x:-600,y:160,z:k},{x:600,y:160,z:k}]].forEach(pair=>{const a=project3D(pair[0],yaw,pitch,zoom*fit,w,h),b=project3D(pair[1],yaw,pitch,zoom*fit,w,h);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();});
    }
    model.edges.forEach(e=>{
      const ai=index.get(e.from),bi=index.get(e.to),a=projected[ai],b=projected[bi];if(!a||!b)return;
      const active=ai===selected||bi===selected;
      ctx.strokeStyle=e.conditional?(active?'#f8ca70':'#a88b53'):(active?'#70dcff':'#436c99');ctx.lineWidth=active?2.6:1.5;ctx.setLineDash(e.conditional?[7,6]:[]);
      const angle=Math.atan2(b.y-a.y,b.x-a.x),endX=b.x-Math.cos(angle)*19*b.scale,endY=b.y-Math.sin(angle)*19*b.scale;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(endX,endY);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(endX,endY);ctx.lineTo(endX-10*Math.cos(angle-.4),endY-10*Math.sin(angle-.4));ctx.lineTo(endX-10*Math.cos(angle+.4),endY-10*Math.sin(angle+.4));ctx.fill();
    });
    [...model.nodes.keys()].sort((a,b)=>projected[b].depth-projected[a].depth).forEach(i=>{
      const p=projected[i],n=model.nodes[i],r=Math.max(7,17*p.scale),c=colors[n.severity]||'#b6aadf';
      ctx.shadowColor=c;ctx.shadowBlur=i===selected?25:10;ctx.fillStyle=c;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      if(i===selected){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,r+7,0,Math.PI*2);ctx.stroke();}
      ctx.fillStyle='#102038';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText(String(i+1),p.x,p.y+4);
      ctx.font=(i===selected?'600 ':'')+'12px system-ui';ctx.fillStyle=i===selected?'#fff':'#bdcde3';
      const limit=i===selected?28:20;
      const label=n.label.length>limit?n.label.slice(0,limit-1)+'…':n.label;
      const labelY=i%2===0?p.y-r-28:p.y+r+24;
      ctx.fillText(label,p.x,labelY);ctx.fillStyle='#8297b7';ctx.font='10px system-ui';ctx.fillText(n.type.toUpperCase(),p.x,labelY+15);
    });
  }
  canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,yaw,pitch};moved=false;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)moved=true;yaw=drag.yaw+dx*.007;pitch=Math.max(-1.15,Math.min(1.15,drag.pitch+dy*.007));draw();});
  canvas.addEventListener('pointerup',e=>{if(!moved){const r=canvas.getBoundingClientRect();let hit=-1,best=Infinity;projected.forEach((p,i)=>{const d=Math.hypot(e.clientX-r.left-p.x,e.clientY-r.top-p.y);if(d<Math.max(20,25*p.scale)&&d<best){best=d;hit=i;}});if(hit>=0)select(hit);}drag=null;});
  canvas.addEventListener('pointercancel',()=>{drag=null;});
  function zoomBy(f){zoom=Math.max(.5,Math.min(2.3,zoom*f));draw();}
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoomBy(e.deltaY<0?1.08:1/1.08);},{passive:false});
  canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')yaw-=.12;if(e.key==='ArrowRight')yaw+=.12;if(e.key==='ArrowUp')pitch=Math.max(-1.15,pitch-.12);if(e.key==='ArrowDown')pitch=Math.min(1.15,pitch+.12);if(e.key==='+')zoomBy(1.15);if(e.key==='-')zoomBy(1/1.15);if(e.key==='Home')reset();draw();}});
  function reset(){yaw=-.32;pitch=.25;zoom=1;draw();}
  document.getElementById('cg3d-in').onclick=()=>zoomBy(1.2);
  document.getElementById('cg3d-out').onclick=()=>zoomBy(1/1.2);
  document.getElementById('cg3d-reset').onclick=reset;
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(draw).observe(canvas);else window.addEventListener('resize',draw);
  select(0);
}
export const GRAPH3D_JS = '(' + initGraph3D.toString() + ')(' + project3D.toString() + ');';
export const GRAPH3D_CSS = `
.cg3d-shell{border:1px solid #2c4160;border-radius:16px;overflow:hidden;background:#0b1426;color:#dae6f7;margin:20px 0;box-shadow:0 20px 45px #0b142625}.cg3d-shell[hidden]{display:none}.cg3d-head{padding:18px 22px;border-bottom:1px solid #243653;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.cg3d-head strong{color:#eff6ff;font-size:17px}.cg3d-head p{margin:5px 0;color:#9aafce;font-size:12px}.cg3d-head .ab-btn{background:#182a44;color:#e1ebfa;border-color:#3e577b}.cg3d-body{display:grid;grid-template-columns:minmax(0,1fr) 300px}.cg3d-stage{min-width:0;background:radial-gradient(ellipse at 45% 35%,#172d4b 0%,#0b1426 70%)}#cg3d{display:block;width:100%;height:510px;touch-action:none;cursor:grab}#cg3d:active{cursor:grabbing}#cg3d:focus-visible{outline:3px solid #70dcff;outline-offset:-4px}.cg3d-detail{padding:22px;border-left:1px solid #243653;overflow-wrap:anywhere;max-height:510px;overflow:auto}.cg3d-detail h3{color:#f3f7ff;font-size:16px;line-height:1.45}.cg3d-detail h4{color:#b8cbe6;margin:20px 0 8px}.cg3d-detail small{color:#86baff;letter-spacing:1px}.cg3d-detail p{color:#a9bdd8;font-size:12px;white-space:pre-line}.cg3d-legend{display:flex;gap:20px;padding:12px 22px;border-top:1px solid #243653;color:#b7cae4;font-size:12px}.cg3d-legend span:first-child{color:#70dcff}.cg3d-legend span:nth-child(2){color:#f8ca70}.cg3d-nodes{display:flex;gap:8px;overflow:auto;padding:12px 20px;border-top:1px solid #243653}.cg3d-nodes button{flex:0 0 170px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:8px 12px;border:1px solid #304969;border-radius:7px;background:#132239;color:#b9cce6;text-align:left;cursor:pointer}.cg3d-nodes button[aria-pressed=true]{border-color:#70dcff;color:#fff;background:#203d5b}.cg3d-nodes button:focus-visible{outline:2px solid #70dcff}.cg3d-fallback{margin:16px 0}.cg3d-fallback summary{cursor:pointer;color:#41618c;font-weight:600}@media(max-width:850px){.cg3d-body{grid-template-columns:1fr}.cg3d-detail{border-left:0;border-top:1px solid #243653;max-height:250px}#cg3d{height:410px}}@media print{.cg3d-shell{display:none!important}.cg3d-fallback>summary{display:none}.cg3d-fallback{display:block}.cg3d-fallback>*{display:block}}
`;
