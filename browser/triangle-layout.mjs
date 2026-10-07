// Keep frequently traversed positions apart from attributes needed only at hits.
// No precision reduction, vertex removal, or change to the BVH leaf ordering.
export function packTriangles(source, order) {
  if (source.length !== order.length * 36)
    throw Error("Invalid triangle payload length");
  const geometry = new Float32Array(order.length * 12),
    attributes = new Float32Array(order.length * 24);
  for (let i = 0; i < order.length; i++) {
    const start = order[i] * 36;
    if (start + 36 > source.length) throw Error("Invalid triangle permutation");
    geometry.set(source.subarray(start, start + 12), i * 12);
    attributes.set(source.subarray(start + 12, start + 36), i * 24);
  }
  return { geometry, attributes };
}
