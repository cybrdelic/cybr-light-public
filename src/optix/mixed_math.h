#pragma once
// Experimental only. Keep film, geometry, Fresnel/complex arithmetic and RNG
// in double precision; test FP32 transcendental evaluation independently.
// No --use_fast_math: float intrinsics retain their normal accuracy guarantees.
#ifdef CYBR_OPTIX_MIXED_MATH
__device__ __forceinline__ double cybr_exp(double x){return expf(float(x));}
__device__ __forceinline__ double cybr_sin(double x){return sinf(float(x));}
__device__ __forceinline__ double cybr_cos(double x){return cosf(float(x));}
__device__ __forceinline__ double cybr_tan(double x){return tanf(float(x));}
__device__ __forceinline__ double cybr_acos(double x){return acosf(float(x));}
__device__ __forceinline__ double cybr_atan2(double y,double x){return atan2f(float(y),float(x));}
#define exp cybr_exp
#define sin cybr_sin
#define cos cybr_cos
#define tan cybr_tan
#define acos cybr_acos
#define atan2 cybr_atan2
#endif
