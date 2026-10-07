"""Check refractive NEE against unmodified path sampling on a submerged bed."""
from pathlib import Path
import argparse,json,sys,subprocess
import numpy as np
import trimesh
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'python'))
from cybrlight import Scene,Settings,Camera,read_pfm

def main():
    p=argparse.ArgumentParser();p.add_argument('--gpu',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--scattering',type=float,default=0);p.add_argument('--spp',type=int,default=256);a=p.parse_args()
    out=a.out.resolve();out.mkdir(parents=True,exist_ok=True)
    s=Scene('Submerged diffuse receiver, finite closed water')
    s.settings=Settings(width=128,height=96,spp=a.spp,bands=8,max_depth=12,rr_depth=6,filter='tent',seed=912)
    s.camera=Camera(origin=(2,2.5,4),target=(0,0,0),up=(0,1,0),fov=36)
    s.environment.update(color=(.6,.7,.8),strength=1,flat=True)
    floor=s.material(type='diffuse',color=(.55,.4,.24));water=s.material(type='glass',ior_a=1.334,absorption=(.25,.06,.03),scattering=a.scattering,phase_g=.74)
    s.quad((-.9,-.2,-.9),(0,0,1.8),(1.8,0,0),floor,object_id=1)
    box=trimesh.creation.box(extents=(2,.8,2));s.mesh(box.vertices,box.faces,water,object_id=2)
    scene=s.save(out/'fixture.cys')
    for name,flags in [('reference',[]),('connected',['--refractive-nee'])]:
        with (out/f'{name}.log').open('w') as log:subprocess.run([str(a.gpu),'--scene',str(scene),'--out',str(out/name),'--tile','512',*flags],stdout=log,stderr=log,check=True)
    x=read_pfm(out/'reference.pfm');y=read_pfm(out/'connected.pfm');mask=read_pfm(out/'reference_object.pfm')[:,:,0]==2
    assert np.isfinite(x).all() and np.isfinite(y).all() and not np.array_equal(x,y),'Connection path was not exercised'
    mean_a=x[mask].mean();mean_b=y[mask].mean();relative=float(abs(mean_a-mean_b)/mean_a)
    result=dict(relativeMeanError=relative,referenceMean=float(mean_a),connectedMean=float(mean_b),pixels=int(mask.sum()))
    for name in ['reference','connected']:
        report=json.loads((out/f'{name}.json').read_text());assert report['invalid_path_samples']==0;result[name]=report
    (out/'comparison.json').write_text(json.dumps(result,indent=2))
    def display(z):
        z=np.maximum(z,0);z=z/(1+z);return np.uint8(np.clip(z**(1/2.2)*255,0,255))
    Image.fromarray(np.concatenate((display(x),display(y)),axis=1)).save(out/'comparison.png')
    print(json.dumps(result));assert relative<.03,'Refractive connection changed mean energy beyond tolerance'

if __name__=='__main__':main()
