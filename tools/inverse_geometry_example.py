"""Executed geometry inverse problem; numeric derivatives, not visibility-aware AD."""
from pathlib import Path
import sys,json
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'python'))
from cybrlight import Scene,Camera,Settings,render,read_pfm,bundle_scene
from cybrlight.inverse import Parameter,optimize

def main():
    directory=ROOT/'outputs/inverse_geometry';directory.mkdir(exist_ok=True,parents=True)
    scene=Scene('Two-parameter geometry fitting, independent renderer')
    scene.settings=Settings(width=64,height=48,spp=64,bands=6,max_depth=3,threads=1,seed=1729,filter='tent')
    scene.camera=Camera(origin=(0,1,6),target=(0,1,0),orthographic=True,ortho_scale=3.2)
    material=scene.material(color=(.05,.48,.25));scene.sphere((.28,1,0),.91,material)
    scene.environment.update(color=[.8,.85,1],strength=.85,flat=True)
    scene.point_light((-2,4,4),30)
    bundle_scene(scene,directory/'target_scene');render(scene,directory/'target')
    target=read_pfm(directory/'target.pfm')
    initial=scene.clone();initial.primitives[0]['center'][0]=-.38;initial.primitives[0]['radius']=.58
    bundle_scene(initial,directory/'initial_scene');render(initial,directory/'initial')
    parameters=[Parameter('shapes.0.center',0,.045,-.8,.8),Parameter('shapes.0.radius',None,.045,.35,1.2)]
    fitted,report=optimize(initial,target,parameters,max_iterations=12,loss_blur_sigma=1.2,output_directory=directory)
    report['synthetic_same_renderer_target']=True;report['target_values']=[.28,.91]
    # Repeat both initial and fitted models using a random seed not used to fit.
    heldout_target=scene.clone();heldout_initial=initial.clone();heldout_fitted=fitted.clone()
    for item in (heldout_target,heldout_initial,heldout_fitted):item.settings.seed=987631
    render(heldout_target,directory/'heldout_target');render(heldout_initial,directory/'heldout_initial');render(heldout_fitted,directory/'heldout_fitted')
    reference=read_pfm(directory/'heldout_target.pfm')
    before=float(np.mean((read_pfm(directory/'heldout_initial.pfm')-reference)**2));after=float(np.mean((read_pfm(directory/'heldout_fitted.pfm')-reference)**2))
    report['heldout_seed_raw_mse']={'seed':987631,'initial':before,'fitted':after}
    if not after<before*.2:raise AssertionError('Geometry fit failed to improve held-out raw image error sufficiently')
    (directory/'optimization.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
    from PIL import Image,ImageDraw
    names=[('Target','target'),('Initial geometry','initial'),('Fitted geometry','fitted')]
    sheet=Image.new('RGB',(768,214),(17,21,28));draw=ImageDraw.Draw(sheet)
    for i,(title,name) in enumerate(names):
        image=Image.open(directory/(name+'.png')).resize((256,192),Image.Resampling.NEAREST);sheet.paste(image,(i*256,22));draw.text((i*256+8,5),title,fill='white')
    sheet.save(ROOT/'outputs/09_inverse_geometry.png')

if __name__=='__main__':main()
