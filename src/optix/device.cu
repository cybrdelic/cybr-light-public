#include "shared.h"
#include <optix_device.h>
#include <math.h>
#include "mixed_math.h"
extern "C" { __constant__ Params params; }
#define D __device__ __forceinline__
constexpr double PI=3.14159265358979323846;
D V v(double x,double y,double z){return {x,y,z};}
D V operator+(V a,V b){return v(a.x+b.x,a.y+b.y,a.z+b.z);}
D V operator-(V a,V b){return v(a.x-b.x,a.y-b.y,a.z-b.z);}
D V operator-(V a){return v(-a.x,-a.y,-a.z);}
D V operator*(V a,double b){return v(a.x*b,a.y*b,a.z*b);}
D V operator/(V a,double b){return a*(1/b);}
D double dot(V a,V b){return a.x*b.x+a.y*b.y+a.z*b.z;}
D V cross(V a,V b){return v(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
D double len(V a){return sqrt(dot(a,a));}
D V norm(V a){double n=len(a);return n>0?a/n:v(0,1,0);}
D double sq(double a){return a*a;}
D double clamp(double a){return fmin(1.,fmax(0.,a));}
D V reflect(V a,V n){return a-n*(2*dot(a,n));}
D V offset(V p,V n,V d){return p+n*((dot(n,d)>0?1:-1)*2e-6*fmax(1.,fmax(fabs(p.x),fmax(fabs(p.y),fabs(p.z)))));}
D bool refract(V a,V n,double eta,V& out){double c=-dot(a,n),k=1-eta*eta*(1-c*c);if(k<0)return false;out=norm(a*eta+n*(eta*c-sqrt(k)));return true;}
D uint64_t mix(uint64_t x){x+=0x9e3779b97f4a7c15ULL;x=(x^(x>>30))*0xbf58476d1ce4e5b9ULL;x=(x^(x>>27))*0x94d049bb133111ebULL;return x^(x>>31);}
struct Rng { uint64_t state; D Rng(uint64_t seed):state(mix(seed)){} D double u(){state=state*6364136223846793005ULL+1442695040888963407ULL;unsigned x=((state>>18)^state)>>27,r=state>>59;return (((x>>r)|(x<<((-r)&31)))+.5)/4294967296.;} };
struct Frame { V x,y,z; D Frame(V n,V t):z(n){x=t-z*dot(t,z);if(dot(x,x)<1e-18)x=cross(fabs(n.z)<.999?v(0,0,1):v(0,1,0),n);x=norm(x);y=cross(z,x);} D V world(V a){return x*a.x+y*a.y+z*a.z;} D V local(V a){return v(dot(a,x),dot(a,y),dot(a,z));} };
D V cosine(Rng& r){double a=2*PI*r.u(),s=sqrt(r.u());return v(s*cos(a),s*sin(a),sqrt(1-s*s));}
D V basis(double nm){double r=exp(-.5*sq((nm-610)/43)),g=exp(-.5*sq((nm-545)/34)),b=exp(-.5*sq((nm-450)/27));return v(r,g,b)/(r+g+b+1e-30);}
D double spectrum(Spec s,double nm,V weights){if(!s.count)return s.constant?s.rgb.x:dot(s.rgb,weights);int lo=0,hi=s.count;while(lo<hi){int m=(lo+hi)/2;if(params.spectra[s.begin+m].x<nm)lo=m+1;else hi=m;}if(lo==0)return params.spectra[s.begin].y;if(lo==s.count)return params.spectra[s.begin+s.count-1].y;double2 a=params.spectra[s.begin+lo-1],b=params.spectra[s.begin+lo];return a.y+(b.y-a.y)*(nm-a.x)/(b.x-a.x);}
D double ior(const Mat& m,double nm){return m.a+m.b/sq(nm*.001);}
D double fresnel(double c,double ni,double nt){c=clamp(fabs(c));double s=sq(ni/nt)*(1-c*c);if(s>=1)return 1;double t=sqrt(1-s);return .5*(sq((ni*c-nt*t)/(ni*c+nt*t))+sq((nt*c-ni*t)/(nt*c+ni*t)));}
D double conductor(double c,double eta,double k){c=clamp(fabs(c));double c2=c*c,s2=1-c2,t0=eta*eta-k*k-s2,ab=sqrt(t0*t0+4*eta*eta*k*k),a=sqrt(fmax(0.,.5*(ab+t0))),t1=ab+c2,t2=2*c*a,rs=(t1-t2)/(t1+t2),t3=c2*ab+s2*s2,t4=t2*s2;return clamp(.5*(rs+rs*(t3-t4)/(t3+t4+1e-30)));}
struct C {double r,i;};
D C add(C a,C b){return {a.r+b.r,a.i+b.i};} D C sub(C a,C b){return {a.r-b.r,a.i-b.i};}
D C mul(C a,C b){return {a.r*b.r-a.i*b.i,a.r*b.i+a.i*b.r};} D C mul(C a,double b){return {a.r*b,a.i*b};}
D C divc(C a,C b){double n=b.r*b.r+b.i*b.i;return {(a.r*b.r+a.i*b.i)/n,(a.i*b.r-a.r*b.i)/n};}
D C root(double a){return a>=0?C{sqrt(a),0}:C{0,sqrt(-a)};}
D double filmPower(C a,C b,C phase){C r=divc(add(a,mul(b,phase)),add(C{1,0},mul(mul(a,b),phase)));return r.r*r.r+r.i*r.i;}
D double film(double co,double ni,double nf,double nt,double thickness,double nm){if(thickness<=0)return fresnel(co,ni,nt);double c=clamp(fabs(co)),s=1-c*c;C c1=root(1-s*sq(ni/nf)),c2=root(1-s*sq(ni/nt));double q=4*PI*nf*thickness/nm;C phase={exp(-q*c1.i)*cos(q*c1.r),exp(-q*c1.i)*sin(q*c1.r)};C rs01=divc(sub(C{ni*c,0},mul(c1,nf)),add(C{ni*c,0},mul(c1,nf))),rs12=divc(sub(mul(c1,nf),mul(c2,nt)),add(mul(c1,nf),mul(c2,nt))),rp01=divc(sub(C{nf*c,0},mul(c1,ni)),add(C{nf*c,0},mul(c1,ni))),rp12=divc(sub(mul(c1,nt),mul(c2,nf)),add(mul(c1,nt),mul(c2,nf)));return clamp(.5*(filmPower(rs01,rs12,phase)+filmPower(rp01,rp12,phase)));}
struct Hit {V p,n,gn,tangent;double distance;int primitive,material,object;bool front;};
// CPU-compatible bilinear PFM lookup, including negative repeat and clamped edges.
D V materialTexel(const Texture& t,int x,int y){
 if(t.repeat){x=(x%t.width+t.width)%t.width;y=(y%t.height+t.height)%t.height;}
 else{x=max(0,min(t.width-1,x));y=max(0,min(t.height-1,y));}
 return params.texturePixels[t.begin+y*t.width+x];
}
D V materialTexture(int index,double u,double w){
 const Texture& t=params.textures[index];u*=t.su;w*=t.sv;
 if(t.repeat){u-=floor(u);w-=floor(w);}else{u=clamp(u);w=clamp(w);}
 double x=u*t.width-.5,y=w*t.height-.5;int ix=int(floor(x)),iy=int(floor(y));double a=x-ix,b=y-iy;
 return materialTexel(t,ix,iy)*((1-a)*(1-b))+materialTexel(t,ix+1,iy)*(a*(1-b))+materialTexel(t,ix,iy+1)*((1-a)*b)+materialTexel(t,ix+1,iy+1)*(a*b);
}
D V surfaceUV(const Hit& h){
 const Tri& t=params.triangles[h.primitive];V e=t.b-t.a,f=t.c-t.a,q=h.p-t.a;
 double ee=dot(e,e),ff=dot(f,f),ef=dot(e,f),qe=dot(q,e),qf=dot(q,f),den=ee*ff-ef*ef;
 double u=(ff*qe-ef*qf)/den,w=(ee*qf-ef*qe)/den;
 return t.uv?t.ta*(1-u-w)+t.tb*u+t.tc*w:v(u,w,0);
}
D V vertexColor(const Hit&h){const Tri&t=params.triangles[h.primitive];if(!t.vertexMaterial)return v(1,1,1);V e=t.b-t.a,f=t.c-t.a,q=h.p-t.a;double ee=dot(e,e),ff=dot(f,f),ef=dot(e,f),den=ee*ff-ef*ef,u=(ff*dot(q,e)-ef*dot(q,f))/den,w=(ee*dot(q,f)-ef*dot(q,e))/den;return t.ca*(1-u-w)+t.cb*u+t.cc*w;}
D double albedo(const Mat&m,const Hit&h,double nm,V weights){
 double value=spectrum(m.color,nm,weights);if(params.triangles[h.primitive].vertexMaterial)value*=dot(vertexColor(h),weights);if(m.texture<0)return value;
 V uv=surfaceUV(h);return value*dot(materialTexture(m.texture,uv.x,uv.y),weights);
}
D Mat mappedMaterial(Mat m,const Hit&h){if(m.roughnessTexture>=0){V uv=surfaceUV(h),parameters=materialTexture(m.roughnessTexture,uv.x,uv.y);m.rough=fmin(1.,fmax(.001,parameters.x));if(m.textureIor){m.a=fmax(1.,parameters.y);m.b=0;}}const Tri&t=params.triangles[h.primitive];if(t.vertexMaterial){V e=t.b-t.a,f=t.c-t.a,q=h.p-t.a;double ee=dot(e,e),ff=dot(f,f),ef=dot(e,f),den=ee*ff-ef*ef,u=(ff*dot(q,e)-ef*dot(q,f))/den,w=(ee*dot(q,f)-ef*dot(q,e))/den;V p=t.pa*(1-u-w)+t.pb*u+t.pc*w;m.rough=fmin(1.,fmax(.001,p.x));m.a=fmax(1.,p.y);m.b=0;}return m;}
D double landscape(const Mat&m,const Hit&h,V wo,V wi,double nm,V weights,double&pdf){
 double co=dot(h.n,wo),ci=dot(h.n,wi);pdf=0;if(co<=0||ci<=0)return 0;
 V half=norm(wo+wi);double ch=dot(h.n,half),alpha=fmax(.018,m.rough*m.rough),a2=alpha*alpha;
 double Dn=a2/(PI*sq(ch*ch*(a2-1)+1));
 double g1=2*co/(co+sqrt(a2+(1-a2)*co*co)),g2=2*ci/(ci+sqrt(a2+(1-a2)*ci*ci));
 double fr=fresnel(dot(wo,half),1,ior(m,nm)),s2=sq(m.rough*.52),vi=sqrt(fmax(0.,1-co*co)),li=sqrt(fmax(0.,1-ci*ci));
 double cp=vi*li>1e-8?fmax(0.,(dot(wo,wi)-co*ci)/(vi*li)):0;
 double oren=1-s2/(2*(s2+.33))+.45*s2/(s2+.09)*cp*fmax(vi,li)*fmin(vi/fmax(co,1e-5),li/fmax(ci,1e-5));
 double p=m.rough<.35?.44:.19;pdf=p*Dn*g1/(4*co)+(1-p)*ci/PI;
 return albedo(m,h,nm,weights)*(1-fr)*oren/PI+fr*Dn*g1*g2/(4*co*ci);
}
D Hit normalMapped(const Mat&m,Hit h){
 if(m.normalTexture<0)return h;V uv=surfaceUV(h),n;const Texture&t=params.textures[m.normalTexture];
 if(m.normalType==15)n=norm(materialTexture(m.normalTexture,uv.x,uv.y)*2-v(1,1,1));
 else{double du=1./t.width,dv=1./t.height;
  double a=(materialTexture(m.normalTexture,uv.x+du,uv.y).x-materialTexture(m.normalTexture,uv.x-du,uv.y).x)/(2*du);
  double b=(materialTexture(m.normalTexture,uv.x,uv.y+dv).x-materialTexture(m.normalTexture,uv.x,uv.y-dv).x)/(2*dv);
  n=norm(v(-m.bumpScale*a,-m.bumpScale*b,1));
 }
 V world=norm(Frame(h.n,h.tangent).world(n));if(dot(world,h.gn)>1e-5)h.n=world;return h;
}
D bool trace(V o,V d,Hit& hit){unsigned id=0xffffffff,u=0,w=0;optixTrace(params.gas,make_float3(o.x,o.y,o.z),make_float3(d.x,d.y,d.z),1e-6f,1e20f,0,255,OPTIX_RAY_FLAG_DISABLE_ANYHIT,0,1,0,id,u,w);if(id==0xffffffff)return false;const Tri& t=params.triangles[id];double a=__uint_as_float(u),b=__uint_as_float(w);hit.p=t.a*(1-a-b)+t.b*a+t.c*b;hit.distance=len(hit.p-o);V gn=norm(cross(t.b-t.a,t.c-t.a));V n=t.smooth?norm(t.na*(1-a-b)+t.nb*a+t.nc*b):gn;if(dot(n,gn)<0)n=-n;hit.front=dot(d,gn)<0;hit.gn=hit.front?gn:-gn;hit.n=hit.front?n:-n;if(dot(hit.n,d)>0)hit.n=hit.gn;hit.tangent=norm(t.b-t.a);if(t.uv){V x=t.tb-t.ta,y=t.tc-t.ta;double det=x.x*y.y-x.y*y.x;if(fabs(det)>1e-14)hit.tangent=norm(((t.b-t.a)*y.y-(t.c-t.a)*x.y)/det);}hit.material=t.material;hit.object=t.object;hit.primitive=id;return true;}
extern "C" __global__ void __closesthit__surface(){optixSetPayload_0(optixGetPrimitiveIndex());float2 b=optixGetTriangleBarycentrics();optixSetPayload_1(__float_as_uint(b.x));optixSetPayload_2(__float_as_uint(b.y));}
extern "C" __global__ void __miss__surface(){optixSetPayload_0(0xffffffff);}
D V texel(int x,int y){x=(x%params.envWidth+params.envWidth)%params.envWidth;y=(y%params.envHeight+params.envHeight)%params.envHeight;return params.environment[y*params.envWidth+x];}
D double env(V d,V weights){if(params.envWidth==0)return params.envStrength*dot(params.envBase,weights)*(params.envFlat?1:(.3+.7*fmax(0.,d.y)));double u=atan2(d.z,d.x)/(2*PI)+params.envRotation/(2*PI),w=acos(fmin(1.,fmax(-1.,d.y)))/PI;u-=floor(u);w-=floor(w);double x=u*params.envWidth-.5,y=w*params.envHeight-.5;int ix=floor(x),iy=floor(y);double tx=x-ix,ty=y-iy;return params.envStrength*dot(texel(ix,iy)*((1-tx)*(1-ty))+texel(ix+1,iy)*(tx*(1-ty))+texel(ix,iy+1)*((1-tx)*ty)+texel(ix+1,iy+1)*(tx*ty),weights);}
D double envPdf(V d){int w=params.proposalWidth,h=params.proposalHeight;int y=min(h-1,int(acos(fmin(1.,fmax(-1.,d.y)))*h/PI));double p=atan2(d.z,d.x);if(p<0)p+=2*PI;int x=min(w-1,int(p*w/(2*PI)));return params.envProbability[y*w+x]/(2*PI/w*(cos(PI*y/h)-cos(PI*(y+1)/h)));}
D V envSample(Rng& r,double& pdf){int w=params.proposalWidth,h=params.proposalHeight;r.u();double u=r.u();int lo=0,hi=w*h;while(lo<hi){int m=(lo+hi)/2;if(params.envCdf[m]<u)lo=m+1;else hi=m;}int idx=min(lo,w*h-1),y=idx/w,x=idx%w;double a=cos(PI*y/h),b=cos(PI*(y+1)/h),c=a+(b-a)*r.u(),s=sqrt(1-c*c),p=2*PI*(x+r.u())/w;pdf=params.envProbability[idx]/(2*PI/w*(a-b));return v(s*cos(p),c,s*sin(p));}
D double mis(double a,double b){return a*a/(a*a+b*b+1e-300);}
D double emitted(const Mat&m,double nm,V weights){
 double spectral=1.;
 if(m.kelvin>0)spectral=pow(560./nm,5.)*expm1(.01438776877/(560e-9*m.kelvin))/expm1(.01438776877/(nm*1e-9*m.kelvin));
 return m.emission*spectrum(m.color,nm,weights)*spectral;
}
struct AreaSample {V wi;double distance,pdf,radiance;int primitive;};
D AreaSample sampleArea(V point,double nm,V weights,Rng&r){
 AreaSample result={};result.primitive=-1;if(!params.emitterCount)return result;
 double selection=r.u();int lo=0,hi=params.emitterCount;
 while(lo<hi){int mid=(lo+hi)/2;if(params.emitterCdf[mid]<selection)lo=mid+1;else hi=mid;}
 int id=params.emitters[min(lo,params.emitterCount-1)];const Tri&t=params.triangles[id];
 double root=sqrt(r.u()),fraction=r.u();V target=t.a*(1-root)+t.b*(root*(1-fraction))+t.c*(root*fraction);
 V difference=target-point;double distance=len(difference);if(distance<=1e-8)return result;
 V wi=difference/distance;double cosine=dot(norm(cross(t.b-t.a,t.c-t.a)),-wi);if(cosine<=1e-9)return result;
 result.wi=wi;result.distance=distance;result.pdf=t.lightPdfArea*distance*distance/cosine;
 result.radiance=emitted(params.materials[t.material],nm,weights);result.primitive=id;return result;
}
D double areaPdf(V point,const Hit&h,V incoming){
 const Tri&t=params.triangles[h.primitive];double cosine=dot(h.gn,-incoming);
 if(!h.front||cosine<=1e-9)return 0.;V delta=h.p-point;return t.lightPdfArea*dot(delta,delta)/cosine;
}
D AreaSample sampleDelta(int index,V point,double nm,V weights){
 const Delta&light=params.deltas[index];AreaSample result={};result.pdf=1.;result.distance=1e30;
 result.radiance=spectrum(light.intensity,nm,weights)*light.scale;
 if(light.kind==1){result.wi=-light.direction;return result;}
 V difference=light.position-point;result.distance=len(difference);
 if(result.distance<=1e-9){result.radiance=0.;return result;}
 result.wi=difference/result.distance;result.radiance/=result.distance*result.distance;
 if(light.kind==2){double c=dot(light.direction,-result.wi),a=cos(light.cutoff),b=cos(light.beam);
  result.radiance*=c<=a?0.:c>=b?1.:(c-a)/(b-a);}
 return result;
}
D double lambda(V a,double x,double y){if(fabs(a.z)<1e-15)return 1e30;return .5*(sqrt(1+(sq(x*a.x)+sq(y*a.y))/sq(a.z))-1);}
D V visible(V view,double ax,double ay,Rng& r){V a=norm(v(ax*view.x,ay*view.y,view.z));double q=a.x*a.x+a.y*a.y;V t=q>1e-20?v(-a.y,a.x,0)/sqrt(q):v(1,0,0),b=cross(a,t);double radius=sqrt(r.u()),phi=2*PI*r.u(),p=radius*cos(phi),s=radius*sin(phi),blend=.5*(1+a.z);s=(1-blend)*sqrt(fmax(0.,1-p*p))+blend*s;V h=t*p+b*s+a*sqrt(fmax(0.,1-p*p-s*s));return norm(v(ax*h.x,ay*h.y,fmax(1e-12,h.z)));}
D double evaluate(const Mat& m,const Hit& h,V wo,V wi,double nm,V weights,double& pdf){pdf=0;double co=dot(h.n,wo),ci=dot(h.n,wi);if(co<=0||ci<=0||(!m.twoSided&&!h.front))return 0;if(m.type==17)return landscape(m,h,wo,wi,nm,weights,pdf);if(m.type==0){pdf=ci/PI;return albedo(m,h,nm,weights)/PI;}if(m.type!=1&&m.type!=2)return 0;V half=norm(wo+wi);double ch=dot(h.n,half),vh=dot(wo,half);if(ch<=0||vh<=0)return 0;double ax=m.ax>0?m.ax:fmax(.002,m.rough*m.rough),ay=m.ay>0?m.ay:ax;Frame f(h.n,h.tangent);V hv=f.local(half),vo=f.local(wo),vi=f.local(wi);double Dn=1/(PI*ax*ay*sq(sq(hv.x/ax)+sq(hv.y/ay)+hv.z*hv.z)),G1=1/(1+lambda(vo,ax,ay)),G=1/(1+lambda(vo,ax,ay)+lambda(vi,ax,ay));pdf=Dn*G1/(4*co);double F=m.type==1?conductor(vh,spectrum(m.eta,nm,weights),spectrum(m.k,nm,weights)):fresnel(vh,1,ior(m,nm)),value=F*Dn*G/(4*co*ci);if(m.type==2){value+=albedo(m,h,nm,weights)*(1-fresnel(co,1,ior(m,nm)))*(1-fresnel(ci,1,ior(m,nm)))/PI;pdf=.5*pdf+.5*ci/PI;}return value;}
#include "refractive_nee.h"
D double hg(double c,double g){double a=1+g*g-2*g*c;return (1-g*g)/(4*PI*a*sqrt(a));}
D V sampleHG(V incoming,double g,Rng&r){double u=r.u(),c=fabs(g)<1e-5?1-2*u:(1+g*g-sq((1-g*g)/(1-g+2*g*u)))/(2*g);c=fmin(1.,fmax(-1.,c));double a=2*PI*r.u(),s=sqrt(1-c*c);return Frame(incoming,v(1,0,0)).world(v(s*cos(a),s*sin(a),c));}
D double path(V origin,V direction,double nm,Rng& r){V weights=basis(nm),previousPoint=origin;double throughput=1,radiance=0,previousPdf=0;bool previousDelta=true;int objects[64],mats[64],count=0;
 int connectionState=0,connectionObject=-1,connectionMaterial=-1;V connectionOrigin{},connectionDirection{};double connectionPdf=0;
 for(int depth=0;depth<=params.maxDepth;depth++){
  Hit h;bool found=trace(origin,direction,h);
  if(count&&params.materials[mats[count-1]].scattering>0){
   const Mat&medium=params.materials[mats[count-1]];double t=-log(fmax(1e-15,1-r.u()))/medium.scattering;
   if(!found||t<h.distance){
    if(depth==params.maxDepth)break;V point=origin+direction*t;
    double sigma=spectrum(medium.absorption,nm,weights);throughput*=exp(-sigma*t);
    connectionState=0;
    for(int lightIndex=0;lightIndex<params.deltaCount;lightIndex++){
     auto light=sampleDelta(lightIndex,point,nm,weights);Hit shadow;
     if(light.radiance>0&&(!trace(point+light.wi*2e-6,light.wi,shadow)||shadow.distance>=light.distance-2e-5))
      radiance+=throughput*hg(dot(direction,light.wi),medium.phaseG)*light.radiance*exp(-(sigma+medium.scattering)*light.distance);
    }
    if(params.emitterCount){auto light=sampleArea(point,nm,weights,r);Hit shadow;
     if(light.pdf>0&&trace(point+light.wi*2e-6,light.wi,shadow)&&shadow.primitive==light.primitive){
      double phase=hg(dot(direction,light.wi),medium.phaseG),survival=exp(-medium.scattering*light.distance);
      radiance+=throughput*phase*light.radiance*exp(-sigma*light.distance)*survival*mis(light.pdf,phase*survival)/light.pdf;
     }
    }
    if(params.refractiveNee&&count==1&&medium.film==0){
     double ep;V air=envSample(r,ep);auto c=connectEnvironment(point,air,mats[0],objects[0],nm);
     if(c.valid&&ep>0){Hit shadow;if(!trace(offset(c.exit.p,c.exit.gn,air),air,shadow)){
      double phase=hg(dot(direction,c.wi),medium.phaseG),trans=1-c.fresnel,eta=ior(medium,nm);
      radiance+=throughput*phase*env(air,weights)*exp(-(sigma+medium.scattering)*c.exit.distance)*trans*eta*eta*c.jacobian/ep*mis(ep/c.jacobian,phase*trans*exp(-medium.scattering*c.exit.distance));
     }}
    }
    V wi=sampleHG(direction,medium.phaseG,r);double pdf=hg(dot(direction,wi),medium.phaseG);
    if(params.refractiveNee&&count==1&&medium.film==0){connectionState=1;connectionOrigin=point;connectionDirection=wi;connectionPdf=pdf;connectionObject=objects[0];connectionMaterial=mats[0];}
    previousPoint=point;origin=point+wi*2e-6;direction=wi;previousPdf=pdf;previousDelta=false;
    if(depth>=params.rrDepth){if(r.u()>.85)break;throughput/=.85;}continue;
   }
  }
  if(count){double sigma=spectrum(params.materials[mats[count-1]].absorption,nm,weights);if(sigma>0)throughput*=found?exp(-sigma*h.distance):0;}
  if(!found){double weight=previousDelta?1:mis(previousPdf,envPdf(direction));
   if(connectionState==2){auto c=connectEnvironment(connectionOrigin,direction,connectionMaterial,connectionObject,nm);if(c.valid&&dot(c.wi,connectionDirection)>1-1e-8)weight=mis(connectionPdf*(1-c.fresnel)*exp(-params.materials[connectionMaterial].scattering*c.exit.distance),envPdf(direction)/c.jacobian);}
   radiance+=throughput*env(direction,weights)*weight;break;}
  Mat m=mappedMaterial(params.materials[h.material],h);h=normalMapped(m,h);V wo=-direction;double ni=count?ior(params.materials[mats[count-1]],nm):1,nt=ni;
  if(m.emission>0&&h.front){double survival=count?exp(-params.materials[mats[count-1]].scattering*h.distance):1.;
   double weight=previousDelta?1.:mis(previousPdf*survival,areaPdf(previousPoint,h,direction));
   radiance+=throughput*emitted(m,nm,weights)*weight;
  }
  if(m.type==8)break;
  if(m.type==3){if(h.front)nt=ior(m,nm);else{int j=count-1;while(j>=0&&objects[j]!=h.object)j--;if(j>=0)nt=j>0?ior(params.materials[mats[j-1]],nm):1;else{ni=ior(m,nm);nt=count?ior(params.materials[mats[count-1]],nm):1;}}}
  if(!m.twoSided&&!h.front&&m.type!=3)break;
  bool delta=m.type==3||m.type==5;
  if(connectionState==2)connectionState=0;
  if(connectionState==1&&!(m.type==3&&!h.front&&h.object==connectionObject))connectionState=0;
  if(depth==params.maxDepth)break;
  if(!delta)for(int lightIndex=0;lightIndex<params.deltaCount;lightIndex++){
   auto light=sampleDelta(lightIndex,h.p,nm,weights);double bp=0;double bsdf=light.radiance>0?evaluate(m,h,wo,light.wi,nm,weights,bp):0;Hit shadow;
   if(bsdf>0&&(!trace(offset(h.p,h.gn,light.wi),light.wi,shadow)||shadow.distance>=light.distance-2e-5)){
    double attenuation=1.;if(count){const Mat&medium=params.materials[mats[count-1]];attenuation=exp(-(spectrum(medium.absorption,nm,weights)+medium.scattering)*light.distance);}
    radiance+=throughput*bsdf*fabs(dot(h.n,light.wi))*light.radiance*attenuation;
   }
  }
  if(!delta){double pdf;V wi=envSample(r,pdf);double bp,bsdf=evaluate(m,h,wo,wi,nm,weights,bp);if(bsdf>0&&pdf>0){Hit shadow;if(!trace(offset(h.p,h.gn,wi),wi,shadow)){double att=1;if(count&&spectrum(params.materials[mats[count-1]].absorption,nm,weights)>0)att=0;radiance+=throughput*bsdf*fabs(dot(h.n,wi))*env(wi,weights)*att*mis(pdf,bp)/pdf;}}}
  // Environment and finite emitters are separate NEE techniques with
  // disjoint endpoints. Each is paired with the corresponding BSDF hit.
  if(!delta&&params.emitterCount){auto light=sampleArea(h.p,nm,weights,r);double bp=0;
   double bsdf=light.pdf>0?evaluate(m,h,wo,light.wi,nm,weights,bp):0;Hit shadow;
   if(bsdf>0&&trace(offset(h.p,h.gn,light.wi),light.wi,shadow)&&shadow.primitive==light.primitive){
    double attenuation=1.,survival=1.;if(count){const Mat&medium=params.materials[mats[count-1]];
     attenuation=exp(-spectrum(medium.absorption,nm,weights)*light.distance);survival=exp(-medium.scattering*light.distance);}
    radiance+=throughput*bsdf*fabs(dot(h.n,light.wi))*light.radiance*attenuation*survival*mis(light.pdf,bp*survival)/light.pdf;
   }
  }
  if(params.refractiveNee&&!delta&&count==1&&params.materials[mats[0]].film==0){
   double ep;V air=envSample(r,ep);auto c=connectEnvironment(h.p,air,mats[0],objects[0],nm);
   if(c.valid&&ep>0&&dot(c.wi,h.gn)>0){Hit shadow;
    if(!trace(offset(c.exit.p,c.exit.gn,air),air,shadow)){
     double bp,bsdf=evaluate(m,h,wo,c.wi,nm,weights,bp);double trans=1-c.fresnel;
     double sigma=spectrum(params.materials[mats[0]].absorption,nm,weights),eta=ior(params.materials[mats[0]],nm);
     double survival=exp(-params.materials[mats[0]].scattering*c.exit.distance);
     radiance+=throughput*bsdf*fabs(dot(h.n,c.wi))*env(air,weights)*exp(-sigma*c.exit.distance)*survival*trans*eta*eta*c.jacobian/ep*mis(ep/c.jacobian,bp*trans*survival);
    }
   }
  }
  V wi;double weight=0,pdf=0;bool transmitted=false;
  if(delta){double co=dot(wo,h.n),F=m.type==5?1:fresnel(co,ni,nt);if(m.type==3&&m.film>0)F=film(co,ni,m.filmIor,nt,fmax(0.,m.film+dot(m.filmGradient,h.p)),nm);transmitted=m.type==3&&r.u()>=F&&refract(-wo,h.n,ni/nt,wi);if(!transmitted)wi=reflect(-wo,h.n);pdf=transmitted?1-F:F;weight=transmitted?sq(ni/nt):1;if(m.type==5)weight=conductor(co,spectrum(m.eta,nm,weights),spectrum(m.k,nm,weights));}
  else{Frame f(h.n,h.tangent);if(m.type==0||(m.type==2&&r.u()<.5)||(m.type==17&&r.u()>(m.rough<.35?.44:.19)))wi=f.world(cosine(r));else{double ax=m.ax>0?m.ax:fmax(m.type==17?.018:.002,m.rough*m.rough),ay=m.ay>0?m.ay:ax;wi=reflect(-wo,f.world(visible(f.local(wo),ax,ay,r)));}if(dot(wi,h.gn)<=0)break;double bsdf=evaluate(m,h,wo,wi,nm,weights,pdf);if(pdf>0)weight=bsdf*fabs(dot(h.n,wi))/pdf;}
  if(pdf<=0||weight<=0)break;if(!isfinite(weight)){atomicAdd(params.errors,1);return 0;}
  if(params.refractiveNee&&!delta&&count==1&&params.materials[mats[0]].film==0){connectionState=1;connectionOrigin=h.p;connectionDirection=wi;connectionPdf=pdf;connectionObject=objects[0];connectionMaterial=mats[0];}
  else if(connectionState==1)connectionState=transmitted&&!h.front?2:0;
  throughput*=weight;if(transmitted){if(h.front){if(count==64){atomicAdd(params.errors,1);return 0;}objects[count]=h.object;mats[count++]=h.material;}else{for(int j=count-1;j>=0;j--)if(objects[j]==h.object){for(int k=j;k<count-1;k++){objects[k]=objects[k+1];mats[k]=mats[k+1];}count--;break;}}}
  previousPoint=h.p;origin=offset(h.p,h.gn,wi);direction=wi;previousDelta=delta;previousPdf=pdf;
  if(depth>=params.rrDepth){if(r.u()>.85)break;throughput/=.85;}
 }
 return radiance;
}
D double gaussian(double w,double m,double a,double b){double t=(w-m)*(w<m?a:b);return exp(-.5*t*t);}
D V observer(double w){return v(1.056*gaussian(w,599.8,.0264,.0323)+.362*gaussian(w,442,.0624,.0374)-.065*gaussian(w,501.1,.049,.0382),.821*gaussian(w,568.8,.0213,.0247)+.286*gaussian(w,530.9,.0613,.0322),1.217*gaussian(w,437,.0845,.0278)+.681*gaussian(w,459,.0385,.0725));}
D void camera(double x,double y,V& origin,V& direction){const Cam& c=params.camera;double px=(2*x/params.width-1)*double(params.width)/params.height,py=1-2*y/params.height;origin=c.origin;if(c.ortho){origin=origin+(c.right*px+c.up*py)*(c.scale*.5);direction=c.forward;}else direction=norm(c.forward+(c.right*px+c.up*py)*tan(c.fov*PI/360));}
extern "C" __global__ void __raygen__render(){unsigned id=params.offset+optixGetLaunchIndex().x;if(id>=params.count)return;int x=id%params.width,y=id/params.width;V origin,direction;
 if(x<params.regionX0||x>=params.regionX1||y<params.regionY0||y>=params.regionY1)return;
 if(params.diagnostics){camera(x+.5,y+.5,origin,direction);Hit h;if(trace(origin,direction,h)){const Mat&m=params.materials[h.material];h=normalMapped(m,h);V color=m.color.rgb;if(m.texture>=0){V uv=surfaceUV(h),tex=materialTexture(m.texture,uv.x,uv.y);color=v(color.x*tex.x,color.y*tex.y,color.z*tex.z);}V vc=vertexColor(h);color=v(color.x*vc.x,color.y*vc.y,color.z*vc.z);params.position[id]=h.p;params.normal[id]=h.n*.5+v(.5,.5,.5);params.albedo[id]=color;params.object[id]=v(h.object,h.object,h.object);params.depth[id]=v(h.distance,h.distance,h.distance);}return;}
 Rng primary(mix(params.seed^mix(id)^mix(uint64_t(params.sample)+0xc001)));double fx=primary.u(),fy;
 if(params.filter){fx-=primary.u();fy=primary.u()-primary.u();}else{fx-=.5;fy=primary.u()-.5;}
 primary.u(); // camera shutter RNG, matching the native CPU stream
 camera(x+.5+fx,y+.5+fy,origin,direction);double shift=primary.u();V packet=v(0,0,0);
 for(int band=0;band<params.bands;band++){double nm=360+(band+shift)*470/params.bands;Rng r=primary;double value=path(origin,direction,nm,r);if(!isfinite(value)||value<0){atomicAdd(params.errors,1);continue;}packet=packet+observer(nm)*(value*470/(106.856917101*params.bands));}
 Pixel& film=params.film[id];film.xyz=film.xyz+packet;film.y+=packet.y;film.y2+=packet.y*packet.y;
}
