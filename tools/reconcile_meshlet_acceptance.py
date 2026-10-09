"""CPU-only receipt reconciliation and ordered PNG review preparation.

Reads the preserved native runs without modifying them. Verifies every source
PNG, temporal metric, reset boundary and selected valid capture; writes a public
receipt ledger and small ordered contact sheets. No server, browser or GPU.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def pixel_delta(a, b):
    diff = ImageChops.difference(a.convert('RGB'), b.convert('RGB'))
    channels = diff.split()
    maximum = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    histogram = maximum.histogram()
    return {'changedPixels': a.width * a.height - histogram[0],
            'maxChannelDifference': max(i for i, count in enumerate(histogram) if count)}


def font(size):
    try:
        return ImageFont.truetype('C:/Windows/Fonts/consola.ttf', size)
    except OSError:
        return ImageFont.load_default()


def sheet(records, label, output, width=320, columns=4):
    height = width * 540 // 960
    top, caption, gap = 56, 52, 8
    rows = (len(records) + columns - 1) // columns
    canvas = Image.new('RGB', (columns * (width + gap) + gap,
                              top + rows * (height + caption + gap)), '#101719')
    draw = ImageDraw.Draw(canvas)
    draw.text((gap, 8), label, font=font(20), fill='#e4ece8')
    draw.text((gap, 32), 'Ordered discrete poses; same selected-LOD reference is pixel-identical', font=font(12), fill='#a5b6aa')
    for ordinal, record in enumerate(records):
        x = gap + (ordinal % columns) * (width + gap)
        y = top + (ordinal // columns) * (height + caption + gap)
        with Image.open(record['_normalPath']) as original:
            canvas.paste(original.convert('RGB').resize((width, height), Image.Resampling.LANCZOS), (x, y))
        target = record['targetState']
        target_label = f"{target['before']}->{target['after']}" if target else '-'
        draw.text((x, y + height + 3), f"{record['index']:02d} {record['kind']}  LOD {target_label}", font=font(13), fill='#d3e1d8')
        draw.text((x, y + height + 23), f"distance {record['pose']['distance']:.3f} | changed {record['lod']['changed']:,}", font=font(12), fill='#9bb5a3')
    canvas.save(output, optimize=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, required=True)
    parser.add_argument('--continuation', type=Path, required=True)
    parser.add_argument('--invalid-depth', type=Path, required=True)
    parser.add_argument('--cpu-proof', type=Path, required=True)
    parser.add_argument('--docs', type=Path, required=True)
    parser.add_argument('--boundary-output', type=Path, required=True)
    args = parser.parse_args()
    manifest = read(args.continuation / 'grouped-acceptance-manifest.json')
    prior_manifest = read(args.prefix / 'grouped-acceptance-manifest.json')
    proof = read(args.cpu_proof)
    assert manifest['cases'] == prior_manifest['cases']
    assert manifest['probeIds'] == prior_manifest['probeIds']
    assert len(manifest['cases']) == 79 and len(manifest['probeIds']) == 167
    assert manifest['resumeIndex'] == 17 and manifest['cases'][17]['resetHistory']
    policies = {name: read(root / 'grouped-acceptance-policy.json')['matchedPolicy']
                for name, root in [('stored-depth-prefix-v2', args.prefix), ('binary32-continuation-v3', args.continuation)]}
    assert policies['binary32-continuation-v3']['acceptancePolicyVersion'] == 3
    assert policies['stored-depth-prefix-v2']['acceptanceHarnessSha256']['forest-acceptance.mjs'] == policies['binary32-continuation-v3']['acceptanceHarnessSha256']['forest-acceptance.mjs']
    args.docs.mkdir(parents=True, exist_ok=True)
    assets = args.docs / 'pr-assets'
    assets.mkdir(exist_ok=True)
    args.boundary_output.mkdir(parents=True, exist_ok=True)
    captures, records, views, holds, near_black = [], [], {}, [], []
    previous = previous_normal = previous_reference = None
    for case in manifest['cases']:
        index = case['index']
        root = args.prefix if index < 17 else args.continuation
        run = 'stored-depth-prefix-v2' if index < 17 else 'binary32-continuation-v3'
        name = f'grouped-acceptance-{index:03d}'
        receipt_path = root / (name + '.json')
        raw = receipt_path.read_bytes()
        report = read(receipt_path)
        for key in ('index', 'view', 'kind', 'pose', 'lodPixels', 'resetHistory', 'targetId'):
            assert report[key] == case[key], (index, key)
        assert report['geometryPassed'] and report['coverage']['geometryPassed'] and report['coverage']['imageExact']
        assert not report['errors'] and not report['requiresImageReview']
        for field in ('historyErrors', 'selectorErrors', 'rootWitnessErrors'):
            assert report['lod'][field] == 0
        for field in ('overflow', 'referenceErrors', 'fallbackErrors'):
            assert report['draw'][field] == 0
        for field in ('missingSamples', 'closerReferenceSamples', 'unexpectedCloserSamples', 'nonfiniteDepth'):
            assert report['coverage'][field] == 0
        assert report['coverage']['referenceCoveredSamples'] > 0
        assert report['normalCounters'][3] == report['referenceCounters'][3] == 0
        assert report['normalCounters'][0] == report['referenceCounters'][0] == report['lod']['visible']
        if index < 17:
            assert proof['stateChecks'][index]['exact']
            assert not proof['stateChecks'][index]['fallbackFloat32Mismatches']
            assert proof['stateChecks'][index]['stateSha256'] == report['lodStateSha256']
        normal_path, reference_path = root / (name + '-normal.png'), root / (name + '-reference.png')
        with Image.open(normal_path) as n, Image.open(reference_path) as r:
            normal, reference = n.convert('RGBA'), r.convert('RGBA')
        assert normal.size == reference.size == (960, 540)
        assert normal.tobytes() == reference.tobytes(), ('decoded color mismatch', index)
        extrema = normal.convert('RGB').getextrema()
        if max(channel[1] for channel in extrema) <= 5:
            near_black.append(index)
        if case['resetHistory']:
            assert report['temporal'] is None
        else:
            assert previous is not None and previous['view'] == case['view']
            normal_delta, reference_delta = pixel_delta(normal, previous_normal), pixel_delta(reference, previous_reference)
            assert normal_delta == reference_delta
            assert normal_delta['changedPixels'] == report['temporal']['normalChangedPixels']
            assert reference_delta['changedPixels'] == report['temporal']['referenceChangedPixels']
            assert normal_delta['maxChannelDifference'] == report['temporal']['normalMaxChannelDifference']
            assert reference_delta['maxChannelDifference'] == report['temporal']['referenceMaxChannelDifference']
            if case['kind'].startswith('hold-') and previous['pose'] == case['pose'] and previous['lodPixels'] == case['lodPixels']:
                assert normal_delta['changedPixels'] == 0 and report['lod']['changed'] == 0 and report['holdChanged'] == 0
                holds.append(index)
        report['_normalPath'] = str(normal_path)
        records.append(report)
        views.setdefault(case['view'], []).append(report)
        captures.append({'sourceRun': run, 'sourceReceipt': receipt_path.name, 'sourceReceiptSha256': digest(raw),
                         'normalPngSha256': digest(normal_path.read_bytes()), 'referencePngSha256': digest(reference_path.read_bytes()),
                         'decodedRgbaSha256': digest(normal.tobytes()), 'decodedPairExact': True,
                         'rgbExtrema': extrema,
                         'capture': {key: value for key, value in report.items() if not key.startswith('_')}})
        previous, previous_normal, previous_reference = report, normal, reference
    summaries = []
    for view, ordered in views.items():
        demote = next(r for r in ordered if r['kind'] == 'after-demote')
        promote = next(r for r in ordered if r['kind'] == 'after-promote')
        assert demote['targetState']['after'] == demote['targetState']['before'] + 1
        assert promote['targetState']['after'] == promote['targetState']['before'] - 1
        asset_name = f'meshlet-ordered-{view}.png'
        sheet(ordered, f'{view}: all {len(ordered)} ordered captures', assets / asset_name)
        boundaries = [r for r in ordered if r['kind'] in ('outbound-mid-band', 'after-demote', 'hold-coarse', 'inbound-mid-band', 'after-promote', 'hold-fine')]
        # Full source resolution for local perceptual inspection; the smaller
        # complete ordered sheet is committed for reviewer-facing proof.
        sheet(boundaries, f'{view}: threshold brackets and stable holds', args.boundary_output / f'{view}-boundaries.png', width=960, columns=2)
        summaries.append({'view': view, 'pairs': len(ordered), 'indices': [r['index'] for r in ordered],
                          'demoted': sum(r['lod']['demoted'] for r in ordered), 'promoted': sum(r['lod']['promoted'] for r in ordered),
                          'targetDemotion': demote['targetState'], 'targetPromotion': promote['targetState'],
                          'unchangedHolds': [i for i in holds if any(r['index'] == i for r in ordered)],
                          'orderedSheet': 'pr-assets/' + asset_name, 'orderedSheetSha256': digest((assets / asset_name).read_bytes())})
    ledger = {
        'status': '79/79 grouped sampled geometry captures reconciled; ordered visual assessment recorded separately',
        'visualReview': 'MESHLET_RASTER_VISUAL_REVIEW.md',
        'mode': 'meshlets=1&meshletGroup=8', 'baselineDefault': True, 'gpuUsedByReconciliation': False, 'browserUsedByReconciliation': False,
        'exactCoverage': {'prefixIndices': [0, 16], 'prefixPairs': 17, 'continuationIndices': [17, 78], 'continuationPairs': 62,
                          'totalUniquePairs': 79, 'views': 5, 'triangleProbes': 167, 'renderSize': [960, 540], 'samplesPerPixel': 4,
                          'comparedColorPixels': 79 * 960 * 540, 'comparedDepthSamples': 79 * 960 * 540 * 4,
                          'depthRelativeTolerance': manifest['policy']['depthRelativeTolerance'], 'allColorPairsDecodedExact': True,
                          'allRecordedDepthChecksPassed': True, 'allRecordedCountAndHistoryChecksPassed': True,
                          'zeroPixelAndLodChangeHoldPairs': holds, 'fullDetailViews': ['trail', 'canopy', 'sky', 'clearing'],
                          'nearBlackFrames': {'indices': near_black, 'criterion': 'Every RGB channel is <= 5/255 across the whole image; same complete-LOD reference has identical pixels'},
                          'fullDetailOverview': 'excluded: estimated 1,885,302,274 submitted triangles exceeds 600M budget',
                          'path': 'recorded pan and threshold-bracket poses; not every intermediate animation frame'},
        'reference': 'Complete selected model LOD with same root cull, captured per-instance LOD history, transforms, materials and masks',
        'scopeLimits': ['No continuous-frame or arbitrary-camera guarantee', 'Original complete LODs switch discretely without blending',
                        'Fine mode has no equivalent sweep and remains unsupported experimental research', 'One NVIDIA Lovelace / Chrome 145 desktop',
                        'No performance benefit demonstrated; fully resident geometry; streaming absent'],
        'policies': policies, 'manifest': manifest, 'views': summaries, 'captures': captures,
        'releaseReceipts': {'storedDepthPrefix': read(args.prefix / 'cleanup.json'), 'continuation': read(args.continuation / 'cleanup.json')},
        'preservedHistory': [
            {'run': 'discard-depth-initial', 'status': 'invalid depth evidence; original root-count oracle failed',
             'failure': read(args.invalid_depth / 'grouped-acceptance-failure.json'),
             'capture0': read(args.invalid_depth / 'grouped-acceptance-000.json'), 'capture1': read(args.invalid_depth / 'grouped-acceptance-001.json')},
            {'run': 'stored-depth-prefix-v2', 'status': 'native run failed at 26; prefix 0..16 retained only after v3 CPU count audit',
             'failure': read(args.prefix / 'grouped-acceptance-failure.json'), 'capture26': read(args.prefix / 'grouped-acceptance-026.json')},
            {'run': 'binary32-continuation-v3', 'status': '62/62 native continuation pass; does not overwrite historical failed receipts',
             'summary': read(args.continuation / 'grouped-acceptance-summary.json')}
        ]
    }
    output = args.docs / 'MESHLET_RASTER_GROUPED_ACCEPTANCE.json'
    output.write_text(json.dumps(ledger, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'uniquePairs': 79, 'decodedExactPairs': 79, 'stableHolds': len(holds),
                      'views': summaries, 'gpuUsed': False}))


if __name__ == '__main__':
    main()
