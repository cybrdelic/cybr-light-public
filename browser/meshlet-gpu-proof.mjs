// Dedicated validation entrypoint. Open only after the GPU owner grants a slot.
import {buildForestClusterPlan,cullHierarchyCpu} from './meshlet-hierarchy.mjs';
import {readBuffer} from './readback.mjs';
const output=document.querySelector('#result');
window.meshletProof=(async()=>{
 const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw Error('WebGPU adapter unavailable');
 const device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
 try{
  const vertex=new Float32Array(180*3*10),words=new Uint32Array(vertex.buffer),indices=new Uint32Array(180*3);
  for(let t=0;t<180;t++)for(let j=0;j<3;j++){const i=t*3+j;vertex.set([(t%3-1)*20+j*.1,Math.floor(t/3)*.01,20+j*.02,0,1,0,.1,.2,.3],i*10);words[i*10+9]=t%2?128:1;indices[i]=i;}
  const batches=[{id:'fixture',radius:40,levels:[0,.01,.03,.1].map(error=>({vertices:vertex.slice().buffer,indices:indices.slice().buffer,error}))}];
  const instanceData=new Float32Array(128*12),iw=new Uint32Array(instanceData.buffer);
  for(let i=0;i<128;i++){const angle=i*.071,scale=.4+i%5*.2;instanceData.set([(i%9-4)*3,0,Math.floor(i/9)*2,scale,0,Math.sin(angle/2),0,Math.cos(angle/2)],i*12);iw[i*12+9]=129;instanceData[i*12+10]=40*scale;}
  const drawGroupSize=new URLSearchParams(location.search).get('meshletGroup')==='8'?8:1;
  const plan=buildForestClusterPlan(batches,[128],{drawGroupSize});
  const upload=(data,usage)=>{const buffer=device.createBuffer({size:Math.max(16,typeof data==='number'?data:data.byteLength),usage:usage|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});if(typeof data!=='number')device.queue.writeBuffer(buffer,0,data);return buffer;};
  const uniform=upload(128,GPUBufferUsage.UNIFORM),instances=upload(instanceData,GPUBufferUsage.STORAGE),draws=upload(plan.draw,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT),visible=upload(plan.visibleBytes,GPUBufferUsage.STORAGE),nodes=upload(plan.nodes,GPUBufferUsage.STORAGE),models=upload(plan.models,GPUBufferUsage.STORAGE),stats=upload(16,GPUBufferUsage.STORAGE);
  const response=await fetch('./forest-meshlet-cull.wgsl');if(!response.ok)throw Error('Missing cluster shader');const module=device.createShaderModule({code:await response.text()});
  const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'cull'}}),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[uniform,instances,draws,visible,nodes,models,stats].map((buffer,binding)=>({binding,resource:{buffer}}))});
  const results=[];
  for(const [index,camera] of [
   {eye:[0,0,0],forward:[0,0,1],right:[1,0,0],up:[0,1,0],tan:.15,aspect:1,lodPixels:0},
   {eye:[0,0,0],forward:[0,0,1],right:[1,0,0],up:[0,1,0],tan:1,aspect:1.8,lodPixels:.75},
   {eye:[25,4,-15],forward:[0,0,1],right:[1,0,0],up:[0,1,0],tan:.3,aspect:1.8,lodPixels:0},
   {eye:[0,0,0],forward:[0,0,1],right:[1,0,0],up:[0,1,0],tan:100,aspect:1,lodPixels:0}
  ].entries()){
   device.queue.writeBuffer(instances,0,instanceData);device.queue.writeBuffer(draws,0,plan.draw);device.queue.writeBuffer(stats,0,new Uint32Array(4));
   device.queue.writeBuffer(uniform,0,new Float32Array([...camera.eye,0,...camera.right,camera.aspect,...camera.up,0,...camera.forward,camera.tan,...new Float32Array(12),0,0,camera.lodPixels,1]));
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
   const expected=cullHierarchyCpu(plan,instanceData,camera),actualDraw=new Uint32Array(await readBuffer(device,draws,{size:plan.draw.byteLength})),actualVisible=new Uint32Array(await readBuffer(device,visible,{size:plan.visibleBytes})),actualStats=new Uint32Array(await readBuffer(device,stats,{size:16}));
   for(let command=0;command<plan.records.length;command++){const count=actualDraw[command*8+1],start=actualDraw[command*8+5],ids=Array.from(actualVisible.subarray(start,start+count)).sort((a,b)=>a-b);if(JSON.stringify(ids)!==JSON.stringify(expected.visible[command]))throw Error(`CPU/GPU visibility differs: case ${index}, command ${command}`);}
   if(actualStats[3]||errors.length)throw Error('Overflow or uncaptured GPU error: '+errors.join('\n'));
   results.push({case:index,triangles:expected.triangles,tested:actualStats[1],rejected:actualStats[2],overflow:actualStats[3],commands:plan.records.length});
  }
  const adapterInfo={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description};
  const report={passed:true,adapter:adapterInfo,drawGroupSize,optionalFeaturesRequested:[],cases:results,errors};output.textContent=JSON.stringify(report,null,2);return report;
 }finally{device.destroy();}
})().catch(error=>{output.textContent=error.stack||String(error);throw error;});
