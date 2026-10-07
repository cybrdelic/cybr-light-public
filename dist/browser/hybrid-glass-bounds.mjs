// Conservative bounds for the ordinary-mesh proof scene; never trim triangles.
export function glassBounds(triangles,attributes,materials){
 const t=new Float32Array(triangles),a=new Float32Array(attributes),m=new Float32Array(materials),objects=new Map();
 for(let i=0;i<t.length/12;i++){
  const o=i*12,material=t[o+3];if(m[material*16+5]<.5)continue;
  const boundary=a[i*24+3];let b=objects.get(boundary);
  if(!b){b={low:[Infinity,Infinity,Infinity],high:[-Infinity,-Infinity,-Infinity]};objects.set(boundary,b);}
  for(let v=0;v<3;v++)for(let k=0;k<3;k++){
   const x=t[o+k]+(v?t[o+v*4+k]:0);b.low[k]=Math.min(b.low[k],x);b.high[k]=Math.max(b.high[k],x);
  }
 }
 if(objects.size>16)throw Error('Proof-scene glass bounds exceed fixed capacity');
 const data=new Float32Array(128);let i=0;
 for(const b of objects.values()){data.set(b.low.map(x=>x-.0002),i*8);data.set(b.high.map(x=>x+.0002),i*8+4);i++;}
 return{data,count:objects.size};
}
