async (page) => {
  await page.waitForFunction(() => window.cybrLight?.snapshot().ready, null, {
    timeout: 120000,
  });
  const results = [];
  for (const variant of [
    "legacy",
    "history",
    "energy",
    "energy",
    "history",
    "legacy",
  ]) {
    const result = await page.evaluate(async (variant) => {
      const api = window.cybrLight;
      await api.verifyOptions({
        legacyHistory: variant === "legacy",
        legacySampler: variant !== "energy",
      });
      api.setCamera(0.62, 0.3, 6.2);
      await api.verifySteps(Array(32).fill(null));
      const start = api.snapshot();
      const end = await api.verifySteps(
        Array.from({ length: 96 }, (_, i) => [
          0.62 + Math.sin(((i + 1) * Math.PI) / 48) * 0.1,
          0.3,
          6.2,
        ]),
      );
      return {
        variant,
        traceGpuMs: end.traceGpuMs,
        gpuFrameMs: end.gpuFrameMs,
        errors: end.errors,
        scene: end.scene,
      };
    }, variant);
    results.push(result);
  }
  return results;
};
