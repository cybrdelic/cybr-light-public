// Lossless BVH node packing. Geometry and SAH leaf order are unchanged.
// Internal: low.w = left, high.w = right. Leaf: low.w = start,
// high.w = 0x80000000 | count. Bounds retain their original FP32 bits.
export function compactBVH(source){
 if(!(source instanceof ArrayBuffer)||source.byteLength%48)throw Error('Invalid BVH buffer');
 const src=new Uint32Array(source),out=new Uint32Array(src.length/12*8);
 for(let i=0;i<src.length/12;i++){
  const a=i*12,b=i*8,count=src[a+11];
  if(src[a+9]>=0x80000000||count>=0x80000000)throw Error('BVH packing overflow');
  out.set(src.subarray(a,a+3),b);out.set(src.subarray(a+4,a+7),b+4);
  out[b+3]=count?src[a+10]:src[a+8];out[b+7]=count?(count|0x80000000):src[a+9];
 }
 return out.buffer;
}
export function compactBVHShader(source){
 const declaration='struct Node { low:vec4f,high:vec4f,links:vec4u }';
 if(!source.includes(declaration)||!source.includes('node.links'))throw Error('Compact BVH shader contract changed');
 return source.replace(declaration,`struct Node { low:vec3f,left:u32,high:vec3f,right:u32 }
fn nodeLinks(node:Node)->vec4u{
 let a=node.left;let b=node.right;
 if((b&0x80000000u)!=0u){return vec4u(0,0,a,b&0x7fffffffu);}
 return vec4u(a,b,0,0);
}`).replaceAll('node.links','nodeLinks(node)');
}
