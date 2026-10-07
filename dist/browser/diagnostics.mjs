// Read-only presentation views. No diagnostic writes enter reconstruction history.
export function diagnosticShader(stride, separated, optical) {
  return `
@group(0) @binding(0) var<uniform> cfg:vec4u;
@group(0) @binding(1) var<storage,read> data:array<vec4f>;
@vertex fn vertex(@builtin(vertex_index) id:u32)->@builtin(position) vec4f {
 let x=f32((id<<1u)&2u);let y=f32(id&2u);return vec4f(x*2.-1.,y*2.-1.,0,1);
}
fn heat(v:f32)->vec3f {return clamp(vec3f(1.5)-abs(vec3f(3.,2.,1.)-4.*clamp(v,0.,1.)),vec3f(0),vec3f(1));}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f {
 if(cfg.z>=11u){let xy=min(vec2u(p.xy),cfg.xy-1u);let v=data[xy.y*cfg.x+xy.x][min(cfg.z-11u,3u)];return vec4f(heat(log2(1.+v)/14.),1);}
 let xy=min(vec2u(p.xy),cfg.xy-1u);let b=(xy.y*cfg.x+xy.x)*${stride / 16}u;
 let channel=min(cfg.w,3u);
 var co=data[b];var mo=data[b+3u];
 ${separated ? 'co=data[b+select(channel,10u,channel==3u)];mo=data[b+select(5u+channel,11u,channel==3u)];' : ''}
 let pos=data[b+${separated ? 3 : 1}u];let no=data[b+${separated ? 4 : 2}u];
 var guide=data[b+${separated ? 8 : 4}u];var gn=data[b+${separated ? 9 : 5}u];
 ${optical ? 'if(channel==1u){guide=data[b+12u];gn=data[b+13u];}' : ''}
 ${stride===272 ? 'if(channel==3u&&no.w==0.){guide=data[b+14u];gn=data[b+15u];}' : ''}
 var rgb=vec3f(0);
 switch cfg.z {
 case 1u,2u:{rgb=pow(max(co.rgb,vec3f(0))/(1.+max(co.rgb,vec3f(0))),vec3f(1./2.2));}
 case 3u:{rgb=no.xyz*.5+.5;}
 case 4u:{rgb=vec3f(clamp(no.w,0.,1.));}
 case 5u:{rgb=heat(log2(1.+max(co.w,0.))/9.);}
 case 6u:{rgb=select(vec3f(.04,.12,.2),vec3f(1.,.22,.04),co.w<=1.01);}
 case 7u:{rgb=heat(log2(1.+max(mo.y-mo.x*mo.x,0.))*0.25);}
 case 8u:{rgb=fract(sin(vec3f(12.9898,78.233,37.719)*(pos.w+1.))*43758.5453);}
 case 9u:{rgb=select(vec3f(.35,.03,.06),vec3f(.1,.85,.5),gn.w>0.);}
 case 10u:{rgb=heat(log2(1.+distance(pos.xyz,guide.xyz))/8.);}
 default:{}
 }
 if(pos.w<0. && cfg.z>2u){rgb=vec3f(.025);}
 return vec4f(rgb,1);
}`;
}

export function decodeStages(t, detailed) {
 const ms=(a,b)=>Number(t[b]-t[a])/1e6;
 return {trace:ms(0,1),total:ms(0,3),display:ms(2,3),
   ...(detailed?{temporal:ms(4,5),filter:ms(6,7)}:{})};
}

export function createDiagnostics({wake, snapshot}) {
 const panel=document.createElement('details');panel.id='diagnostics';
 panel.innerHTML=`<summary>Debug / profiler</summary>
 <label>Viewport signal<select id="debug-view">
 <option value="0">Beauty (normal renderer)</option><option value="1">Raw radiance</option><option value="2">Temporal radiance</option>
 <option value="3">Surface normals</option><option value="4">Roughness</option><option value="5">History age</option>
 <option value="6">Fresh history</option><option value="7">Temporal variance</option><option value="8">Surface / material ID</option>
 <option value="9">Secondary guide validity</option><option value="10">Secondary guide distance</option></select></label>
 <label>Separated-backend lobe<select id="debug-channel"><option value="0">Diffuse / baseline combined</option><option value="1">Specular</option><option value="2">Transmission</option><option value="3">Indirect diffuse</option></select></label>
 <p id="debug-legend" class="note"></p>
 <label class="check"><input type="checkbox" id="debug-profile">Detailed GPU timings</label>
 <canvas id="profile-chart" width="240" height="100" aria-label="GPU frame timing history"></canvas>
 <div id="profile-stages"></div><p class="note">GPU elapsed milliseconds, not FPS. Timings include instrumentation; debug views replace the beauty presentation. No per-pixel cost estimate.</p>
 <button id="debug-export">Export diagnostic JSON</button>
 <details><summary>Experimental reconstruction</summary>
 <label class="check"><input type="checkbox" id="experiment-endpoint">Optical endpoint cache</label>
 <label class="check"><input type="checkbox" id="experiment-contributors">Two-contributor coverage</label>
 <p class="note">Unproven quality/performance. Applying reloads the scene. Neither is enabled by default.</p>
 <button id="experiment-apply">Apply experimental modes</button>
 <button id="experiment-measure">Measure reuse</button><pre id="experiment-stats"></pre></details>`;
 document.querySelector('#metrics').after(panel);
 const params=new URLSearchParams(location.search);
 panel.querySelector('#experiment-endpoint').checked=params.get('cache')==='endpoint';
 panel.querySelector('#experiment-contributors').checked=params.get('reconstruction')==='contributors';
 panel.querySelector('#experiment-apply').onclick=()=>{const url=new URL(location.href);for(const [id,key,value] of [['experiment-endpoint','cache','endpoint'],['experiment-contributors','reconstruction','contributors']]){if(panel.querySelector('#'+id).checked)url.searchParams.set(key,value);else if(url.searchParams.get(key)===value)url.searchParams.delete(key);}location.assign(url.href);};
 panel.querySelector('#experiment-measure').onclick=async()=>{const button=panel.querySelector('#experiment-measure');button.disabled=true;try{panel.querySelector('#experiment-stats').textContent=JSON.stringify(await window.cybrLight.inspectReuse(),null,2);}catch(e){panel.querySelector('#experiment-stats').textContent=String(e);}finally{button.disabled=false;}};
 const view=panel.querySelector('#debug-view'),channel=panel.querySelector('#debug-channel'),profile=panel.querySelector('#debug-profile');
 const legends=['Normal presentation.','Raw radiance, simple diagnostic tone map; not beauty exposure.','Accumulated radiance, same diagnostic tone map.','World-space normals: XYZ → RGB.','Black smooth → white rough.','Blue → red: 0 → 511 history samples (log scale).','Orange: history count ≤ 1; includes resets/disocclusion, NOT an exact rejection reason. Blue: reused history.','Blue → red: variance 0 → 15 (log scale). Moment variance, not reference-image error.','Hashed surface/material IDs, not unique triangle IDs.','Green: valid secondary guide; red: unavailable. Sky dark. Specular uses reflection guides only with optics=guides.','Blue → red: guide distance 0 → 255 scene units (log scale). Only meaningful for valid guides.'];
 function changed(){panel.querySelector('#debug-legend').textContent=legends[+view.value]||'Traversal counters: blue → red = 0 → 16,383 operations (log scale). Instrumented timing includes counter overhead.';wake();}
 view.onchange=channel.onchange=profile.onchange=changed;changed();
 const rows=[];
 panel.querySelector('#debug-export').onclick=()=>{
   const blob=new Blob([JSON.stringify({schema:1,capturedAt:new Date().toISOString(),url:location.href,snapshot:snapshot(),view:+view.value,stages:rows},null,2)],{type:'application/json'});
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cybr-light-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return {get view(){return +view.value;},get channel(){return +channel.value;},get enabled(){return profile.checked;},rows,
 clear(){rows.length=0;},
 record(row){rows.push(row);if(rows.length>240)rows.shift();if(!panel.open)return;
   const ctx=panel.querySelector('canvas').getContext('2d'),max=Math.max(16.67,...rows.map(r=>r.total));ctx.clearRect(0,0,240,100);ctx.strokeStyle='#ba3030';ctx.beginPath();ctx.moveTo(0,100-16.67/max*100);ctx.lineTo(240,100-16.67/max*100);ctx.stroke();ctx.strokeStyle='#254c70';ctx.beginPath();rows.forEach((r,i)=>{const x=i,y=100-r.total/max*100;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
   panel.querySelector('#profile-stages').textContent=Object.entries(row).filter(([k,v])=>typeof v==='number'&&k!=='view').map(([k,v])=>k+': '+v.toFixed(2)+' ms').join(' / ')+`\nChart 0–${max.toFixed(1)} ms; red = 16.67 ms`;
 }};
}
