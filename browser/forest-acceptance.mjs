// Instantiated only by --acceptance's validation-only served runtime.
import {readBuffer} from './readback.mjs';
import {prepareAcceptanceInputs,auditLodState,predictFallbackCounts,auditDrawCounts,compareCoverage} from './forest-acceptance-plan.mjs';
export {prepareAcceptanceInputs};
export async function createForestAcceptance(c){
 const {device,input}=c,width=960,height=540;
 const outputColor=device.createTexture({size:[width,height],format:c.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
 const colorBytes=device.createBuffer({size:width*height*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
 const depthBytes=device.createBuffer({size:width*height*4*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const pipeline=async(name,entry)=>{const response=await fetch('./forest-acceptance-'+name+'.wgsl');if(!response.ok)throw Error('Acceptance shader unavailable');const module=device.createShaderModule({code:await response.text()}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));return device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:entry}});};
 const reset=await pipeline('reset','reset'),depth=await pipeline('depth','capture');
 const resetGroup=device.createBindGroup({layout:reset.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:c.instances}}]});
 const depthGroup=device.createBindGroup({layout:depth.getBindGroupLayout(0),entries:[{binding:0,resource:c.depth.createView()},{binding:1,resource:{buffer:depthBytes}}]});
 const resumeIndex=Number(new URLSearchParams(location.search).get('acceptanceFrom')??0);
 if(!Number.isInteger(resumeIndex)||resumeIndex<0||!input.manifest.cases[resumeIndex]?.resetHistory)throw Error('Acceptance continuation must begin at a recorded history reset');
 let active=false,previous=null,lastImage=null,lastCase=null,nextCase=resumeIndex;
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 async function render(reference){
  const values=c.uniforms().slice();values[29]=reference?1:0;values[31]=1;
  device.queue.writeBuffer(c.uniform,0,values);device.queue.writeBuffer(c.indirect,0,c.drawWords);device.queue.writeBuffer(c.stats,0,new Uint32Array(4));
  const encoder=device.createCommandEncoder(),compute=encoder.beginComputePass();compute.setPipeline(c.compute);compute.setBindGroup(0,c.computeGroup);compute.dispatchWorkgroups(c.workgroups);compute.end();
  const pass=encoder.beginRenderPass({colorAttachments:[{view:c.color.createView(),resolveTarget:outputColor.createView(),loadOp:'clear',storeOp:'discard',clearValue:{r:.64,g:.76,b:.84,a:1}}],depthStencilAttachment:{view:c.depth.createView(),depthClearValue:0,depthLoadOp:'clear',depthStoreOp:'store'}});
  pass.executeBundles([c.forestBundle]);pass.end();
  const capture=encoder.beginComputePass();capture.setPipeline(depth);capture.setBindGroup(0,depthGroup);capture.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));capture.end();
  encoder.copyTextureToBuffer({texture:outputColor},{buffer:colorBytes,bytesPerRow:width*4,rowsPerImage:height},[width,height]);device.queue.submit([encoder.finish()]);
  const [color,depthData,draws,stats]=await Promise.all([readBuffer(device,colorBytes),readBuffer(device,depthBytes),readBuffer(device,c.indirect),readBuffer(device,c.stats,{size:16})]);
  return {color:new Uint8Array(color),depth:new Float32Array(depthData),draws:new Uint32Array(draws),stats:new Uint32Array(stats),uniforms:values};
 }
 function png(color){
  const rgba=new Uint8ClampedArray(color);if(c.format==='bgra8unorm')for(let i=0;i<rgba.length;i+=4){const red=rgba[i];rgba[i]=rgba[i+2];rgba[i+2]=red;}
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);return canvas.toDataURL('image/png').split(',')[1];
 }
 return {manifest:{...input.manifest,resumeIndex},async capturePair(index,{images=false}={}){
  assert(!active,'Acceptance capture already active');assert(index===nextCase,'Acceptance cases must run in recorded order');const test=input.manifest.cases[index];assert(test,'Unknown acceptance case');active=true;c.pause();
  try{
   await device.queue.onSubmittedWorkDone();assert(c.state.errors.length===0,'Prior renderer error');c.setPose(test.pose);c.setLod(test.lodPixels);
   if(test.resetHistory){const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(reset);pass.setBindGroup(0,resetGroup);pass.dispatchWorkgroups(c.workgroups);pass.end();device.queue.submit([encoder.finish()]);previous=null;lastImage=null;lastCase=null;}
   const normal=await render(false),states=new Uint32Array(await readBuffer(device,c.acceptanceState)),reference=await render(true),u=normal.uniforms,camera={eye:Array.from(u.slice(0,3)),right:Array.from(u.slice(4,7)),up:Array.from(u.slice(8,11)),forward:Array.from(u.slice(12,15)),tan:u[15],aspect:u[7],lodPixels:u[30]};
   const lod=auditLodState(states,previous,input,camera),fallbackCounts=predictFallbackCounts(states,input,camera),draw=auditDrawCounts(normal.draws,reference.draws,input,lod.populations,fallbackCounts),coverage=compareCoverage(normal,reference);
   const temporal=lastImage?{normal:compareCoverage(normal,lastImage.normal),reference:compareCoverage(reference,lastImage.reference)}:null;
   const hold=test.kind.startsWith('hold-')&&lastCase&&JSON.stringify(lastCase.pose)===JSON.stringify(test.pose)&&lastCase.lodPixels===test.lodPixels,holdChanged=hold&&previous?lod.changed:0;
   const report={index,view:test.view,kind:test.kind,pose:test.pose,lodPixels:test.lodPixels,resetHistory:test.resetHistory,targetId:test.targetId,targetState:test.targetId===null?null:{before:states[test.targetId]&3,after:(states[test.targetId]>>>2)&3,rootVisible:Boolean(states[test.targetId]&16)},lod:{...lod,populations:undefined},draw,coverage,temporal:temporal?{normalChangedPixels:temporal.normal.changedPixels,referenceChangedPixels:temporal.reference.changedPixels,normalMaxChannelDifference:temporal.normal.maxChannelDifference,referenceMaxChannelDifference:temporal.reference.maxChannelDifference}:null,holdChanged,normalCounters:Array.from(normal.stats),referenceCounters:Array.from(reference.stats),errors:[...c.state.errors]};
   report.geometryPassed=coverage.geometryPassed&&lod.historyErrors===0&&lod.selectorErrors===0&&lod.rootWitnessErrors===0&&draw.overflow===0&&draw.referenceErrors===0&&draw.fallbackErrors===0&&normal.stats[3]===0&&reference.stats[3]===0&&normal.stats[0]===lod.visible&&reference.stats[0]===lod.visible&&holdChanged===0&&c.state.errors.length===0;
   report.requiresImageReview=!coverage.imageExact;
   report.fallbackBoundsDifferences=input.records.flatMap((r,i)=>!r.clustered&&(fallbackCounts[i]!==lod.populations[r.model*4+r.level]||normal.draws[i*8+1]!==fallbackCounts[i])?[{draw:i,model:r.model,level:r.level,rootCount:lod.populations[r.model*4+r.level],selectedLodExpectedCount:fallbackCounts[i],actualCount:normal.draws[i*8+1]}]:[]);
   report.appliedUniforms=Array.from(u);
   report.lodStateSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',states)),x=>x.toString(16).padStart(2,'0')).join('');
   if(images||!report.geometryPassed||report.requiresImageReview)report.images={normal:png(normal.color),reference:png(reference.color)};
   previous=states;lastImage={normal:{color:normal.color,depth:normal.depth},reference:{color:reference.color,depth:reference.depth}};lastCase=test;nextCase++;return report;
  }finally{active=false;}
 }};
}
