from __future__ import annotations
import sys
import time
import json
from pathlib import Path
import numpy as np
import torch
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from cybrlight.tensor_backend import WavefrontDiffuse,camera_samples,default_parameters
ROOT=Path(__file__).resolve().parents[1]

def image(data):
    a=np.maximum(data,0)
    a=np.clip(a*(2.51*a+.03)/(a*(2.43*a+.59)+.14),0,1)
    a=np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)
    return Image.fromarray(np.uint8(np.clip(a,0,1)*255+.5))

def main():
    torch.set_num_threads(1)
    module=WavefrontDiffuse(depth=4).eval()
    args=camera_samples(48,32,2,4,depth=4)+default_parameters()
    with torch.no_grad():
        a=module(*args)
        compiled=torch.jit.trace(module,args,check_trace=False)
        b=compiled(*args)
    error=float((a-b).abs().max())
    if error>2e-5:raise RuntimeError(f'JIT mismatch: {error}')
    compiled.save(str(ROOT/'build'/'cybr_tensor_cpu.pt'))
    (ROOT/'outputs'/'tensor_jit_graph.txt').write_text(str(compiled.inlined_graph))
    # Rendering uses the actual compiled graph. CUDA availability is reported,
    # not inferred from the backend's ability to accept CUDA tensors.
    width,height,spp,bands=384,256,64,8
    # Bound memory by a small packet batch instead of allocating every ray,
    # wavelength and random walk for the entire image at once.
    parameters=default_parameters()
    accumulation=torch.zeros(height,width,3,dtype=torch.float64)
    start=time.perf_counter();packet_batch=4
    with torch.no_grad():
        for packet in range(0,spp,packet_batch):
            current=min(packet_batch,spp-packet)
            rays=camera_samples(width,height,current,bands,depth=4,seed=20+packet)
            n=rays[0].shape[0];parts=[]
            for begin in range(0,n,65536):
                chunk=tuple(v[begin:begin+65536] for v in rays)
                parts.append(compiled(*(chunk+parameters)).cpu())
            values=torch.cat(parts).reshape(height,width,current,bands,3)
            accumulation+=values.sum((2,3)).to(torch.float64)
            del rays,parts,values,chunk
            print(f'Compiled CPU packets {packet+current}/{spp}',flush=True)
    pixels=(accumulation/(spp*bands)).float().numpy()
    seconds=time.perf_counter()-start
    np.save(ROOT/'outputs'/'12_tensor_jit_linear.npy',pixels)
    image(pixels).save(ROOT/'outputs'/'12_tensor_jit.png')
    # Reverse-mode gradient check for material parameters, compared with central
    # differences on exactly the same paths. No optimizer receives ground truth.
    small=camera_samples(40,28,3,4,depth=4,seed=82)
    centers,radii,colors,energy=default_parameters()
    colors.requires_grad_(True)
    values=module(*(small+(centers,radii,colors,energy)))
    loss=values.square().mean();loss.backward();automatic=float(colors.grad[1,1])
    eps=.001
    with torch.no_grad():
        plus=colors.detach().clone();minus=colors.detach().clone()
        plus[1,1]+=eps;minus[1,1]-=eps
        lp=module(*(small+(centers,radii,plus,energy))).square().mean()
        lm=module(*(small+(centers,radii,minus,energy))).square().mean()
    numerical=float((lp-lm)/(2*eps))
    rel=abs(automatic-numerical)/max(abs(numerical),1e-8)
    if rel>.003:raise RuntimeError(f'Reverse AD check failed: {rel}')
    report={'renderer':'CYBR LIGHT tensor diffuse backend','image_generation_used':False,
            'pytorch_version':torch.__version__,'cpu_executed':True,'cuda_available':torch.cuda.is_available(),
            'cuda_executed':False,'torchscript_jit_executed':True,'jit_max_absolute_error':error,
            'reverse_ad_gradient':automatic,'finite_difference_gradient':numerical,'gradient_relative_error':rel,
            'width':width,'height':height,'packets_per_pixel':spp,'wavelengths_per_packet':bands,
            'render_seconds':seconds,'packet_batch':packet_batch,'scope':'diffuse spheres and plane; rectangular area light; hard visibility; fixed depth 4',
            'limitations':['No mesh BVH in tensor backend','Visibility-boundary derivatives omitted','CUDA code path is unverified','Compilation and automatic differentiation are provided by PyTorch']}
    (ROOT/'outputs'/'12_tensor_jit.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':main()
