async (page) => {
  await page.waitForFunction(() => window.cybrLight?.snapshot().ready, null, {
    timeout: 120000,
  });
  return page.evaluate(() => window.cybrLight.verifyRecomposition(32));
};
