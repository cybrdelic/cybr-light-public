"""Resumable, isolated source recipe imports. Never modify source recipes/bakes."""
from pathlib import Path
import argparse, importlib, importlib.util, json, subprocess, sys, time, traceback
import numpy as np
from export_project_examples import save, REPO, HERE

def entries():
    out=[]
    def add(key,label,path,factory='build',kind='assembly',**kw):
        out.append(dict(id='example-'+key,label=label,source='cybr-geo/'+path,factory=factory,kind=kind,**kw))
    for key,label,file in [('motor','M8325s motor','motor'),('actuator','Nitinol actuator','nitinol_actuator'),('actuator-v2','Nitinol actuator v2','nitinol_actuator_v2'),('drivetrain','Motor / belt drivetrain','drivetrain')]:
        add('geo-'+key,'GEO / '+label,'src/mechanism_lab/models/'+file+'.py',module='mechanism_lab.models.'+file)
    for kind in ['reference','core','working']:
        add('geo-differential-'+kind,'GEO / Differential '+kind,'src/mechanism_lab/models/differential.py',module='mechanism_lab.models.differential',args=[kind])
    add('geo-yard','GEO / YARD skatepark','examples/diy_skatepark/recipe.py')
    add('geo-aeris','GEO / AERIS','examples/aeris/recipe.py')
    add('geo-aeris-engineered','GEO / AERIS engineered','examples/aeris/engineering_revision.py','build_engineered')
    for name in ['table','vise','press','drill','bend','measure','electronics']:
        add('geo-roam-'+name,'GEO / ROAM '+name,'examples/roam/workshop/'+name+'.py',kind='workshop')
    add('geo-roam-spine','GEO / ROAM shared spine','examples/roam/spine/model.py',kind='spine')
    for p in sorted((REPO/'cybr-geo/examples').glob('reach*.py')):
        if 'def build(' in p.read_text():add('geo-'+p.stem.replace('_','-'),'GEO / '+p.stem.replace('_',' '),'examples/'+p.name)
    return out

def build(entry):
    source=REPO/entry['source'];sys.path.insert(0,str(source.parent))
    recovered=HERE/'source-cache/differential'
    if (recovered/'assets/differential_v3/geometry/working_variant_parts.npz').exists():
        from mechanism_lab.models import differential
        differential.project_root=lambda:recovered
    if entry.get('module'):module=importlib.import_module(entry['module'])
    else:
        spec=importlib.util.spec_from_file_location('catalog_recipe',source)
        module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    if entry['kind']=='spine':assembly=module.Model().build().assembly(module.DEFAULT,True)[0]
    else:assembly=getattr(module,entry['factory'])(*entry.get('args',[]))
    if entry['kind']=='workshop':
        from mechanism_lab.core import Assembly,cad_part
        kernel=importlib.import_module('kernel')
        parts=[cad_part(n,assembly.transform(n,{}),v['material'],tolerance=.04,angular=.08) for n,v in assembly.parts.items()]
        assembly=Assembly(assembly.title,parts,kernel.MAT)
    count=sum(len(p.faces) for p in assembly.parts)
    if count*96>512*1024*1024:raise RuntimeError(f'Full source has {count:,} triangles: exceeds current 512 MiB attribute binding. Needs paged/instanced BVH; geometry was NOT decimated.')
    items=[]
    for p in assembly.parts:
        matrix=assembly.pose(p)
        v=p.vertices@matrix[:3,:3].T+matrix[:3,3];n=p.normals@matrix[:3,:3].T
        if not np.isfinite(v).all() or not np.isfinite(n).all():raise ValueError('Nonfinite source geometry: '+p.name)
        items.append((v,n,p.faces,p.material))
    materials=[dict(color=list(m.color),metalness=m.metal,roughness=m.rough,ior=m.ior) for m in assembly.materials]
    transparent=[m.name for m in assembly.materials if m.opacity<1]
    note='Original '+assembly.name+' source assembly. Static RGB studio study; native microfinish, anisotropy, coatings and original lighting are not reproduced.'
    if 'differential' in entry['id'] or 'drivetrain' in entry['id']:note+=' Differential meshes regenerated from retained source, not byte-identical historical archives.'
    if transparent:note+=' Source transparent materials currently displayed opaque: '+', '.join(transparent)+'.'
    save(entry['id'],source,items,materials,note)

def write_catalog(rows):
    path=HERE/'catalog.json';temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(dict(entries=rows),indent=2));temporary.replace(path)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--one');ap.add_argument('--retry-failed',action='store_true');args=ap.parse_args()
    rows=entries()
    if args.one:
        build(next(x for x in rows if x['id']==args.one));return
    old=json.loads((HERE/'catalog.json').read_text())['entries'] if (HERE/'catalog.json').exists() else []
    prior={x['id']:x for x in old}
    logs=HERE/'import-logs';logs.mkdir(exist_ok=True)
    for row in rows:
        row.update(status='queued')
        if row['id'] in prior:row.update({k:v for k,v in prior[row['id']].items() if k in ('status','error','seconds')})
        if (HERE/'assets'/row['id']/'manifest.json').exists():row['status']='exported'
    write_catalog(rows)
    for row in rows:
        if row['status']=='exported' or (row['status']=='failed' and not args.retry_failed):continue
        row.update(status='building');write_catalog(rows);start=time.monotonic()
        with (logs/(row['id']+'.log')).open('w') as log:
            try:
                result=subprocess.run([sys.executable,__file__,'--one',row['id']],stdout=log,stderr=subprocess.STDOUT,timeout=1200)
                row['status']='exported' if result.returncode==0 else 'failed'
            except subprocess.TimeoutExpired:row.update(status='failed',error='Source build exceeded the 20-minute per-recipe guard; completed imports preserved.')
        row['seconds']=round(time.monotonic()-start,2)
        if row['status']=='failed' and not row.get('error'):row['error']='\n'.join((logs/(row['id']+'.log')).read_text(errors='replace').splitlines()[-4:])[-1200:]
        write_catalog(rows);print(row['id'],row['status'],row['seconds'],flush=True)

if __name__=='__main__':main()
