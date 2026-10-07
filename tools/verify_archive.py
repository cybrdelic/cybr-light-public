"""Build and exercise a source archive after extraction into an independent path.

This is an execution check, not a software-security audit. Only test trusted
archives: CMake files and generated C++ shaders execute native build commands.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import zipfile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    archive = args.archive.resolve()
    records = []
    report = {
        'archive_name': archive.name,
        'tested_archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'scope': 'Clean source extraction, native compilation, tests, relocated scene and shader renders',
        'status': 'running',
        'commands': records,
    }
    try:
        with tempfile.TemporaryDirectory(prefix='cybr_clean_') as temporary:
            destination = Path(temporary)
            with zipfile.ZipFile(archive) as source:
                corrupt = source.testzip()
                if corrupt is not None:
                    raise ValueError('Corrupt archive member: ' + corrupt)
                for member in source.infolist():
                    resolved = (destination / member.filename).resolve()
                    if not resolved.is_relative_to(destination.resolve()):
                        raise ValueError('Archive member escapes extraction root')
                    if (member.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError('Symlink archive members are not accepted')
                source.extractall(destination)
            root = destination / 'cybr_light_engine'
            if not (root / 'CMakeLists.txt').is_file():
                raise ValueError('Expected cybr_light_engine/CMakeLists.txt')
            report['clean_extraction_path'] = str(root)
            manifest = json.loads((root / 'SOURCE_MANIFEST.json').read_text())
            for item in manifest['files']:
                member = root / item['path']
                if not member.is_file() or hashlib.sha256(member.read_bytes()).hexdigest() != item['sha256']:
                    raise AssertionError('Implementation manifest mismatch: ' + item['path'])
            report['implementation_payload_sha256'] = manifest['implementation_payload_sha256']
            report['manifest_members_verified'] = len(manifest['files'])

            environment = os.environ.copy()
            environment['PYTHONPATH'] = str(root / 'python')
            environment['CYBR_LIGHT_BINARY'] = str(root / 'build/cybr-light')
            environment.pop('NUMBA_ENABLE_CUDASIM', None)
            def run(command: list[str], name: str) -> None:
                start = time.monotonic()
                result = subprocess.run(command, cwd=root, env=environment,
                                        text=True, capture_output=True, timeout=300)
                records.append({'name': name, 'command': command,
                                'returncode': result.returncode,
                                'seconds': time.monotonic() - start,
                                'stdout': result.stdout, 'stderr': result.stderr})
                if result.returncode:
                    raise RuntimeError(f'{name} failed: {result.stderr[-3000:]}')
            run(['cmake', '-S', '.', '-B', 'build', '-DCMAKE_BUILD_TYPE=Release'], 'configure')
            run(['cmake', '--build', 'build', '-j2'], 'build')
            run(['ctest', '--test-dir', 'build', '--output-on-failure'], 'native_tests')
            run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v'], 'python_tests')
            run([sys.executable, '-m', 'cybrlight', 'rebuild-shaders',
                 'examples/executed/06_compiled_shader'], 'rebuild_relocated_shader')
            for name, scene in [
                ('xml', 'examples/workflow/instances.xml'),
                ('shader', 'examples/executed/06_compiled_shader/scene.cys'),
                ('textures', 'examples/executed/05_material_graphs/scene.cys'),
            ]:
                run([sys.executable, '-m', 'cybrlight', 'render', scene,
                     '--out', 'clean_outputs/' + name, '--size', '40', '28',
                     '--spp', '4', '--bands', '4', '--threads', '2'], 'render_' + name)
            # This process imports only the relocated package to inspect its own outputs.
            check = (
                'from pathlib import Path; import numpy as np; '
                'from cybrlight import read_pfm; '
                'paths=list(Path("clean_outputs").glob("*.pfm")); '
                'assert len(paths)>=3; '
                'assert all(np.isfinite(read_pfm(p)).all() for p in paths); '
                'print("finite raw buffers:",len(paths))'
            )
            run([sys.executable, '-c', check], 'finite_raw_buffers')
            report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        raise
    finally:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2))
    print(json.dumps({'status': report['status'], 'commands': len(records), 'report': str(args.report)}, indent=2))


if __name__ == '__main__':
    main()
