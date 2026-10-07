// Diagnostic-only counters. They change shader register pressure: never use
// instrumented frame time as a production performance measurement.
export function traversalProfileShader(source){
 if(!source.includes('samples[index]=Pixel'))throw Error('Traversal profiler requires baseline Pixel transport');
 source=`@group(0) @binding(8) var<storage,read_write> traversalStats:array<vec4f>;
 var<private> traversalCounts:vec4u;
 `+source;
 source=source.replace('fn trace(o:vec3f,d:vec3f,limit:f32,anyHit:bool)->Hit{','fn trace(o:vec3f,d:vec3f,limit:f32,anyHit:bool)->Hit{traversalCounts.x++;');
 source=source.replace('root:u32,instance:u32)->Hit{','root:u32,instance:u32)->Hit{traversalCounts.w++;');
 source=source.replaceAll('count--;let','count--;traversalCounts.y++;let');
 // Only BVH leaf triangle tests; not material/lighting reads.
 source=source.replaceAll('let id=node.links.z+k;','traversalCounts.z++;let id=node.links.z+k;');
 source=source.replace('samples[index]=Pixel','traversalStats[index]=vec4f(traversalCounts);samples[index]=Pixel');
 return source;
}
export function summarizeTraversal(data){
 const names=['traceCalls','nodeVisits','triangleTests','blasEntries'];
 return Object.fromEntries(names.map((name,c)=>{
  const values=[];let sum=0,max=0;for(let i=c;i<data.length;i+=4){const v=data[i];sum+=v;max=Math.max(max,v);values.push(v);}
  values.sort((a,b)=>a-b);return [name,{mean:sum/values.length,p95:values[Math.floor(values.length*.95)],max}];
 }));
}
