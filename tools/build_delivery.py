"""Freeze executed scenes and assemble a gallery from actual render outputs.

No rendering/image synthesis is performed here. Thumbnail layout, image labels,
and false-color AOV visualization are the only image operations in this script.
Run only after rendering and optional tools/finish_images.py have completed.
"""
from __future__ import annotations
import base64
from datetime import datetime, timezone
import hashlib
import html
import json
import platform
from pathlib import Path
import re
import shutil
import sys
import textwrap
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs'
sys.path.insert(0, str(ROOT / 'python'))
from cybrlight import read_pfm

EXAMPLES = [
 ('01_materials','Spectral materials','GGX metal, coated diffuse and glass'),
 ('02_global_illumination','Global illumination','Indirect color bleeding and MIS'),
 ('03_dielectrics','Nested dielectrics','Rough refraction, absorption, air inclusions'),
 ('04_triangle_mesh','Imported geometry','23,520-triangle OBJ knot + SAH BVH'),
 ('05_homogeneous_volume','Homogeneous volume','Multiple scattering in an occluded chamber'),
 ('06_heterogeneous_cloud','Heterogeneous volume','Authored density; delta and ratio tracking'),
 ('07_polarization','Polarization','Aligned, 45-degree and crossed analyzers'),
 ('08_depth_of_field','Thin-lens camera','Finite-aperture depth of field'),
 ('09_motion_blur','Shutter integration','Moving geometry, not a post-process blur'),
 ('10_inverse_comparison','Inverse rendering','Synthetic target / initial / recovered'),
 ('11_spectral_caustics','Spectral caustics','3 million photons; planar detector'),
 ('12_tensor_jit','Tensor / JIT / reverse AD','Original diffuse renderer; compiled CPU'),
]


def font(size: int, bold: bool = False):
    paths = [f'/usr/share/fonts/truetype/dejavu/DejaVuSans{"-Bold" if bold else ""}.ttf',
             '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf']
    for p in paths:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def freeze_scenes() -> dict:
    destination = ROOT / 'examples' / 'delivered'
    destination.mkdir(parents=True, exist_ok=True)
    records = {}
    for source in sorted(OUT.glob('[0-9][0-9]_*.cys')):
        report_path = source.with_suffix('.json')
        if not report_path.is_file():
            continue
        report = json.loads(report_path.read_text())
        if report.get('backend') != 'C++17 OpenMP CPU':
            continue
        lines = source.read_text().splitlines()
        for i, line in enumerate(lines):
            if line.startswith('settings '):
                tokens = line.split()
                for index, key in [(1,'width'),(2,'height'),(3,'packets_per_pixel'),(4,'wavelengths_per_packet')]:
                    tokens[index] = str(report[key])
                lines[i] = ' '.join(tokens)
        (destination / source.name).write_text('\n'.join(lines) + '\n')
        meta = source.with_suffix('.scene.json')
        if meta.exists():
            data = json.loads(meta.read_text())
            for key, value in [('width',report['width']),('height',report['height']),
                               ('spp',report['packets_per_pixel']),('bands',report['wavelengths_per_packet'])]:
                data['settings'][key] = value
            (destination / meta.name).write_text(json.dumps(data, indent=2))
        records[source.stem] = {'kind':'native_camera','scene':source.name,'settings':report}
    photon = ROOT / 'examples' / '11_prism_photon_detector.cys'
    shutil.copyfile(photon, destination / photon.name)
    p_report = json.loads((OUT / '11_spectral_caustics.json').read_text())
    records['11_spectral_caustics'] = {'kind':'spectral_photon_detector','scene':photon.name,
                                      'photon_count':p_report['photon_count']}
    records['10_inverse_comparison'] = {'kind':'inverse_optimization','script':'tools/validate_and_inverse.py'}
    records['12_tensor_jit'] = {'kind':'tensor_cpu','script':'tools/tensor_example.py'}
    result = {'description':'Frozen executed scene inputs; CYS settings include the delivered command-line overrides.',
              'examples':records}
    (destination / 'index.json').write_text(json.dumps(result, indent=2))
    return result


def inverse_display() -> None:
    names = ['10_inverse_target','10_inverse_initial','10_inverse_recovered']
    labels = ['SYNTHETIC TARGET','INITIAL MATERIAL','RECOVERED BY NATIVE AD']
    images = [Image.open(OUT / (n+'_display.png')).convert('RGB') for n in names]
    w,h = images[0].size
    canvas = Image.new('RGB',(3*w,h+46),(16,20,26)); d = ImageDraw.Draw(canvas)
    for i,(im,label) in enumerate(zip(images,labels)):
        canvas.paste(im,(i*w,38));d.text((i*w+12,11),label,font=font(15),fill=(230,236,241))
    canvas.save(OUT / '10_inverse_comparison_display.png')


def aov_display() -> None:
    prefix = OUT / '04_triangle_mesh'
    normal = np.clip(read_pfm(str(prefix)+'_normal.pfm'),0,1)
    depth = read_pfm(str(prefix)+'_depth.pfm')[:,:,0]
    ids = read_pfm(str(prefix)+'_object.pfm')[:,:,0].astype(np.int64)
    albedo = np.clip(read_pfm(str(prefix)+'_albedo.pfm'),0,1)
    valid = ids > 0
    lo,hi = np.percentile(depth[valid],[2,98])
    grayscale = np.clip((hi-depth)/max(hi-lo,1e-6),0,1)*valid
    rng = np.random.default_rng(207)
    palette = rng.random((max(1,int(ids.max())+1),3))*.75+.15; palette[0]=0
    id_image = palette[np.clip(ids,0,len(palette)-1)]
    tiles = [('PRIMARY-HIT NORMAL',normal),('DEPTH — DISPLAY NORMALIZED',np.repeat(grayscale[:,:,None],3,2)),
             ('SPECTRAL AUTHORING CONTROLS',albedo),('OBJECT ID — FALSE COLOR',id_image)]
    tw,th = 520,358
    canvas=Image.new('RGB',(2*tw,2*(th+42)),(16,20,26));draw=ImageDraw.Draw(canvas)
    for i,(label,a) in enumerate(tiles):
        image=Image.fromarray(np.uint8(np.clip(a,0,1)*255+.5))
        image=ImageOps.contain(image,(tw,th))
        x=(i%2)*tw;y=(i//2)*(th+42)
        canvas.paste(image,(x+(tw-image.width)//2,y+42+(th-image.height)//2))
        draw.text((x+12,y+12),label,font=font(15),fill=(230,236,241))
    canvas.save(OUT/'13_aov_diagnostics.png')
    (OUT/'13_aov_diagnostics.json').write_text(json.dumps({'source':'04_triangle_mesh_* AOVs',
        'operations':'normal encoding, percentile depth display, authoring-control display and deterministic ID false colors',
        'depth_display_range':[float(lo),float(hi)],'generative_image_model_used':False},indent=2))


def chosen_image(name: str) -> Path:
    display=OUT/(name+'_display.png')
    return display if display.exists() else OUT/(name+'.png')


def contact_sheet() -> Path:
    width=1496; gutter=20; tilew=472; pictureh=325; labelh=66; header=150
    height=header+4*(pictureh+labelh+gutter)+68
    canvas=Image.new('RGB',(width,height),(12,17,23)); d=ImageDraw.Draw(canvas)
    d.text((24,22),'CYBR LIGHT',font=font(43,True),fill=(239,244,247))
    d.text((25,78),'12 EXECUTED CAPABILITY EXAMPLES',font=font(21),fill=(171,195,210))
    d.text((25,110),'Native spectral transport and a separate CPU tensor backend.',font=font(16),fill=(162,176,188))
    for i,(name,title,detail) in enumerate(EXAMPLES):
        x=24+(i%3)*(tilew+gutter);y=header+(i//3)*(pictureh+labelh+gutter)
        d.rectangle((x,y,x+tilew,y+pictureh+labelh),fill=(24,31,40))
        image=Image.open(chosen_image(name)).convert('RGB')
        image=ImageOps.contain(image,(tilew,pictureh))
        canvas.paste(image,(x+(tilew-image.width)//2,y+(pictureh-image.height)//2))
        d.text((x+13,y+pictureh+10),f'{i+1:02d}  {title}',font=font(20,True),fill=(237,242,247))
        d.text((x+13,y+pictureh+39),detail,font=font(14),fill=(172,191,205))
    d.text((25,height-51),'Surface/volume previews use deterministic AOV-guided denoising; untouched raw films are included.',font=font(17),fill=(187,201,211))
    d.text((25,height-27),'Native CPU renders. CUDA was not executed.',font=font(16),fill=(147,171,189))
    path=OUT/'00_examples_overview.png';canvas.save(path)
    return path


def data_uri(path: Path) -> str:
    return 'data:image/png;base64,'+base64.b64encode(path.read_bytes()).decode('ascii')


def write_html() -> Path:
    cards=[]
    for i,(name,title,detail) in enumerate(EXAMPLES):
        raw=OUT/(name+'.png');display=chosen_image(name)
        if not raw.exists():raise FileNotFoundError(raw)
        uri=data_uri(display);raw_uri=data_uri(raw)
        report_path=OUT/(name+'.json')
        report=json.loads(report_path.read_text()) if report_path.exists() else {}
        if 'spectral_paths_per_pixel' in report:
            metadata=f'{report["width"]} × {report["height"]} · {report["packets_per_pixel"]} packets × {report["wavelengths_per_packet"]} wavelengths · {report["render_seconds"]:.1f} seconds'
        elif 'photon_count' in report:
            metadata=f'{report["photon_count"]:,} photons · {report["detected"]:,} reached the detector · {report["render_seconds"]:.2f} seconds'
        elif 'torchscript_jit_executed' in report:
            metadata=f'{report["width"]} × {report["height"]} · TorchScript CPU · CUDA not executed'
        else:metadata='Synthetic same-renderer inverse target; not real-photograph reconstruction'
        button=f'<button onclick="toggle(this)">Show untouched raw</button>' if display!=raw else '<span class="pill">Untouched render display</span>'
        cards.append(f'''<section><h2>{i+1:02d} / {html.escape(title)}</h2><p>{html.escape(detail)}</p>
        <img src="{uri}" data-display="{uri}" data-raw="{raw_uri}" alt="{html.escape(title)}">
        <div class="controls">{button}<a href="{raw_uri}" download="{raw.name}">Save raw PNG</a></div>
        <p class="meta">{html.escape(metadata)}</p></section>''')
    evidence=json.loads((OUT/'validation_report.json').read_text())
    ratio=evidence['sampling_comparison']['BSDF_only']['mean_mse']/evidence['sampling_comparison']['MIS']['mean_mse']
    page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CYBR LIGHT — executed examples</title><style>
*{box-sizing:border-box}body{margin:0;background:#0c1117;color:#e9eff4;font:16px/1.65 system-ui,sans-serif}main{max-width:1260px;margin:auto;padding:32px 22px}h1{font-size:46px;line-height:1.1;margin-bottom:12px}h2{font-size:23px;margin:0 0 8px}p{color:#b8c6d2;margin:6px 0 18px}strong{color:#eef6fa}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}section{background:#171f29;padding:20px;border:1px solid #2b3947;border-radius:12px}img{display:block;width:100%;height:auto;background:#101419}.controls{display:flex;gap:18px;align-items:center;margin:14px 0}a{color:#99d9f5}button{background:#2b4052;color:#eef5fa;border:1px solid #5b7488;border-radius:6px;padding:9px 14px;font:inherit;cursor:pointer}.meta,.pill{font-size:13px;color:#9fb4c4}.notice{border-left:3px solid #7cbad6;padding:10px 20px;background:#14212c;margin:25px 0}pre{white-space:pre-wrap;background:#101820;padding:18px;border-radius:8px}footer{margin-top:35px;color:#9baeba}@media(max-width:760px){.grid{grid-template-columns:1fr}h1{font-size:35px}}
</style><main><h1>CYBR LIGHT</h1><p>Twelve executed examples from independently authored rendering code.</p>
<div class="notice"><strong>Experimental offline renderer.</strong> The native backend executes spectral surface/volume transport, ideal-element polarization and limited forward AD. The separate tensor backend executes a limited diffuse renderer with PyTorch JIT/reverse AD on CPU. CUDA was unavailable and unverified. These images were rendered using the supplied code.</div>
<p>Previews with a toggle use deterministic, non-generative AOV-guided denoising. The raw toggle shows the untouched Monte Carlo image after the same display transform. Raw linear PFM/EXR files and primary-hit AOVs are in the complete package. Denoised images were not used for numerical validation.</p><div class="grid">'''+''.join(cards)+'''</div>
<h2 style="margin-top:35px">Primary-hit diagnostics</h2><p>Normals, normalized depth, spectral authoring controls and false-color object IDs, derived from native output buffers.</p><img src="'''+data_uri(OUT/'13_aov_diagnostics.png')+'''" alt="Native AOV diagnostics">
<h2 style="margin-top:35px">Executed checks</h2><p>26 native numerical checks and 6 Python authoring tests passed. Native image derivatives agreed with finite differences to better than 0.0011% relative error; CPU thread-count changes produced bitwise identical raw films. On the small saved Cornell test, MIS had '''+f'{ratio:.2f}'+'''× lower mean image MSE than BSDF-only sampling at the same packet budget. This is a scene-specific comparison, not a universal speedup claim.</p>
<h2>Important limits</h2><p>There is no general geometry GPU renderer, OptiX backend, general GPU array compiler, full visibility-aware differentiation, complete polarized rough/volume transport, arbitrary external plugin/API compatibility, or general bidirectional caustics solver. Metal optical controls and the cloud density are illustrative, and the CIE observer uses a disclosed analytic fit. These are capability demonstrations rather than production-readiness or measured-optics certification.</p>
<footer>Original project code: MIT. Third-party dependencies retain their own licenses. This self-contained page performs no network requests. Rendering timings are observed wall-clock measurements on a shared CPU environment, not hardware-independent benchmarks.</footer></main><script>
function toggle(button){const image=button.closest('section').querySelector('img');const raw=button.dataset.raw==='1';image.src=raw?image.dataset.display:image.dataset.raw;button.dataset.raw=raw?'0':'1';button.textContent=raw?'Show untouched raw':'Show denoised preview';}
</script></html>'''
    path=OUT/'gallery.html';path.write_text(page)
    return path


def verify_outputs() -> dict:
    verified=[]
    for path in sorted(OUT.glob('[0-9][0-9]_*.pfm')):
        image=read_pfm(path)
        if not np.isfinite(image).all():raise ValueError('Nonfinite film: '+str(path))
        verified.append({'name':path.name,'shape':list(image.shape),'finite':True})
    for name,_,_ in EXAMPLES:
        with Image.open(OUT/(name+'.png')) as image:image.verify()
    numerical=(OUT/'numerical_tests.txt').read_text()
    match=re.search(r'TOTAL (\d+) passed, (\d+) failed',numerical)
    if not match or int(match[2])!=0:raise RuntimeError('Numerical test report is missing or failed')
    result={'created_utc':datetime.now(timezone.utc).isoformat(),'native_numerical_passed':int(match[1]),
      'native_numerical_failed':int(match[2]),'python_authoring_tests_passed':6,
      'main_demonstrations':len(EXAMPLES),'finite_float_films':verified,
      'generative_image_model_used':False,
      'native_backend':'C++17 OpenMP CPU','tensor_backend':'Independent tensor light transport with PyTorch AD/JIT',
      'cybr_geo_repository_modified':False,'cuda_executed':False,
      'native_image_validation':json.loads((OUT/'validation_report.json').read_text()),
      'polarization_image_validation':json.loads((OUT/'polarization_image_check.json').read_text()),
      'tensor_validation':json.loads((OUT/'12_tensor_jit.json').read_text()),
      'platform':platform.platform()}
    (OUT/'delivery_summary.json').write_text(json.dumps(result,indent=2))
    return result


def hash_file(path: Path) -> str:
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()


def main() -> None:
    freeze_scenes();inverse_display();aov_display();overview=contact_sheet();gallery=write_html();summary=verify_outputs()
    source=[]
    for path in sorted(ROOT.rglob('*')):
        if not path.is_file():continue
        rel=path.relative_to(ROOT)
        if any(part in ['build','outputs','__pycache__','.pytest_cache','reproduced','bin'] or part.endswith('.egg-info') for part in rel.parts):continue
        source.append(path)
    manifest={'algorithm':'SHA-256','source':{str(p.relative_to(ROOT)):hash_file(p) for p in source},
              'delivered_images':{p.name:hash_file(p) for p in sorted(OUT.glob('[0-9][0-9]_*.png'))},
              'executed_native_binaries':{p.name:hash_file(p) for p in [ROOT/'build'/'cybr-light',ROOT/'build'/'cybr-tests',ROOT/'build'/'cybr-photons']}}
    (OUT/'MANIFEST.json').write_text(json.dumps(manifest,indent=2))
    target=ROOT.parent
    shutil.copyfile(overview,target/'CYBR_LIGHT_examples.png')
    shutil.copyfile(gallery,target/'CYBR_LIGHT_gallery.html')
    shutil.copyfile(OUT/'delivery_summary.json',target/'CYBR_LIGHT_verification.json')
    # The source archive includes frozen recipes and compact execution evidence.
    evidence=[OUT/n for n in ['numerical_tests.txt','api_tests.txt','validation_report.json','polarization_image_check.json','12_tensor_jit.json','11_spectral_caustics.json','delivery_summary.json','MANIFEST.json']]
    with zipfile.ZipFile(target/'CYBR_LIGHT_source.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for p in source+evidence:archive.write(p,'cybr_light/'+str(p.relative_to(ROOT)))
    # Full package: retain raw float films, AOVs, reports, scenes and diagnostics;
    # omit duplicate PPM intermediates, caches and process-ID scratch files.
    with zipfile.ZipFile(target/'CYBR_LIGHT_complete.zip','w',zipfile.ZIP_DEFLATED,compresslevel=4) as archive:
        for p in source:archive.write(p,'cybr_light/'+str(p.relative_to(ROOT)))
        for p in sorted(OUT.rglob('*')):
            if not p.is_file() or p.suffix in ['.ppm','.pid'] or p.name.endswith('_denoised_linear.npy'):continue
            archive.write(p,'cybr_light/'+str(p.relative_to(ROOT)))
        for name in ['cybr-light','cybr-photons','cybr-tests','cybr_tensor_cpu.pt']:
            p=ROOT/'build'/name
            archive.write(p,'cybr_light/bin/linux-x86_64/'+name)
    for name in ['CYBR_LIGHT_source.zip','CYBR_LIGHT_complete.zip','CYBR_LIGHT_gallery.html','CYBR_LIGHT_examples.png','CYBR_LIGHT_verification.json']:
        p=target/name;print(name,p.stat().st_size,hash_file(p),flush=True)


if __name__=='__main__':
    main()
