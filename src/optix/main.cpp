// CYBR LIGHT's spectral surface transport on CUDA/OptiX. No external renderer.
#include <optix.h>
#include <optix_function_table_definition.h>
#include <optix_stubs.h>
#include <optix_stack_size.h>
#include <cuda_runtime.h>
#include "shared.h"
#undef near
#undef far
#include "cybr/film.hpp"
#include <chrono>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <iomanip>
#include <cstring>
#define CUDA(x) do {auto e=(x);if(e!=cudaSuccess)throw std::runtime_error(std::string(#x)+": "+cudaGetErrorString(e));}while(0)
#define OPTIX(x) do {auto e=(x);if(e!=OPTIX_SUCCESS)throw std::runtime_error(std::string(#x)+": "+optixGetErrorName(e));}while(0)
struct Buffers {std::vector<void*> all;~Buffers(){for(auto p:all)cudaFree(p);}template<class T>T* alloc(size_t n){T*p=nullptr;CUDA(cudaMalloc((void**)&p,n*sizeof(T)));all.push_back(p);CUDA(cudaMemset(p,0,n*sizeof(T)));return p;}template<class T>T* upload(const std::vector<T>&a){if(a.empty())return nullptr;T*p=alloc<T>(a.size());CUDA(cudaMemcpy(p,a.data(),a.size()*sizeof(T),cudaMemcpyHostToDevice));return p;}};
V cv(cybr::Vec3 a){return {a.x,a.y,a.z};}
cybr::Vec3 cv(V a){return {a.x,a.y,a.z};}
struct alignas(OPTIX_SBT_RECORD_ALIGNMENT) Record {char header[OPTIX_SBT_RECORD_HEADER_SIZE];};
// Integrate texels inside each proposal cell. Point-sampling a coarse proposal
// misses a small HDR solar disc entirely, producing avoidable fireflies.
void buildEnvironment(cybr::Environment& e,int& width,int& height){
 e.build();width=256;height=128;if(!e.texture)return;
 width=std::max(256,std::min(2048,e.texture->width));height=std::max(128,std::min(1024,e.texture->height));
 e.cdf.resize(size_t(width)*height);e.probability.resize(size_t(width)*height);
 int nx=std::min(8,std::max(1,(e.texture->width+width-1)/width));
 int ny=std::min(8,std::max(1,(e.texture->height+height-1)/height));
 double sum=0;
 for(int y=0;y<height;y++){
  double c0=std::cos(cybr::pi*y/height),c1=std::cos(cybr::pi*(y+1)/height),area=2*cybr::pi/width*(c0-c1);
  for(int x=0;x<width;x++){
   double value=0;
   for(int j=0;j<ny;j++)for(int i=0;i<nx;i++){
    double c=c0+(c1-c0)*(j+.5)/ny,sn=std::sqrt(std::max(0.,1-c*c)),phi=2*cybr::pi*(x+(i+.5)/nx)/width;
    cybr::Vec3 d{sn*std::cos(phi),c,sn*std::sin(phi)};
    value+=(e.radiance(d,450)+e.radiance(d,550)+e.radiance(d,650))/(3*nx*ny);
   }
   sum+=e.probability[y*width+x]=std::max(1e-8,value)*area;e.cdf[y*width+x]=sum;
  }
 }
 for(auto&v:e.cdf)v/=sum;for(auto&v:e.probability)v/=sum;
}
std::string read(const std::string& path){std::ifstream f(path,std::ios::binary);if(!f)throw std::runtime_error("Cannot read "+path);return {std::istreambuf_iterator<char>(f),{}};}
void replace(const std::string&temp,const std::string&dest){
#ifdef _WIN32
 if(!MoveFileExA(temp.c_str(),dest.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw std::runtime_error("Atomic file replacement failed: "+dest);
#else
 std::filesystem::rename(temp,dest);
#endif
}
void checkpoint(const std::string& path,uint64_t signature,unsigned completed,const std::vector<Pixel>& film){
 uint64_t head[]={0x4359425247505531ULL,signature,completed,film.size(),sizeof(Pixel)};
 std::ofstream f(path+".tmp",std::ios::binary);f.write((char*)head,sizeof(head));f.write((char*)film.data(),film.size()*sizeof(Pixel));
 uint64_t hash=cybr::hash_bytes(film.data(),film.size()*sizeof(Pixel),cybr::hash_bytes(head,sizeof(head)));f.write((char*)&hash,8);f.flush();if(!f)throw std::runtime_error("Checkpoint write failed");f.close();replace(path+".tmp",path);
}
unsigned restore(const std::string&path,uint64_t signature,std::vector<Pixel>&film){
 uint64_t h[5]={},stored=0;std::ifstream f(path,std::ios::binary);f.read((char*)h,sizeof(h));
 if(!f||h[0]!=0x4359425247505531ULL||h[1]!=signature||h[3]!=film.size()||h[4]!=sizeof(Pixel))throw std::runtime_error("GPU checkpoint scene/assets/pipeline mismatch");
 f.read((char*)film.data(),film.size()*sizeof(Pixel));f.read((char*)&stored,8);if(!f||stored!=cybr::hash_bytes(film.data(),film.size()*sizeof(Pixel),cybr::hash_bytes(h,sizeof(h)))||f.peek()!=EOF)throw std::runtime_error("GPU checkpoint corrupt or truncated");return unsigned(h[2]);
}
int main(int argc,char**argv){try{
 std::string input,out="gpu-render",ptx=std::filesystem::path(argv[0]).parent_path().string()+"/device.ptx",resume;
 int spp=-1,width=-1,height=-1,bands=-1,tile=8192,saveEvery=8,stopAfter=0,inflight=1;bool refractiveNee=false,aovOnly=false;
 auto arg=[&](int&i){if(++i>=argc)throw std::runtime_error("Missing argument");return std::string(argv[i]);};
 int region[4]={0,0,-1,-1};bool regionSet=false;
 for(int i=1;i<argc;i++)if(std::string(argv[i])=="--render-region"){
  if(regionSet||i+4>=argc)throw std::runtime_error("Expected one --render-region x0 y0 x1 y1");
  for(int k=0;k<4;k++)region[k]=std::stoi(argv[i+k+1]);regionSet=true;
  for(int j=i;j<argc-5;j++)argv[j]=argv[j+5];argc-=5;i--;
 }
 // Strip this opt-in flag before the existing strict argument parser.
 for(int i=1;i<argc;i++)if(std::string(argv[i])=="--aov-only"){aovOnly=true;for(int j=i;j<argc-1;j++)argv[j]=argv[j+1];argc--;i--;}
 for(int i=1;i<argc;i++)if(std::string(argv[i])=="--refractive-nee"){refractiveNee=true;for(int j=i;j<argc-1;j++)argv[j]=argv[j+1];argc--;i--;}
 for(int i=1;i<argc;i++){std::string a=argv[i];if(a=="--scene")input=arg(i);else if(a=="--out")out=arg(i);else if(a=="--ptx")ptx=arg(i);else if(a=="--spp")spp=std::stoi(arg(i));else if(a=="--bands")bands=std::stoi(arg(i));else if(a=="--size"){width=std::stoi(arg(i));height=std::stoi(arg(i));}else if(a=="--tile")tile=std::stoi(arg(i));else if(a=="--inflight")inflight=std::stoi(arg(i));else if(a=="--checkpoint-every")saveEvery=std::stoi(arg(i));else if(a=="--resume")resume=arg(i);else if(a=="--stop-after")stopAfter=std::stoi(arg(i));else throw std::runtime_error("Unknown argument "+a);}
 if(input.empty())throw std::runtime_error("--scene required");if(aovOnly&&(!resume.empty()||stopAfter))throw std::runtime_error("AOV-only must not resume or modify a film checkpoint");cybr::Scene s;
 // Reserve the exact input primitive count. Avoid vector-growth copies of a
 // million-triangle scene while the independent CPU bake is still running.
 size_t inputCount=0,triangleCapacity=0;{std::ifstream f(input);std::string line;while(std::getline(f,line)){if(line.rfind("triangle ",0)==0){inputCount++;triangleCapacity++;}else if(line.rfind("quad ",0)==0){inputCount++;triangleCapacity+=2;}else if(line.rfind("sphere ",0)==0||line.rfind("disk ",0)==0||line.rfind("cylinder ",0)==0)inputCount++;}}
 s.primitives.reserve(inputCount);cybr::read_scene(input,s);auto&cfg=s.settings;
 if(spp>0)cfg.spp=spp;if(width>0)cfg.width=width;if(height>0)cfg.height=height;if(bands>0)cfg.bands=bands;
 if(cfg.width<1||cfg.height<1||uint64_t(cfg.width)*cfg.height>8000000||cfg.spp<1||cfg.bands<1||cfg.bands>128||tile<1||tile>65536||saveEvery<1||inflight<1||inflight>8)throw std::runtime_error("Invalid or excessive GPU settings");
 if(cfg.polarized||cfg.ad||!s.volumes.empty()||!s.environment.lobes.empty()||!cfg.observer_path.empty()||cfg.integrator!="path"||cfg.sampler!=0||!cfg.mis||!cfg.nee||cfg.max_depth<1||cfg.max_depth>64||cfg.rr_depth<0||(cfg.filter!="box"&&cfg.filter!="tent"))throw std::runtime_error("Unsupported GPU integrator/lighting feature: refusing silent fallback");
 if(s.camera.aperture!=0||s.camera.spherical||s.camera.shutter_open!=s.camera.shutter_close)throw std::runtime_error("GPU camera requires static pinhole/orthographic camera");
 std::filesystem::create_directories(std::filesystem::absolute(out).parent_path());
 Params p={};p.width=cfg.width;p.height=cfg.height;p.bands=cfg.bands;p.maxDepth=cfg.max_depth;p.rrDepth=cfg.rr_depth;p.seed=cfg.seed;p.filter=cfg.filter=="tent";p.count=cfg.width*cfg.height;
 std::vector<double2> spectra;std::vector<Mat> materials;
 if(!regionSet){region[2]=p.width;region[3]=p.height;}
 if(region[0]<0||region[1]<0||region[2]>p.width||region[3]>p.height||region[0]>=region[2]||region[1]>=region[3])throw std::runtime_error("Invalid render region");
 p.regionX0=region[0];p.regionY0=region[1];p.regionX1=region[2];p.regionY1=region[3];
 std::vector<Texture> textures;std::vector<V> texturePixels;
 std::vector<const cybr::ImageTexture*> textureSources;
 auto texture=[&](const std::shared_ptr<cybr::ImageTexture>& image){
  if(!image)return -1;
  auto found=std::find(textureSources.begin(),textureSources.end(),image.get());
  if(found!=textureSources.end())return int(found-textureSources.begin());
  if(image->width<1||image->height<1||image->pixels.size()!=size_t(image->width)*image->height||!std::isfinite(image->scale_u)||!std::isfinite(image->scale_v))throw std::runtime_error("Invalid GPU texture");
  if(texturePixels.size()+image->pixels.size()>64000000)throw std::runtime_error("GPU texture budget exceeded");
  int index=int(textures.size());textures.push_back({int(texturePixels.size()),image->width,image->height,int(image->repeat),image->scale_u,image->scale_v});
  for(auto pixel:image->pixels)texturePixels.push_back(cv(pixel));textureSources.push_back(image.get());return index;
 };
 auto spec=[&](const cybr::Spectrum& value){Spec a={cv(value.controls),int(spectra.size()),int(value.table.size()),int(value.constant)};for(auto pair:value.table)spectra.push_back(make_double2(pair.first,pair.second));return a;};
 for(auto&outer:s.materials){
  const cybr::Material* leaf=&outer;Mat a={};a.texture=a.normalTexture=a.roughnessTexture=-1;
  int wrapper=int(outer.type);
  if(wrapper==15||wrapper==16){
   if(!outer.child1||outer.child2||!outer.texture||outer.shader||outer.emission!=0||outer.checker!=0||outer.opacity!=1||!std::isfinite(outer.bump_scale))throw std::runtime_error("Unsupported GPU normal/bump wrapper");
   a.normalTexture=texture(outer.texture);a.normalType=wrapper;a.bumpScale=outer.bump_scale;leaf=outer.child1.get();
  }
  const auto&m=*leaf;int t=int(m.type);
  if((t!=0&&t!=1&&t!=2&&t!=3&&t!=5&&t!=8&&t!=17)||m.shader||m.child1||m.child2||m.checker!=0||m.opacity!=1)throw std::runtime_error("Unsupported GPU material: "+std::to_string(t));
  if(!std::isfinite(m.emission)||m.emission<0||!std::isfinite(m.kelvin))throw std::runtime_error("Invalid GPU emission");
  if(leaf!=&outer&&m.emission!=0)throw std::runtime_error("GPU emission inside a material wrapper is unsupported");
  a.emission=m.emission;a.kelvin=m.kelvin;
  // Color textures affect diffuse/plastic albedo, not conductor optical constants.
  if(m.texture&&t!=0&&t!=2&&t!=17)throw std::runtime_error("GPU color texture requires diffuse, plastic or landscape material");
  if(m.roughness_texture&&t!=1&&t!=2&&t!=17)throw std::runtime_error("GPU roughness texture requires a rough reflective material");
  a.roughnessTexture=texture(m.roughness_texture);
  a.scattering=m.scattering;a.phaseG=m.phase_g;
  a.textureIor=m.texture_ior;if(m.texture_ior&&!m.roughness_texture)throw std::runtime_error("Textured IOR requires parameter texture");
  a.texture=texture(m.texture);a.color=spec(m.color);a.eta=spec(m.eta);a.k=spec(m.k);a.absorption=spec(m.absorption);a.type=t;a.twoSided=m.two_sided&&outer.two_sided;a.rough=m.roughness;a.ax=m.alpha_u;a.ay=m.alpha_v;a.a=m.ior_a;a.b=m.ior_b;a.film=m.film_nm;a.filmIor=m.film_ior;a.filmGradient=cv(m.film_gradient);materials.push_back(a);
 }
 std::vector<Delta> deltas;
 if(s.delta_lights.size()>64)throw std::runtime_error("GPU direct-light budget exceeded (64)");
 for(const auto&light:s.delta_lights){
  if(light.kind<0||light.kind>2||!std::isfinite(light.scale)||light.scale<0)throw std::runtime_error("Invalid GPU delta light");
  deltas.push_back({light.kind,cv(light.position),cv(light.direction),spec(light.intensity),light.scale,light.cutoff,light.beam});
 }
 p.deltaCount=int(deltas.size());
 std::vector<Tri> triangles;std::vector<float3> vertices;triangles.reserve(triangleCapacity);vertices.reserve(triangleCapacity*3);
 auto triangle=[&](const cybr::Primitive& q,cybr::Vec3 a,cybr::Vec3 b,cybr::Vec3 c){Tri t={cv(a),cv(b),cv(c),cv(q.na),cv(q.nb),cv(q.nc),cv(q.ta),cv(q.tb),cv(q.tc),q.material,q.object,int(q.smooth),int(q.has_uv)};
  t.ca=cv(q.ca);t.cb=cv(q.cb);t.cc=cv(q.cc);t.pa=cv(q.pa);t.pb=cv(q.pb);t.pc=cv(q.pc);t.vertexMaterial=q.vertex_material;
  if(q.shape==cybr::Shape::Quad){
   auto uv=[&](cybr::Vec3 p){auto d=p-q.a;double bb=cybr::dot(q.b,q.b),cc=cybr::dot(q.c,q.c),bc=cybr::dot(q.b,q.c),db=cybr::dot(d,q.b),dc=cybr::dot(d,q.c),den=bb*cc-bc*bc;return V{(db*cc-dc*bc)/den,(dc*bb-db*bc)/den,0};};
   t.ta=uv(a);t.tb=uv(b);t.tc=uv(c);t.uv=1;
  }
  triangles.push_back(t);for(auto v:{a,b,c})vertices.push_back(make_float3(float(v.x),float(v.y),float(v.z)));};
 for(auto&q:s.primitives){if(q.material<0||q.material>=int(materials.size())||q.area()<=1e-15||!std::isfinite(q.area()))throw std::runtime_error("Invalid GPU geometry");if(cybr::norm2(q.velocity)!=0)throw std::runtime_error("GPU deformation/motion unsupported");if(q.shape==cybr::Shape::Triangle)triangle(q,q.a,q.b,q.c);else if(q.shape==cybr::Shape::Quad){triangle(q,q.a,q.a+q.b,q.a+q.c);triangle(q,q.a+q.b,q.a+q.b+q.c,q.a+q.c);}else throw std::runtime_error("GPU currently accepts triangles and quads; tessellate analytic primitives explicitly");}
 std::vector<int> emitters;std::vector<double> emitterCdf;double emitterWeight=0;
 for(size_t i=0;i<triangles.size();i++){
  auto&t=triangles[i];const auto&m=s.materials[t.material];
  if(m.emission<=0)continue;
  double area=cybr::norm(cybr::cross(cv(t.b)-cv(t.a),cv(t.c)-cv(t.a)))*.5;
  double density=m.emission*std::max(.01,m.color.eval(550));double weight=area*density;
  if(!std::isfinite(weight)||weight<=0)throw std::runtime_error("Invalid GPU area-light weight");
  t.lightPdfArea=density;emitterWeight+=weight;emitters.push_back(int(i));emitterCdf.push_back(emitterWeight);
 }
 if(!s.environment.active()&&emitters.empty()&&deltas.empty())throw std::runtime_error("GPU scene has no supported active light");
 if(emitterWeight>0){for(auto id:emitters)triangles[id].lightPdfArea/=emitterWeight;for(auto&cdf:emitterCdf)cdf/=emitterWeight;}
 p.emitterCount=int(emitters.size());
 if(triangles.empty())throw std::runtime_error("No GPU triangles");s.primitives.clear();s.primitives.shrink_to_fit();
 p.camera.origin=cv(s.camera.origin);p.camera.forward=cv(cybr::normalize(s.camera.target-s.camera.origin));p.camera.right=cv(cybr::normalize(cybr::cross(cv(p.camera.forward),s.camera.up)));p.camera.up=cv(cybr::cross(cv(p.camera.right),cv(p.camera.forward)));p.camera.fov=s.camera.fov;p.camera.scale=s.camera.ortho_scale;p.camera.ortho=s.camera.orthographic;
 buildEnvironment(s.environment,p.proposalWidth,p.proposalHeight);p.refractiveNee=refractiveNee;p.envBase=cv(s.environment.base.controls);p.envStrength=s.environment.strength;p.envRotation=s.environment.rotation;p.envFlat=s.environment.flat;
 CUDA(cudaSetDevice(0));CUDA(cudaFree(0));cudaDeviceProp device;CUDA(cudaGetDeviceProperties(&device,0));
 size_t freeBytes,totalBytes;CUDA(cudaMemGetInfo(&freeBytes,&totalBytes));size_t required=triangles.size()*sizeof(Tri)+vertices.size()*sizeof(float3)*4+size_t(p.count)*(sizeof(Pixel)+5*sizeof(V))+emitters.size()*(sizeof(int)+sizeof(double))+deltas.size()*sizeof(Delta)+64*1024*1024;
 required+=texturePixels.size()*sizeof(V)+textures.size()*sizeof(Texture)+s.environment.cdf.size()*sizeof(double)*2;
 if(required>freeBytes*3/4)throw std::runtime_error("Insufficient GPU memory budget; CPU batch is untouched");
 OPTIX(optixInit());OptixDeviceContext context=nullptr;OptixDeviceContextOptions options={};OPTIX(optixDeviceContextCreate(0,&options,&context));Buffers buffers;
 p.triangles=buffers.upload(triangles);size_t triangleCount=triangles.size();triangles.clear();triangles.shrink_to_fit();p.materials=buffers.upload(materials);p.spectra=buffers.upload(spectra);
 p.emitters=buffers.upload(emitters);p.emitterCdf=buffers.upload(emitterCdf);
 p.deltas=buffers.upload(deltas);
 p.textures=buffers.upload(textures);p.texturePixels=buffers.upload(texturePixels);texturePixels.clear();texturePixels.shrink_to_fit();
 auto dv=buffers.upload(vertices);vertices.clear();vertices.shrink_to_fit();CUdeviceptr vertexBuffer=(CUdeviceptr)dv;unsigned flags=OPTIX_GEOMETRY_FLAG_DISABLE_ANYHIT;
 OptixBuildInput bi={};bi.type=OPTIX_BUILD_INPUT_TYPE_TRIANGLES;bi.triangleArray.vertexFormat=OPTIX_VERTEX_FORMAT_FLOAT3;bi.triangleArray.vertexStrideInBytes=sizeof(float3);bi.triangleArray.numVertices=unsigned(triangleCount*3);bi.triangleArray.vertexBuffers=&vertexBuffer;bi.triangleArray.flags=&flags;bi.triangleArray.numSbtRecords=1;
 OptixAccelBuildOptions abo={};abo.buildFlags=OPTIX_BUILD_FLAG_PREFER_FAST_TRACE;abo.operation=OPTIX_BUILD_OPERATION_BUILD;OptixAccelBufferSizes sizes;
 OPTIX(optixAccelComputeMemoryUsage(context,&abo,&bi,1,&sizes));auto scratch=buffers.alloc<char>(sizes.tempSizeInBytes),gas=buffers.alloc<char>(sizes.outputSizeInBytes);
 OPTIX(optixAccelBuild(context,0,&abo,&bi,1,(CUdeviceptr)scratch,sizes.tempSizeInBytes,(CUdeviceptr)gas,sizes.outputSizeInBytes,&p.gas,nullptr,0));CUDA(cudaDeviceSynchronize());
 if(s.environment.texture){std::vector<V> pixels;for(auto c:s.environment.texture->pixels)pixels.push_back(cv(c));p.environment=buffers.upload(pixels);p.envWidth=s.environment.texture->width;p.envHeight=s.environment.texture->height;}
 p.envCdf=buffers.upload(s.environment.cdf);p.envProbability=buffers.upload(s.environment.probability);
 auto code=read(ptx);OptixModule module=nullptr;OptixModuleCompileOptions mo={};mo.optLevel=OPTIX_COMPILE_OPTIMIZATION_LEVEL_3;
 OptixPipelineCompileOptions po={};po.traversableGraphFlags=OPTIX_TRAVERSABLE_GRAPH_FLAG_ALLOW_SINGLE_GAS;po.numPayloadValues=3;po.numAttributeValues=2;po.pipelineLaunchParamsVariableName="params";po.pipelineLaunchParamsSizeInBytes=sizeof(Params);po.usesPrimitiveTypeFlags=OPTIX_PRIMITIVE_TYPE_FLAGS_TRIANGLE;
 char log[262144];size_t logSize=sizeof(log);auto result=optixModuleCreate(context,&mo,&po,code.data(),code.size(),log,&logSize,&module);if(result!=OPTIX_SUCCESS)throw std::runtime_error(std::string(log,std::min(logSize,sizeof(log)))+optixGetErrorName(result));
 OptixProgramGroupDesc desc[3]={};desc[0].kind=OPTIX_PROGRAM_GROUP_KIND_RAYGEN;desc[0].raygen.module=module;desc[0].raygen.entryFunctionName="__raygen__render";desc[1].kind=OPTIX_PROGRAM_GROUP_KIND_MISS;desc[1].miss.module=module;desc[1].miss.entryFunctionName="__miss__surface";desc[2].kind=OPTIX_PROGRAM_GROUP_KIND_HITGROUP;desc[2].hitgroup.moduleCH=module;desc[2].hitgroup.entryFunctionNameCH="__closesthit__surface";
 OptixProgramGroup groups[3];OptixProgramGroupOptions go={};logSize=sizeof(log);OPTIX(optixProgramGroupCreate(context,desc,3,&go,log,&logSize,groups));OptixPipeline pipeline;OptixPipelineLinkOptions link={};link.maxTraceDepth=1;logSize=sizeof(log);OPTIX(optixPipelineCreate(context,&po,&link,groups,3,log,&logSize,&pipeline));
 OptixStackSizes stack={};for(auto group:groups)OPTIX(optixUtilAccumulateStackSizes(group,&stack,pipeline));unsigned dcTraversal,dcState,continuation;OPTIX(optixUtilComputeStackSizes(&stack,1,0,0,&dcTraversal,&dcState,&continuation));OPTIX(optixPipelineSetStackSize(pipeline,dcTraversal,dcState,continuation,1));
 std::vector<Record> records(3);for(int i=0;i<3;i++)OPTIX(optixSbtRecordPackHeader(groups[i],&records[i]));auto rec=buffers.upload(records);OptixShaderBindingTable sbt={};sbt.raygenRecord=(CUdeviceptr)rec;sbt.missRecordBase=(CUdeviceptr)(rec+1);sbt.missRecordStrideInBytes=sizeof(Record);sbt.missRecordCount=1;sbt.hitgroupRecordBase=(CUdeviceptr)(rec+2);sbt.hitgroupRecordStrideInBytes=sizeof(Record);sbt.hitgroupRecordCount=1;
 p.film=buffers.alloc<Pixel>(p.count);p.position=buffers.alloc<V>(p.count);p.normal=buffers.alloc<V>(p.count);p.albedo=buffers.alloc<V>(p.count);p.object=buffers.alloc<V>(p.count);p.depth=buffers.alloc<V>(p.count);p.errors=buffers.alloc<unsigned>(1);auto dp=buffers.alloc<Params>(inflight);
 uint64_t signature=cybr::hash_file(argv[0],cybr::hash_file(ptx,cybr::scene_signature(input,s)));signature=cybr::hash_bytes(&p.refractiveNee,sizeof(p.refractiveNee),signature);signature=cybr::hash_bytes(region,sizeof(region),signature);std::vector<Pixel> film(p.count);unsigned begin=0;if(!resume.empty()){begin=restore(resume,signature,film);if(begin>unsigned(cfg.spp))throw std::runtime_error("Checkpoint samples exceed target");CUDA(cudaMemcpy(p.film,film.data(),film.size()*sizeof(Pixel),cudaMemcpyHostToDevice));}
 auto start=std::chrono::steady_clock::now();double maxLaunchMs=0,kernelMs=0;unsigned completed=begin;
 struct LaunchQueue {
  Params* host=nullptr;cudaEvent_t before[8]={},after[8]={};int count;
  LaunchQueue(int n):count(n){CUDA(cudaMallocHost((void**)&host,n*sizeof(Params)));for(int i=0;i<n;i++){CUDA(cudaEventCreate(&before[i]));CUDA(cudaEventCreate(&after[i]));}}
  ~LaunchQueue(){cudaDeviceSynchronize();for(int i=0;i<count;i++){cudaEventDestroy(before[i]);cudaEventDestroy(after[i]);}cudaFreeHost(host);}
 } queue(inflight);
 int pending=0;uint64_t launchCount=0;
 auto flush=[&](){if(!pending)return;CUDA(cudaEventSynchronize(queue.after[pending-1]));for(int j=0;j<pending;j++){float ms;CUDA(cudaEventElapsedTime(&ms,queue.before[j],queue.after[j]));kernelMs+=ms;maxLaunchMs=std::max(maxLaunchMs,double(ms));if(ms>1000)throw std::runtime_error("GPU launch exceeded 1s safety gate; reduce --tile before continuing");}pending=0;};
 auto launch=[&](unsigned offset,unsigned length){int j=pending;queue.host[j]=p;queue.host[j].offset=offset;CUDA(cudaMemcpyAsync(dp+j,queue.host+j,sizeof(p),cudaMemcpyHostToDevice));CUDA(cudaEventRecord(queue.before[j]));OPTIX(optixLaunch(pipeline,0,(CUdeviceptr)(dp+j),sizeof(p),&sbt,length,1,1));CUDA(cudaEventRecord(queue.after[j]));++pending;++launchCount;if(pending==inflight)flush();};
 auto progress=[&](const char*phase){std::ofstream f(out+"-progress.json.tmp");f<<"{\"renderer\":\"CYBR LIGHT OptiX\",\"phase\":\""<<phase<<"\",\"completedPackets\":"<<completed<<",\"totalPackets\":"<<cfg.spp<<",\"bands\":"<<cfg.bands<<",\"maxLaunchMs\":"<<maxLaunchMs<<"}\n";f.close();replace(out+"-progress.json.tmp",out+"-progress.json");};
 if(aovOnly){
  p.diagnostics=1;for(unsigned off=0;off<p.count;off+=tile)launch(off,std::min(unsigned(tile),p.count-off));flush();
  auto guide=[&](V*ptr,const char*name){std::vector<V> data(p.count);CUDA(cudaMemcpy(data.data(),ptr,data.size()*sizeof(V),cudaMemcpyDeviceToHost));std::vector<cybr::Vec3> values;values.reserve(data.size());for(auto x:data)values.push_back(cv(x));cybr::write_pfm(out+name,values,p.width,p.height);};
  guide(p.position,"_position.pfm");guide(p.normal,"_normal.pfm");guide(p.albedo,"_albedo.pfm");guide(p.object,"_object.pfm");guide(p.depth,"_depth.pfm");
  std::ofstream receipt(out+"-aov.json");receipt<<"{\"aovOnly\":true,\"filmModified\":false,\"width\":"<<p.width<<",\"height\":"<<p.height<<",\"signature\":\""<<signature<<"\",\"maxLaunchMs\":"<<maxLaunchMs<<"}\n";receipt.close();
  OPTIX(optixPipelineDestroy(pipeline));for(auto g:groups)OPTIX(optixProgramGroupDestroy(g));OPTIX(optixModuleDestroy(module));OPTIX(optixDeviceContextDestroy(context));return 0;
 }
 std::cerr<<"CYBR LIGHT OptiX on "<<device.name<<"; triangles="<<triangleCount<<"; packets="<<begin<<".."<<cfg.spp<<"; bands="<<cfg.bands<<"\n";
 progress("rendering");for(unsigned sample=begin;sample<unsigned(cfg.spp);sample++){p.sample=sample;for(unsigned off=0;off<p.count;off+=tile)launch(off,std::min(unsigned(tile),p.count-off));flush();completed=sample+1;unsigned errors;CUDA(cudaMemcpy(&errors,p.errors,sizeof(errors),cudaMemcpyDeviceToHost));if(errors)throw std::runtime_error("Invalid spectral paths or medium-stack overflow: "+std::to_string(errors));progress("rendering");if(completed%saveEvery==0||completed==unsigned(cfg.spp)||(stopAfter&&completed==unsigned(stopAfter))){CUDA(cudaMemcpy(film.data(),p.film,film.size()*sizeof(Pixel),cudaMemcpyDeviceToHost));checkpoint(out+".gpu-checkpoint",signature,completed,film);}if(stopAfter&&completed==unsigned(stopAfter)){progress("checkpointed");return 0;}}
 p.diagnostics=1;for(unsigned off=0;off<p.count;off+=tile)launch(off,std::min(unsigned(tile),p.count-off));flush();
 CUDA(cudaMemcpy(film.data(),p.film,film.size()*sizeof(Pixel),cudaMemcpyDeviceToHost));std::vector<cybr::Vec3> rgb(p.count);
 for(unsigned i=0;i<p.count;i++){rgb[i]=cybr::xyz_to_rgb(cv(film[i].xyz)/completed);if(!std::isfinite(rgb[i].x)||!std::isfinite(rgb[i].y)||!std::isfinite(rgb[i].z))throw std::runtime_error("Nonfinite film");}
 cybr::write_pfm(out+".pfm",rgb,p.width,p.height);cybr::write_ppm(out+".ppm",rgb,p.width,p.height,cfg.exposure);
 for(unsigned i=0;i<p.count;i++){double variance=completed>1?std::max(0.,(film[i].y2-film[i].y*film[i].y/completed)/(completed-1)):0;rgb[i]=cybr::Vec3(std::sqrt(variance/completed));}
 cybr::write_pfm(out+"_stderr.pfm",rgb,p.width,p.height);
 std::vector<Pixel>().swap(film);std::vector<cybr::Vec3>().swap(rgb);
 auto aov=[&](V*ptr,const char*name){std::vector<V> data(p.count);CUDA(cudaMemcpy(data.data(),ptr,data.size()*sizeof(V),cudaMemcpyDeviceToHost));std::vector<cybr::Vec3> values;values.reserve(data.size());for(auto x:data)values.push_back(cv(x));cybr::write_pfm(out+name,values,p.width,p.height);};
 aov(p.position,"_position.pfm");aov(p.normal,"_normal.pfm");aov(p.albedo,"_albedo.pfm");aov(p.object,"_object.pfm");aov(p.depth,"_depth.pfm");double seconds=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
 std::ofstream report(out+".json");report<<std::setprecision(12)<<"{\"renderer\":\"CYBR LIGHT OptiX spectral\",\"gpu_execution\":true,\"device\":\""<<device.name<<"\",\"width\":"<<p.width<<",\"height\":"<<p.height<<",\"packets_per_pixel\":"<<completed<<",\"wavelengths_per_packet\":"<<p.bands<<",\"invalid_path_samples\":0,\"render_seconds\":"<<seconds<<",\"max_launch_ms\":"<<maxLaunchMs<<",\"triangles\":"<<triangleCount<<",\"resumed_from_samples\":"<<begin<<",\"denoising_used\":false}\n";report.close();progress("complete");
 std::cerr<<"Completed GPU render in "<<seconds<<" s; max launch "<<maxLaunchMs<<" ms\n";
 std::ofstream timings(out+"-timing.json");timings<<"{\"kernelSeconds\":"<<kernelMs/1000<<",\"launchCount\":"<<launchCount<<",\"inflight\":"<<inflight<<",\"tile\":"<<tile<<"}\n";
 OPTIX(optixPipelineDestroy(pipeline));for(auto g:groups)OPTIX(optixProgramGroupDestroy(g));OPTIX(optixModuleDestroy(module));OPTIX(optixDeviceContextDestroy(context));return 0;
 }catch(const std::exception&e){std::cerr<<"ERROR: "<<e.what()<<"\n";return 1;}}
