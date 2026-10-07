"""Real-device CPU/GPU comparisons; artifacts on disk, bounded JSON output."""
from pathlib import Path
import argparse,json,subprocess,sys,time,shutil
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'python'))
from cybrlight import Scene,Settings,Camera,read_pfm

def run(exe,scene,prefix,*args):
    started=time.perf_counter()
    with prefix.with_suffix('.log').open('w') as log:
        subprocess.run([str(exe),'--scene',str(scene),'--out',str(prefix),*args],stdout=log,stderr=log,check=True)
    return time.perf_counter()-started

def compare(cpu,gpu,out):
    a=read_pfm(cpu.with_suffix('.pfm'));b=read_pfm(gpu.with_suffix('.pfm'))
    assert a.shape==b.shape and np.isfinite(a).all() and np.isfinite(b).all()
    ids_a=read_pfm(cpu.with_name(cpu.name+'_object.pfm'))[:,:,0]
    ids_b=read_pfm(gpu.with_name(gpu.name+'_object.pfm'))[:,:,0]
    regions={}
    for oid in np.unique(ids_a):
        mask=(ids_a==oid)&(ids_b==oid)
        if mask.sum()<20:continue
        mean_a=float(a[mask].mean());mean_b=float(b[mask].mean())
        regions[str(int(oid))]={'pixels':int(mask.sum()),'cpuMean':mean_a,'gpuMean':mean_b,'relativeMeanError':abs(mean_a-mean_b)/max(abs(mean_a),1e-5)}
    metrics={'idAgreement':float((ids_a==ids_b).mean()),'relativeMeanError':float(abs(a.mean()-b.mean())/max(abs(a.mean()),1e-5)),'rmse':float(np.sqrt(np.mean((a-b)**2))),'regions':regions}
    def display(x):
        x=np.maximum(x,0)/np.array([1.2048,.9483,.9087])*.55
        x=np.clip(x*(2.51*x+.03)/(x*(2.43*x+.59)+.14),0,1)
        return np.uint8(np.rint(np.where(x<=.0031308,12.92*x,1.055*x**(1/2.4)-.055)*255))
    sheet=Image.fromarray(np.concatenate((display(a),display(b)),axis=1));sheet.thumbnail((1600,1600));sheet.save(out.with_suffix('.png'))
    out.with_suffix('.json').write_text(json.dumps(metrics,indent=2));return metrics

def main():
    p=argparse.ArgumentParser();p.add_argument('--build',type=Path,default=Path('D:/CYBR-build/exploded-instrument'));p.add_argument('--instrument',type=int)
    p.add_argument('--gpu',type=Path);p.add_argument('--out',type=Path);a=p.parse_args()
    work=a.out or a.build/'optix-validation';work.mkdir(parents=True,exist_ok=True)
    gpu=a.gpu or a.build/'native-optix/cybr-light-optix.exe';cpu=a.build/'native-msvc/Release/cybr-light.exe'
    if a.instrument is not None:
        index=a.instrument;folder=a.build/'path-bake-light'/f'draft-{index:03d}';scene=folder/'scene.cys';prefix=work/f'instrument-{index:03d}-gpu'
        report=json.loads((folder/'native.json').read_text());args=['--size',str(report['width']),str(report['height']),'--spp',str(report['packets_per_pixel']),'--bands',str(report['wavelengths_per_packet'])]
        seconds=run(gpu,scene,prefix,*args)
        print(json.dumps({'wallSeconds':seconds,**compare(folder/'native',prefix,work/f'instrument-{index:03d}-comparison')}));return
    import trimesh
    scene=Scene('GPU spectral parity fixture');scene.settings=Settings(width=192,height=120,spp=32,bands=8,threads=4,max_depth=20,rr_depth=6,filter='tent',seed=1307)
    scene.camera=Camera(origin=(0,1.4,7),target=(0,0,0),up=(0,1,0),fov=42)
    floor=scene.material(name='neutral',type='diffuse',color=.5)
    metal=scene.material(name='measured aluminium',type='metal',eta=.24,k=3.5,alpha_u=.035,alpha_v=.095)
    for name in ('eta','k'):
        shutil.copyfile(a.build/f'studio/optical-constants/Al-{name}.spd',work/f'Al-{name}.spd')
        scene.materials[metal].spectra[name]=str((work/f'Al-{name}.spd').resolve())
    glass=scene.material(name='coated glass',type='glass',ior_a=1.48,ior_b=.008,film_nm=380,film_ior=2.8,film_gradient=(0,140,90))
    water=scene.material(name='water',type='glass',ior_a=1.324,ior_b=.003,absorption=(.12,.024,.006))
    scene.quad((-8,-.85,-8),(0,0,16),(16,0,0),floor,object_id=1)
    for center,radius,mat,oid in [((-1.35,0,0),.8,metal,2),((.55,0,0),.8,glass,3),((.55,0,0),.64,water,4)]:
        mesh=trimesh.creation.icosphere(subdivisions=3,radius=radius)
        normals=mesh.vertices/radius;scene.mesh(mesh.vertices+center,mesh.faces,mat,normals=normals,object_id=oid)
    shutil.copyfile(a.build/'studio/light-path-studio.pfm',work/'studio.pfm')
    scene.environment.update(texture=str((work/'studio.pfm').resolve()),strength=1,flat=True)
    path=scene.save(work/'fixture.cys')
    cpu_seconds=run(cpu,path,work/'fixture-cpu');gpu_seconds=run(gpu,path,work/'fixture-gpu')
    metrics=compare(work/'fixture-cpu',work/'fixture-gpu',work/'fixture-comparison')
    run(gpu,path,work/'resume-gpu','--stop-after','8')
    run(gpu,path,work/'resume-gpu','--resume',str(work/'resume-gpu.gpu-checkpoint'))
    full=read_pfm(work/'fixture-gpu.pfm');resumed=read_pfm(work/'resume-gpu.pfm')
    assert np.array_equal(full,resumed),'GPU checkpoint resume changed film'
    mismatch=subprocess.run([str(gpu),'--scene',str(path),'--out',str(work/'reject-mismatch'),
                             '--size','193','120','--resume',str(work/'fixture-gpu.gpu-checkpoint')],capture_output=True,text=True)
    assert mismatch.returncode!=0 and 'mismatch' in mismatch.stderr.lower(),'Incompatible checkpoint accepted'
    scene.materials[0].checker=1
    unsupported=scene.save(work/'unsupported.cys')
    rejected=subprocess.run([str(gpu),'--scene',str(unsupported),'--out',str(work/'reject-feature')],capture_output=True,text=True)
    assert rejected.returncode!=0 and 'Unsupported GPU material' in rejected.stderr,'Unsupported lighting silently accepted'
    result={'cpuWallSeconds':cpu_seconds,'gpuWallSeconds':gpu_seconds,'resumeExact':True,
            'checkpointMismatchRejected':True,'unsupportedFeatureRejected':True,**metrics}
    (work/'validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
    assert metrics['idAgreement']>.999 and metrics['relativeMeanError']<.1

if __name__=='__main__':main()
