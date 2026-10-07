// Area × emitted luminance selection; .p.w is CDF, .e1.w is PMF.
// Both direct-light sampling and BSDF-hit MIS must use this same PMF.
export function weightEmitters(lights) {
  const weights = [];
  let total = 0;
  for (let q = 0; q < lights.length; q += 16) {
    const ax=lights[q+4], ay=lights[q+5], az=lights[q+6];
    const bx=lights[q+8], by=lights[q+9], bz=lights[q+10];
    const area = Math.hypot(ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx);
    const power = Math.max(0, .2126*lights[q+12]+.7152*lights[q+13]+.0722*lights[q+14]);
    const weight = area * power;
    weights.push(weight); total += weight;
  }
  let cdf=0;
  weights.forEach((w,i) => {
    const pmf=total>0?w/total:1/weights.length;
    cdf+=pmf;
    lights[i*16+3]=i===weights.length-1?1:cdf;
    lights[i*16+7]=pmf;
  });
  return lights;
}
