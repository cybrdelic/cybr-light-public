// Explicit diagnostics only. Never called by the animation loop.
export async function readBuffer(
  device,
  source,
  { offset = 0, size = source.size - offset } = {},
) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(size) ||
    offset < 0 ||
    size <= 0 ||
    offset % 4 ||
    size % 4 ||
    offset + size > source.size
  ) {
    throw Error('Invalid GPU readback range');
  }
  const staging = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  let mapped = false;
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, offset, staging, 0, size);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    mapped = true;
    return staging.getMappedRange().slice(0);
  } finally {
    if (mapped) staging.unmap();
    staging.destroy();
  }
}

export async function readFloatBuffer(device, source, range) {
  return new Float32Array(await readBuffer(device, source, range));
}
export function recomposeSignals(colors, modulation, count) {
  if (colors.length !== count * 16 || modulation.length !== count * 4)
    throw Error('Four-signal readback ABI mismatch');
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 3; k++)
      out[i * 3 + k] =
        (colors[i * 4 + k] + colors[(i + count * 3) * 4 + k]) *
          modulation[i * 4 + k] +
        colors[(i + count) * 4 + k] +
        colors[(i + count * 2) * 4 + k];
  return out;
}
export function compareLinear(a, b) {
  if (a.length !== b.length) throw Error('Image dimensions differ');
  let nonfinite = 0,
    maxAbsolute = 0,
    squared = 0,
    energy = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      nonfinite++;
      continue;
    }
    const d = a[i] - b[i];
    maxAbsolute = Math.max(maxAbsolute, Math.abs(d));
    squared += d * d;
    energy += a[i] * a[i];
  }
  return {
    values: a.length,
    nonfinite,
    maxAbsolute,
    rmse: Math.sqrt(squared / a.length),
    relativeRMSE: Math.sqrt(squared / Math.max(energy, 1e-20)),
  };
}

// colors[0] is spatial ping-pong storage after filtering, not a temporal capture.
// Read the unfiltered reconstructed RGB from the history ABI. Alpha is unused.
export function temporalColors(history, count, stride, separated) {
  if (history.length !== count * stride || stride < (separated ? 48 : 24))
    throw Error('Temporal readback ABI mismatch');
  const offsets = separated ? [0, 4, 8, 40] : [0],
    out = new Float32Array(count * offsets.length * 4);
  for (let c = 0; c < offsets.length; c++)
    for (let i = 0; i < count; i++)
      for (let k = 0; k < 3; k++)
        out[(c * count + i) * 4 + k] = history[i * stride + offsets[c] + k];
  return out;
}
