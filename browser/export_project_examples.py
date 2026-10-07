"""Export real GEO recipe and SCENES source geometry, not rendered images."""
from pathlib import Path
import sys, json, gzip, hashlib
import numpy as np
import trimesh

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
sys.path[:0]=[str(REPO/'cybr-geo/src'),str(REPO/'cybr-geo/examples')]

def save(name, source, items, materials, notes):
    payload=bytearray(); meshes=[]
    def attr(a, dtype):
        a=np.asarray(a,dtype=dtype).reshape(-1)
        result=dict(offset=len(payload),count=a.size,dtype='float32' if dtype=='<f4' else 'uint32')
        payload.extend(a.tobytes());return result
    for item in items:
        p,n,f,m=item[:4]
        record=dict(module=name,material=m+32,positions=attr(p,'<f4'),normals=attr(n,'<f4'),indices=attr(f,'<u4'))
        if len(item)>4:record['colors']=attr(item[4],'<f4')
        meshes.append(record)
    out=HERE/'assets'/name;out.mkdir(parents=True,exist_ok=True)
    (out/'instrument.bin.gz').write_bytes(gzip.compress(payload,mtime=0))
    manifest=dict(source=str(source.relative_to(REPO)),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),notes=notes,modules=[dict(name=name,explodedX=0)],meshes=meshes,customMaterials={i+32:m for i,m in enumerate(materials)})
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
    print(name,'triangles',sum(len(item[2]) for item in items),'bytes',len(payload),flush=True)

def geo():
    import custom_flange
    assembly=custom_flange.build();items=[]
    for part in assembly.parts:
        matrix=assembly.pose(part)
        items.append((part.vertices@matrix[:3,:3].T+matrix[:3,3],part.normals@matrix[:3,:3].T,part.faces,part.material))
    materials=[dict(color=list(m.color),metalness=m.metal,roughness=m.rough,ior=m.ior) for m in assembly.materials]
    save('example-geo-flange',REPO/'cybr-geo/examples/custom_flange.py',items,materials,'Original CYBR GEO custom flange CAD recipe. RGB studio relighting; anisotropic finish and coatings are not reproduced.')

def showcase():
    sys.path.insert(0,str(REPO/'cybr-geo/examples/fuse_c220'))
    import printer
    import orbit_inspection_wrist
    for name,source,builder in [
        ('example-geo-printer','fuse_c220/printer.py',lambda:printer.posed(printer.build(),printer.State(x=30,y=-30,z=100))),
        ('example-geo-wrist','orbit_inspection_wrist.py',orbit_inspection_wrist.build),
    ]:
        print('Building',name,flush=True)
        assembly=builder();items=[]
        for part in assembly.parts:
            matrix=assembly.pose(part)
            items.append((part.vertices@matrix[:3,:3].T+matrix[:3,3],part.normals@matrix[:3,:3].T,part.faces,part.material))
        materials=[dict(color=list(m.color),metalness=m.metal,roughness=m.rough,ior=m.ior) for m in assembly.materials]
        save(name,REPO/'cybr-geo/examples'/source,items,materials,'Original CYBR GEO '+assembly.name+' assembly, static pose. RGB studio relighting; authored microfinish, anisotropy and coatings are not yet reproduced. Not the native photographic render.')

def observatory():
    source=REPO/'cybr-scenes/scenes/observatory-iv/assets/observatory_interior_source.glb'
    scene=trimesh.load(source);items=[];materials=[]
    # Bake scene graph instances into geometry, retaining authored vertex colors
    # as per-face material groups when the source uses ColorVisuals.
    for node in scene.graph.nodes_geometry:
        matrix,key=scene.graph[node];mesh=scene.geometry[key].copy();mesh.apply_transform(matrix)
        p=mesh.vertices[:,[0,2,1]]*np.array([1,-1,1]);n=mesh.vertex_normals[:,[0,2,1]]*np.array([1,-1,1])
        visual=mesh.visual
        if visual.kind in ('face','vertex'):
            colors=np.asarray(visual.face_colors)[:,:3]/255
            unique,groups=np.unique(colors,axis=0,return_inverse=True)
            for i,c in enumerate(unique):
                linear=np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
                m=len(materials);materials.append(dict(color=linear.tolist(),metalness=0,roughness=.6))
                items.append((p,n,mesh.faces[groups==i],m))
        else:
            material=visual.material;c=np.asarray(getattr(material,'baseColorFactor',None) if getattr(material,'baseColorFactor',None) is not None else [180,180,180,255])[:3]/255
            c=np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
            m=len(materials);materials.append(dict(color=c.tolist(),metalness=float(getattr(material,'metallicFactor',0) or 0),roughness=float(getattr(material,'roughnessFactor',.6) or .6)))
            items.append((p,n,mesh.faces,m))
    save('example-observatory',source,items,materials,'Original Observatory IV source interior GLB, not the complete final scene. RGB studio relighting; texture maps, native lights, spectral quartz and participating media are not imported.')

if __name__=='__main__':
    if '--showcase' in sys.argv:showcase()
    else:geo();observatory()
