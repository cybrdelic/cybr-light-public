"""Catalog full environments from native receipts; export complete Observatory geometry."""
import importlib.util,json,sys
from pathlib import Path
import numpy as np
from export_project_examples import REPO,HERE,save

rows=[]
root=REPO/'cybr-scenes'
registry=json.loads((root/'environments/scenes.json').read_text())['scenes']
for entry in registry:
    proof=json.loads((root/'docs/recovery-proof'/entry['id']/'verification.json').read_text())
    def count(value):
        if isinstance(value,dict):
            if 'triangles' in value:return value['triangles']
            for v in value.values():
                found=count(v)
                if found:return found
        return None
    triangles=count(proof)
    reason=f'Full native geometry: {triangles:,} triangles. '
    if triangles*96>512*1024*1024:reason+='Requires paged/instanced attribute storage; current binding limit is 5,592,405 triangles. No reduced substitute imported.'
    else:reason+='Native scene/material importer not implemented; spectral water/quartz, emission and original lighting need adaptation.'
    rows.append(dict(id='example-scene-'+entry['id'],label='SCENES / '+entry['title'],source='cybr-scenes/environments/'+entry['mesh'],status='needs renderer support',triangles=triangles,error=reason))
rows.append(dict(id='example-scene-observatory-full',label='SCENES / Observatory IV full geometry',status='building',source='cybr-scenes/scenes/observatory-iv/build_scene.py'))
rows.append(dict(id='example-geo-neo-vortex',label='GEO / REV NEO Vortex + SPARK Flex',status='missing source asset',source='cybr-geo/examples/neo_vortex/geometry',error='Manufacturer CAD import cache is absent. Source study scripts are retained; do not substitute the procedural M8325s motor.'))
def write():
    tmp=HERE/'environment-catalog.tmp';tmp.write_text(json.dumps(dict(entries=rows),indent=2));tmp.replace(HERE/'environment-catalog.json')
write()
try:
    source=root/'scenes/observatory-iv/build_scene.py'
    spec=importlib.util.spec_from_file_location('observatory_source',source);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    # Invoke geometry authoring only. Never overwrite original assets/receipts.
    m.import_room();m.paper_and_cloth();m.instruments();m.landscape()
    palette={0:[.65,.6,.51],1:[.52,.47,.39],2:[.33,.2,.1],3:[.77,.60,.30],4:[.32,.24,.12],5:[.13,.14,.15],6:[.80,.73,.58],7:[.12,.24,.23],8:[.78,.86,.89],9:[.15,.08,.04],10:[.05,.04,.03],11:[.19,.29,.16],12:[.76,.71,.60]}
    items=[];materials=[]
    for name,mesh,mat,tex,tint,uv in m.PARTS:
        index=len(materials);color=np.asarray(palette.get(mat,[.5]*3))*np.asarray(tint)
        material=dict(color=np.clip(color,0,1).tolist(),metalness=int(mat in (3,4,5)),roughness=.25 if mat in (3,4,5) else .65)
        if mat==8:material.update(nativeType='glass',ior=1.46,roughness=.025,color=[1,1,1])
        materials.append(material);items.append((mesh.vertices,mesh.vertex_normals,mesh.faces,index))
    key='example-scene-observatory-full'
    save(key,source,items,materials,'Complete authored Observatory geometry, including optical bench, cloth and landscape. Approximate RGB materials/studio lighting; native textures, directional sunlight, spectral quartz and fog are NOT reproduced.')
    path=HERE/'assets'/key/'manifest.json';manifest=json.loads(path.read_text());manifest['framing']=dict(center=[-.20,.43,1.51],extent=10);delta=np.array([-.75,-3.71,.87]);manifest['camera']=dict(yaw=float(np.arctan2(delta[0],-delta[1])),pitch=float(np.arcsin(delta[2]/np.linalg.norm(delta))),distance=float(np.linalg.norm(delta)*.4));path.write_text(json.dumps(manifest,indent=2))
    manifest=json.loads(path.read_text());manifest['portals']=[dict(center=[1.35,3.17,2.195],u=[.85,0,0],v=[0,0,1.325]),dict(center=[-1.78,-3.81,2.35],u=[.79,0,0],v=[0,0,1.27])];path.write_text(json.dumps(manifest,indent=2))
    rows[-2]['status']='exported'
except Exception as exc:
    rows[-2].update(status='failed',error=str(exc));write();raise
write()
