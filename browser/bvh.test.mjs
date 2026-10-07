import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBVH } from "./bvh.mjs";

for (const shape of ["grid", "coincident", "long-thin"])
  test("SAH retains and contains every triangle: " + shape, () => {
    const count = 2000,
      bounds = new Float32Array(count * 6),
      centers = new Float32Array(count * 3);
    for (let i = 0; i < count; i++)
      for (let k = 0; k < 3; k++) {
        const c =
          shape === "coincident"
            ? 0
            : shape === "long-thin"
              ? k === 0
                ? i * 0.01
                : 0
              : ((i * (k * 7 + 3)) % 107) * 0.013;
        bounds[i * 6 + k] = c - 0.005;
        bounds[i * 6 + k + 3] = c + 0.005;
        centers[i * 3 + k] = c;
      }
    const bvh = buildBVH(bounds, centers, count),
      f = new Float32Array(bvh.buffer),
      u = new Uint32Array(bvh.buffer);
    assert.equal(new Set(bvh.ids).size, count);
    assert.ok(bvh.maxDepth < 63);
    const visited = new Set(),
      covered = new Set();
    function inspect(index) {
      assert.ok(index < bvh.nodeCount);
      assert.ok(!visited.has(index));
      visited.add(index);
      const o = index * 12,
        n = u[o + 11];
      if (n) {
        for (let j = u[o + 10]; j < u[o + 10] + n; j++) {
          assert.ok(!covered.has(j));
          covered.add(j);
          const id = bvh.ids[j];
          for (let k = 0; k < 3; k++) {
            assert.ok(f[o + k] <= bounds[id * 6 + k]);
            assert.ok(f[o + 4 + k] >= bounds[id * 6 + k + 3]);
          }
        }
      } else
        for (const child of [u[o + 8], u[o + 9]]) {
          for (let k = 0; k < 3; k++) {
            assert.ok(f[o + k] <= f[child * 12 + k]);
            assert.ok(f[o + 4 + k] >= f[child * 12 + 4 + k]);
          }
          inspect(child);
        }
    }
    inspect(0);
    assert.equal(covered.size, count);
    assert.equal(visited.size, bvh.nodeCount);
  });
test("reject empty geometry", () =>
  assert.throws(
    () => buildBVH(new Float32Array(), new Float32Array(), 0),
    /Empty/,
  ));
