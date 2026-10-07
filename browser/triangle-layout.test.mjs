import { test } from "node:test";
import assert from "node:assert/strict";
import { packTriangles } from "./triangle-layout.mjs";
test("split storage preserves every FP32 attribute and the leaf permutation", () => {
  const source = Float32Array.from({ length: 108 }, (_, i) => (i - 54) / 13);
  const order = new Uint32Array([2, 0, 1]);
  const { geometry, attributes } = packTriangles(source, order);
  assert.equal(geometry.byteLength, 3 * 48);
  assert.equal(attributes.byteLength, 3 * 96);
  for (let i = 0; i < 3; i++)
    assert.deepEqual(
      [
        ...geometry.slice(i * 12, (i + 1) * 12),
        ...attributes.slice(i * 24, (i + 1) * 24),
      ],
      Array.from(source.slice(order[i] * 36, (order[i] + 1) * 36)),
    );
});
test("invalid triangle payloads are rejected", () => {
  assert.throws(() =>
    packTriangles(new Float32Array(12), new Uint32Array([0])),
  );
  assert.throws(() =>
    packTriangles(new Float32Array(36), new Uint32Array([1])),
  );
});
