// Opt-in single-interface refractive environment connection on actual meshes.
// Local Newton root only, with finite-difference solid-angle Jacobian and MIS.
// Rejected/occluded connections contribute nothing; ordinary transport remains.
struct EnvironmentConnection { V wi;Hit exit;double jacobian,fresnel;bool valid; };
D bool exitDirection(V p,V wi,int material,int object,double nm,Hit& h,V& air){
 if(!trace(p+wi*1e-5,wi,h)||h.object!=object||h.material!=material||h.front)return false;
 h=normalMapped(params.materials[material],h);
 return refract(wi,h.n,ior(params.materials[material],nm),air);
}
__device__ __noinline__ EnvironmentConnection connectEnvironment(V p,V air,int material,int object,double nm){
 EnvironmentConnection result={};const Mat&m=params.materials[material];
 if(m.type!=3||m.film>0)return result;
 Hit start;bool seed=trace(p+air*1e-5,air,start)&&start.object==object&&!start.front;
 // The straight air-direction ray can hit a bank although the steeper
 // refracted ray reaches open water. Find an actual exit before solving.
 if(!seed){V axes[6]={v(0,1,0),v(0,0,1),v(1,0,0),v(0,-1,0),v(0,0,-1),v(-1,0,0)};
  for(int i=0;i<6;i++){Hit candidate;if(trace(p+axes[i]*1e-5,axes[i],candidate)&&candidate.object==object&&!candidate.front&&dot(-candidate.n,air)>0){start=candidate;seed=true;break;}}
 }
 if(!seed)return result;
 start=normalMapped(m,start);V initial;
 if(!refract(-air,-start.n,1/ior(m,nm),initial))return result;
 V wi=-initial;Frame target(air,v(1,0,0));constexpr double step=2e-4;
 for(int iteration=0;iteration<12;iteration++){
  Hit h;V out;if(!exitDirection(p,wi,material,object,nm,h,out))return result;
  double rx=dot(out,target.x),ry=dot(out,target.y);if(dot(out,air)<=0)return result;
  Frame source(wi,v(1,0,0));V xp,xm,yp,ym;Hit scratch;
  if(!exitDirection(p,norm(wi+source.x*step),material,object,nm,scratch,xp)||
     !exitDirection(p,norm(wi-source.x*step),material,object,nm,scratch,xm)||
     !exitDirection(p,norm(wi+source.y*step),material,object,nm,scratch,yp)||
     !exitDirection(p,norm(wi-source.y*step),material,object,nm,scratch,ym))return result;
  V dx=(xp-xm)/(2*step),dy=(yp-ym)/(2*step);
  double a=dot(dx,target.x),b=dot(dy,target.x),c=dot(dx,target.y),d=dot(dy,target.y),det=a*d-b*c;
  if(!isfinite(det)||fabs(det)<1e-6)return result;
  if(rx*rx+ry*ry<1e-12){result.wi=wi;result.exit=h;result.jacobian=1/fabs(det);
   result.fresnel=fresnel(-dot(wi,h.n),ior(m,nm),1);result.valid=isfinite(result.jacobian)&&result.jacobian<30;return result;}
  double sx=(d*rx-b*ry)/det,sy=(-c*rx+a*ry)/det,length=sqrt(sx*sx+sy*sy);
  if(length>.2){sx*=.2/length;sy*=.2/length;}
  bool accepted=false;
  for(int backtrack=0;backtrack<6;backtrack++){
   V trial=norm(wi-source.x*sx-source.y*sy),direction;Hit test;
   if(exitDirection(p,trial,material,object,nm,test,direction)&&dot(direction,air)>0&&sq(dot(direction,target.x))+sq(dot(direction,target.y))<rx*rx+ry*ry){wi=trial;accepted=true;break;}
   sx*=.5;sy*=.5;
  }
  if(!accepted)return result;
 }
 return result;
}
