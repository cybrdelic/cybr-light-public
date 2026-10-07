from pathlib import Path
import sys,time,os
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'examples'))
from cybrlight import render
from gallery import BUILDERS,lens_motion,ROOT
# Wait for the previously launched Cornell render, not for a guessed duration.
while not (ROOT/'outputs'/'02_global_illumination.json').exists():time.sleep(2)
from PIL import Image
Image.open(ROOT/'outputs'/'02_global_illumination.ppm').save(ROOT/'outputs'/'02_global_illumination.png')
for name in ['dielectrics','mesh','homogeneous','polarization']:
 s=BUILDERS[name]();s.settings.threads=4
 # Keep the lighting panel physically out of the camera's framing.
 for p in s.primitives:
  if p['type']=='quad' and s.materials[p['material']].emission>0 and p.get('corner',[0,0,0])[2]<-2.5 and 'volume' not in s.name:
   if p['corner'][1]>3:p['corner'][1]+=1.4
 print('BEGIN',s.name,flush=True)
 report=render(s,ROOT/'outputs'/s.name,spp=96,bands=8,size=(512,352))
 print('END',s.name,report['render_seconds'],flush=True)
for s in lens_motion():
 s.settings.threads=4
 print('BEGIN',s.name,flush=True)
 report=render(s,ROOT/'outputs'/s.name,spp=96,bands=8,size=(512,352))
 print('END',s.name,report['render_seconds'],flush=True)

s=BUILDERS['clouds']();s.settings.threads=4
print('BEGIN',s.name,flush=True)
r=render(s,ROOT/'outputs'/s.name,spp=40,bands=8,size=(448,308))
print('END',s.name,r['render_seconds'],flush=True)
