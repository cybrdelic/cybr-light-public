// Diagnostic reads own one current cull. Never infer applied flags from requested state.
export function createForestDiagnostics({device,uniform,indirect,drawWords,stats,uniforms,compute,computeGroup,workgroups,readBuffer}){
 let busy=false;
 return {get busy(){return busy;},async capture({counters=false}={}){
  if(busy)throw Error('Forest diagnostic already in progress');
  if(counters&&!stats)throw Error('Meshlet counters unavailable');
  busy=true;
  try{
   // Stop new frame submissions through busy, then drain the old in-flight settings.
   await device.queue.onSubmittedWorkDone();
   const values=uniforms().slice();if(counters)values[31]=1;
   device.queue.writeBuffer(uniform,0,values);device.queue.writeBuffer(indirect,0,drawWords);
   if(stats)device.queue.writeBuffer(stats,0,new Uint32Array(4));
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
   pass.setPipeline(compute);pass.setBindGroup(0,computeGroup);pass.dispatchWorkgroups(workgroups);pass.end();
   device.queue.submit([encoder.finish()]);
   const bytes=await readBuffer(device,counters?stats:indirect,{size:counters?16:drawWords.byteLength});
   return {bytes,countersEnabled:counters,sampling:'dedicated-current-cull',uniforms:values};
  }finally{busy=false;}
 }};
}
