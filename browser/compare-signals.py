"""Display-space regression diagnostics, never a substitute for image review."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

root = Path('output/playwright')
def image(name):
    return np.asarray(Image.open(root / name).convert('RGB'), dtype=np.float64) / 255
a = image('signals-combined-raw.png')
b = image('signals-separate-raw.png')
report = {'raw_recomposition': {'max_display_error': float(abs(a-b).max()),
          'mean_display_error': float(abs(a-b).mean())}}
reference = image('noise-reference-reference1024.png')
regions = {'scene': (0,73,1150,719), 'glass': (651,338,798,482),
           'polymer': (516,323,638,452), 'floor': (60,548,1085,705)}
for label in ['combined', 'separate']:
    current = image(f'signals-{label}-motion.png')
    result = {}
    for name,(x0,y0,x1,y1) in regions.items():
        c=current[y0:y1,x0:x1]; r=reference[y0:y1,x0:x1]
        result[name]={'rmse': float(np.sqrt(np.mean((c-r)**2))),
                      'gradient_rmse': float(np.sqrt(np.mean((np.diff(c,axis=1)-np.diff(r,axis=1))**2)))}
    report[label]=result
print(json.dumps(report, indent=2))
