"""Rebuild missing historical arrays into browser-local storage only."""
import importlib.util,json,sys
from pathlib import Path
import numpy as np
from export_project_examples import HERE,REPO

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m

cache=HERE/'source-cache/differential/assets/differential_v3/geometry';cache.mkdir(parents=True,exist_ok=True)
ref=load(REPO/'cybr-geo/archive/reference_v2/src/build_geometry.py','recovery_reference')
ref.OUT=cache;ref.CACHE=cache/'cad-cache';ref.CACHE.mkdir(exist_ok=True)
def capture():
    np.savez_compressed(cache/'reference_mesh_arrays.npz',**{p['name']+'__'+k:p[k] for p in ref.PARTS for k in ['vertices','faces','normals']})
    (cache/'reference_manifest.json').write_text(json.dumps(dict(materials=ref.MATERIALS,components=[dict(name=p['name'],material=p['material'],group=p['group']) for p in ref.PARTS])))
ref.export_all=capture
ref.main()
model=load(REPO/'cybr-geo/examples/differential/src/model.py','recovery_differential')
model.GEOM=cache;model.M=json.loads((cache/'reference_manifest.json').read_text());model.MATERIALS=model.M['materials']
parts=model.load_reference();core,pairs=model.build_kinematic_core()
for name,p in [('reference_parts',parts),('kinematic_core_parts',core),('working_variant_parts',model.compatible_reference(parts)+core)]:model.save_parts(p,cache/(name+'.npz'))
(cache/'regeneration_receipt.json').write_text(json.dumps(dict(origin='Regenerated from retained source; not byte-identical historical archives.',reference_parts=len(parts),core_parts=len(core))))
print('Recovered three differential arrays into browser-local source-cache',flush=True)
