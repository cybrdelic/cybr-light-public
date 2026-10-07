#pragma once
#include <optix.h>
#include <cuda_runtime.h>
#include <stdint.h>
// Plain device-transfer records; no host pointers, virtual methods or STL.
struct V { double x,y,z; };
struct Spec { V rgb; int begin,count,constant; };
struct Delta { int kind;V position,direction;Spec intensity;double scale,cutoff,beam; };
struct Texture { int begin,width,height,repeat; double su,sv; };
struct Mat { Spec color,eta,k,absorption; int type,twoSided; double rough,ax,ay,a,b,film,filmIor; V filmGradient; int texture,normalTexture,normalType,roughnessTexture,textureIor; double bumpScale,scattering,phaseG,emission,kelvin; };
struct Tri { V a,b,c,na,nb,nc,ta,tb,tc; int material,object,smooth,uv; V ca,cb,cc,pa,pb,pc;int vertexMaterial;double lightPdfArea; };
struct Cam { V origin,forward,right,up; double fov,scale; int ortho; };
struct Pixel { V xyz; double y,y2; };
struct Params {
 OptixTraversableHandle gas;
 Tri* triangles; Mat* materials; double2* spectra; Texture* textures; V* texturePixels;
 int* emitters; double* emitterCdf; int emitterCount;
 Delta* deltas;int deltaCount;
 V* environment; int envWidth,envHeight; V envBase; double envStrength,envRotation; int envFlat;
 double* envCdf; double* envProbability; int proposalWidth,proposalHeight,refractiveNee;
 Cam camera; int width,height,bands,maxDepth,rrDepth,filter;
 uint64_t seed; unsigned int sample,offset,count,diagnostics;
 Pixel* film; V* position; V* normal; V* albedo; V* object; V* depth;
 unsigned int* errors;
 int regionX0,regionY0,regionX1,regionY1;
};
