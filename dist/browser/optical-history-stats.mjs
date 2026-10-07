// Readback-only diagnostics; no cost in the render loop.
export function opticalHistoryStats(data, stride = 56) {
  if (![56, 68].includes(stride) || data.length % stride)
    throw Error('Expected optical Signals ABI');
  const result = {};
  for (const [name, color, position, normal] of [
    ['reflection', 4, 48, 52],
    ['transmission', 8, 32, 36],
    ...(stride === 68 ? [['internalReflection', 40, 56, 60]] : []),
  ]) {
    let active = 0,
      guided = 0,
      reused = 0,
      samples = 0;
    for (let i = 0; i < data.length; i += stride) {
      if (name === 'internalReflection' && data[i + 19] !== 0) continue;
      if (data[i + color] + data[i + color + 1] + data[i + color + 2] <= 1e-8)
        continue;
      active++;
      if (data[i + normal + 3] > 0.5 && Number.isFinite(data[i + position])) {
        guided++;
        samples += data[i + color + 3];
        if (data[i + color + 3] > 1.01) reused++;
      }
    }
    result[name] = {
      active,
      guided,
      reused,
      guideFraction: guided / Math.max(active, 1),
      reuseFraction: reused / Math.max(guided, 1),
      meanGuidedSamples: samples / Math.max(guided, 1),
    };
  }
  return result;
}
