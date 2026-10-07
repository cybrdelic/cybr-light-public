"""Full native triangle stream, preserving geometry and vertex tints."""
import json,struct
import numpy as np
from export_project_examples import HERE,REPO,save
source=HERE/'source-cache/geode/scene.meshbin'
with source.open('rb') as f:magic,count=struct.unpack('<4sI',f.read(8))
assert magic==b'CVR2' and source.stat().st_size==8+count*144
if count*144>512*1024*1024:raise RuntimeError(f'{count} triangles exceeds browser single-buffer cap; refusing a partial scene')
raw=np.memmap(source,dtype='<f4',offset=8,shape=(count,36),mode='r')
materials=[]
for i in range(10):
    m=dict(color=[.25]*3,roughness=.7,metalness=0)
    if i in (3,4):m['color']=[1]*3
    if i in (6,8,9):m.update(nativeType='glass',ior=1.333 if i==6 else 1.46,roughness=.025,color=[1]*3)
    materials.append(m)
items=[]
for i in np.unique(raw[:,18]).astype(int):
    a=np.asarray(raw[raw[:,18]==i]);p=a[:,:9].reshape(-1,3);n=a[:,9:18].reshape(-1,3)
    items.append((p,n,np.arange(len(p),dtype=np.uint32).reshape(-1,3),int(i),a[:,26:35].reshape(-1,3)))
name='example-scene-drowned-geode'
save(name,REPO/'cybr-scenes/environments/engines/geode/build_v3.py',items,materials,'Full Drowned Geode V3 geometry and vertex tints. RGB material study: scanned maps, mineral shading, caustics, water scattering, fog and spectral quartz are NOT reproduced. Studio illumination, not native lighting.')
path=HERE/'assets'/name/'manifest.json';m=json.loads(path.read_text());target=np.array([.6,12.8,6.3]);delta=np.array([-3.8,-10.3,2.6])-target
m.update(framing=dict(center=target.tolist(),extent=35),camera=dict(yaw=float(np.arctan2(delta[0],-delta[1])),pitch=float(np.arcsin(delta[2]/np.linalg.norm(delta))),distance=float(np.linalg.norm(delta)*4/35)))
path.write_text(json.dumps(m,indent=2))
path=HERE/'environment-catalog.json';catalog=json.loads(path.read_text())
for row in catalog['entries']:
    if row['id']==name:row.update(status='exported',triangles=count);row.pop('error',None)
path.write_text(json.dumps(catalog,indent=2))
