"""Deterministic AOV/variance-guided display denoising, never generative.

Input radiance PFM, untouched PNG, sample standard error, normals and object IDs
are retained. Filtered files have the explicit _display suffix. This is a biased
presentation filter; it is not used for any numerical test, gradient, or metric.
"""
from __future__ import annotations
import os
os.environ.setdefault('OPENCV_IO_ENABLE_OPENEXR','1')
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from cybrlight import read_pfm
ROOT=Path(__file__).resolve().parents[1]


def tonemap(a,exposure=1.):
    a=np.maximum(a*exposure,0)
    a=np.clip(a*(2.51*a+.03)/(a*(2.43*a+.59)+.14),0,1)
    return np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)


def shifted(a,dy,dx):
    # Edge replication, not wraparound.
    h,w=a.shape[:2]
    yy=np.clip(np.arange(h)+dy,0,h-1);xx=np.clip(np.arange(w)+dx,0,w-1)
    return a[yy[:,None],xx[None,:]]


def denoise(prefix: Path) -> dict:
    source=read_pfm(prefix.with_suffix('.pfm')).astype(np.float64)
    if not np.isfinite(source).all():raise ValueError(f'Nonfinite radiance: {prefix}')
    normal=read_pfm(Path(str(prefix)+'_normal.pfm')).astype(np.float64)*2-1
    depth=read_pfm(Path(str(prefix)+'_depth.pfm'))[:,:,0].astype(np.float64)
    ids=read_pfm(Path(str(prefix)+'_object.pfm'))[:,:,0]
    standard_error=read_pfm(Path(str(prefix)+'_stderr.pfm'))[:,:,0].astype(np.float64)
    lum=source@np.array([.2126,.7152,.0722])
    # Variance floors protect smooth low-noise gradients from visible posterization.
    variance=standard_error**2+(.001+.005*np.abs(lum))**2
    result=source.copy();kernel=np.array([1,4,6,4,1],dtype=float)
    normal_valid=np.linalg.norm(normal,axis=-1)>.1
    for step in (1,2,4):
        accumulation=np.zeros_like(result);denominator=np.zeros(result.shape[:2])
        for iy in range(-2,3):
            for ix in range(-2,3):
                dy,dx=iy*step,ix*step
                other_normal=shifted(normal,dy,dx)
                cosine=np.clip(np.sum(normal*other_normal,axis=-1),0,1)
                angular=cosine**32
                other_valid=shifted(normal_valid,dy,dx)
                angular=np.where(normal_valid&other_valid,angular,1.)
                same_object=ids==shifted(ids,dy,dx)
                lum_neighbor=shifted(lum,dy,dx)
                uncertainty=np.sqrt(variance+shifted(variance,dy,dx))
                radiometric=np.exp(-np.abs(lum-lum_neighbor)/(3.0*uncertainty+1e-8))
                dz=np.abs(depth-shifted(depth,dy,dx))
                spatial_depth=np.exp(-dz/(.025*np.maximum(depth,1.)*step+1e-8))
                weight=kernel[iy+2]*kernel[ix+2]*angular*same_object*radiometric*spatial_depth
                accumulation+=shifted(result,dy,dx)*weight[:,:,None]
                denominator+=weight
        result=accumulation/np.maximum(denominator[:,:,None],1e-20)
    scene=prefix.with_suffix('.scene.json')
    exposure=json.loads(scene.read_text())['settings']['exposure'] if scene.exists() else 1.
    Image.fromarray(np.uint8(np.clip(tonemap(result,exposure),0,1)*255+.5)).save(Path(str(prefix)+'_display.png'))
    np.save(Path(str(prefix)+'_denoised_linear.npy'),result.astype(np.float32))
    report={'source_radiance':prefix.name+'.pfm','display':prefix.name+'_display.png',
            'filter':'AOV/object-ID/variance-guided three-pass atrous filter',
            'steps':[1,2,4],'generative_model_used':False,'raw_radiance_modified':False,
            'numerical_tests_use_filtered_data':False,'denoising_is_biased':True,
            'exposure':exposure,'display_transform':'ACES-style rational fit followed by sRGB transfer',
            'mean_absolute_linear_change':float(np.mean(np.abs(result-source)))}
    Path(str(prefix)+'_display.json').write_text(json.dumps(report,indent=2))
    return report


def exr(prefix: Path):
    try:
        import cv2
    except ImportError:
        return False
    a=read_pfm(prefix.with_suffix('.pfm'))
    path=prefix.with_suffix('.exr')
    if not cv2.imwrite(str(path),a[:,:,::-1]):raise RuntimeError('OpenEXR write failed')
    back=cv2.imread(str(path),cv2.IMREAD_UNCHANGED)[:,:,::-1]
    if not np.array_equal(a,back):raise RuntimeError('Lossless EXR roundtrip mismatch')
    return True


def main():
    import argparse
    p=argparse.ArgumentParser();p.add_argument('names',nargs='*');args=p.parse_args()
    prefixes=[ROOT/'outputs'/name for name in args.names] if args.names else [p.with_suffix('') for p in (ROOT/'outputs').glob('[0-9][0-9]_*.pfm') if not p.stem.endswith(('_normal','_albedo','_depth','_position','_object','_stderr','_stokes0','_stokes1','_stokes2','_stokes3','_d0','_d1','_d2'))]
    reports=[]
    for prefix in prefixes:
        if Path(str(prefix)+'_normal.pfm').exists():reports.append(denoise(prefix))
        exr(prefix)
        if prefix.with_suffix('.ppm').exists() and not prefix.with_suffix('.png').exists():Image.open(prefix.with_suffix('.ppm')).save(prefix.with_suffix('.png'))
        print(prefix.name,flush=True)
    reports=[json.loads(path.read_text()) for path in sorted((ROOT/'outputs').glob('[0-9][0-9]_*_display.json'))]
    (ROOT/'outputs'/'display_processing_report.json').write_text(json.dumps(reports,indent=2))

if __name__=='__main__':main()
