"""Collision hulls from the exact gallery LOD geometry, never visual proxies."""
import gzip, json
from pathlib import Path
import numpy as np
from scipy.spatial import ConvexHull

root=Path(__file__).resolve().parents[1]/'browser/assets/gallery-lod'
out=Path(__file__).resolve().parents[2]/'output/pile-tools/hulls.json'
index=json.loads((root/'index.json').read_text())
models=[]
for e in index['entries']:
    m=json.loads((root/e['id']/'low.json').read_text())
    raw=gzip.decompress((root/e['id']/'low.bin.gz').read_bytes())
    p=np.concatenate([np.frombuffer(raw,dtype='<f4',offset=s['positions']['offset'],count=s['positions']['count']).reshape(-1,3) for s in m['meshes']]).astype(np.float64)*e['galleryScale']
    p=p[:,[0,2,1]];p[:,2]*=-1
    center=(p.min(0)+p.max(0))/2;p-=center
    hull=ConvexHull(p)
    points=p[hull.vertices]
    models.append(dict(id=e['id'],sha256=m['sha256'],scale=e['galleryScale'],points=points.round(7).tolist(),size=np.ptp(p,axis=0).tolist(),radius=float(np.linalg.norm(p,axis=1).max())))
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(models,separators=(',',':')))
print(json.dumps(dict(models=len(models),hullVertices=sum(len(m['points']) for m in models),output=str(out))))
