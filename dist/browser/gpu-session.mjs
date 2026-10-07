// Shared browser-independent preflight. API presence alone is not GPU readiness.
export async function probeGpuSession(canvas,{gpu=globalThis.navigator?.gpu,secure=globalThis.isSecureContext}={}){
 const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
 if(secure===false)fail('insecure','WebGPU requires HTTPS or localhost. Open this viewer over a secure connection.');
 if(!gpu?.requestAdapter)fail('unsupported','WebGPU is unavailable in this browser/device. Use a browser with WebGPU enabled and hardware acceleration. This renderer does not yet have a WebGL or CPU fallback.');
 let adapter;
 try{adapter=await gpu.requestAdapter({powerPreference:'high-performance'});}catch{}
 if(!adapter){try{adapter=await gpu.requestAdapter();}catch{}}
 if(!adapter)fail('adapter-unavailable','No usable WebGPU adapter is available. Check hardware acceleration and GPU drivers, then restart the browser.');
 let context;
 try{context=canvas.getContext('webgpu');}catch{}
 if(!context)fail('context-unavailable','A GPU adapter exists, but this tab cannot create a WebGPU canvas context. Reload the tab or restart the browser.');
 let format;
 try{format=gpu.getPreferredCanvasFormat();}catch{}
 if(!format)fail('format-unavailable','The browser cannot provide a WebGPU canvas format. Restart or update the browser.');
 return {gpu,adapter,context,format};
}

// Timing queries are diagnostics, not transport inputs. Avoid the optional
// query/readback driver path on mobile unless explicitly requested.
export function gpuDeviceOptions(adapter,{mobile=false,recovery=false,timings=null}={}){
 const timestamp=adapter.features.has('timestamp-query')&&
  (timings===true||(timings!==false&&!mobile&&!recovery));
 return {requiredFeatures:timestamp?['timestamp-query']:[],requiredLimits:{
  maxComputeWorkgroupStorageSize:Math.min(adapter.limits.maxComputeWorkgroupStorageSize,32768),
  maxStorageBufferBindingSize:Math.min(adapter.limits.maxStorageBufferBindingSize,512*1024*1024),
  maxBufferSize:Math.min(adapter.limits.maxBufferSize,512*1024*1024),
 }};
}

// Keep loss, shutdown and queued compilation under one owner. A later queue
// rejection must not replace the device-loss reason with a generic Dawn error.
export function createGpuRuntime(device,{serial=false,onFailure=()=>{}}={}){
 let phase='Configuring canvas',lost=null,disposed=false,firstError=null,tail=Promise.resolve();
 const assertActive=()=>{if(disposed||lost){const error=new Error(disposed?'GPU session closed':'GPU device lost');error.name='AbortError';throw error;}};
 const report=(error)=>{
  if(disposed)return null;
  if(!firstError)firstError={phase,name:error?.name||'Error',message:error?.message||String(error)};
  const detail=lost?`GPU device lost (${lost.reason}) during ${lost.phase}: ${lost.message}`:
   `Renderer failed during ${firstError.phase}: ${firstError.message}`;
  onFailure(detail);
  return detail;
 };
 device.addEventListener('uncapturederror',event=>report(event.error));
 device.lost.then(info=>{
  if(disposed)return;
  lost={reason:info.reason||'unknown',message:info.message||'No driver detail was provided',phase};
  report(new Error(lost.message));
 });
 return {
  setPhase(value){assertActive();phase=value;},assertActive,report,
  snapshot:()=>({phase,lost:lost?{...lost}:null,disposed,serialCompilation:serial,firstError:firstError?{...firstError}:null}),
  compile(kind,descriptor){
   const run=async()=>{assertActive();phase=`Compiling ${descriptor.label||descriptor.compute?.module?.label||descriptor.vertex?.module?.label||kind}`;
    try{const pipeline=await device[kind](descriptor);assertActive();return pipeline;}
    catch(error){report(error);throw error;}};
   if(!serial)return run();
   const pending=tail.then(run);tail=pending.catch(()=>{});return pending;
  },
  dispose(){if(disposed)return;disposed=true;device.destroy();},
 };
}

export function validateGpuBuffer(size,usage,limits,storageUsage=128){
 const bytes=Math.max(16,Math.ceil(size/4)*4);
 if(!Number.isSafeInteger(bytes)||bytes<16)throw Error('Invalid GPU buffer size');
 const limit=(usage&storageUsage)?Math.min(limits.maxBufferSize,limits.maxStorageBufferBindingSize):limits.maxBufferSize;
 if(bytes>limit)throw Error(`GPU buffer needs ${bytes} bytes; this device permits ${limit}. Choose another scene or resolution, then retry.`);
 return bytes;
}
