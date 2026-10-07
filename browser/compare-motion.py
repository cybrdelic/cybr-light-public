"""Fixed-pose source-gallery display error; excludes UI and reports explicit ROIs."""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('reference');p.add_argument('images',nargs='+');p.add_argument('--output',required=True);a=p.parse_args()
ref=np.asarray(Image.open(a.reference).convert('RGB'),dtype=np.float64)/255
regions={'scene':(0,73,1150,719),'glass':(651,338,798,482),'polymer':(516,323,638,452),'floor':(60,548,1085,705)}
result={'reference':a.reference,'metric':'display-space RGB RMSE, not a proof of unbiased transport','regions':regions,'images':{}}
for filename in a.images:
    image=np.asarray(Image.open(filename).convert('RGB'),dtype=np.float64)/255
    if image.shape!=ref.shape:raise ValueError('Mismatched image dimensions')
    result['images'][filename]={}
    for name,(x0,y0,x1,y1) in regions.items():
        delta=image[y0:y1,x0:x1]-ref[y0:y1,x0:x1]
        result['images'][filename][name]={'rmse':float(np.sqrt(np.mean(delta*delta))),'mae':float(np.mean(abs(delta)))}
Path(a.output).write_text(json.dumps(result,indent=2));print(json.dumps(result['images']))
