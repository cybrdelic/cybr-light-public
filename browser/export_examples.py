"""Export source-authored gallery geometry as explicit RGB studio studies.

No native beauty images. Studio studies and source-lit variants are separate.
Analytic curved primitives are tessellated for the browser triangle BVH.
"""
from pathlib import Path
import sys, gzip, json, hashlib
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'examples'))
import gallery

def vector(v):
    a=np.asarray(v,dtype=float)
    return np.full(3,float(a)) if a.ndim==0 else a

def frame(n):
    n=vector(n);n/=np.linalg.norm(n)
    t=np.cross(n,[1,0,0] if abs(n[0])<.9 else [0,1,0]);t/=np.linalg.norm(t)
    return n,t,np.cross(n,t)

def export(name,builder,source_lighting=False):
    scene=builder();groups={};subject_points=[];active_boundary=0
    def add(points,material,normals=None):
        p=np.asarray(points,float);cross=np.cross(p[1]-p[0],p[2]-p[0]);length=np.linalg.norm(cross)
        if length<1e-12:return
        n=np.tile(cross/length,(3,1)) if normals is None else np.asarray(normals,float)
        if np.dot(cross,np.mean(n,axis=0))<0:p=p[[0,2,1]];n=n[[0,2,1]]
        groups.setdefault(material,[]).append((p,n,active_boundary))
    for active_boundary,p in enumerate(scene.primitives,1):
        mat=scene.materials[p['material']]
        if not source_lighting and (mat.type=='emitter' or mat.name=='graphite floor'):continue
        if mat.type not in ('diffuse','plastic','metal','glass','emitter'):raise ValueError('Unsupported '+mat.type)
        m=p['material'];kind=p['type']
        if kind=='triangle':add(p['vertices'],m,p['normals'] if p['smooth'] else None)
        elif kind=='quad':
            a=vector(p['corner']);u=vector(p['u']);v=vector(p['v']);add([a,a+u,a+u+v],m);add([a,a+u+v,a+v],m)
        elif kind=='sphere':
            c=vector(p['center']);r=p['radius']
            def normal(i,j):
                phi=i*np.pi/48;theta=j*2*np.pi/96
                return np.array([np.sin(phi)*np.cos(theta),np.cos(phi),np.sin(phi)*np.sin(theta)])
            for i in range(48):
                for j in range(96):
                    n=[normal(i,j),normal(i+1,j),normal(i+1,j+1),normal(i,j+1)]
                    for face in ((0,1,2),(0,2,3)):add([c+r*n[k] for k in face],m,[n[k] for k in face])
        elif kind in ('cylinder','disk'):
            if kind=='cylinder':a=vector(p['a']);b=vector(p['b']);axis,t,v=frame(b-a)
            else:a=vector(p['a']);axis,t,v=frame(p['b'])
            for i in range(128):
                n=t*np.cos(i*2*np.pi/128)+v*np.sin(i*2*np.pi/128);nn=t*np.cos((i+1)*2*np.pi/128)+v*np.sin((i+1)*2*np.pi/128)
                x=n*p['radius'];y=nn*p['radius']
                if kind=='disk':add([a,a+x,a+y],m,[axis]*3)
                else:add([a+x,b+x,b+y],m,[n,n,nn]);add([a+x,b+y,a+y],m,[n,nn,nn])
        else:raise ValueError('Unsupported primitive '+kind)
    payload=bytearray();meshes=[];custom={}
    def attribute(a,dtype):
        a=np.asarray(a,dtype=dtype).reshape(-1);offset=len(payload);payload.extend(a.tobytes());return {'offset':offset,'count':a.size,'dtype':'float32' if dtype=='<f4' else 'uint32'}
    for m,tris in groups.items():
        p=np.concatenate([t[0] for t in tris]);n=np.concatenate([t[1] for t in tris]);p=p[:,[0,2,1]]*np.array([1,-1,1]);n=n[:,[0,2,1]]*np.array([1,-1,1]);key=m+32
        meshes.append({'module':name,'material':key,'positions':attribute(p,'<f4'),'normals':attribute(n,'<f4'),'indices':attribute(np.arange(len(p)),'<u4'),'boundaries':attribute([t[2] for t in tris],'<u4')})
        mat=scene.materials[m];color=vector(mat.color)
        if mat.type!='emitter' and mat.name!='graphite floor':subject_points.append(p)
        if mat.type=='metal':
            eta=vector(mat.eta);k=vector(mat.k);color=((eta-1)**2+k*k)/((eta+1)**2+k*k)
        custom[key]={'role':mat.name,'color':color.tolist(),'roughness':mat.roughness,'metalness':int(mat.type=='metal')}
        custom[key]['nativeType']=mat.type
        if mat.type=='emitter':
            # RGB approximation of the authored blackbody, explicitly not its
            # spectral basis. Preserve emitter shape, intensity and temperature.
            kelvin=max(1000,min(40000,mat.kelvin or 6500));temperature=kelvin/100
            red=255 if temperature<=66 else 329.698727446*(temperature-60)**-.1332047592
            green=99.4708025861*np.log(temperature)-161.1195681661 if temperature<=66 else 288.1221695283*(temperature-60)**-.0755148492
            blue=255 if temperature>=66 else 0 if temperature<=19 else 138.5177312231*np.log(temperature-10)-305.0447927307
            rgb=np.clip(np.array([red,green,blue])/255,0,1);rgb=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
            custom[key].update(emission=(rgb*mat.emission*color).tolist(),kelvin=kelvin)
        if mat.type=='glass':custom[key].update(nativeType='glass',ior=mat.ior_a+mat.ior_b/.55**2,attenuationColor=np.exp(-vector(mat.absorption)).tolist(),attenuationDistance=1)
    out=Path(__file__).parent/'assets'/name;out.mkdir(parents=True,exist_ok=True)
    (out/'instrument.bin.gz').write_bytes(gzip.compress(payload,mtime=0))
    manifest={'source':'cybr-light/examples/gallery.py::'+builder.__name__,'sourceSha256':hashlib.sha256((ROOT/'examples/gallery.py').read_bytes()).hexdigest(),'notes':'Actual source geometry. Tessellated analytic surfaces, approximate RGB materials; relit in browser studio. Not native spectral/lighting parity.','modules':[{'name':name,'explodedX':0}],'meshes':meshes,'customMaterials':custom}
    if source_lighting:
        points=np.concatenate(subject_points);low=points.min(axis=0);high=points.max(axis=0)
        target=vector(scene.camera.target);view=vector(scene.camera.origin)-target;extent=float((high-low).max())
        manifest.update(framing={'center':[float(target[0]),float(-target[2]),float(target[1])],'extent':extent},lighting={'environment':(vector(scene.environment['color'])*scene.environment['strength']).tolist(),'disableStudio':True},camera={'yaw':float(np.arctan2(view[0],view[2])),'pitch':float(np.arcsin(view[1]/np.linalg.norm(view))),'distance':float(np.linalg.norm(view)*4/extent),'fov':scene.camera.fov},exposure=scene.settings.exposure)
        manifest['notes']='Source geometry, floor, emitter shapes and environment intensity retained. RGB approximations of spectral materials and blackbody emission; not spectral parity.'
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
    print(name, 'triangles',sum(len(v) for v in groups.values()),'bytes',len(payload))

if __name__=='__main__':
    export('example-materials',gallery.material_gallery)
    export('example-knot',gallery.mesh_knot)
    export('example-materials-source',gallery.material_gallery,source_lighting=True)
    export('example-knot-source',gallery.mesh_knot,source_lighting=True)
