"""Build and execute the original native CYBR LIGHT example recipes.

No Three.js, WebGPU, image-generation service, or prerecorded-render substitution.
Asset-generating builders and shader compilation run on the current checkout.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
sys.path.insert(0, str(ROOT / 'tools'))
from cybrlight import bundle_scene, read_pfm, render
import engine_gallery as engine

spec = importlib.util.spec_from_file_location('cybr_native_legacy_examples', ROOT / 'examples/gallery.py')
assert spec is not None and spec.loader is not None
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)

RECIPES = {
    'anisotropy': (engine.anisotropy, 'Analytic cylinders and anisotropic GGX conductors'),
    'caustics': (engine.caustics, 'Camera-view dispersive surface photon mapping'),
    'rayleigh': (engine.rayleigh, 'Polarized Rayleigh multiple scattering'),
    'transparent': (engine.transparent, 'Colored null sheets and transparent shadows'),
    'materials': (engine.textures, 'UV textures, normal maps, and material mixtures'),
    'shader': (engine.shader, 'Compiled spectral material and image derivatives'),
    'xml': (engine.xml_instances, 'XML references, PLY geometry, transformed instances'),
    'studio': (legacy.material_gallery, 'Original native material studio'),
    'cornell': (legacy.cornell, 'Diffuse indirect illumination and color bleeding'),
    'dielectrics': (legacy.dielectrics, 'Smooth/rough absorbing glass and nested air bubbles'),
    'mesh': (legacy.mesh_knot, 'Procedurally authored knot exported and reimported as OBJ'),
    'fog': (legacy.homogeneous, 'Homogeneous participating medium and light shafts'),
    'cloud': (legacy.clouds, 'Authored heterogeneous multiple-scattering cloud'),
    'polarization': (legacy.polarization, 'Aligned, 45-degree, and crossed polarizers'),
    'dof': (lambda: legacy.lens_motion()[0], 'Thin-lens depth of field'),
    'motion': (lambda: legacy.lens_motion()[1], 'Shutter-time sampling of translating geometry'),
}
PRESETS = {
    'smoke': (160, 106, 4, 4, 20_000),
    'preview': (480, 320, 64, 8, 500_000),
    'reference': (720, 480, 192, 12, 2_400_000),
}


def positive(value: str) -> int:
    result = int(value)
    if result <= 0:
        raise argparse.ArgumentTypeError('must be positive')
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('names', nargs='*', help='Recipe names, or all')
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--preset', choices=PRESETS, default='preview')
    parser.add_argument('--out', type=Path, default=ROOT / 'rendered/examples')
    parser.add_argument('--spp', type=positive)
    parser.add_argument('--width', type=positive)
    parser.add_argument('--height', type=positive)
    parser.add_argument('--threads', type=positive, default=2)
    parser.add_argument('--previews-only', action='store_true',
                        help='Keep PNGs and compact execution records, not raw films')
    parser.add_argument('--export-only', action='store_true',
                        help='Write portable scene bundles without rendering')
    args = parser.parse_args()
    if args.list:
        for name, (_, title) in RECIPES.items():
            print(f'{name:14} {title}')
        return
    names = list(RECIPES) if 'all' in args.names else (args.names or ['anisotropy'])
    invalid = set(names) - RECIPES.keys()
    if invalid:
        parser.error(f'Unknown recipes: {sorted(invalid)}; use --list')
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    width, height, spp, bands, photons = PRESETS[args.preset]
    width, height, spp = args.width or width, args.height or height, args.spp or spp
    records = []
    for name in names:
        scene = RECIPES[name][0]()
        scene.settings.width, scene.settings.height = width, height
        scene.settings.spp, scene.settings.bands = spp, bands
        scene.settings.threads = args.threads
        scene.settings.photon_count = photons
        scene.settings.film_format = 'openexr'
        if name == 'caustics':
            scene.settings.spp = min(spp, 24)
        scene.notes.append('Native-only repository example; no browser renderer.')
        print(f'BUILD {name}: {width}x{height}, {scene.settings.spp} packets, {bands} wavelengths', flush=True)
        if args.export_only:
            bundle_scene(scene, out / name)
            continue
        with tempfile.TemporaryDirectory(prefix='cybr-native-') as temp:
            prefix = (Path(temp) if args.previews_only else out) / name
            report = render(scene, prefix)
            film = read_pfm(prefix.with_suffix('.pfm'))
            if film.shape != (height, width, 3) or not np.isfinite(film).all():
                raise RuntimeError(f'{name}: nonfinite film or incorrect dimensions {film.shape}')
            png = prefix.with_suffix('.png')
            if not png.is_file() or png.stat().st_size == 0:
                raise RuntimeError(f'{name}: the native render produced no PNG')
            if args.previews_only:
                shutil.copyfile(png, out / f'{name}.png')
            record = {
                'name': name, 'description': RECIPES[name][1],
                'backend': 'native-cpp-cpu', 'preset': args.preset,
                'width': width, 'height': height,
                'packets_per_pixel': scene.settings.spp, 'wavelengths_per_packet': bands,
                'max_depth': scene.settings.max_depth, 'photon_count': photons if name == 'caustics' else 0,
                'render_seconds': report.get('render_seconds'),
                'raw_film_sha256': hashlib.sha256(prefix.with_suffix('.pfm').read_bytes()).hexdigest(),
                'preview_sha256': hashlib.sha256(png.read_bytes()).hexdigest(),
                'raw_film_finite': True, 'denoised': False,
                'preview_note': 'Display transform only; no AI image generation or denoising',
            }
            records.append(record)
            (out / f'{name}.json').write_text(json.dumps(record, indent=2) + '\n')
            print(f'RENDERED {name}: {record["render_seconds"]} seconds', flush=True)
    (out / 'index.json').write_text(json.dumps({'examples': records}, indent=2) + '\n')


if __name__ == '__main__':
    main()
