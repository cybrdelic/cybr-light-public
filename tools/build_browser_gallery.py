"""Build separate gallery LOD assets; never modify full-resolution exports."""
from pathlib import Path
import gzip, json, math, sys, hashlib
import numpy as np
from scipy.spatial import cKDTree
import fast_simplification

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'browser/assets'
OUT = ASSETS / 'gallery-lod'

def build():
    OUT.mkdir(exist_ok=True)
    labels = {}
    for name in ['catalog.json', 'environment-catalog.json']:
        for entry in json.loads((ROOT/'browser'/name).read_text())['entries']:
            labels[entry['id']] = entry['label']
    sources = [(p.name, p, None) for p in sorted(ASSETS.glob('example-*')) if (p/'manifest.json').exists()]
    instrument = ASSETS/'instrument-cartridges-c'
    sources += [(name, instrument, name) for name in ['geo','light','elements','song','combat','scenes','flip']]
    entries=[]
    requested=[arg for arg in sys.argv[1:] if not arg.startswith('--')]
    for ident, source, module in sources:
        if requested and ident not in requested:
            existing=json.loads((OUT/'index.json').read_text())['entries']
            entries.append(next(e for e in existing if e['id']==ident))
            continue
        dest = OUT/ident
        dest.mkdir(exist_ok=True)
        manifest=json.loads((source/'manifest.json').read_text())
        raw=gzip.decompress((source/'instrument.bin.gz').read_bytes())
        def read(spec):
            return np.frombuffer(raw,dtype={'float32':'<f4','int16':'<i2','uint32':'<u4'}[spec['dtype']],count=spec['count'],offset=spec['offset'])
        meshes=[m for m in manifest['meshes'] if module is None or m['module']==module]
        decoded=[]
        removed_staging=0
        for m in meshes:
            material=manifest.get('customMaterials',{}).get(str(m['material']),{})
            if ident.endswith('-source') and (material.get('nativeType')=='emitter' or material.get('role')=='graphite floor'):
                removed_staging+=m['indices']['count']//3
                continue
            p=read(m['positions']).reshape(-1,3).astype(np.float64)
            n=read(m['normals']).reshape(-1,3).astype(np.float64)
            if m['normals']['dtype']=='int16': n/=32767
            faces=read(m['indices']).reshape(-1,3)
            colors=read(m['colors']).reshape(-1,3) if m.get('colors') else None
            if ident=='example-scene-observatory-full':
                # Keep the authored building/site, not kilometre-scale render
                # backdrops. Whole connected meshes are retained or excluded;
                # never slice triangles through a wall to crop the scene.
                framing=manifest['framing']; anchor=np.array(framing['center'])
                if np.max(p.max(axis=0)-p.min(axis=0))>framing['extent']*4 or np.linalg.norm((p.min(axis=0)+p.max(axis=0))*.5-anchor)>framing['extent']*3:
                    removed_staging+=len(faces)
                    continue
            decoded.append((m,p,n,faces,colors))
        if module=='flip':
            fluid=instrument.parent/'instrument-fluid'
            fm=json.loads((fluid/'manifest.json').read_text())
            item=fm['frames'][0]
            fluid_raw=gzip.decompress((fluid/item['file']).read_bytes())
            p=np.frombuffer(fluid_raw,dtype='<i2',count=item['count']*3).reshape(-1,3).astype(float)/fm['positionScale']
            n=np.frombuffer(fluid_raw,dtype='<i2',count=item['count']*3,offset=item['count']*6).reshape(-1,3).astype(float)/32767
            decoded=[({'material':7},p,n,np.arange(item['count']).reshape(-1,3),None)]
        # Use cached water geometry in the elements cartridge, just as other
        # gallery models are static. The individual FLIP viewer stays unchanged.
        lo=np.min([p.min(axis=0) for _,p,_,_,_ in decoded],axis=0)
        hi=np.max([p.max(axis=0) for _,p,_,_,_ in decoded],axis=0)
        scale=2.6/max(hi-lo)
        center=(lo+hi)*.5
        total=sum(len(f) for _,_,_,f,_ in decoded)
        counts={}
        if '--metadata-only' in sys.argv:
            old=next(e for e in json.loads((OUT/'index.json').read_text())['entries'] if e['id']==ident)
            counts=old['counts']
        for level,budget in [('low',24000),('near',140000)]:
            if '--metadata-only' in sys.argv: continue
            if level=='low' and '--near-only' in sys.argv:
                counts[level]=json.loads((dest/'low.json').read_text())['count']
                continue
            payload=bytearray(); output=[]; actual=0
            def attr(a,dtype):
                a=np.asarray(a,dtype=dtype).reshape(-1)
                offset=len(payload);payload.extend(a.tobytes())
                return {'offset':offset,'count':a.size,'dtype':'float32' if dtype=='<f4' else 'uint32'}
            for m,p,n,faces,colors in decoded:
                target=min(len(faces),max(128,round(budget*len(faces)/total)))
                if target < len(faces):
                    # Weld coincident positions before QEM; do not drop triangles
                    # or uniformly subsample faces (which would leave holes).
                    # Collapse sub-pixel topology for the overview. Tiny screw
                    # tessellation otherwise places a hard floor on QEM reduction.
                    if level=='low':
                        cell=max(hi-lo)/220
                        _, inv=np.unique(np.round(p/cell).astype(np.int64),axis=0,return_inverse=True)
                        weights=np.bincount(inv)
                        welded=np.column_stack([np.bincount(inv,weights=p[:,k])/weights for k in range(3)])
                    else:
                        welded,inv=np.unique(p,axis=0,return_inverse=True)
                    clustered=inv[faces]
                    clustered=clustered[(clustered[:,0]!=clustered[:,1])&(clustered[:,1]!=clustered[:,2])&(clustered[:,0]!=clustered[:,2])]
                    if not len(clustered): continue
                    q,f=fast_simplification.simplify(welded,clustered,target_count=min(target,len(clustered)),agg=7,preserve_border=level=='near')
                    nearest=cKDTree(p).query(q)[1]
                    normals=n[nearest]; col=colors[nearest] if colors is not None else None
                else: q,f,normals,col=p,faces,n,colors
                if ident.startswith('example-geo-'):
                    # QEM can merge vertices across a CAD crease. Nearest-source
                    # vertex normals then point along unrelated faces and make
                    # broad metal panels look shredded. Use geometric face
                    # normals for these reduced CAD surfaces; full originals
                    # retain their authored normal fields.
                    corners=q[f]
                    face_n=np.cross(corners[:,1]-corners[:,0],corners[:,2]-corners[:,0])
                    vertex_n=np.zeros_like(q)
                    for corner in range(3): np.add.at(vertex_n,f[:,corner],face_n)
                    vertex_n/=np.maximum(np.linalg.norm(vertex_n,axis=1)[:,None],1e-20)
                    face_n/=np.maximum(np.linalg.norm(face_n,axis=1)[:,None],1e-20)
                    corner_n=vertex_n[f]
                    corner_n=np.where((np.sum(corner_n*face_n[:,None,:],axis=2)>.9)[:,:,None],corner_n,face_n[:,None,:])
                    if col is not None: col=col[f].reshape(-1,3)
                    q=corners.reshape(-1,3)
                    normals=corner_n.reshape(-1,3)
                    f=np.arange(len(q)).reshape(-1,3)
                q=(q-center)*scale
                q[:,2]-=(lo[2]-center[2])*scale
                q=q.astype('<f4')
                corners=q[f].astype(float)
                valid=np.linalg.norm(np.cross(corners[:,1]-corners[:,0],corners[:,2]-corners[:,0]),axis=1)>=1e-14
                f=f[valid]
                if not len(f):continue
                used,inverse=np.unique(f.reshape(-1),return_inverse=True)
                q=q[used];normals=normals[used]
                if col is not None:col=col[used]
                f=inverse.reshape(-1,3)
                mesh={'module':'example-gallery','material':m['material'],'positions':attr(q,'<f4'),'normals':attr(normals,'<f4'),'indices':attr(f,'<u4')}
                if col is not None: mesh['colors']=attr(col,'<f4')
                output.append(mesh); actual+=len(f)
            (dest/f'{level}.bin.gz').write_bytes(gzip.compress(payload,compresslevel=3))
            (dest/f'{level}.json').write_text(json.dumps({'meshes':output,'customMaterials':manifest.get('customMaterials',{}),'count':actual,'byteLength':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}))
            counts[level]=actual
        if ident.startswith('example-geo-') and ident!='example-geo-yard':
            gallery_scale=max(hi-lo)/650
            scale_note='Machinery · shared millimetre scale'
        elif ident=='example-geo-yard' or ident.startswith('example-scene-') or ident=='example-observatory':
            metres=max(hi-lo)/1000 if ident=='example-geo-yard' else max(hi-lo)
            gallery_scale=metres*.04/2.6
            scale_note='Environment miniature · 1:100 relative to machinery'
        elif ident.startswith('example-knot') or ident.startswith('example-materials'):
            gallery_scale=max(hi-lo)/4.84
            scale_note='Optical studies · shared authored scale'
        else:
            gallery_scale=max(hi-lo)/650
            scale_note='Instrument parts · shared millimetre scale'
        entries.append({'id':ident,'label':labels.get(ident,ident.replace('example-','').replace('-',' ').upper()),'sourceTriangles':total,'counts':counts,'galleryScale':float(gallery_scale),'scaleNote':scale_note,'sourceBounds':[lo.tolist(),hi.tolist()],'normalizedSize':((hi-lo)*scale).tolist(),'removedStagingTriangles':removed_staging})
        print(json.dumps({'model':ident,**counts}),flush=True)
    (OUT/'index.json').write_text(json.dumps({'entries':entries,'columns':7},indent=2))
    print(json.dumps({'complete':len(entries),'lowTriangles':sum(e['counts']['low'] for e in entries)}),flush=True)

if __name__=='__main__': build()
