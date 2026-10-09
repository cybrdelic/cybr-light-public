// Validation-only source-order binary32 emulation of forest-meshlet-cull.wgsl.
// WGSL permits reassociation/fusion; this reference does not claim universal
// bit identity on every adapter. Every intermediate here rounds to nearest f32.
const f=Math.fround,add=(a,b)=>f(a+b),sub=(a,b)=>f(a-b),mul=(a,b)=>f(a*b);
export const dotF32=(a,b)=>add(add(mul(a[0],b[0]),mul(a[1],b[1])),mul(a[2],b[2]));
const cross=(a,b)=>[sub(mul(a[1],b[2]),mul(a[2],b[1])),sub(mul(a[2],b[0]),mul(a[0],b[2])),sub(mul(a[0],b[1]),mul(a[1],b[0]))];
export function rotateF32(q,v){const a=cross(q,v),b=cross(q,a.map((x,k)=>add(x,mul(q[3],v[k]))));return v.map((x,k)=>add(x,mul(2,b[k])));}
export function transformPointF32(local,values,o){const scale=values[o+3],q=Array.from(values.subarray(o+4,o+8));return rotateF32(q,local.map(x=>mul(x,scale))).map((x,k)=>add(x,values[o+k]));}
export function transformSphereF32(local,values,o){return [...transformPointF32(local.slice(0,3),values,o),mul(local[3],Math.abs(values[o+3]))];}
export function traceSphereF32(sphere,camera){
 const center=sphere.slice(0,3).map(f),d=center.map((x,k)=>sub(x,camera.eye[k])),z=dotF32(d,camera.forward),x=dotF32(d,camera.right),y=dotF32(d,camera.up),ty=f(camera.tan),tx=mul(ty,camera.aspect),magnitude=Math.max(1,...center.map(Math.abs),...camera.eye.map(Math.abs)),radius=add(f(sphere[3]),mul(magnitude,f(.000002)));
 const near=add(z,radius),horizontal=add(mul(z,tx),mul(radius,f(Math.sqrt(add(1,mul(tx,tx)))))),vertical=add(mul(z,ty),mul(radius,f(Math.sqrt(add(1,mul(ty,ty))))));
 const margins={near:sub(near,f(.05)),horizontal:sub(horizontal,Math.abs(x)),vertical:sub(vertical,Math.abs(y))};
 return {visible:near>=f(.05)&&Math.abs(x)<=horizontal&&Math.abs(y)<=vertical,center,d,z,x,y,tx,ty,inflatedRadius:radius,near,horizontal,vertical,margins};
}
export const sphereVisibleF32=(sphere,camera)=>traceSphereF32(sphere,camera).visible;
export function selectLodF32(errors,scale,z,radius,camera,previous=0){let level=0;if(camera.lodPixels>0)for(let k=1;k<4;k++){const limit=mul(camera.lodPixels,k>previous?f(.9):1),numerator=mul(mul(errors[k],Math.abs(scale)),270),denominator=mul(Math.max(sub(z,radius),f(.05)),camera.tan);if(f(numerator/denominator)<=limit)level=k;}return level;}
