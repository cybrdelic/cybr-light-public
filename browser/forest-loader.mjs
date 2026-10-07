// Shared forest templates and a compact transform stream. Keep simulation
// provenance attached to the scene rather than silently substituting assets.
export async function loadForest(base,scene){
  const get=async path=>{const r=await fetch(base+path,{cache:'no-store'});if(!r.ok)throw Error('Missing forest asset: '+path);return r;};
  const manifest=await(await get('manifest.json')).json();
  const decode=async path=>new Response((await get(path)).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const raw=await decode('instrument.bin.gz'),bytes=await decode('instances.bin.gz');
  const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
  if(raw.byteLength!==manifest.byteLength||bytes.byteLength!==manifest.instanceCount*44||await digest(raw)!==manifest.sha256||await digest(bytes)!==manifest.instanceSha256)throw Error('Forest assets are stale or incomplete; rebuild the export');
  const records=new Float32Array(bytes),tree=scene==='forest'?null:manifest.selectedTrees[Number(scene.slice(-1))];
  const ids=[];
  for(let i=0;i<manifest.instanceCount;i++)if(tree===null||records[i*11+9]===tree)ids.push(i);
  if(!ids.length)throw Error('Forest selection has no geometry');
  const used=new Set(ids.map(i=>records[i*11]));
  const models=manifest.models.filter((_,i)=>used.has(i)),mapping=new Map();
  manifest.models.forEach((m,i)=>{if(used.has(i))mapping.set(i,models.findIndex(x=>x.id===m.id));});
  const meshes=manifest.meshes.filter(m=>models.some(x=>x.id===m.galleryId));
  const instanceAt=i=>{const o=ids[i]*11;return {model:mapping.get(records[o]),position:Array.from(records.slice(o+1,o+4)),rotation:Array.from(records.slice(o+4,o+8)),scale:records[o+8],leafMask:records[o+10]};};
  return {raw,manifest:{...manifest,meshes,nearModels:[]},pile:{models,instances:{length:ids.length},instanceAt,count:ids.length,
    description:manifest.notes+' State SHA256 '+manifest.stateSha256,
    forest:true,individual:tree!==null,
    views:tree===null?{
      trail:{position:[-4,7,-8],target:[0,12,-26]},
      canopy:{position:[30,42,-25],target:[30,12,-26]},
      sky:{position:[30,6.35,-25],target:[30,24,-25.2]},
      clearing:{position:[18,9,-24],target:[-4,12,-30]},
      overview:{position:[145,115,140],target:[0,12,0]}
    }:null,
    camera:tree===null?{position:[-4,7,-8],target:[0,12,-26]}:null}};
}
