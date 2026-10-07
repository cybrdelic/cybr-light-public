// Static scene proof only: never infer an absent lobe from noisy ray samples.
// Material ABI is four vec4f records; physical.y controls dielectric transport.
export function signalSchedule(materials,{separate=false,cullEmpty=false}={}) {
  if(!separate)return [0];
  const all=[0,1,2,3];
  if(materials instanceof ArrayBuffer&&materials.byteLength%64===0)materials=new Float32Array(materials);
  if(!cullEmpty||!(materials instanceof Float32Array)||materials.length%16)return all;
  for(let i=5;i<materials.length;i+=16)
    if(!Number.isFinite(materials[i])||materials[i]>.5)return all;
  return [0,1,3];
}
