import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rendererOptions } from './renderer-options.mjs';
import { buildRendererShader } from './renderer-shaders.mjs';
test('sampled transmission correspondence composes across trace layouts', async () => {
  const load = (n) => readFile(new URL(n, import.meta.url), 'utf8');
  const parameters = new URLSearchParams('optics=paths');
  for (const name of ['trace', 'trace-pile', 'trace-meshlets', 'reconstruct']) {
    const s = await buildRendererShader(name, {
      load,
      parameters,
      options: rendererOptions(parameters),
    });
    if (name === 'reconstruct')
      assert.ok(
        s.includes('output[i].residualPosition=current[i].residualPosition'),
      );
    else {
      assert.ok(s.includes('transmissionEndpoint=true'));
      assert.ok(s.includes('let tg=transmittedGuide(guide,guideDirection)'));
      assert.ok(s.includes('residualGuide.position,residualGuide.normal'));
      if(name==='trace-pile')assert.ok(s.includes('let boundary=vec2u(u32(attributes[h.id].n0.w),instanceIdentity(h));'));
    }
  }
});
test('reference accumulation averages pixel radiance, not last-sample albedo', async () => {
  const load = (n) => readFile(new URL(n, import.meta.url), 'utf8');
  for (const query of ['backend=signals', 'optics=guides', 'optics=paths']) {
    const parameters = new URLSearchParams(query),
      options = rendererOptions(parameters);
    const trace = await buildRendererShader('trace', {
      load,
      parameters,
      options,
    });
    const reconstruct = await buildRendererShader('reconstruct', {
      load,
      parameters,
      options,
    });
    assert.ok(trace.includes('if(u.flags.y>.5){demod=vec3f(1);}'));
    assert.ok(
      reconstruct.includes(
        'if(u.flags.y>.5&&!moving&&u.size.z>0u){history=readSignal(previous[i],channel);}',
      ),
    );
  }
});
