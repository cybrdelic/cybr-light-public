"""Native CPU/GPU emission, area-light MIS, shadow and resume comparisons."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,subprocess,sys
import numpy as np
import trimesh

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'python'))
from cybrlight import Scene,Settings,Camera,read_pfm
spec=importlib.util.spec_from_file_location('optix_comparison',Path(__file__).with_name('validate-optix.py'))
comparison=importlib.util.module_from_spec(spec);spec.loader.exec_module(comparison)


def fixture(environment,emission,delta=None):
    s=Scene('Native emissive surface verification')
    s.settings=Settings(width=192,height=128,spp=256,bands=12,threads=4,max_depth=8)
    s.camera=Camera(origin=(2.8,2.1,4.5),target=(0,.65,0),up=(0,1,0),fov=45)
    s.environment.update(color=(.7,.8,1),strength=environment,flat=True)
    if delta=='sun':s.directional_light((.3,-1,-.2),(1,.85,.7),scale=1.5)
    if delta=='point':s.point_light((-1,2,1),(1,.85,.7),scale=5)
    if delta=='spot':s.spot_light((-1,2,1),(.2,-1,-.2),(1,.85,.7),scale=8)
    floor=s.material(name='diffuse_receiver',type='diffuse',color=(.5,.5,.5))
    body=s.material(name='occluding_plastic',type='plastic',color=(.12,.13,.14),roughness=.45)
    hot=s.material(name='1100K_emitter',type='emitter',color=(1,1,1),emission=emission,kelvin=1100)
    warm=s.material(name='1800K_emissive_plastic',type='plastic',color=(.05,.05,.05),emission=emission*20,kelvin=1800,roughness=.5)
    s.quad((-3,0,-3),(0,0,6),(6,0,0),floor,object_id=1)
    box=trimesh.creation.box(extents=(.5,.65,.6));s.mesh(box.vertices+np.array([0,.325,.5]),box.faces,body,object_id=2)
    s.quad((-1.3,.65,-.5),(.8,0,0),(0,.7,0),hot,object_id=3)
    s.quad((.5,.65,-.5),(.8,0,0),(0,.7,0),warm,object_id=4)
    return s


def main():
    p=argparse.ArgumentParser();p.add_argument('--gpu',type=Path,required=True);p.add_argument('--cpu',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    a.out.mkdir(parents=True,exist_ok=True);results=[]
    source={n:hashlib.sha256((ROOT/'src/optix'/n).read_bytes()).hexdigest() for n in ('main.cpp','device.cu','shared.h')}
    for name,environment,emission,delta in [('emission-only',0.,1.,None),('mixed',.2,1.,None),('environment-only',.2,0.,None),('sun',0.,0.,'sun'),('point',0.,0.,'point'),('spot',0.,0.,'spot')]:
        s=fixture(environment,emission,delta);scene=s.save(a.out/f'{name}.cys');cpu=a.out/f'{name}-cpu';gpu=a.out/f'{name}-gpu'
        cpu_time=comparison.run(a.cpu,scene,cpu);gpu_time=comparison.run(a.gpu,scene,gpu)
        metrics=comparison.compare(cpu,gpu,a.out/f'{name}-comparison')
        assert metrics['idAgreement']>.999
        assert metrics['relativeMeanError']<.02,(name,metrics)
        for region in metrics['regions'].values():
            if region['cpuMean']>1e-3:assert region['relativeMeanError']<.04,(name,region)
        results.append(dict(case=name,cpu_wall_s=cpu_time,gpu_wall_s=gpu_time,**metrics))
    scene=a.out/'mixed.cys';prefix=a.out/'resume'
    comparison.run(a.gpu,scene,prefix,'--stop-after','8')
    comparison.run(a.gpu,scene,prefix,'--resume',str(prefix.with_suffix('.gpu-checkpoint')))
    assert np.array_equal(read_pfm((a.out/'mixed-gpu').with_suffix('.pfm')),read_pfm(prefix.with_suffix('.pfm')))
    changed=fixture(.2,1.1).save(a.out/'changed-emission.cys')
    reject=subprocess.run([str(a.gpu),'--scene',str(changed),'--out',str(a.out/'rejected'),
                           '--resume',str(prefix.with_suffix('.gpu-checkpoint'))],capture_output=True,text=True)
    assert reject.returncode!=0 and 'mismatch' in reject.stderr.lower()
    # An emitter is one-sided even when its material is marked two-sided for
    # scattering. Viewing its back must not create light in a black scene.
    back=Scene('Back-facing emitter');back.settings=Settings(width=48,height=32,spp=8,bands=8,threads=2,max_depth=4)
    back.camera=Camera(origin=(0,0,-2),target=(0,0,0),up=(0,1,0),fov=35)
    back.environment.update(strength=0)
    m=back.material(type='emitter',color=1,emission=10,kelvin=1400,two_sided=True)
    back.quad((-2,-2,0),(4,0,0),(0,4,0),m)
    backpath=back.save(a.out/'backface.cys')
    for name,exe in [('cpu',a.cpu),('gpu',a.gpu)]:
        target=a.out/f'backface-{name}';comparison.run(exe,backpath,target)
        assert np.max(abs(read_pfm(target.with_suffix('.pfm'))))==0
    report=dict(cases=results,resume_exact=True,changed_emission_resume_rejected=True,backface_dark=True,
                source_sha256=source,binary_sha256={str(exe):hashlib.sha256(exe.read_bytes()).hexdigest() for exe in (a.cpu,a.gpu)},
                timing_note='Concurrent physics work was running; these timings are not an isolated performance benchmark.',
                scope='Small native surface-emission correctness fixture; not a scene-quality or general performance claim')
    (a.out/'verification.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k not in ('source_sha256','cases')},indent=2))
    for row in results:print(json.dumps({k:v for k,v in row.items() if k!='regions'}))


if __name__=='__main__':main()
