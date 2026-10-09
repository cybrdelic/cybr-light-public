// Playwright run-code callback. GPU owner must explicitly grant a native slot.
async page=>{
 // Replay Canopy from its recorded reset to reproduce the history at pair 26.
 // Grouped prefix 0..16 uses retained stored-depth receipts, separately audited
 // by the v3 CPU proof. Fine mode has no accepted prefix and starts at zero.
 const base='http://127.0.0.1:8037',mode='grouped',resumeIndex=mode==='grouped'?17:0,start=Date.now(),deadline=start+150000;
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const bounded=async(promise,maximum=10000)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Acceptance stage timeout')),Math.max(1,Math.min(maximum,deadline-Date.now()))))]);}finally{clearTimeout(timer);}};
 const save=async(label,value)=>{const response=await fetch(base+'/__evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label,value})});assert(response.ok,'Acceptance evidence save failed');};
 const reports=[];
 try{
  const metadata=await (await fetch(base+'/__meta')).json();assert(metadata.matchedPolicy.acceptance===true&&metadata.matchedPolicy.acceptancePolicyVersion===3,'Start a fresh server with --acceptance and the v3 binary32 oracle');await save(mode+'-acceptance-policy',metadata);
  await page.goto(base+'/browser/forest-game.html?meshlets=1'+(mode==='grouped'?'&meshletGroup=8':'')+'&acceptanceFrom='+resumeIndex,{waitUntil:'domcontentloaded'});
  await bounded(page.waitForFunction(()=>window.forestAcceptance&&window.forestGame?.snapshot().ready||document.querySelector('#status').textContent.match(/Error|failed|unavailable|lost|changed|requires/i),null,{timeout:65000}),65000);
  assert(await page.evaluate(()=>Boolean(window.forestAcceptance)),'Acceptance runtime initialization failed');
  const manifest=await page.evaluate(()=>window.forestAcceptance.manifest);await save(mode+'-acceptance-manifest',manifest);
  assert(manifest.policy.version===3&&manifest.resumeIndex===resumeIndex&&manifest.cases[resumeIndex]?.resetHistory,'Continuation must replay an explicit history-reset case with the v3 oracle');
  const cases=manifest.cases.filter(x=>x.index>=resumeIndex);assert(cases.length>0,'Empty acceptance continuation');
  for(const test of cases){
   assert(Date.now()<deadline-12000,'Insufficient time; incomplete coverage cannot pass');
   const images=true; // Retain the complete ordered strip for post-release perceptual review.
   const result=await bounded(page.evaluate(({index,images})=>window.forestAcceptance.capturePair(index,{images}),{index:test.index,images}));
   await save(mode+'-acceptance-'+String(test.index).padStart(3,'0'),result);delete result.images;reports.push(result);
   assert(result.geometryPassed,'Geometry/state/fallback/overflow acceptance failed at '+test.view+'/'+test.kind);
  }
  const views=[...new Set(cases.map(x=>x.view))],transitions=views.map(view=>({view,demoted:reports.filter(x=>x.view===view).reduce((n,x)=>n+x.lod.demoted,0),promoted:reports.filter(x=>x.view===view).reduce((n,x)=>n+x.lod.promoted,0),target:manifest.targets.find(x=>x.view===view)?.target??null}));
  const complete=reports.length===cases.length&&transitions.every(x=>x.demoted>0&&x.promoted>0&&x.target!==null),imageReview=reports.some(x=>x.requiresImageReview);
  const summary={geometryPassed:complete,scope:resumeIndex?'remaining cases only; combine with separately retained and CPU-audited prefix receipts':'entire bounded sweep',retainedPrefix:resumeIndex?{firstIndex:0,lastIndex:resumeIndex-1,source:'meshlet-acceptance-replay-v2',requiresReview:true}:null,resumeIndex,totalPlanPairs:manifest.cases.length,imageExact:!imageReview,transitions,completedPairs:reports.length,plannedPairs:cases.length,elapsedMs:Date.now()-start,mode,browserVersion:page.context().browser().version(),renderAdapter:await page.evaluate(()=>window.forestGame.snapshot().acceptanceAdapter),continuousPerceptualReview:'still required: inspect saved before/after demotion/promotion pairs and temporal changes; discrete reference LOD switches can remain visible',productionFilesModified:false};
  await save(mode+'-acceptance-summary',summary);assert(complete,'Transitions/target coverage incomplete');return summary;
 }catch(error){await save(mode+'-acceptance-failure',{message:error.message,resumeIndex,completedPairs:reports.length,elapsedMs:Date.now()-start});throw error;}
 finally{await page.goto('about:blank');}
}
