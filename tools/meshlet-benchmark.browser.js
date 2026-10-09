// Playwright run-code callback. Execute only in an authorized serialized GPU slot.
async page=>{
 // Edit base/output together with the loopback server arguments if needed.
 const base='http://127.0.0.1:8037',output='output/meshlet-benchmark',start=Date.now(),results={},browser=page.context().browser();
 const save=async(label,value)=>{results[label]=value;await fetch(base+'/__evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label,value})});};
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const bound=async(p,ms)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Bounded stage timeout')),ms))]);}finally{clearTimeout(timer);}};
 await save('policy',(await (await fetch(base+'/__meta')).json()).matchedPolicy);
 await page.goto(base+'/browser/meshlet-gpu-proof.html?meshletGroup=8');
 try{
  const proof=await bound(page.evaluate(()=>window.meshletProof),12000);assert(proof.passed,'Grouped equivalence failed');await save('grouped-equivalence',proof);
  await page.addInitScript(()=>{
   window.meshletHostCosts={workerMs:null,frameCpuMs:[],submitCpuMs:[],adapter:null,errorClamps:0,minScale:null};const Native=window.Worker;
   window.Worker=class extends Native{constructor(...args){super(...args);const start=performance.now();this.addEventListener('message',({data})=>{const costs=window.meshletHostCosts;costs.workerMs=performance.now()-start;
    if(data.lodErrors){const values=new Float32Array(data.lodErrors);for(let m=0;m<values.length;m+=4){let maximum=0;for(let k=0;k<4;k++){if(values[m+k]<maximum)costs.errorClamps++;maximum=Math.max(maximum,values[m+k]);}}}
    if(data.instances){const values=new Float32Array(data.instances);let minimum=Infinity;for(let i=3;i<values.length;i+=12)minimum=Math.min(minimum,values[i]);costs.minScale=minimum;}
   });}};
   const submit=GPUQueue.prototype.submit;GPUQueue.prototype.submit=function(...args){const start=performance.now();const value=submit.apply(this,args);window.meshletHostCosts.submitCpuMs.push(performance.now()-start);return value;};
   const raf=window.requestAnimationFrame;window.requestAnimationFrame=function(callback){return raf.call(window,time=>{const before=window.forestGame?.snapshot().frames,start=performance.now();let elapsed;try{return callback(time);}finally{elapsed=performance.now()-start;const after=window.forestGame?.snapshot().frames;if(after>before)window.meshletHostCosts.frameCpuMs.push(elapsed);}});};
   const request=GPU.prototype.requestAdapter;GPU.prototype.requestAdapter=async function(...args){const adapter=await request.apply(this,args);if(adapter)window.meshletHostCosts.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description};return adapter;};
  });
  for(const mode of ['baseline','fine','grouped']){
   if(Date.now()-start>120000)throw Error('Insufficient remaining time for another mode');
   const begin=Date.now(),query=mode==='baseline'?'meshlets=0':mode==='fine'?'meshlets=1':'meshlets=1&meshletGroup=8';
   await page.goto(base+'/browser/forest-game.html?'+query,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.forestGame?.snapshot().ready||document.querySelector('#status').textContent.match(/Error|failed|unavailable|lost|outside|Non-finite/i),null,{timeout:65000});
   assert(await page.evaluate(()=>window.forestGame?.snapshot().ready),'Forest startup failed');
   await save(mode+'-startup',{startupMs:Date.now()-begin,...await page.evaluate(()=>({workerMs:window.meshletHostCosts.workerMs,adapter:window.meshletHostCosts.adapter,errorClamps:window.meshletHostCosts.errorClamps,minScale:window.meshletHostCosts.minScale})),browserVersion:browser.version()});
   for(const view of ['trail','sky']){
    await page.locator('#view').selectOption(view);await page.locator('#detail').selectOption('0.75');
    await page.evaluate(()=>{window.meshletHostCosts.frameCpuMs=[];window.meshletHostCosts.submitCpuMs=[];});await page.waitForTimeout(4000);
    const measured=await page.evaluate(()=>{const summary=values=>{const a=values.slice(-120).sort((a,b)=>a-b);return {samples:a.length,meanMs:a.reduce((n,x)=>n+x,0)/a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)]};};return {...window.forestGame.snapshot(),frameCpu:summary(window.meshletHostCosts.frameCpuMs),submitCpu:summary(window.meshletHostCosts.submitCpuMs)};});
    assert(!measured.errors.length,'Rendering error');await save(mode+'-'+view+'-timing',measured);
    const draws=await bound(page.evaluate(()=>window.forestGame.inspectDraws()),7000);await save(mode+'-'+view+'-draws',{triangles:draws.reduce((n,x)=>n+x.triangles,0),activeCommands:draws.filter(x=>x.instances>0).length,draws});
    if(mode!=='baseline'){const counters=await bound(page.evaluate(()=>window.forestGame.inspectMeshlets()),7000);assert(counters.sampling==='dedicated-current-cull'&&counters.visibleInstances>0&&counters.nodesTested>0&&counters.overflow===0,'Current counters invalid');await save(mode+'-'+view+'-counters',counters);}
    await page.locator('canvas').screenshot({path:output+'/'+mode+'-'+view+'-lod.png'});
   }
  }
  await save('summary',{passed:true,elapsedMs:Date.now()-start,browserVersion:browser.version(),gpuUsed:true,hysteresisControlled:true});return {passed:true,elapsedMs:Date.now()-start};
 }catch(error){await save('failure',{message:error.message,elapsedMs:Date.now()-start});throw error;}
 finally{await page.goto('about:blank');}
}
