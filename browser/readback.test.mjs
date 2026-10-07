import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readBuffer,
  readFloatBuffer,
  recomposeSignals,
  compareLinear,
} from './readback.mjs';

function mockDevice({ failMap = false, failCopy = false } = {}) {
  globalThis.GPUBufferUsage ??= { COPY_DST: 8, MAP_READ: 1 };
  globalThis.GPUMapMode ??= { READ: 1 };
  const calls = [];
  const staging = {
    async mapAsync() {
      calls.push('map');
      if (failMap) throw Error('map failed');
    },
    getMappedRange() {
      return new Float32Array([1, 2]).buffer;
    },
    unmap() {
      calls.push('unmap');
    },
    destroy() {
      calls.push('destroy');
    },
  };
  const encoder = {
    copyBufferToBuffer(...args) {
      calls.push(args);
      if (failCopy) throw Error('copy failed');
    },
    finish() {
      return 'commands';
    },
  };
  return {
    calls,
    staging,
    device: {
      createBuffer(options) {
        calls.push(options);
        return staging;
      },
      createCommandEncoder() {
        return encoder;
      },
      queue: {
        submit() {
          calls.push('submit');
        },
      },
    },
  };
}

test('GPU readback copies only the requested range and returns independent storage', async () => {
  const { device, calls, staging } = mockDevice();
  const source = { size: 24 };
  const result = await readFloatBuffer(device, source, { offset: 8, size: 8 });
  assert.deepEqual([...result], [1, 2]);
  assert.deepEqual(calls[1], [source, 8, staging, 0, 8]);
  assert.deepEqual(calls.slice(-2), ['unmap', 'destroy']);
});

test('GPU readback destroys staging storage after map or submission setup failure', async () => {
  for (const failure of [{ failMap: true }, { failCopy: true }]) {
    const { device, calls } = mockDevice(failure);
    await assert.rejects(readBuffer(device, { size: 8 }), /failed/);
    assert.equal(calls.at(-1), 'destroy');
    assert.ok(!calls.includes('unmap'));
  }
});

test('invalid GPU readback ranges fail before allocation', async () => {
  for (const range of [
    { offset: -4 },
    { offset: 2 },
    { size: 3 },
    { size: 0 },
    { offset: 8, size: 12 },
    { offset: NaN },
  ]) {
    const { device, calls } = mockDevice();
    await assert.rejects(readBuffer(device, { size: 16 }, range), /range/);
    assert.equal(calls.length, 0);
  }
});
test('direct and indirect diffuse remodulate once; specular/transmission do not', () => {
  const c = new Float32Array([
    1, 2, 3, 1, 4, 5, 6, 1, 7, 8, 9, 1, 10, 11, 12, 1,
  ]);
  assert.deepEqual(
    [...recomposeSignals(c, new Float32Array([0.5, 0.25, 1, 1]), 1)],
    [16.5, 16.25, 30],
  );
});
test('readback shape mismatches and nonfinite radiance cannot silently pass', () => {
  assert.throws(
    () => recomposeSignals(new Float32Array(12), new Float32Array(4), 1),
    /ABI/,
  );
  assert.equal(compareLinear([NaN, 1], [0, 1]).nonfinite, 1);
  assert.throws(() => compareLinear([1], [1, 2]), /dimensions/);
});
