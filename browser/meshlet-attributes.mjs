// Bounded 64-triangle attribute clusters in existing SAH order. Only exact
// duplicate normal/color records are shared; intersection geometry is untouched.
export function packMeshletAttributes(attributes,trianglesPerCluster=64){
 if(!(attributes instanceof Float32Array)||attributes.length%24||!Number.isInteger(trianglesPerCluster)||trianglesPerCluster<1||trianglesPerCluster>256)throw Error('Invalid meshlet attributes');
 const count=attributes.length/24,src=new Uint32Array(attributes.buffer,attributes.byteOffset,attributes.length);
 const vertexBase=4+count*4,out=new Uint32Array(vertexBase+count*24);out[0]=vertexBase/4;
 let vertices=0,clusters=0;
 for(let start=0;start<count;start+=trianglesPerCluster){
  const map=new Map();clusters++;
  for(let i=start;i<Math.min(count,start+trianglesPerCluster);i++)for(let j=0;j<3;j++){
   const n=i*24+j*4,c=i*24+12+j*4;
   const key=[...src.subarray(n,n+4),...src.subarray(c,c+4)].join(',');let vertex=map.get(key);
   if(vertex===undefined){vertex=vertices++;map.set(key,vertex);out.set(src.subarray(n,n+4),vertexBase+vertex*8);out.set(src.subarray(c,c+4),vertexBase+vertex*8+4);}
   out[4+i*4+j]=vertex;
  }
 }
 return {data:new Float32Array(out.buffer.slice(0,(vertexBase+vertices*8)*4)),clusters,vertices,originalBytes:attributes.byteLength};
}
export function meshletAttributeShader(source){
 const declaration='var<storage,read> attributes:array<Attributes>;';
 if(!source.includes(declaration))throw Error('Meshlet attribute ABI changed');
 source=source.replace(declaration,`var<storage,read> meshletAttributes:array<vec4u>;
fn loadAttributes(id:i32)->Attributes{
 let indices=meshletAttributes[1u+u32(id)];let base=meshletAttributes[0].x;
 let a=base+indices.x*2u;let b=base+indices.y*2u;let c=base+indices.z*2u;
 return Attributes(bitcast<vec4f>(meshletAttributes[a]),bitcast<vec4f>(meshletAttributes[b]),bitcast<vec4f>(meshletAttributes[c]),bitcast<vec4f>(meshletAttributes[a+1u]),bitcast<vec4f>(meshletAttributes[b+1u]),bitcast<vec4f>(meshletAttributes[c+1u]));
}`);
 return source.replace(/attributes\[([^\]]+)\]/g,'loadAttributes($1)');
}
