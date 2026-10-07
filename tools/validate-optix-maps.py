"""Real GPU gates for linear textures, wrapped normals, and refractive water.

Experimental outputs only. Never overwrites the production renderer or bakes.
"""
from pathlib import Path
import argparse,json,sys,subprocess,shutil
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'python'))
from cybrlight import Scene,Settings,Camera,read_pfm
from importlib.util import spec_from_file_location,module_from_spec
spec=spec_from_file_location('validation',Path(__file__).with_name('validate-optix.py'))
validation=module_from_spec(spec);spec.loader.exec_module(validation)

def pfm(path,a):
    a=np.asarray(a,dtype='<f4')
    with path.open('wb') as f:
        f.write(f'PF\n{a.shape[1]} {a.shape[0]}\n-1.0\n'.encode());f.write(a[::-1].tobytes())

def main():
    p=argparse.ArgumentParser();p.add_argument('--gpu',type=Path,required=True)
    p.add_argument('--cpu',type=Path,default=Path('D:/CYBR-build/exploded-instrument/native-msvc/Release/cybr-light.exe'))
    p.add_argument('--out',type=Path,required=True);p.add_argument('--landscape',action='store_true');p.add_argument('--texture-ior',action='store_true');p.add_argument('--vertex-material',action='store_true');args=p.parse_args();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    y,x=np.mgrid[:128,:128]/128
    rgb=np.stack((.12+.65*x,.1+.55*y,.18+.25*np.sin(x*19)**2),axis=-1)
    pfm(out/'color.pfm',rgb)
    height=.5+.12*np.sin(x*18)*np.cos(y*23)
    pfm(out/'height.pfm',np.repeat(height[:,:,None],3,axis=2))
    pfm(out/'parameters.pfm',np.stack((height,1.25+.6*x,np.zeros_like(x)),axis=-1))
    normal=np.stack((.5+.04*np.sin(x*22),.5+.04*np.cos(y*17),np.ones_like(x)),axis=-1)
    pfm(out/'normal.pfm',normal)
    s=Scene('GPU mapped mineral and water validation')
    s.settings=Settings(width=256,height=192,spp=64,bands=8,threads=4,max_depth=16,rr_depth=6,filter='tent',seed=1307)
    s.camera=Camera(origin=(3,3,5),target=(0,0,0),up=(0,1,0),fov=40)
    shutil.copyfile('D:/CYBR-build/exploded-instrument/studio/light-path-studio.pfm',out/'studio.pfm')
    s.environment.update(texture=str(out/'studio.pfm'),strength=1,flat=True)
    floor=s.material(type='diffuse',color=.7)
    pigment=s.material(type='landscape' if args.landscape else 'diffuse',color=.8,texture=str(out/'color.pfm'),uv_scale=(2.3,-1.7),roughness_texture=str(out/('parameters.pfm' if args.texture_ior else 'height.pfm')) if args.landscape else None,texture_ior=args.texture_ior)
    bumped=s.material(type='bumpmap',children=(pigment,-1),texture=str(out/'height.pfm'),bump_scale=.035)
    clamped=s.material(type='plastic',color=.8,texture=str(out/'color.pfm'),texture_repeat=False,uv_scale=(1.7,1.4),roughness=.3)
    mapped=s.material(type='normalmap',children=(clamped,-1),texture=str(out/'normal.pfm'))
    water=s.material(type='glass',ior_a=1.324,ior_b=.003,absorption=(1.2,.24,.06))
    rippled=s.material(type='bumpmap',children=(water,-1),texture=str(out/'height.pfm'),bump_scale=.006)
    s.quad((-4,-.45,-4),(0,0,8),(8,0,0),floor,object_id=1)
    if args.vertex_material:
        leaf=s.material(type='landscape',color=1)
        s.mesh([[-1.8,-.4,-.8],[-1.8,-.4,.8],[-.2,-.4,-.8],[-.2,-.4,.8]],[[0,1,2],[2,1,3]],leaf,object_id=2,
               albedo=[[.65,.12,.08],[.1,.6,.15],[.1,.2,.7],[.6,.5,.2]],parameters=[[.1,1.3,0],[.9,1.7,0],[.3,1.4,0],[.7,1.6,0]])
    else:s.quad((-1.8,-.4,-.8),(0,0,1.6),(1.6,0,0),bumped,object_id=2)
    s.quad((.2,-.4,-.8),(0,0,1.6),(1.6,0,0),mapped,object_id=3)
    # A closed, outward-wound water box, not an infinite one-sided interface.
    lo=np.array([-1.6,-.35,-.6]);hi=np.array([-.4,.1,.6])
    import trimesh
    box=trimesh.creation.box(extents=hi-lo);v=box.vertices+(lo+hi)/2
    uv=v[:,[0,2]]*.6+.5
    s.mesh(v,box.faces,rippled,uv=uv,object_id=4)
    scene=s.save(out/'fixture.cys')
    times={}
    for name,exe in [('cpu',args.cpu),('gpu',args.gpu)]:
        times[name]=validation.run(exe,scene,out/name,*(['--tile','2048'] if name=='gpu' else []))
    metrics=validation.compare(out/'cpu',out/'gpu',out/'comparison')
    report=json.loads((out/'gpu.json').read_text());assert report['invalid_path_samples']==0
    validation.run(args.gpu,scene,out/'resume','--tile','2048','--stop-after','8')
    validation.run(args.gpu,scene,out/'resume','--tile','2048','--resume',str(out/'resume.gpu-checkpoint'))
    assert np.array_equal(read_pfm(out/'gpu.pfm'),read_pfm(out/'resume.pfm'))
    # Asset content, not merely filename, must invalidate the checkpoint.
    pfm(out/'color.pfm',rgb*.9)
    rejected=subprocess.run([str(args.gpu),'--scene',str(scene),'--out',str(out/'reject'),
        '--resume',str(out/'gpu.gpu-checkpoint')],capture_output=True,text=True)
    assert rejected.returncode!=0 and 'mismatch' in rejected.stderr.lower()
    pfm(out/'color.pfm',rgb)
    result=dict(metrics=metrics,wallSeconds=times,resumeExact=True,textureChangeRejected=True,native=report)
    (out/'result.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
    assert metrics['idAgreement']>.999 and metrics['relativeMeanError']<.03
    assert all(r['relativeMeanError']<.06 for r in metrics['regions'].values())

if __name__=='__main__':main()
