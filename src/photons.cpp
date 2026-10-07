// Forward spectral light tracing onto an ideal planar irradiance detector.
// This is NOT a cached texture painted into a camera image: every detector
// contribution is an independently traced photon, with flux / pixel-area units.
#include "cybr/io.hpp"
#include <chrono>
#include <iostream>
#ifdef _OPENMP
#include <omp.h>
#endif
using namespace cybr;
int main(int argc,char**argv){
 try{
  if(argc<3){std::cerr<<"Usage: cybr-photons SCENE.cys OUTPUT_PREFIX [PHOTONS=4000000]\n";return 1;}
  Scene s;read_scene(argv[1],s);s.build();std::string prefix=argv[2];uint64_t photons=argc>3?std::stoull(argv[3]):4000000;
  int width=900,height=420,threads=4;const double xmin=-5.0,xmax=1.5,ymin=-1.1,ymax=1.1,detector_z=5.;
  const double pixel_area=(xmax-xmin)*(ymax-ymin)/(width*height);std::vector<std::vector<Vec3>> buffers(threads,std::vector<Vec3>(width*height));
#ifdef _OPENMP
  omp_set_num_threads(threads);
#endif
  if(photons==0)throw std::runtime_error("Photon count must be positive");
  uint64_t detected=0,escaped=0,absorbed=0,truncated=0;auto start=std::chrono::steady_clock::now();
#pragma omp parallel for schedule(static) reduction(+:detected,escaped,absorbed,truncated)
  for(uint64_t sample=0;sample<photons;sample++){
   int tid=0;
#ifdef _OPENMP
   tid=omp_get_thread_num();
#endif
   RNG rng(mix64(sample)^9238423);double nm=360+470*rng.uniform();
   Ray ray{{(rng.uniform()-.5)*.015,(rng.uniform()-.5)*1.5,-3},{0,0,1}};
   double power=blackbody_normalized(nm,6500);std::vector<MediumEntry> stack;bool done=false;
   for(int bounce=0;bounce<48;bounce++){
    Hit hit;s.bvh.hit(ray,hit);double detector_t=ray.d.z>0?(detector_z-ray.o.z)/ray.d.z:inf;
    if(detector_t>0&&detector_t<hit.t){Vec3 point=ray.at(detector_t);int x=int(std::floor((point.x-xmin)/(xmax-xmin)*width)),y=int(std::floor((ymax-point.y)/(ymax-ymin)*height));
     if(x>=0&&x<width&&y>=0&&y<height){buffers[tid][y*width+x]+=s.observer.xyz(nm)*(power*470/(106.856917101*double(photons)*pixel_area));detected++;}else escaped++;done=true;break;}
    if(hit.primitive<0){escaped++;done=true;break;}
    if(!stack.empty())power*=std::exp(-s.materials[stack.back().material].absorption.eval(nm)*hit.t);
    const auto&m=s.materials[hit.material];if(!m.dielectric()){absorbed++;done=true;break;}
    double ni=stack.empty()?1:s.materials[stack.back().material].ior(nm),nt=m.ior(nm);
    if(!hit.front){nt=1;for(int j=int(stack.size())-1;j>=0;j--)if(stack[j].object==hit.object){nt=j>0?s.materials[stack[j-1].material].ior(nm):1;break;}}
    auto b=sample_bsdf(m,hit,-ray.d,nm,ni,nt,rng,false,false);if(b.pdf<=0){absorbed++;done=true;break;}
    // Convert radiance-mode eta scaling to the importance/flux convention.
    power*=b.weight.v*(b.transmission?sqr(nt/ni):1);
    if(b.transmission){if(hit.front)stack.push_back({hit.object,hit.material});else for(int j=int(stack.size())-1;j>=0;j--)if(stack[j].object==hit.object){stack.erase(stack.begin()+j);break;}}
    ray={offset(hit.p,hit.gn,b.wi),b.wi};
   }
   if(!done)truncated++;
  }
  std::vector<Vec3> pixels(width*height);for(int i=0;i<width*height;i++){Vec3 xyz;for(int j=0;j<threads;j++)xyz+=buffers[j][i];pixels[i]=xyz_to_rgb(xyz);}
  std::filesystem::path p(prefix);std::filesystem::create_directories(p.parent_path());write_pfm(prefix+".pfm",pixels,width,height);write_ppm(prefix+".ppm",pixels,width,height,.8);
  double seconds=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
  std::ofstream f(prefix+".json");f<<"{\n \"renderer\":\"CYBR LIGHT forward spectral light tracer\",\n \"image_generation_used\":false,\n \"denoising_used\":false,\n \"photon_count\":"<<photons<<",\n \"detected\":"<<detected<<",\n \"escaped\":"<<escaped<<",\n \"absorbed\":"<<absorbed<<",\n \"depth_truncated\":"<<truncated<<",\n \"render_seconds\":"<<seconds<<",\n \"width\":"<<width<<",\n \"height\":"<<height<<",\n \"detector_z\":"<<detector_z<<",\n \"detector_x_range\":["<<xmin<<","<<xmax<<"],\n \"detector_y_range\":["<<ymin<<","<<ymax<<"],\n \"estimator\":\"photon flux per detector pixel area; no kernel splatting\",\n \"limitation\":\"planar irradiance detector, not a bidirectional camera integrator\"\n}\n";
  std::cerr<<"Traced "<<photons<<" spectral photons in "<<seconds<<" s; detected="<<detected<<"\n";
 }catch(const std::exception&e){std::cerr<<"ERROR: "<<e.what()<<"\n";return 1;}
}
