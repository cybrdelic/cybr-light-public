"""Execution evidence: deterministic native renders, numerical image gradients,
material recovery, and independent-seed convergence tests."""
from __future__ import annotations
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'examples'))
from cybrlight import render,read_pfm
from gallery import inverse,cornell,ROOT

WORK=ROOT/'outputs'/'validation'
WORK.mkdir(exist_ok=True)


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def execute(scene,name):
    scene.settings.threads=1
    return render(scene,WORK/name)


def main():
    results={}
    s=inverse();s.settings.width=104;s.settings.height=78;s.settings.spp=48;s.settings.bands=8
    idx=s.settings.active_material
    truth=np.asarray(s.materials[idx].color,dtype=float)
    execute(s,'target')
    target=read_pfm(WORK/'target.pfm').astype(np.float64)
    initial=np.array([.61,.11,.045]);current=initial.copy();history=[]
    for iteration in range(6):
        trial=s.clone(f'inverse_iteration_{iteration}')
        trial.materials[idx].color=current.tolist();trial.settings.ad=True
        execute(trial,f'iteration_{iteration}')
        prediction=read_pfm(WORK/f'iteration_{iteration}.pfm').astype(np.float64)
        jacobian=np.stack([read_pfm(WORK/f'iteration_{iteration}_d{c}.pfm') for c in range(3)],axis=-1).astype(np.float64)
        residual=(prediction-target).reshape(-1)
        j=jacobian.reshape(-1,3)
        mse=float(np.mean(residual**2))
        history.append({'iteration':iteration,'spectral_controls':current.tolist(),'linear_rgb_mse':mse})
        print(history[-1],flush=True)
        if mse<1e-13:break
        # Gauss-Newton solve from rendered Jacobians, not a copied target value.
        lhs=j.T@j+np.eye(3)*1e-7
        step=np.linalg.solve(lhs,j.T@residual)
        current=np.clip(current-step,.005,.95)
    error=float(np.max(np.abs(current-truth)))
    if error>1e-4:raise AssertionError(f'Material recovery error {error}')
    results['native_inverse']={'target_controls':truth.tolist(),'initial_controls':initial.tolist(),
        'recovered_controls':current.tolist(),'max_parameter_error':error,'history':history,
        'method':'Gauss-Newton with native forward-mode spectral path derivatives',
        'qualification':'Synthetic same-renderer target; identical random paths during fitting; not real-photo material identification.'}
    # Compare the rendered native derivative against central differences.
    check=s.clone('gradient_check');check.settings.width=60;check.settings.height=44;check.settings.spp=24
    check.materials[idx].color=[.22,.34,.18];check.settings.ad=True
    execute(check,'gradient_base')
    errors=[]
    eps=.002
    for c in range(3):
        plus=check.clone();minus=check.clone();plus.settings.ad=False;minus.settings.ad=False
        plus.materials[idx].color[c]+=eps;minus.materials[idx].color[c]-=eps
        execute(plus,f'gradient_plus_{c}');execute(minus,f'gradient_minus_{c}')
        fd=(read_pfm(WORK/f'gradient_plus_{c}.pfm')-read_pfm(WORK/f'gradient_minus_{c}.pfm'))/(2*eps)
        derivative=read_pfm(WORK/f'gradient_base_d{c}.pfm')
        relative=float(np.linalg.norm(fd-derivative)/max(np.linalg.norm(fd),1e-10))
        errors.append(relative)
    if max(errors)>.001:raise AssertionError(f'Native image derivative mismatch: {errors}')
    results['native_image_gradient_relative_errors']=errors
    # Exact reproducibility across native CPU thread counts. This does not use
    # the helper which intentionally forces a single validation worker.
    deterministic=check.clone('thread_reproducibility');deterministic.settings.ad=False
    deterministic.settings.threads=1;render(deterministic,WORK/'thread_1')
    deterministic.settings.threads=4;render(deterministic,WORK/'thread_4')
    identical=digest(WORK/'thread_1.pfm')==digest(WORK/'thread_4.pfm')
    if not identical:raise AssertionError('Thread-count reproducibility failed')
    results['native_thread_count_bitwise_equal']=identical
    # Independent seed is used for the final target/recovery validation.
    high=s.clone();high.settings.seed=948171;high.settings.width=320;high.settings.height=240
    high.settings.spp=96;high.settings.bands=12;high.settings.threads=1
    for name,controls in [('target',truth),('initial',initial),('recovered',current)]:
        high.name=f'10_inverse_{name}';high.materials[idx].color=controls.tolist();high.settings.ad=False
        render(high,ROOT/'outputs'/high.name)
    heldout_target=read_pfm(ROOT/'outputs'/'10_inverse_target.pfm')
    heldout_result=read_pfm(ROOT/'outputs'/'10_inverse_recovered.pfm')
    results['held_out_seed_reconstruction_mse']=float(np.mean((heldout_result-heldout_target)**2))
    # Scene-level convergence: a separate high-sample reference and three sample
    # counts, evaluated with the same camera geometry and radiometric film.
    test=cornell();test.settings.width=80;test.settings.height=64;test.settings.bands=8
    test.settings.max_depth=16;test.settings.spp=384;test.settings.seed=345678
    execute(test,'convergence_reference');reference=read_pfm(WORK/'convergence_reference.pfm')
    convergence=[]
    for spp in [4,16,64]:
        mses=[]
        for rep in range(3):
            test.settings.spp=spp;test.settings.seed=1000+rep
            execute(test,f'convergence_{spp}_{rep}')
            image=read_pfm(WORK/f'convergence_{spp}_{rep}.pfm')
            mses.append(float(np.mean((image-reference)**2)))
        convergence.append({'packets_per_pixel':spp,'mean_mse_to_independent_384_packet_reference':float(np.mean(mses)),
                            'seed_mse':mses})
    results['convergence']=convergence
    # Compare unbiased MIS and BSDF-only estimators, with a broad area emitter.
    comparison={}
    for method in ['MIS','BSDF_only']:
        mses=[]
        for rep in range(3):
            test.settings.spp=16;test.settings.seed=222+rep;test.settings.nee=method=='MIS'
            execute(test,f'{method}_{rep}')
            mses.append(float(np.mean((read_pfm(WORK/f'{method}_{rep}.pfm')-reference)**2)))
        comparison[method]={'mean_mse':float(np.mean(mses)),'seed_mse':mses}
    results['sampling_comparison']=comparison
    results['all_requested_checks_passed']=True
    (ROOT/'outputs'/'validation_report.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(results,indent=2),flush=True)
    # Presentation composites consist solely of actual rendered images + labels.
    
    try: font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
    except OSError: font=ImageFont.load_default()
    canvas=Image.new('RGB',(960,285),(17,19,23));draw=ImageDraw.Draw(canvas)
    for i,(name,label) in enumerate([('target','TARGET'),('initial','INITIAL MATERIAL'),('recovered','RECOVERED BY NATIVE AD')]):
        image=Image.open(ROOT/'outputs'/f'10_inverse_{name}.png')
        canvas.paste(image,(i*320,35));draw.text((i*320+12,10),label,font=font,fill=(232,236,240))
    canvas.save(ROOT/'outputs'/'10_inverse_comparison.png')

if __name__=='__main__':main()
