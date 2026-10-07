// Append to hybrid-lighting.wgsl. Queue one owner per surface anchor, preserving
// screen-space locality within contiguous workgroup-sized chunks. Radiometric
// sampling, key identity, sample counts and seeds are unchanged.
var<workgroup> localCount:atomic<u32>;
var<workgroup> localSlots:array<u32,768>;
var<workgroup> globalStart:u32;
@compute @workgroup_size(1) fn clearQueue(){atomicStore(&owners[SLOTS],0u);}
@compute @workgroup_size(8,8) fn collectQueue(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&localCount,0u);}workgroupBarrier();
 if(all(gid.xy<u.size.xy)){
  for(var s=0u;s<4u;s++){let data=loadVisibility(vec2i(gid.xy),i32(s));if(data.x==0u){continue;}
   if(data.x==1u&&s>0u&&loadVisibility(vec2i(gid.xy),0).x==1u){continue;}
   for(var corner=0u;corner<3u;corner++){
    let support=supportFor(data,corner);if(support.weight<1e-7){continue;}let slot=lookup(support.key);if(slot==SLOTS){continue;}
    let index=((gid.y*u.size.x+gid.x)*4u+s)*3u+corner;
    if(atomicLoad(&owners[slot])!=index){continue;}atomicAdd(&statistics[1],1u);let value=cells[slot].value;
    cells[slot].seen.x=u.size.z;
    if(value.w>=1024.||(value.w>0.&&((hash(support.key)+u.size.z)%4u)!=0u)){continue;}
    let at=atomicAdd(&localCount,1u);localSlots[at]=slot;
   }
  }
 }
 workgroupBarrier();
 if(lane==0u){globalStart=atomicAdd(&owners[SLOTS],atomicLoad(&localCount));}workgroupBarrier();
 for(var i=lane;i<atomicLoad(&localCount);i+=64u){atomicStore(&owners[SLOTS+4u+globalStart+i],localSlots[i]);}
}
@compute @workgroup_size(64) fn updateQueued(@builtin(global_invocation_id) gid:vec3u){
 if(gid.x>=atomicLoad(&owners[SLOTS])){return;}
 let slot=atomicLoad(&owners[SLOTS+4u+gid.x]);let key=cells[slot].key;var value=cells[slot].value;
 let sample=sampleIrradiance(hitFor(key),key.x!=1u&&(key.z&0x80000000u)!=0u,hash(key)^(u32(value.w)*6271u));
 value=vec4f(value.rgb+(sample-value.rgb)/(value.w+1.),value.w+1.);
 cells[slot].value=value;atomicAdd(&statistics[2],1u);
}
