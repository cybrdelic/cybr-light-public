// Offline deterministic VNDF integration of the renderer's separable Smith GGX.
// Coordinates are perceptual roughness and sqrt(N.V), denser near grazing.
export const ENERGY_SIZE = 32;
export function directionalEnergy(mu, roughness, samples = 4096) {
  if (roughness === 0) return 1;
  mu = Math.max(mu, 0.001);
  const alpha = roughness * roughness,
    a2 = alpha * alpha;
  const wx = Math.sqrt(1 - mu * mu),
    len = Math.hypot(alpha * wx, mu),
    vx = (alpha * wx) / len,
    vz = mu / len,
    s = 0.5 * (1 + vz);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    let bits = i,
      inv = 0,
      weight = 0.5;
    while (bits) {
      inv += (bits & 1) * weight;
      weight *= 0.5;
      bits >>>= 1;
    }
    const r = Math.sqrt((i + 0.5) / samples),
      phi = 2 * Math.PI * inv,
      p1 = r * Math.cos(phi);
    const p2 =
        (1 - s) * Math.sqrt(Math.max(0, 1 - p1 * p1)) + s * r * Math.sin(phi),
      pz = Math.sqrt(Math.max(0, 1 - p1 * p1 - p2 * p2));
    const hx = alpha * (-p2 * vz + pz * vx),
      hy = alpha * p1,
      hz = Math.max(0, p2 * vx + pz * vz),
      hl = Math.hypot(hx, hy, hz);
    const dot = (wx * hx + mu * hz) / hl,
      nl = (2 * dot * hz) / hl - mu;
    if (nl > 0) sum += (2 * nl) / (nl + Math.sqrt(a2 + (1 - a2) * nl * nl));
  }
  return sum / samples;
}
export function buildEnergyTable(samples = 4096) {
  const n = ENERGY_SIZE,
    out = [];
  for (let y = 0; y < n; y++) {
    const row = Array.from({ length: n }, (_, x) =>
      directionalEnergy((x / (n - 1)) ** 2, y / (n - 1), samples),
    );
    let avg = 0;
    // Integrate the SAME piecewise-linear lookup reconstruction, not a separate
    // average estimate: this keeps the compensation denominator consistent.
    for (let x = 0; x < n - 1; x++) {
      const a = x / (n - 1),
        b = (x + 1) / (n - 1),
        slope = (row[x + 1] - row[x]) / (b - a);
      avg +=
        row[x] * (b ** 4 - a ** 4) +
        slope * (0.8 * (b ** 5 - a ** 5) - a * (b ** 4 - a ** 4));
    }
    for (const e of row) out.push(+e.toFixed(7), +avg.toFixed(7));
  }
  return out;
}
export function lookupEnergy(table, mu, roughness) {
  const n = ENERGY_SIZE,
    x = Math.sqrt(Math.max(0, Math.min(1, mu))) * (n - 1),
    y = Math.max(0, Math.min(1, roughness)) * (n - 1);
  const ix = Math.min(n - 2, Math.floor(x)),
    iy = Math.min(n - 2, Math.floor(y)),
    fx = x - ix,
    fy = y - iy;
  return [0, 1].map((c) => {
    const a = table[(iy * n + ix) * 2 + c],
      b = table[(iy * n + ix + 1) * 2 + c],
      d = table[((iy + 1) * n + ix) * 2 + c],
      e = table[((iy + 1) * n + ix + 1) * 2 + c];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  });
}
export function packMetalEnergy(portals, table) {
  if (table.length !== ENERGY_SIZE ** 2 * 2 || !table.every(Number.isFinite))
    throw Error('Invalid GGX energy table');
  const out = new Float32Array((2 + ENERGY_SIZE ** 2) * 12);
  if (portals?.length > 24)
    throw Error('Metal energy layout reserves two portal records');
  out.set(portals || [], 0);
  for (let i = 0; i < ENERGY_SIZE ** 2; i++)
    out.set(table.slice(i * 2, i * 2 + 2), (i + 2) * 12);
  return out;
}
