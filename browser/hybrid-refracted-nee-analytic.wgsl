// Experimental air-to-air, all-transmission area-light connections.
// A deterministic seed selects ONE root. BSDF-hit MIS replays that same root;
// other roots retain their full BSDF weight. Never assume root completeness.
struct RefractedPath {point:vec3f,valid:u32,weight:vec3f,probability:f32,chain:u32,interfaces:u32,dx:vec3f,dy:vec3f}
struct RefractedConnection {direction:vec3f,pdf:f32,weight:vec3f,probability:f32,chain:u32,interfaces:u32}
const CONNECTION_CHANCE=.125;
fn normalizedDerivative(v:vec3f,dv:vec3f)->vec3f{let n=normalize(v);return (dv-n*dot(n,dv))/length(v);}
fn shadingDerivative(h:Hit,dp:vec3f)->vec3f{
 let tr=triangles[h.id];let areaNormal=cross(tr.e1.xyz,tr.e2.xyz);
 // Reciprocal edge basis avoids cancellation in (e1.e1)(e2.e2)-(e1.e2)^2.
 let db=vec2f(dot(dp,cross(tr.e2.xyz,areaNormal)),dot(dp,cross(areaNormal,tr.e1.xyz)))/dot(areaNormal,areaNormal);
 let attr=attributes[h.id];let raw=attr.n0.xyz*(1.-h.bary.x-h.bary.y)+attr.n1.xyz*h.bary.x+attr.n2.xyz*h.bary.y;
 if(dot(raw,raw)<1e-20){return vec3f(0);}
 return normalizedDerivative(raw,(attr.n1.xyz-attr.n0.xyz)*db.x+(attr.n2.xyz-attr.n0.xyz)*db.y);
}
fn refractionDerivative(d:vec3f,n:vec3f,dd:vec3f,dn:vec3f,eta:f32)->vec3f{
 let cosine=dot(n,d);let dc=dot(dn,d)+dot(n,dd);let root=sqrt(max(1e-20,1.-eta*eta*(1.-cosine*cosine)));
 return eta*dd-(eta*dc+eta*eta*cosine*dc/root)*n-(eta*cosine+root)*dn;
}
fn refractedPlane(origin:vec3f,initial:vec3f,light:AreaLight,budget:u32)->RefractedPath{
 var out:RefractedPath;var o=origin;var d=initial;var stack:MediumStack;var ior=1.;var extinction=vec3f(0);var weight=vec3f(1);var probability=1.;var chain=2166136261u;var interfaces=0u;
 var ox=vec3f(0);var oy=vec3f(0);var ddx=basis(d,vec3f(1,0,0));var ddy=basis(d,vec3f(0,1,0));
 let ln=normalize(cross(light.e1.xyz,light.e2.xyz));
 for(var depth=0u;depth<min(budget,16u);depth++){
  let denominator=dot(d,ln);var plane=1e20;
  if(abs(denominator)>1e-8){plane=dot(light.p.xyz-o,ln)/denominator;}
  let h=trace(o,d,1e20,false);
  if(abs(denominator)>1e-8&&plane>.00001&&plane<1e19&&plane<=h.t+.0001&&stack.count==0u&&interfaces>0u){
   let px=ox+ddx*plane;let py=oy+ddy*plane;
   return RefractedPath(o+d*plane,1u,weight*exp(-extinction*plane),probability,chain,interfaces,px-d*dot(px,ln)/denominator,py-d*dot(py,ln)/denominator);
  }
  if(h.id<0){return out;}let m=material(h);if(m.physical.y<.5){return out;}
  weight*=exp(-extinction*h.t);
  let areaNormal=cross(triangles[h.id].e1.xyz,triangles[h.id].e2.xyz);
  if(!(dot(areaNormal,areaNormal)>1e-30)){return out;}
  let p=o+d*h.t;let gn=geometric(h);let entering=dot(d,gn)<0.;let geometricNormal=select(-gn,gn,entering);var n=normal(h);
  let px=ox+ddx*h.t;let py=oy+ddy*h.t;let denominatorHit=dot(d,gn);if(abs(denominatorHit)<1e-7){return out;}
  let dpdx=px-d*dot(px,gn)/denominatorHit;let dpdy=py-d*dot(py,gn)/denominatorHit;
  var nx=shadingDerivative(h,dpdx);var ny=shadingDerivative(h,dpdy);
  if(dot(n,geometricNormal)<0.){n=-n;nx=-nx;ny=-ny;}if(dot(n,-d)<.001){n=geometricNormal;nx=vec3f(0);ny=vec3f(0);}
  let boundary=/*NEE_BOUNDARY*/;
  let inside=vec4f(-log(clamp(m.attenuation.xyz,vec3f(1e-20),vec3f(1)))/max(m.attenuation.w,1e-8),m.physical.z);
  let next=mediumTarget(&stack,boundary,entering,inside);
  let incidentIor=select(ior,m.physical.z,!entering&&stack.count==0u);let eta=incidentIor/next.w;
  var rd=refract(d,n,eta);let reflected=reflect(d,n);
  if(dot(reflected,geometricNormal)<=0.||dot(rd,geometricNormal)>0.){n=geometricNormal;nx=vec3f(0);ny=vec3f(0);rd=refract(d,n,eta);}
  if(dot(rd,rd)<.01){return out;}
  let f=dielectricFresnel(max(0.,dot(-d,n)),incidentIor,next.w);
  probability*=1.-f;weight*=(1.-f)*eta*eta;
  commitMedium(&stack,boundary,entering,inside);ior=next.w;extinction=next.xyz;
  chain=(chain^u32(attributes[h.id].n0.w))*16777619u;chain=(chain^select(2u,1u,entering))*16777619u;
  ddx=normalizedDerivative(rd,refractionDerivative(d,n,ddx,nx,eta));ddy=normalizedDerivative(rd,refractionDerivative(d,n,ddy,ny,eta));
  ox=dpdx;oy=dpdy;interfaces++;d=normalize(rd);o=p-geometricNormal*.0001;
 }
 return out;
}
fn connectRefracted(origin:vec3f,destination:vec3f,light:AreaLight,budget:u32)->RefractedConnection{
 var result:RefractedConnection;var d=normalize(destination-origin);
 let normal=normalize(cross(light.e1.xyz,light.e2.xyz));let tx=normalize(light.e1.xyz);let ty=cross(normal,tx);let epsilon=.0005;
 for(var iteration=0u;iteration<6u;iteration++){
  let center=refractedPlane(origin,d,light,budget);if(center.valid==0u){return result;}
  let sx=basis(d,vec3f(1,0,0));let sy=basis(d,vec3f(0,1,0));
  let dx=center.dx;let dy=center.dy;
  let a=dot(dx,tx);let b=dot(dy,tx);let c=dot(dx,ty);let e=dot(dy,ty);let determinant=a*e-b*c;
  if(abs(determinant)<1e-8){return result;}
  let residual=center.point-destination;let rx=dot(residual,tx);let ry=dot(residual,ty);
  if(dot(residual,residual)<1e-8){
   let area=.5*length(cross(light.e1.xyz,light.e2.xyz));
   return RefractedConnection(d,light.e1.w*abs(determinant)/area,center.weight,center.probability,center.chain,center.interfaces);
  }
  let step=vec2f(e*rx-b*ry,a*ry-c*rx)/determinant;
  let scale=min(1.,.2/max(length(step),1e-8));d=normalize(d-(sx*step.x+sy*step.y)*scale);
 }
 return result;
}
// MIS must evaluate density at the sampled direction, not at the nearby
// numerical root used only to identify which branch the light sampler selects.
fn replayRefracted(origin:vec3f,destination:vec3f,direction:vec3f,light:AreaLight,budget:u32)->RefractedConnection{
 let selected=connectRefracted(origin,destination,light,budget);var result:RefractedConnection;
 let difference=selected.direction-direction;
 if(selected.pdf<=0.||dot(difference,difference)>=2e-7){return result;}
 let path=refractedPlane(origin,direction,light,budget);if(path.valid==0u||path.chain!=selected.chain||path.interfaces!=selected.interfaces){return result;}
 let normal=normalize(cross(light.e1.xyz,light.e2.xyz));let tx=normalize(light.e1.xyz);let ty=cross(normal,tx);
 let determinant=dot(path.dx,tx)*dot(path.dy,ty)-dot(path.dy,tx)*dot(path.dx,ty);
 let area=.5*length(cross(light.e1.xyz,light.e2.xyz));
 return RefractedConnection(direction,light.e1.w*abs(determinant)/area,path.weight,path.probability,path.chain,path.interfaces);
}
