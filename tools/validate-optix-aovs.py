"""CPU/GPU material guides and non-mutating AOV-only output contract."""
from pathlib import Path
import argparse,json,subprocess,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'python'))
from cybrlight import read_pfm
p=argparse.ArgumentParser();p.add_argument('--gpu',type=Path,required=True);p.add_argument('--cpu',type=Path,required=True);p.add_argument('--scene',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
a.out.mkdir(parents=True,exist_ok=True)
for label,exe,args in [('cpu',a.cpu,['--spp','1']),('gpu',a.gpu,['--aov-only','--tile','512'])]:
    with (a.out/(label+'.log')).open('w') as log:subprocess.run([str(exe),'--scene',str(a.scene),'--out',str(a.out/label),*args],stdout=log,stderr=log,check=True)
assert not (a.out/'gpu.pfm').exists() and not (a.out/'gpu.gpu-checkpoint').exists() and not (a.out/'gpu-progress.json').exists()
ci=read_pfm(a.out/'cpu_object.pfm')[:,:,0];gi=read_pfm(a.out/'gpu_object.pfm')[:,:,0]
mask=(ci==gi)&(ci>0);metrics={}
for key in ['normal','albedo']:
    cpu=read_pfm(a.out/f'cpu_{key}.pfm');gpu=read_pfm(a.out/f'gpu_{key}.pfm')
    assert np.isfinite(cpu).all() and np.isfinite(gpu).all()
    error=np.abs(cpu[mask]-gpu[mask]);metrics[key+'MaxError']=float(error.max());assert error.max()<.002,(key,error.max())
    if key=='albedo':
        variation=float(gpu[gi==2].std());assert variation>.04,'Vertex guide is flat instead of physical albedo';metrics['vertexAlbedoStd']=variation
metrics.update(aovOnly=True,filmUntouched=True,objectIDAgreement=float((ci==gi).mean()))
(a.out/'result.json').write_text(json.dumps(metrics,indent=2));print(json.dumps(metrics))
