import {cameraBasis} from './hybrid-geometry.mjs';
import {mountPlayControls} from './play-controls.mjs';
import {readBuffer} from './readback.mjs';
const canvas=document.querySelector('canvas'),status=document.querySelector('#status');
const state={ready:false,frames:0,errors:[],gpuMs:[],frameMs:[],instances:0,mode:'raster-cached-sun-approximate-sky'};
const fail=e=>{state.errors.push(e.message||String(e));status.textContent=state.errors.at(-1);};
const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
if(!adapter)throw Error('WebGPU adapter unavailable');
const timing=adapter.features.has('timestamp-query');
const device=await adapter.requestDevice({requiredFeatures:timing?['timestamp-query']:[],requiredLimits:{maxBufferSize:Math.min(adapter.limits.maxBufferSize,512*1024*1024),maxStorageBufferBindingSize:Math.min(adapter.limits.maxStorageBufferBindingSize,256*1024*1024)}});
device.addEventListener('uncapturederror',e=>fail(e.error));device.lost.then(info=>fail(Error('GPU device lost: '+info.message)));
const context=canvas.getContext('webgpu'),format=navigator.gpu.getPreferredCanvasFormat();context.configure({device,format,alphaMode:'opaque'});
const data=await new Promise((resolve,reject)=>{const worker=new Worker(new URL('./forest-raster-worker.mjs',import.meta.url),{type:'module'});worker.onmessage=({data})=>{worker.terminate();data.error?reject(Error(data.error)):resolve(data);};worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage({});});
state.instances=data.count;status.textContent='Uploading indexed forest geometry…';
const buffer=(data,usage)=>{const b=device.createBuffer({size:Math.max(16,typeof data==='number'?data:data.byteLength),usage:usage|GPUBufferUsage.COPY_DST});if(typeof data!=='number')device.queue.writeBuffer(b,0,data);return b;};
const uniform=buffer(128,GPUBufferUsage.UNIFORM),shadowUniform=buffer(128,GPUBufferUsage.UNIFORM);
const instances=buffer(data.instances,GPUBufferUsage.STORAGE),visible=buffer(data.count*16,GPUBufferUsage.STORAGE),lodErrors=buffer(data.lodErrors,GPUBufferUsage.STORAGE);
const drawWords=new Uint32Array(data.draw),indirect=buffer(data.draw,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_SRC);
const batches=data.batches.flatMap((b,i)=>b.levels.map((lod,k)=>({id:b.id,level:k,vertex:buffer(lod.vertices,GPUBufferUsage.VERTEX),index:buffer(lod.indices,GPUBufferUsage.INDEX),param:buffer(new Uint32Array([drawWords[(i*4+k)*8+5],0,0,0]),GPUBufferUsage.UNIFORM),shadowParam:buffer(new Uint32Array([drawWords[i*32+5]/4,0,0,0]),GPUBufferUsage.UNIFORM)})));
// GPU uploads own their copies; release the worker's large transfer payloads.
delete data.batches;delete data.instances;delete data.lodErrors;
const shader=async file=>{const response=await fetch(file);if(!response.ok)throw Error('Shader unavailable: '+file);const m=device.createShaderModule({code:await response.text()});const info=await m.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(x=>x.message).join('\n'));return m;};
const compute=await device.createComputePipelineAsync({layout:'auto',compute:{module:await shader('./forest-game.wgsl'),entryPoint:'cull'}});
const renderModule=await shader('./forest-game-render.wgsl');
const layout=[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x3'},{shaderLocation:3,offset:36,format:'uint32'}]}];
const raster=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:renderModule,entryPoint:'vertex',buffers:layout},fragment:{module:renderModule,entryPoint:'fragment',targets:[{format}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'greater'},multisample:{count:4}});
const sunRaster=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:renderModule,entryPoint:'vertex',buffers:layout},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less',depthBias:2,depthBiasSlopeScale:2}});
const texture=(size,format,sampleCount=1,extra=0)=>device.createTexture({size,format,sampleCount,usage:GPUTextureUsage.RENDER_ATTACHMENT|extra});
const shadow=texture([4096,4096],'depth32float',1,GPUTextureUsage.TEXTURE_BINDING),shadowView=shadow.createView();
const color=texture([960,540],format,4),depth=texture([960,540],'depth32float',4);
const group=(pipeline,index,resources)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(index),entries:resources.map(([binding,resource])=>({binding,resource:resource instanceof GPUBuffer?{buffer:resource}:resource}))});
const computeGroup=group(compute,0,[[0,uniform],[1,instances],[2,indirect],[3,visible],[4,lodErrors]]);
const renderGroup=group(raster,0,[[0,uniform],[1,instances],[2,visible],[3,shadowView],[4,device.createSampler({compare:'less-equal',magFilter:'linear',minFilter:'linear'})]]);
const shadowGroup=group(sunRaster,0,[[0,shadowUniform],[1,instances],[2,visible]]);
for(const b of batches){b.group=group(raster,1,[[0,b.param]]);b.shadowGroup=group(sunRaster,1,[[0,b.shadowParam]]);}
const normalize=a=>{const l=Math.hypot(...a);return a.map(v=>v/l);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sun=normalize([-.469,.559,.684]),sunRight=normalize(cross([0,1,0],sun)),sunUp=cross(sun,sunRight);
let pose,previousTime=0,flight=0,paused=false;
function view(name){const {position,target}=data.views[name];const d=position.map((x,i)=>x-target[i]),distance=Math.hypot(...d);pose={target:[...target],distance,yaw:Math.atan2(d[0],d[2]),pitch:Math.asin(d[1]/distance)};document.querySelector('#view').value=name;}
view('trail');document.querySelector('#view').onchange=e=>view(e.target.value);
let lodPixels=.75;
document.querySelector('#detail').onchange=e=>{lodPixels=Number(e.target.value);state.gpuMs=[];state.frameMs=[];};
function uniforms(shadowPass=false){const c=cameraBasis(pose);return new Float32Array([...c.eye,0,...c.right,960/540,...c.up,0,...c.forward,c.tan,...sunRight,230,...sunUp,230,...sun,600,shadowPass?1:0,0,lodPixels,0]);}
device.queue.writeBuffer(shadowUniform,0,uniforms(true));
// Static sunlight is cached once; no noisy per-frame shadow rays.
for(let start=0;start<batches.length;start+=4){
 status.textContent=`Caching sunlight ${Math.round(start/batches.length*100)}%…`;
 const encoder=device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:shadowView,depthClearValue:1,depthLoadOp:start?'load':'clear',depthStoreOp:'store'}});
 pass.setPipeline(sunRaster);pass.setBindGroup(0,shadowGroup);
 for(let i=start;i<Math.min(start+4,batches.length);i++){const b=batches[i];if(b.level!==0)continue;pass.setBindGroup(1,b.shadowGroup);pass.setVertexBuffer(0,b.vertex);pass.setIndexBuffer(b.index,'uint32');pass.drawIndexed(drawWords[i*8],drawWords[i*8+6]);}
 pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();if(state.errors.length)throw Error(state.errors.at(-1));
}
const controls=mountPlayControls(canvas,{ready:()=>state.ready,pose:()=>pose,apply:p=>pose=p,resume:()=>paused=false});
const bundleEncoder=device.createRenderBundleEncoder({colorFormats:[format],depthStencilFormat:'depth32float',sampleCount:4});
bundleEncoder.setPipeline(raster);bundleEncoder.setBindGroup(0,renderGroup);
batches.forEach((b,i)=>{bundleEncoder.setBindGroup(1,b.group);bundleEncoder.setVertexBuffer(0,b.vertex);bundleEncoder.setIndexBuffer(b.index,'uint32');bundleEncoder.drawIndexedIndirect(indirect,i*32);});
const forestBundle=bundleEncoder.finish();
let drag;
canvas.addEventListener('pointerdown',e=>{if(document.pointerLockElement!==canvas){drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);}});
canvas.addEventListener('pointermove',e=>{if(!drag)return;pose.yaw-=(e.clientX-drag[0])*.005;pose.pitch=Math.max(-1.5,Math.min(1.5,pose.pitch+(e.clientY-drag[1])*.005));drag=[e.clientX,e.clientY];});
canvas.addEventListener('pointerup',()=>drag=null);
canvas.addEventListener('wheel',e=>{e.preventDefault();pose.distance=Math.max(.1,pose.distance*Math.exp(e.deltaY*.001));},{passive:false});
const queries=timing?device.createQuerySet({type:'timestamp',count:2}):null;
const queryBuffer=timing?buffer(16,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):null;
const readback=timing?device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}):null;let reading=false;
const average=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
function frame(now){requestAnimationFrame(frame);if(paused||document.hidden||state.errors.length||flight>=2)return;controls.update(now);
 if(previousTime){state.frameMs.push(now-previousTime);if(state.frameMs.length>120)state.frameMs.shift();}previousTime=now;
 device.queue.writeBuffer(uniform,0,uniforms());device.queue.writeBuffer(indirect,0,drawWords);
 const encoder=device.createCommandEncoder(),timed=queries&&!reading;
 const cp=encoder.beginComputePass(timed?{timestampWrites:{querySet:queries,beginningOfPassWriteIndex:0}}:{});cp.setPipeline(compute);cp.setBindGroup(0,computeGroup);cp.dispatchWorkgroups(Math.ceil(data.count/128));cp.end();
 const pass=encoder.beginRenderPass({colorAttachments:[{view:color.createView(),resolveTarget:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'discard',clearValue:{r:.64,g:.76,b:.84,a:1}}],depthStencilAttachment:{view:depth.createView(),depthClearValue:0,depthLoadOp:'clear',depthStoreOp:'discard'},...(timed?{timestampWrites:{querySet:queries,endOfPassWriteIndex:1}}:{})});
 pass.executeBundles([forestBundle]);pass.end();
 if(timed){encoder.resolveQuerySet(queries,0,2,queryBuffer,0);encoder.copyBufferToBuffer(queryBuffer,0,readback,0,16);reading=true;}
 device.queue.submit([encoder.finish()]);flight++;state.frames++;
 device.queue.onSubmittedWorkDone().then(()=>flight--,fail);
 if(timed)readback.mapAsync(GPUMapMode.READ).then(()=>{const t=new BigUint64Array(readback.getMappedRange());state.gpuMs.push(Number(t[1]-t[0])/1e6);if(state.gpuMs.length>60)state.gpuMs.shift();readback.unmap();reading=false;},fail);
 if(state.frames%20===0)document.querySelector('#timing').textContent=`GPU ${average(state.gpuMs)?.toFixed(2)??'—'} ms · presented ${(1000/average(state.frameMs)).toFixed(0)} FPS`;
}
window.forestGame={snapshot:()=>({...state,gpuMs:average(state.gpuMs),frameMs:average(state.frameMs),gpuP95:[...state.gpuMs].sort((a,b)=>a-b)[Math.floor(state.gpuMs.length*.95)],lodPixels,camera:pose}),setView:view,pause:()=>paused=true,resume:()=>{paused=false;previousTime=0;},setCamera:p=>pose=p,
 setLodPixels:value=>{if(!Number.isFinite(value)||value<0||value>4)throw Error('LOD threshold must be 0–4 pixels');lodPixels=value;state.gpuMs=[];state.frameMs=[];},
 async inspectDraws(){const words=new Uint32Array(await readBuffer(device,indirect,{size:data.draw.byteLength}));return batches.map((b,i)=>({id:b.id,level:b.level,instances:words[i*8+1],triangles:words[i*8+1]*words[i*8]/3})).sort((a,b)=>b.triangles-a.triangles);}};
window.addEventListener('pagehide',()=>{paused=true;controls.dispose();device.destroy();});
state.ready=true;status.textContent='';requestAnimationFrame(frame);
