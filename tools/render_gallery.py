from __future__ import annotations
import argparse
import json
import sys
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'examples'))
from cybrlight import render
from gallery import BUILDERS,lens_motion,ROOT

def main():
 p=argparse.ArgumentParser();p.add_argument('--spp',type=int,default=192);p.add_argument('--bands',type=int,default=12)
 p.add_argument('--width',type=int,default=720);p.add_argument('--height',type=int,default=495);p.add_argument('names',nargs='*');args=p.parse_args()
 scenes=[]
 for name in args.names or ['materials','cornell','dielectrics','mesh','homogeneous','clouds','polarization']:
  scenes.append(BUILDERS[name]())
 if not args.names:scenes.extend(lens_motion())
 reports=[]
 for s in scenes:
  print(f'BEGIN {s.name}',flush=True)
  s.save(ROOT/'examples'/f'{s.name}.cys')
  spp=args.spp
  if 'cloud' in s.name:spp=max(96,args.spp//2)
  report=render(s,ROOT/'outputs'/s.name,spp=spp,bands=args.bands,size=(args.width,args.height))
  reports.append(report);print(f'END {s.name}: {report["render_seconds"]:.2f}s',flush=True)
  (ROOT/'outputs'/'gallery_render_progress.json').write_text(json.dumps(reports,indent=2))

if __name__=='__main__':main()
