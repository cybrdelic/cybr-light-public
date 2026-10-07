"""Same input and transport source executed on CPU or explicitly selected CUDA simulator."""
from pathlib import Path
import sys,argparse,json,os
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import numpy as np
from cybrlight import Scene,Camera,Settings,bundle_scene
from cybrlight.portable import render_portable,pack_scene
ROOT=Path(__file__).resolve().parents[1]
def scene(width=20,height=14,spp=3,bands=4):
    s=Scene('Portable cross-target regression');s.settings=Settings(width=width,height=height,spp=spp,bands=bands,max_depth=8,seed=7427)
    s.camera=Camera(origin=(3,2.3,6),target=(0,.7,0),fov=39)
    floor=s.material(color=.6);s.quad((-5,0,-5),(0,0,10),(10,0,0),floor)
    metal=s.material(type='metal',alpha_u=.14,alpha_v=.32,eta=.2,k=3.4);s.sphere((-1.1,.7,0),.7,metal)
    glass=s.material(type='glass',ior_a=1.5,ior_b=.004,absorption=(.03,.005,.025));air=s.material(type='glass',ior_a=1,absorption=0)
    s.sphere((.75,.8,0),.75,glass);s.sphere((.75,.8,0),.35,air)
    rough=s.material(type='roughglass',ior_a=1.4,alpha_u=.16,alpha_v=.2);s.sphere((0,.4,-1.5),.4,rough)
    for i in range(5):s.cylinder((-1.5+i*.75,.1,-2.25),.09,.2,metal)
    s.point_light((-2,3,2),35);s.environment.update(color=[.5,.65,.85],strength=.3,flat=True);return s

def main():
    p=argparse.ArgumentParser();p.add_argument('--backend',choices=['cpu','cuda'],default='cpu');p.add_argument('--gallery',action='store_true');a=p.parse_args()
    s=scene(420,280,96,10) if a.gallery else scene()
    prefix=ROOT/('outputs/08_portable_bvh' if a.gallery else 'evidence/portable_'+a.backend)
    if a.gallery:bundle_scene(s,ROOT/'examples/executed/08_portable_bvh')
    result,report=render_portable(s,prefix,backend=a.backend);np.save(prefix.with_suffix('.npy'),result)
    if a.backend=='cuda':
        cpu=np.load(ROOT/'evidence/portable_cpu.npy');error=float(np.max(np.abs(cpu-result)));report['cpu_max_absolute_difference']=error
        np.testing.assert_allclose(result,cpu,atol=2e-12,rtol=2e-12)
    elif not a.gallery:
        from cybrlight import portable_kernel as k
        P,*_=pack_scene(s);r=np.random.default_rng(318);passed=True
        for i in range(1000):
            origin=tuple(r.uniform(-5,5,3));direction=r.normal(size=3);direction=tuple(direction/np.linalg.norm(direction));fast=k.intersect(P,origin,direction,.4,1e30);distance=1e30;index=-1
            for j,row in enumerate(P):
                if row[0]<0:continue
                t,n=k.hit_one(row,origin,direction,.4,distance)
                if t<distance:distance=t;index=j
            if fast[0]!=index or abs(fast[1]-distance)>1e-10:passed=False;break
        assert passed,'Threaded BVH differs from brute-force intersection'
        report['bvh_vs_bruteforce_rays']=1000;report['bvh_vs_bruteforce_passed']=True
    prefix.with_suffix('.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
