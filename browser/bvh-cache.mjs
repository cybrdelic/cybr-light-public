import { buildBVH } from './bvh.mjs';

// Bounded per-worker LRU, validated against exact geometry rather than a hash.
export function createBVHCache(maxBytes = 256 * 1024 * 1024) {
  const entries = new Map();
  let bytes = 0,
    hits = 0,
    misses = 0;
  const equal = (a, b) =>
    a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    build(key, bounds, centers, count, leafSize = 6, priority = 0) {
      const old = entries.get(key);
      if (
        old &&
        old.count === count &&
        old.leafSize === leafSize &&
        equal(old.bounds, bounds) &&
        equal(old.centers, centers)
      ) {
        hits++;
        entries.delete(key);
        entries.set(key, old);
        return old.result;
      }
      misses++;
      if (old) {
        bytes -= old.bytes;
        entries.delete(key);
      }
      const result = buildBVH(bounds, centers, count, leafSize);
      const size =
        bounds.byteLength +
        centers.byteLength +
        result.buffer.byteLength +
        result.ids.byteLength;
      if (size <= maxBytes) {
        while (bytes + size > maxBytes) {
          const victim = [...entries]
            .filter(([, entry]) => entry.priority <= priority)
            .sort((a, b) => a[1].priority - b[1].priority)[0];
          if (!victim) break;
          bytes -= victim[1].bytes;
          entries.delete(victim[0]);
        }
        if (bytes + size <= maxBytes) {
          entries.set(key, {
            bounds: bounds.slice(),
            centers: centers.slice(),
            count,
            leafSize,
            result,
            bytes: size,
            priority,
          });
          bytes += size;
        }
      }
      return result;
    },
    stats: () => ({ bytes, maxBytes, entries: entries.size, hits, misses }),
    clear() {
      entries.clear();
      bytes = 0;
    },
  };
}
