"""Remove only zero-area LOD faces and bind each manifest to its exact payload."""
from pathlib import Path
import gzip,json,hashlib
import numpy as np
root=Path(__file__).resolve().parents[1]/'browser/assets/gallery-lod'
index=json.loads((root/'index.json').read_text());removed=0
for entry in index['entries']:
    for level in ('low','near'):
        folder=root/entry['id'];path=folder/f'{level}.json'
        manifest=json.loads(path.read_text());raw=gzip.decompress((folder/f'{level}.bin.gz').read_bytes())
        payload=bytearray();meshes=[];total=0
        def read(s):return np.frombuffer(raw,dtype={'float32':'<f4','uint32':'<u4'}[s['dtype']],count=s['count'],offset=s['offset'])
        def attr(a,dtype):
            a=np.asarray(a,dtype=dtype).reshape(-1);offset=len(payload);payload.extend(a.tobytes())
            return {'offset':offset,'count':a.size,'dtype':'float32' if dtype=='<f4' else 'uint32'}
        for mesh in manifest['meshes']:
            p=read(mesh['positions']).reshape(-1,3);f=read(mesh['indices']).reshape(-1,3)
            q=p[f].astype(float);area=np.linalg.norm(np.cross(q[:,1]-q[:,0],q[:,2]-q[:,0]),axis=1)
            valid=area>=1e-14;removed+=int((~valid).sum());f=f[valid]
            if not len(f):continue
            used, inverse=np.unique(f.reshape(-1),return_inverse=True)
            result={k:v for k,v in mesh.items() if k not in ['positions','normals','colors','indices','boundaries']}
            for key in ['positions','normals','colors']:
                if key in mesh:result[key]=attr(read(mesh[key]).reshape(-1,3)[used],'<f4')
            result['indices']=attr(inverse,'<u4')
            meshes.append(result);total+=len(f)
        manifest.update(meshes=meshes,count=total,byteLength=len(payload),sha256=hashlib.sha256(payload).hexdigest())
        (folder/f'{level}.bin.gz').write_bytes(gzip.compress(payload,compresslevel=3))
        path.write_text(json.dumps(manifest));entry['counts'][level]=total
(root/'index.json').write_text(json.dumps(index,indent=2))
print(json.dumps({'models':len(index['entries']),'removedZeroAreaFaces':removed,'lowTriangles':sum(e['counts']['low'] for e in index['entries'])}))
