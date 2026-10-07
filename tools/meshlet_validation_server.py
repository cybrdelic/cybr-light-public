"""Loopback-only source/asset server for the optional matched meshlet benchmark.

--export-policy writes the controlled shader/oracle variants without starting a
server, browser or GPU. Production source files are never modified.
"""
import argparse
import base64
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, unquote


def controlled_sources(root, matched):
    files = ('forest-meshlet-cull.wgsl', 'forest-game.wgsl', 'meshlet-hierarchy.mjs')
    sources = {f'/browser/{name}': (root / 'browser' / name).read_text(encoding='utf-8') for name in files}
    if matched:
        replacements = (
            ('forest-meshlet-cull.wgsl', 'let limit=camera.settings.z*select(1.,.9,k>i.info.w);', 'let limit=camera.settings.z;'),
            ('forest-game.wgsl', 'for(var k=1u;k<4u;k++){if(lodErrors[i.info.x][k]*', 'var cumulativeError=0.;for(var k=1u;k<4u;k++){cumulativeError=max(cumulativeError,lodErrors[i.info.x][k]);if(cumulativeError*'),
            ('meshlet-hierarchy.mjs', 'limit=camera.lodPixels*(k>previous?0.9:1)', 'limit=camera.lodPixels'),
        )
        for name, before, after in replacements:
            key = f'/browser/{name}'
            if sources[key].count(before) != 1:
                raise ValueError(f'Controlled policy marker changed: {name}')
            sources[key] = sources[key].replace(before, after)
    sha = lambda name: hashlib.sha256(sources[f'/browser/{name}'].encode()).hexdigest()
    metadata = {
        'hysteresis': 'disabled in validation-only meshlet shader and CPU oracle; baseline has none' if matched else 'production policy',
        'errorPolicy': 'cumulative maximum in all three validation-only selectors' if matched else 'production policy',
        'meshletShaderSha256': sha(files[0]), 'baselineShaderSha256': sha(files[1]),
        'oracleSha256': sha(files[2]), 'productionFilesModified': False,
    }
    return sources, metadata


def acceptance_sources(root):
    sources, metadata = controlled_sources(root, False)
    key = '/browser/forest-meshlet-cull.wgsl'
    source = sources[key]
    replacements = (
        ('@compute @workgroup_size(128)', '@group(0) @binding(7) var<storage,read_write> acceptanceState:array<u32>;\n@compute @workgroup_size(128)'),
        ('let i=instances[id.x];let radius=', 'let i=instances[id.x];acceptanceState[id.x]=(i.info.w&3u)|((i.info.w&3u)<<2u);let radius='),
        ('var level=0u;', 'var level=select(0u,i.info.w,camera.settings.y>.5);'),
        ('if(camera.settings.z>0.)', 'if(camera.settings.y<.5&&camera.settings.z>0.)'),
        ('instances[id.x].info.w=level;', 'instances[id.x].info.w=level;\n if(camera.settings.y<.5){acceptanceState[id.x]=16u|(i.info.w&3u)|((level&3u)<<2u);}'),
        ('if(!sphereVisible(center,n.sphere.w*abs(i.position.w)))', 'if(camera.settings.y<.5&&!sphereVisible(center,n.sphere.w*abs(i.position.w)))'),
    )
    for before, after in replacements:
        if source.count(before) != 1:
            raise ValueError('Acceptance cull marker changed: ' + before)
        source = source.replace(before, after)
    sources[key] = source
    runtime = (root / 'browser/forest-game.mjs').read_text(encoding='utf-8')
    runtime = "import {createForestAcceptance,prepareAcceptanceInputs} from './forest-acceptance.mjs';\n" + runtime
    replacements = (
        ('// GPU uploads own their copies;', 'const acceptanceInput=prepareAcceptanceInputs(data,clusterPlan);\n// GPU uploads own their copies;'),
        ('const clusterStats=clusterPlan?buffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC):null;', 'const clusterStats=clusterPlan?buffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC):null;\nif(!clusterPlan)throw Error("Acceptance requires meshlets=1");\nconst acceptanceState=buffer(data.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);'),
        ('[6,clusterStats]]', '[6,clusterStats],[7,acceptanceState]]'),
        ("depth=texture([960,540],'depth32float',4)", "depth=texture([960,540],'depth32float',4,GPUTextureUsage.TEXTURE_BINDING)"),
        ("state.ready=true;status.textContent='';requestAnimationFrame(frame);", "window.forestAcceptance=await createForestAcceptance({device,input:acceptanceInput,format,instances,acceptanceState,uniform,indirect,drawWords,stats:clusterStats,uniforms,compute,computeGroup,workgroups:Math.ceil(data.count/128),forestBundle,color,depth,state,pause:()=>paused=true,setPose:value=>pose=value,setLod:value=>lodPixels=value});\nstate.acceptanceAdapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description};\nstate.ready=true;status.textContent='';requestAnimationFrame(frame);"),
    )
    for before, after in replacements:
        if runtime.count(before) != 1:
            raise ValueError('Acceptance runtime marker changed: ' + before)
        runtime = runtime.replace(before, after)
    sources['/browser/forest-game.mjs'] = runtime
    harness_files = ('forest-acceptance.mjs', 'forest-acceptance-plan.mjs', 'forest-acceptance-f32.mjs', 'forest-acceptance-reset.wgsl', 'forest-acceptance-depth.wgsl')
    for name in harness_files:
        sources['/browser/' + name] = (root / 'browser' / name).read_text(encoding='utf-8')
    metadata.update({
        'acceptance': True, 'hysteresis': 'production 90% demotion hysteresis retained',
        'acceptancePolicyVersion': 3,
        'fallbackOracle': 'source-order nearest-binary32 transformed selected-LOD sphere count; exact equality required; complete reference still uses root-visible population',
        'arithmeticLimits': 'WGSL permits reassociation and fusion; this emulation is verified against captured adapter counts and does not silently allow alternative count outcomes',
        'acceptanceHarnessSha256': {name: hashlib.sha256(sources['/browser/' + name].encode()).hexdigest() for name in harness_files},
        'callbackSha256': hashlib.sha256((root / 'tools/meshlet-acceptance.browser.js').read_bytes()).hexdigest(),
        'reference': 'same selected LOD state and root frustum; hierarchy rejection bypassed only for paired reference',
        'state': 'one u32 per instance: previous 2 bits, selected 2 bits, root-visible bit; explicit reset kernel',
        'meshletShaderSha256': hashlib.sha256(source.encode()).hexdigest(),
        'servedRuntimeSha256': hashlib.sha256(runtime.encode()).hexdigest(),
    })
    return sources, metadata


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, default=root / 'dist/browser/assets/forest')
    parser.add_argument('--output', type=Path, default=root / 'output/meshlet-benchmark')
    parser.add_argument('--port', type=int, default=8037)
    parser.add_argument('--matched-lod', action='store_true')
    parser.add_argument('--export-policy', action='store_true')
    parser.add_argument('--acceptance', action='store_true')
    args = parser.parse_args()
    if args.acceptance and args.matched_lod:
        parser.error('Acceptance retains production hysteresis; --matched-lod cannot be combined')
    assets, output = args.assets.resolve(), args.output.resolve()
    sources, metadata = acceptance_sources(root) if args.acceptance else controlled_sources(root, args.matched_lod)
    output.mkdir(parents=True, exist_ok=True)
    for route, source in sources.items():
        (output / ('controlled-' + Path(route).name)).write_bytes(source.encode())
    (output / 'matched-policy.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    if args.export_policy:
        print(json.dumps({'output': str(output), 'serverStarted': False, 'gpuUsed': False, **metadata}))
        return

    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path):
            relative = unquote(urlsplit(path).path).lstrip('/')
            base = assets if relative.startswith('browser/assets/forest/') else root
            if base == assets:
                relative = relative.removeprefix('browser/assets/forest/')
            result = (base / relative).resolve()
            return str(result if result.is_relative_to(base) else root / 'missing')

        def do_GET(self):
            route = urlsplit(self.path).path
            if route == '/__meta':
                body = json.dumps({'pid': os.getpid(), 'matchedPolicy': metadata}).encode()
                mime = 'application/json'
            elif route in sources:
                body = sources[route].encode()
                mime = 'text/javascript' if route.endswith('.mjs') else 'text/plain'
            else:
                return super().do_GET()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path != '/__evidence':
                return self.send_error(404)
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16 * 1024 * 1024:
                return self.send_error(400)
            record = json.loads(self.rfile.read(size))
            label = record['label']
            if not isinstance(label, str) or not label.replace('-', '').isalnum():
                return self.send_error(400)
            images = record['value'].pop('images', {}) if isinstance(record['value'], dict) else {}
            for kind, payload in images.items():
                if kind not in ('normal', 'reference'):
                    return self.send_error(400)
                pixels = base64.b64decode(payload, validate=True)
                if not pixels.startswith(b'\x89PNG\r\n\x1a\n'):
                    return self.send_error(400)
                (output / (label + '-' + kind + '.png')).write_bytes(pixels)
            (output / (label + '.json')).write_text(json.dumps(record['value'], indent=2) + '\n', encoding='utf-8')
            self.send_response(204)
            self.end_headers()

    with ThreadingHTTPServer(('127.0.0.1', args.port), Handler) as server:
        print(f'Meshlet validation on http://127.0.0.1:{args.port}; matched={args.matched_lod}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
