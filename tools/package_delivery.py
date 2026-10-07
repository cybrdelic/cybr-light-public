"""Package source, evidence and actual rendered outputs; never invent missing files."""
from __future__ import annotations
import argparse
import base64
import hashlib
import html
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT.parent
sys.path.insert(0, str(ROOT / 'python'))
from cybrlight import read_pfm
import numpy as np

EXCLUDED = {'.git', 'build', 'build_sanitized', '__pycache__', '.pytest_cache', 'clean_outputs', 'reproduced'}
BINARY_OUTPUT_SUFFIXES = {'.pfm', '.exr', '.npy', '.npz', '.ppm', '.ckpt', '.bin'}
SCENES = [
 ('01_anisotropy', 'Anisotropic surfaces', 'Exact cylinders and disks; anisotropic GGX conductors.'),
 ('02_camera_caustics', 'Camera-view spectral caustics', '2.4 million emitted photons; biased surface photon mapping.'),
 ('03_polarized_rayleigh', 'Polarized multiple scattering', 'Rayleigh scattering with saved Stokes components.'),
 ('04_transparent_shadows', 'Transparent light paths', 'Spectral sheets attenuate directional illumination.'),
 ('05_material_graphs', 'Textures and material graphs', 'UV bitmap textures, normal maps and nested BSDF mixtures.'),
 ('06_compiled_shader', 'Independent compiled shader', 'Generated C++ spectral shader; native image derivatives.'),
 ('07_xml_instances', 'XML, meshes and instances', 'PLY mesh import, references and transformed instances.'),
 ('08_portable_bvh', 'Shared CPU/CUDA source', 'This image used the CPU target. Hardware CUDA is unverified.'),
 ('09_inverse_geometry', 'Geometry recovered from images', 'Synthetic target and two-parameter finite-difference fit.'),
]

def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def allowed(path: Path, full: bool) -> bool:
    relative = path.relative_to(ROOT)
    if any(p in EXCLUDED or p.endswith('.egg-info') for p in relative.parts):
        return False
    if path.suffix in {'.pyc', '.nbc', '.nbi', '.ttf', '.otf', '.woff', '.woff2'}:
        return False
    if not full and relative.parts[0] == 'outputs':
        return False
    if not full and relative.parts[0] == 'evidence' and path.suffix in BINARY_OUTPUT_SUFFIXES | {'.png'}:
        return False
    return True


def source_manifest() -> dict:
    prefixes = {'CMakeLists.txt', 'LICENSE', 'pyproject.toml', 'requirements.txt',
                'requirements-validation.txt', 'include', 'src', 'python', 'tests', 'tools', 'examples', 'data'}
    records = []
    for path in sorted(ROOT.rglob('*')):
        if path.is_file() and allowed(path, False) and path.relative_to(ROOT).parts[0] in prefixes:
            records.append({'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size, 'sha256': digest(path)})
    payload = hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    result = {'scope': 'Implementation, tests, scene recipes and frozen assets; excludes mutable execution reports and rendered films',
              'implementation_payload_sha256': payload, 'files': records}
    (ROOT / 'SOURCE_MANIFEST.json').write_text(json.dumps(result, indent=2))
    return result


def archive(path: Path, full: bool) -> dict:
    members = [p for p in sorted(ROOT.rglob('*')) if p.is_file() and allowed(p, full)]
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for member in members:
            output.write(member, Path(ROOT.name) / member.relative_to(ROOT))
    with zipfile.ZipFile(path) as check:
        if check.testzip() is not None:
            raise AssertionError('ZIP CRC integrity check failed')
        count = len(check.infolist())
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest(path),
            'members': count, 'zip_crc_check': 'passed'}


def make_gallery() -> None:
    from PIL import Image, ImageDraw, ImageFont, ImageOps
    def font(size: int, bold: bool = False):
        candidates = [Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
                      Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf')]
        for p in candidates:
            if p.is_file():
                return ImageFont.truetype(str(p), size)
        return ImageFont.load_default(size=size)
    gap, margin, tw, th, caption = 18, 30, 450, 298, 72
    width = margin*2+3*tw+2*gap
    height = 132+3*(th+caption)+2*gap+42
    canvas = Image.new('RGB', (width, height), '#10131a'); draw = ImageDraw.Draw(canvas)
    draw.text((margin, 24), 'CYBR LIGHT 0.2', font=font(38, True), fill='#f1f4f8')
    draw.text((margin, 77), 'Independent renderer  /  Nine executed examples  /  Raw-render previews', font=font(21), fill='#bac4d4')
    cards = []
    for i, (name, title, description) in enumerate(SCENES):
        path = ROOT/'outputs'/(name+'.png')
        if not path.is_file():
            raise FileNotFoundError(path)
        image = Image.open(path).convert('RGB')
        x = margin+(i%3)*(tw+gap);y = 132+(i//3)*(th+caption+gap)
        fitted = ImageOps.contain(image, (tw, th), Image.Resampling.LANCZOS)
        draw.rectangle((x,y,x+tw,y+th+caption),fill='#1b202b')
        canvas.paste(fitted,(x+(tw-fitted.width)//2,y+(th-fitted.height)//2))
        draw.text((x+12,y+th+10),f'{i+1:02d}  {title}',font=font(19,True),fill='#edf1f7')
        sub = ['Native spectral transport','Biased photon density estimate','Stored Stokes transport',
               'Transparent-sheet visibility','Nested surface models','C++ compiler + image AD',
               'Actual XML scene loading','CPU execution; GPU unverified','Finite differences, not general AD'][i]
        draw.text((x+12,y+th+40),sub,font=font(16),fill='#b5c0d1')
        data = base64.b64encode(path.read_bytes()).decode()
        cards.append(f'<article><img src="data:image/png;base64,{data}" alt="{html.escape(title)}"><div class="copy"><h2>{i+1:02d} · {html.escape(title)}</h2><p>{html.escape(description)}</p></div></article>')
    draw.text((margin,height-29),'Native renderer examples and numerical execution records.',font=font(16),fill='#b5c0d1')
    canvas.save(DEST/'CYBR_LIGHT_engine_outputs.png')
    analyzer = ROOT/'outputs/03_polarization_analysis.png'
    analyzer_data = base64.b64encode(analyzer.read_bytes()).decode()
    page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CYBR LIGHT 0.2 — executed renderer examples</title><style>
body{margin:0;background:#10131a;color:#edf2f8;font:16px/1.55 system-ui,sans-serif}header,main,footer{max-width:1420px;margin:auto;padding:28px}h1{font-size:40px;margin:0}header p{max-width:980px;color:#b8c5d8}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}article{background:#1b202b;border:1px solid #30394b;border-radius:8px;overflow:hidden}img{width:100%;height:auto;display:block}.copy{padding:18px}h2{font-size:19px;margin:0 0 8px}p{margin:0 0 12px}aside{padding:24px;background:#1b202b;margin-top:24px}code{color:#c1dfeb}footer{color:#b8c5d8}a{color:#b8dbff}
</style><header><h1>CYBR LIGHT 0.2</h1><p>Independent spectral rendering, scene workflows, material compilation and execution evidence. These are actual renderer outputs. The Monte Carlo films were not denoised; the PNGs use a display transform.</p></header><main><div class="grid">'''+''.join(cards)+'''</div><aside><h2>Polarization analysis</h2><p>The analyzer views below are computed from saved Stokes films, not separately rerendered scenes. The final panel shows luminance-integrated degree of polarization.</p><img src="data:image/png;base64,'''+analyzer_data+'''" alt="Analyzer views and degree of polarization"></aside><aside><h2>Evidence and limits</h2><p>Raw PFM/EXR films, frozen scene inputs, native/Python tests, finite-difference checks and run receipts are included in the full-output archive. The source archive excludes most image buffers. The portable CUDA result is CPU simulation, not verified hardware GPU execution. The geometry fit uses rerendered finite differences, while the compiled-material example uses native derivatives for three active controls.</p><p>Read <code>README.md</code>, <code>docs/CAPABILITY_MATRIX.md</code> and <code>evidence/delivery_verification.json</code> in the archive for the precise scope. Full API/plugin parity, arbitrary visibility-aware differentiation, a general GPU array runtime and hardware-validated full GPU transport remain unfinished.</p></aside></main><footer>Self-contained gallery. Images are embedded; no network access is required.</footer></html>'''
    (DEST/'CYBR_LIGHT_engine_gallery.html').write_text(page)


def collect_report() -> dict:
    def load(path):
        return json.loads((ROOT/path).read_text())
    for name in ['gallery_xml_current','sanitizer_final','final_validation','baseline_rechecks','inverse_geometry','portable_gallery']:
        status = ROOT/'evidence'/(name+'.exit')
        if not status.is_file() or status.read_text().strip() != '0':
            raise RuntimeError(f'Execution is not complete and passing: {name}')
    native = []
    for name in ['native_baseline_checks','native_engine_checks']:
        text = (ROOT/'evidence'/(name+'.log')).read_text()
        match = re.search(r'TOTAL (\d+) passed, (\d+) failed',text)
        if not match or int(match[2]):raise AssertionError(name)
        native.append({'suite':name,'passed':int(match[1]),'failed':int(match[2])})
    pytext = (ROOT/'evidence/workflow_tests.log').read_text();m = re.search(r'Ran (\d+) tests in',pytext)
    if not m or not pytext.rstrip().endswith('OK'):raise AssertionError('Python tests not passing')
    sanitized=[]
    for name in ['sanitizer_baseline','sanitizer_engine']:
        text=(ROOT/'evidence'/(name+'.log')).read_text();sm=re.search(r'TOTAL (\d+) passed, (\d+) failed',text)
        if not sm or int(sm[2]) or re.search(r'ERROR: AddressSanitizer|runtime error:',text):raise AssertionError(name)
        sanitized.append({'suite':name,'passed':int(sm[1]),'failed':int(sm[2])})
    floats=[]
    for path in sorted([*(ROOT/'outputs').rglob('*.pfm'),*(ROOT/'evidence').rglob('*.pfm')]):
        raw=read_pfm(path)
        if not np.isfinite(raw).all():raise AssertionError('Nonfinite raw film: '+str(path))
        floats.append({'path':str(path.relative_to(ROOT)),'shape':list(raw.shape),'dtype':str(raw.dtype),'sha256':digest(path)})
    primary=[]
    for name,title,description in SCENES:
        entry={'id':name,'title':title,'png_sha256':digest(ROOT/'outputs'/(name+'.png'))}
        receipt=ROOT/'outputs'/(name+'.json')
        if receipt.is_file():entry['execution']=json.loads(receipt.read_text())
        if name=='09_inverse_geometry':entry['execution']=load('outputs/inverse_geometry/optimization.json')
        primary.append(entry)
    versions={}
    for package in ['numpy','Pillow','numba','llvmlite','opencv-python-headless','torch','setuptools']:
        try:versions[package]=importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:versions[package]=None
    report={
        'project':'CYBR LIGHT','version':'0.2.0',
        'image_generation_used':False,
        'denoising_used_for_primary_outputs':False,'hardware_cuda_executed':False,
        'platform':platform.platform(),'python':sys.version,'dependencies':versions,
        'native_executable_sha256':digest(ROOT/'build/cybr-light'),
        'native_numerical_checks':native,'python_tests':{'passed':int(m[1]),'failed':0},
        'sanitizer_checks':sanitized,
        'integration_checks':load('evidence/integration_verification.json'),
        'portable_cpu':load('evidence/portable_cpu.json'),'portable_cuda_simulator':load('evidence/portable_cuda.json'),
        'geometry_inverse':load('outputs/inverse_geometry/optimization.json'),
        'polarization_analysis':load('evidence/polarization_analysis.json'),
        'primary_examples':primary,
        'baseline_camera_rechecks':len(list((ROOT/'outputs/baseline_rechecks').glob('*.png'))),
        'finite_raw_buffer_count':len(floats),'finite_raw_buffers':floats,
        'source_manifest':source_manifest(),
        'limits':['Only the documented scene vocabulary and runtime operations are supported','No physical CUDA compile/run verification or OptiX',
                  'Native AD covers three material/shader controls, not arbitrary visibility-aware scene derivatives',
                  'Independent compiler is elementwise C++ graph compilation, not a full heterogeneous array runtime',
                  'Photon mapping is biased and surface-only','Analytic CIE approximation and illustrative spectral controls',
                  'Camera media not initialized by containment; motion is translation-only','See docs/CAPABILITY_MATRIX.md for remaining boundaries'],
    }
    clean=ROOT/'evidence/clean_archive_verification.json'
    if clean.is_file():
        report['clean_archive_verification']=json.loads(clean.read_text())
        if report['clean_archive_verification']['status']!='passed':raise AssertionError('Clean archive verification failed')
        actual=report['source_manifest']['implementation_payload_sha256']
        tested=report['clean_archive_verification'].get('implementation_payload_sha256')
        if tested!=actual:raise AssertionError('Implementation payload changed after clean archive test')
    return report


def main() -> None:
    parser=argparse.ArgumentParser();parser.add_argument('--prepare-source',action='store_true');args=parser.parse_args()
    if args.prepare_source:
        manifest=source_manifest()
        result=archive(DEST/'CYBR_LIGHT_engine_source.zip',False)
        print(json.dumps({'archive':result,'implementation_payload_sha256':manifest['implementation_payload_sha256']},indent=2))
        return
    make_gallery();report=collect_report()
    target=ROOT/'evidence/delivery_verification.json';target.write_text(json.dumps(report,indent=2))
    (DEST/'CYBR_LIGHT_engine_verification.json').write_text(target.read_text())
    results=[archive(DEST/'CYBR_LIGHT_engine_source.zip',False),archive(DEST/'CYBR_LIGHT_engine_with_outputs.zip',True)]
    hashes={'archives':results,'standalone_artifacts':[]}
    for name in ['CYBR_LIGHT_engine_outputs.png','CYBR_LIGHT_engine_gallery.html','CYBR_LIGHT_engine_verification.json']:
        p=DEST/name;hashes['standalone_artifacts'].append({'path':str(p),'bytes':p.stat().st_size,'sha256':digest(p)})
    (DEST/'CYBR_LIGHT_engine_checksums.json').write_text(json.dumps(hashes,indent=2))
    print(json.dumps({'archives':results,'native_checks':native_count(report),'python_tests':report['python_tests'],
                      'finite_buffers':report['finite_raw_buffer_count']},indent=2))


def native_count(report: dict) -> int:
    return sum(s['passed'] for s in report['native_numerical_checks'])


if __name__=='__main__':main()
