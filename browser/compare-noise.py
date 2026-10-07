"""Bounded screenshot error report; identical camera/viewport and raw reference required."""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image

p=argparse.ArgumentParser()
p.add_argument('reference',type=Path)
p.add_argument('images',type=Path,nargs='+')
p.add_argument('--output',type=Path)
a=p.parse_args()
ref=np.asarray(Image.open(a.reference).convert('RGB'),dtype=np.float64)/255
regions={'full':(0,0,ref.shape[1],ref.shape[0]),'knot':(375,180,790,540),'pedestal':(435,580,720,690)}
out={}
for path in a.images:
    test=np.asarray(Image.open(path).convert('RGB'),dtype=np.float64)/255
    if test.shape!=ref.shape:raise ValueError('Mismatched screenshot dimensions')
    scores={}
    for key,(x0,y0,x1,y1) in regions.items():
        delta=test[y0:y1,x0:x1]-ref[y0:y1,x0:x1]
        scores[key]={'rmse':float(np.sqrt(np.mean(delta*delta))),'mae':float(np.mean(abs(delta)))}
    out[path.name]=scores
report={'reference':str(a.reference),'dimensions':[ref.shape[1],ref.shape[0]],'regions':regions,'scores':out,
        'limits':'Display-space error, not transport energy or temporal flicker. Regions authored for knot captures only.'}
if a.output:a.output.write_text(json.dumps(report,indent=2))
print(json.dumps(report))
