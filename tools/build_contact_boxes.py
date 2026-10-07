"""Conservative compound contact bounds from every rendered low-LOD component.

No source meshes are changed. Spatial bins preserve open-frame cavities better
than a single convex hull. These are static packing proxies, not exact dynamics.
"""
import gzip, json
from pathlib import Path
import numpy as np

root = Path(__file__).resolve().parents[1] / 'browser/assets/gallery-lod'
index = json.loads((root/'index.json').read_text())
models = []
for entry in index['entries']:
    folder = root/entry['id']
    manifest = json.loads((folder/'low.json').read_text())
    raw = gzip.decompress((folder/'low.bin.gz').read_bytes())
    bounds = []
    for mesh in manifest['meshes']:
        a = mesh['positions']
        p = np.frombuffer(raw, dtype='<f4', offset=a['offset'], count=a['count']).reshape(-1,3).astype(float)
        p = p[:,[0,2,1]] * entry['galleryScale']; p[:,2] *= -1
        bounds.append((p.min(0), p.max(0)))
    lo = np.min([b[0] for b in bounds],axis=0); hi = np.max([b[1] for b in bounds],axis=0)
    origin = (lo+hi)/2
    bins = {}
    for low,high in bounds:
        key = tuple(np.minimum(3, ((low+high-2*lo)/2/np.maximum(hi-lo,1e-8)*4).astype(int)))
        if key in bins:
            a,b=bins[key]; bins[key]=(np.minimum(a,low),np.maximum(b,high))
        else: bins[key]=(low,high)
    boxes = [np.concatenate([a-origin,b-origin]).tolist() for a,b in bins.values()]
    models.append(dict(id=entry['id'],sha256=manifest['sha256'],boxes=boxes))
dest = root/'contact-boxes.json'
dest.write_text(json.dumps(dict(version=1,models=models),separators=(',',':')))
print(json.dumps(dict(path=str(dest),models=len(models),boxes=sum(len(m['boxes']) for m in models))))
