// Publication is dispatch-separated. Resolve may claim/write new requests but
// cannot consume them until the next update dispatch publishes ready=2.
struct PathCell {
 state:atomic<u32>,pad0:u32,pad1:u32,pad2:u32,
 positionKey:vec4i,identity:vec4u,directionKey:vec4i,
 point:vec4f,direction:vec4f,normal:vec4f,value:vec4f
}
struct PathStore {lookups:atomic<u32>,hits:atomic<u32>,requests:atomic<u32>,updates:atomic<u32>,cells:array<PathCell>}
@group(1) @binding(5) var<storage,read_write> pathStore:PathStore;
const PATH_SLOTS=65536u;
fn pathLookup(h:Hit,p:vec3f,n:vec3f,d:vec3f,budget:u32)->vec4f{
 atomicAdd(&pathStore.lookups,1u);
 let positionKey=vec4i(vec3i(floor(p*64.)),0);
 let directionKey=vec4i(vec3i(floor(d*16.)),0);
 let identity=vec4u(u32(attributes[h.id].n0.w),/*PATH_INSTANCE*/,lab.epoch,budget);
 var hash=2166136261u;
 for(var k=0u;k<4u;k++){hash=(hash^bitcast<u32>(positionKey[k]))*16777619u;hash=(hash^identity[k])*16777619u;hash=(hash^bitcast<u32>(directionKey[k]))*16777619u;}
 for(var probe=0u;probe<4u;probe++){
  let slot=(hash+probe)&(PATH_SLOTS-1u);let state=atomicLoad(&pathStore.cells[slot].state);
  if(state==0u){
   let claim=atomicCompareExchangeWeak(&pathStore.cells[slot].state,0u,1u);
   if(claim.exchanged){
    pathStore.cells[slot].positionKey=positionKey;pathStore.cells[slot].identity=identity;pathStore.cells[slot].directionKey=directionKey;
    pathStore.cells[slot].point=vec4f(p,0);pathStore.cells[slot].direction=vec4f(d,0);pathStore.cells[slot].normal=vec4f(n,0);pathStore.cells[slot].value=vec4f(0);
    atomicAdd(&pathStore.requests,1u);return vec4f(0);
   }
  }
  if(state!=2u){continue;}
  let key=pathStore.cells[slot].identity;
  if(any(key!=identity)||any(pathStore.cells[slot].positionKey!=positionKey)||any(pathStore.cells[slot].directionKey!=directionKey)){continue;}
  if(dot(pathStore.cells[slot].normal.xyz,n)<.999||pathStore.cells[slot].value.w<16.){return vec4f(0);}
  atomicAdd(&pathStore.hits,1u);return pathStore.cells[slot].value;
 }
 return vec4f(0);
}
@compute @workgroup_size(64) fn updatePathCache(@builtin(global_invocation_id) gid:vec3u){
 // 1/8 of the table per frame, four independent reference paths per cell.
 let slot=gid.x*8u+(u.size.z&7u);if(slot>=PATH_SLOTS){return;}
 let state=atomicLoad(&pathStore.cells[slot].state);if(state==0u){return;}
 if(pathStore.cells[slot].identity.z!=lab.epoch){return;}
 let old=pathStore.cells[slot].value;if(old.w>=64.){return;}
 let p=pathStore.cells[slot].point.xyz;let d=pathStore.cells[slot].direction.xyz;
 let budget=pathStore.cells[slot].identity.w;var sum=vec3f(0);
 for(var s=0u;s<4u;s++){sum+=cacheIncident(p-d*.0001,d,slot*9781u+(u32(old.w)+s)*6271u+1299709u,0.,budget);}
 pathStore.cells[slot].value=vec4f((old.rgb*old.w+sum)/(old.w+4.),old.w+4.);
 atomicStore(&pathStore.cells[slot].state,2u);atomicAdd(&pathStore.updates,1u);
}
fn opticalHistory(current:u32,previous:u32,transmission:bool)->vec4f{return vec4f(0);}
