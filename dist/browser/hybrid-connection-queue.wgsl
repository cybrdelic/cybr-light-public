const CONNECTION_CAPACITY=131072u;
struct ConnectionWork {
 info:vec4u,origin:vec4f,destination:vec4f,normal:vec4f,geometric:vec4f,
 wo:vec4f,color:vec4f,throughput:vec4f,fraction:vec4f,direction:vec4f,
 result:vec4f,diffuse:vec4f
}
struct ConnectionQueue {count:atomic<u32>,overflow:atomic<u32>,success:atomic<u32>,pad:atomic<u32>,bounds:array<vec4f,32>,heads:array<atomic<u32>,518400>,work:array<ConnectionWork>}
@group(1) @binding(5) var<storage,read_write> connectionQueue:ConnectionQueue;
fn mayCrossGlass(origin:vec3f,destination:vec3f)->bool{
 let delta=destination-origin;let lengthToLight=length(delta);let d=delta/lengthToLight;
 let inverse=select(vec3f(-1),vec3f(1),d>=vec3f(0))/max(abs(d),vec3f(1e-10));
 for(var i=0u;i<atomicLoad(&connectionQueue.pad);i++){
  let a=(connectionQueue.bounds[i*2u].xyz-origin)*inverse;let b=(connectionQueue.bounds[i*2u+1u].xyz-origin)*inverse;
  let low=min(a,b);let high=max(a,b);
  if(max(max(low.x,low.y),max(low.z,0.))<=min(min(high.x,high.y),min(high.z,lengthToLight))){return true;}
 }return false;
}
fn enqueueConnection(value:ConnectionWork,pixel:u32){
 if(!mayCrossGlass(value.origin.xyz,value.destination.xyz)){return;}
 let slot=atomicAdd(&connectionQueue.count,1u);
 if(slot>=CONNECTION_CAPACITY){atomicStore(&connectionQueue.overflow,1u);return;}
 var item=value;item.info.x=pixel;item.info.y=atomicExchange(&connectionQueue.heads[pixel],slot);
 connectionQueue.work[slot]=item;
}
@compute @workgroup_size(64) fn clearConnections(@builtin(global_invocation_id) gid:vec3u){
 if(gid.x<518400u){atomicStore(&connectionQueue.heads[gid.x],0xffffffffu);}
 if(gid.x==0u){atomicStore(&connectionQueue.count,0u);atomicStore(&connectionQueue.overflow,0u);atomicStore(&connectionQueue.success,0u);}
}
@compute @workgroup_size(64) fn solveConnections(@builtin(global_invocation_id) gid:vec3u){
 let index=gid.x;if(index>=min(atomicLoad(&connectionQueue.count),CONNECTION_CAPACITY)||atomicLoad(&connectionQueue.overflow)!=0u){return;}
 let item=connectionQueue.work[index];let light=lighting.lights[u32(item.origin.w)];
 var c:RefractedConnection;
 if(item.info.z==0u){c=connectRefracted(item.origin.xyz,item.destination.xyz,light,item.info.w);}
 else{c=replayRefracted(item.origin.xyz,item.destination.xyz,item.direction.xyz,light,item.info.w);}
 var value=vec3f(0);var fraction=item.fraction.xyz;
 if(c.pdf>0.){
  atomicAdd(&connectionQueue.success,1u);
  if(item.info.z==0u){
   let nl=max(dot(item.normal.xyz,c.direction),0.);
   if(nl>0.&&dot(item.geometric.xyz,c.direction)>0.){
    let b=bsdf(item.normal.xyz,item.wo.xyz,c.direction,item.color.xyz,item.geometric.w,item.normal.w,item.wo.w);
    let pdf=CONNECTION_CHANCE*c.pdf;
    value=item.throughput.xyz*b.rgb*nl*light.emission.xyz*c.weight/pdf*mis(pdf,b.w*c.probability);
    if(item.color.w>.5){fraction=diffuseFraction(item.normal.xyz,item.wo.xyz,c.direction,item.color.xyz,item.geometric.w,item.wo.w,b.rgb);}
   }
  // Comparing dot(a,b) against almost 1 rejects matching float32 directions
  // when their rounded lengths differ. Test their difference directly.
  }else if(dot(c.direction-item.direction.xyz,c.direction-item.direction.xyz)<2e-7){
   let weight=mis(item.direction.w*item.destination.w,CONNECTION_CHANCE*c.pdf);
   value=item.throughput.xyz*(weight-item.throughput.w);
  }
 }
 connectionQueue.work[index].result=vec4f(value,c.pdf);connectionQueue.work[index].diffuse=vec4f(fraction,dot(c.direction-item.direction.xyz,c.direction-item.direction.xyz));
 connectionQueue.work[index].normal.w=c.probability;
}
@compute @workgroup_size(64) fn resolveConnections(@builtin(global_invocation_id) gid:vec3u){
 let pixel=gid.x;if(pixel>=u.size.x*u.size.y||atomicLoad(&connectionQueue.overflow)!=0u){return;}
 let current=(u.size.z&1u)*u.size.x*u.size.y+pixel;var value=signals[current];
 var index=atomicLoad(&connectionQueue.heads[pixel]);var visited=0u;
 let progressive=lab.mode!=10u&&lab.mode!=11u&&lab.mode!=12u;
 let weight=.25/select(1.,f32(lab.referenceFrame+1u),progressive);
 loop{if(index==0xffffffffu||index>=CONNECTION_CAPACITY||visited>=128u){break;}
  let item=connectionQueue.work[index];addSignal(&value,item.result.xyz*weight,item.diffuse.xyz,u32(item.fraction.w));index=item.info.y;visited++;
 }
 signals[current]=value;result[pixel]=vec4f(showSignals(value),1);
}
