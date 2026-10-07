// Merge separately budgeted gallery meshes. Original exports are never loaded
// together: their resident triangle buffers alone exceed the laptop's VRAM.
import {galleryLayout} from './gallery-layout.mjs';
export async function loadGallery(base, focus = '', nearModels, maxTriangles = 4000000, dualLOD = false, onProgress = () => {}) {
  const get = async (url) => {
    const r = await fetch(url, {cache:'no-store'});
    if (!r.ok) throw Error(`Gallery asset unavailable: ${url}`);
    return r;
  };
  const index = await (await get(base + 'index.json')).json();
  const chunks = [], meshes = [], customMaterials = {};
  let byteOffset = 0, nextMaterial = 32;
  const columns = index.columns, rows = Math.ceil(index.entries.length / columns);
  const layout=galleryLayout(index), extent=layout.extent;
  if (!nearModels) {
    const at=layout.items.find(e=>e.id===focus);
    nearModels=!at?[]:layout.items.map(e=>({id:e.id,d:Math.hypot(...e.target.map((v,k)=>v-at.target[k]))})).sort((a,b)=>a.d-b.d).slice(0,4).map(e=>e.id);
  }
  let triangleBudget=index.entries.reduce((sum,e)=>sum+(e.counts?.low||0),0);
  nearModels=nearModels.filter(id=>{
    const entry=index.entries.find(e=>e.id===id);
    const extra=(entry?.counts?.near||0)-(dualLOD?0:(entry?.counts?.low||0));
    if(triangleBudget+extra>maxTriangles) return false;
    triangleBudget+=extra; return true;
  });
  let target = [0, 0, 0];
  for (const [i, entry] of index.entries.entries()) {
    const materials = new Map();
    let minimumZ=Infinity;
    const levels=dualLOD && nearModels.includes(entry.id)?['low','near']:[nearModels.includes(entry.id)?'near':'low'];
    for(const level of levels){
    onProgress(`Loading shared geometry ${i+1}/${index.entries.length}: ${entry.id} (${level})…`);
    const root = base + entry.id + '/';
    const manifest = await (await get(root + level + '.json')).json();
    const response = await get(root + level + '.bin.gz');
    const raw = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if(manifest.byteLength!==undefined && raw.byteLength!==manifest.byteLength) throw Error('Gallery geometry/manifest mismatch: '+entry.id);
    if(manifest.sha256){
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),v=>v.toString(16).padStart(2,'0')).join('');
      if(digest!==manifest.sha256) throw Error('Gallery assets changed during loading: '+entry.id+'. Reload the gallery.');
    }
    const placement=layout.items[i], {x,y}=placement;
    if (entry.id === focus) target = placement.target;
    for (const [key, value] of Object.entries(manifest.customMaterials)) {
      if(materials.has(Number(key)))continue;
      materials.set(Number(key), nextMaterial);
      customMaterials[nextMaterial++] = {...value,attenuationDistance:(value.attenuationDistance||100)*placement.scale};
    }
    if(level===levels[0])for(const mesh of manifest.meshes) {
      const p=new Float32Array(raw,mesh.positions.offset,mesh.positions.count);
      for(let j=2;j<p.length;j+=3) minimumZ=Math.min(minimumZ,p[j]);
    }
    for (const mesh of manifest.meshes) {
      const p = new Float32Array(raw, mesh.positions.offset, mesh.positions.count);
      for (let j = 0; j < p.length; j += 3) { p[j]=p[j]*placement.scale+x; p[j+1]=p[j+1]*placement.scale+y; p[j+2]=(p[j+2]-minimumZ)*placement.scale; }
      const copy = {...mesh, galleryId:entry.id, lod:dualLOD?level:'low', material: materials.get(mesh.material) ?? mesh.material};
      for (const key of ['positions','normals','indices','colors','boundaries']) {
        if (mesh[key]) copy[key] = {...mesh[key], offset: mesh[key].offset + byteOffset};
      }
      meshes.push(copy);
    }
    chunks.push(new Uint8Array(raw)); byteOffset += raw.byteLength;
    }
  }
  const combined = new Uint8Array(byteOffset);
  let cursor = 0;
  for (const chunk of chunks) { combined.set(chunk, cursor); cursor += chunk.length; }
  return {raw: combined.buffer, manifest: {
    meshes, customMaterials, modules: [], nearModels, floor:0,
    framing: {center:[0,0,0], extent},
    camera: {yaw:.35, pitch:focus ? .78 : 1.04, distance:focus ? layout.items.find(e=>e.id===focus)?.distance||.9 : 5.2, target},
    notes:`${index.entries.length} models. Machinery shares authored dimensions; environments are marked 1:100 miniatures. ${nearModels.length} nearby models at higher detail. ${index.entries.find(e=>e.id===focus)?.scaleNote||''}`,
  }};
}
