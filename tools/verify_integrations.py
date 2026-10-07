"""Execute image-gradient, checkpoint, relocation, and independent EXR checks.

Tests compare raw float32 films, never denoised or tone-mapped display images.
Use --skip-exr when OpenCV was not installed; this reports a skipped check rather
than a pass. The delivery was executed with the independent EXR decoder enabled.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'python'))
sys.path.insert(0,str(ROOT/'tools'))
from cybrlight import read_pfm, bundle_scene, load_snapshot, rebuild_shaders
from engine_gallery import shader, textures


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--skip-exr',action='store_true')
    args=parser.parse_args();out=ROOT/'evidence'/'integrations';out.mkdir(parents=True,exist_ok=True)
    executable=Path(os.environ.get('CYBR_LIGHT_BINARY',str(ROOT/'build/cybr-light'))).resolve()
    records=[]
    def run(name,scene,*,spp=None,threads=None,resume=None,checkpoint=None,expect_failure=False):
        path=scene.save(out/(name+'.cys')) if hasattr(scene,'save') else Path(scene)
        command=[str(executable),'--scene',str(path),'--out',str(out/name)]
        for flag,value in [('spp',spp),('threads',threads),('resume',resume),('checkpoint',checkpoint)]:
            if value is not None:command += ['--'+flag,str(value)]
        t=time.monotonic();result=subprocess.run(command,text=True,capture_output=True)
        (out/(name+'.log')).write_text(result.stdout+result.stderr)
        records.append({'run':name,'command':command,'returncode':result.returncode,'seconds':time.monotonic()-t,'expected_failure':expect_failure})
        if expect_failure:
            if result.returncode==0:raise AssertionError(f'{name}: invalid input was accepted')
            return result
        if result.returncode:raise RuntimeError(f'{name} failed: {result.stderr}')
        image=read_pfm(out/(name+'.pfm'))
        if not np.isfinite(image).all():raise AssertionError(f'{name}: nonfinite raw film')
        return image

    scene=shader();scene.settings.width=48;scene.settings.height=32
    scene.settings.spp=64;scene.settings.bands=8;scene.settings.filter='box';scene.settings.sampler=0
    active=scene.settings.active_material;scene.settings.film_format='openexr'
    raw=run('shader_ad',scene)
    gradients=[read_pfm(out/f'shader_ad_d{i}.pfm').astype(float) for i in range(3)]
    parameters=list(scene.materials[active].shader_parameters);gradient_checks=[]
    for parameter in range(3):
        step=.005;images=[]
        for sign in (-1,1):
            modified=scene.clone();modified.settings.ad=False;p=parameters.copy();p[parameter]+=sign*step
            modified.materials[active].shader_parameters=p
            images.append(run(f'shader_fd_{parameter}_{"plus" if sign>0 else "minus"}',modified).astype(float))
        fd=(images[1]-images[0])/(2*step)
        relative=float(np.linalg.norm(fd-gradients[parameter])/max(np.linalg.norm(fd),1e-14))
        if relative>8e-4:raise AssertionError(f'Rendered shader derivative {parameter} relative L2 error {relative}')
        gradient_checks.append({'parameter':parameter,'central_difference_step':step,'relative_l2_error':relative,
                                'max_absolute_error':float(np.max(np.abs(fd-gradients[parameter])))})

    # The active leaf material is copied into a wrapper in the native scene loader.
    # This tests propagation of identity and derivatives through that copied graph.
    nested=scene.clone();wrapper=nested.material(type='twosided',children=(active,-1))
    for primitive in nested.primitives:
        if primitive['material']==active:primitive['material']=wrapper
    nested_raw=run('nested_shader_ad',nested)
    nested_gradient_equal=all(np.array_equal(read_pfm(out/f'nested_shader_ad_d{i}.pfm'),read_pfm(out/f'shader_ad_d{i}.pfm')) for i in range(3))
    if not nested_gradient_equal or not np.array_equal(nested_raw,raw):raise AssertionError('Nested shader changes image/derivatives')

    checkpoint_scene=scene.clone();checkpoint_scene.settings.spp=16
    path=checkpoint_scene.save(out/'checkpoint_scene.cys');checkpoint=out/'samples8.ckpt'
    run('checkpoint_first8',path,spp=8,threads=1,checkpoint=checkpoint)
    resumed=run('checkpoint_resumed16',path,spp=16,threads=4,resume=checkpoint)
    full=run('checkpoint_full16',path,spp=16,threads=2)
    names=['.pfm','_d0.pfm','_d1.pfm','_d2.pfm','_stderr.pfm']
    checkpoint_equal={suffix:(out/('checkpoint_resumed16'+suffix)).read_bytes()==(out/('checkpoint_full16'+suffix)).read_bytes() for suffix in names}
    if not all(checkpoint_equal.values()):raise AssertionError(f'Resume changed raw films: {checkpoint_equal}')
    original_checksum=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    changed=checkpoint_scene.clone();changed.materials[active].shader_parameters=[.2,4,.4]
    run('checkpoint_wrong_scene',changed,spp=16,resume=checkpoint,expect_failure=True)
    corrupt=out/'corrupt.ckpt';content=bytearray(checkpoint.read_bytes());content[-1]^=1;corrupt.write_bytes(content)
    run('checkpoint_corrupt',path,spp=16,resume=corrupt,expect_failure=True)
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest()!=original_checksum:raise AssertionError('Rejected resume modified original checkpoint')

    # Source asset no longer needed: use relocated, self-contained bundle and
    # rebuild its native shader from copied C++ source before rendering again.
    original=out/'bundle_original';moved=out/'bundle_relocated'
    if moved.exists():shutil.rmtree(moved)
    bundle_scene(checkpoint_scene,original);shutil.move(original,moved)
    for item in json.loads((moved/'shaders.json').read_text()):(moved/item['binary']).unlink()
    rebuild_receipt=rebuild_shaders(moved)
    relocated=load_snapshot(moved/'scene.cybr.json');relocated_raw=run('relocated_shader',relocated,spp=16,threads=2)
    if not np.array_equal(relocated_raw,full):raise AssertionError('Relocated/rebuilt shader changed rendering')
    native_relocated=run('relocated_native',moved/'scene.cys',spp=16,threads=2)
    if not np.array_equal(native_relocated,full):raise AssertionError('Relocated native scene changed rendering')

    textured=textures();textured.settings.width=32;textured.settings.height=24;textured.settings.spp=4;textured.settings.bands=4
    reference=run('texture_reference',textured);bundle_scene(textured,out/'texture_bundle')
    moved_texture=load_snapshot(out/'texture_bundle/scene.cybr.json')
    relocated_texture=run('texture_relocated',moved_texture)
    if not np.array_equal(reference,relocated_texture):raise AssertionError('Relocated texture changed rendering')

    exr={'status':'skipped','reason':'--skip-exr requested'}
    if not args.skip_exr:
        os.environ['OPENCV_IO_ENABLE_OPENEXR']='1'
        import cv2
        decoded=cv2.imread(str(out/'shader_ad.exr'),cv2.IMREAD_UNCHANGED)
        if decoded is None:raise AssertionError('Independent OpenEXR decoder failed')
        decoded=decoded[...,::-1]
        if not np.array_equal(decoded,raw):raise AssertionError('EXR does not preserve raw float32 pixels')
        exr={'status':'passed','decoder':'OpenCV/OpenEXR','opencv_version':cv2.__version__,
             'shape':list(decoded.shape),'dtype':str(decoded.dtype),'max_absolute_error':float(np.max(np.abs(decoded-raw)))}

    report={'status':'passed','scope':'Small-scene integration checks; not arbitrary-scene optical validation',
            'native_executable_sha256':hashlib.sha256(executable.read_bytes()).hexdigest(),
            'image_derivatives':gradient_checks,'nested_shader_image_and_gradients_bitwise_equal':nested_gradient_equal,
            'checkpoint_resume_bitwise_equal':checkpoint_equal,'resume_threads':[1,4,2],
            'invalid_checkpoint_scene_and_corruption_rejected':True,'original_checkpoint_preserved':True,
            'relocated_shader_and_texture_images_bitwise_equal':True,'shader_rebuilds':rebuild_receipt,
            'exr':exr,'runs':records}
    (ROOT/'evidence/integration_verification.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k not in ('runs','shader_rebuilds')},indent=2))

if __name__=='__main__':main()
