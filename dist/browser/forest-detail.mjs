import {MeshoptSimplifier} from './vendor/meshoptimizer-1.3.0/meshopt_simplifier.js';
import {MeshoptEncoder} from './vendor/meshoptimizer-1.3.0/meshopt_encoder.js';

// All membership/material ranges remain independent. No disconnected-component
// pruning: simplification must not erase entire leaves to hit a triangle budget.
export async function forestDetailLevels(vertices,indices,ranges,radius){
 await Promise.all([MeshoptSimplifier.ready,MeshoptEncoder.ready]);
 if(vertices.length%10||ranges.reduce((n,r)=>n+r,0)!==indices.length)throw Error('Invalid forest geometry layout');
 const attributes=new Float32Array(vertices.length/10*6);
 for(let i=0;i<vertices.length/10;i++)attributes.set(vertices.subarray(i*10+3,i*10+9),i*6);
 const levels=[{indices:indices.slice().buffer,error:0}];
 for(let level=1;level<4;level++){
  const pieces=[];let error=0,offset=0;
  for(const count of ranges){const input=indices.subarray(offset,offset+count);offset+=count;
   const [result,e]=MeshoptSimplifier.simplifyWithAttributes(input,vertices,10,attributes,6,[.1,.1,.1,.5,.5,.5],null,Math.max(3,Math.floor(input.length/4**level/3)*3),radius*[0,.002,.008,.03][level],['ErrorAbsolute','ErrorClamped']);
   pieces.push(result);error=Math.max(error,e);
  }
  const result=new Uint32Array(pieces.reduce((n,p)=>n+p.length,0));let at=0;for(const p of pieces){result.set(p,at);at+=p.length;}
  levels.push({indices:result.buffer,error});
 }
 const words=new Uint32Array(vertices.buffer,vertices.byteOffset,vertices.length);
 for(const lod of levels){const [remap,unique]=MeshoptEncoder.reorderMesh(new Uint32Array(lod.indices),true,false),compact=new Uint32Array(unique*10);
  for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff)compact.set(words.subarray(i*10,i*10+10),remap[i]*10);
  lod.vertices=compact.buffer;
 }
 return levels;
}
