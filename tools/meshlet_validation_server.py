"""Loopback-only source/asset server for the optional matched meshlet benchmark.

--export-policy writes the controlled shader/oracle variants without starting a
server, browser or GPU. Production source files are never modified.
"""
import argparse
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
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


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, default=root / 'dist/browser/assets/forest')
    parser.add_argument('--output', type=Path, default=root / 'output/meshlet-benchmark')
    parser.add_argument('--port', type=int, default=8037)
    parser.add_argument('--matched-lod', action='store_true')
    parser.add_argument('--export-policy', action='store_true')
    args = parser.parse_args()
    assets, output = args.assets.resolve(), args.output.resolve()
    sources, metadata = controlled_sources(root, args.matched_lod)
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
                body = json.dumps({'matchedPolicy': metadata}).encode()
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
            if not 0 < size <= 4 * 1024 * 1024:
                return self.send_error(400)
            record = json.loads(self.rfile.read(size))
            label = record['label']
            if not isinstance(label, str) or not label.replace('-', '').isalnum():
                return self.send_error(400)
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
