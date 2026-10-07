"""Re-render selected demonstrations with improved sampling and closed mesh frames."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'examples'))
from cybrlight import render
from gallery import BUILDERS,ROOT
for name,spp,size in [('mesh',192,(640,440)),('homogeneous',256,(512,352)),('clouds',128,(448,308))]:
    s=BUILDERS[name]();s.settings.threads=4
    s.settings.width,s.settings.height=size;s.settings.spp=spp;s.settings.bands=8
    if name=='mesh':
        for p in s.primitives:
            if p['type']=='quad' and s.materials[p['material']].emission>0 and p.get('corner',[0,0,0])[2]<-2.5:
                p['corner'][1]+=1.4
    print('BEGIN',s.name,flush=True)
    report=render(s,ROOT/'outputs'/s.name)
    print('END',s.name,report['render_seconds'],flush=True)
