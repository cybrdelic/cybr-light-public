async (page) => {
  // Raw accumulation must never leak into the user's interactive viewport.
  const owner = page;
  page = await owner.context().newPage();
  try {
    await page.goto(owner.url());
    await owner.bringToFront();
    await page.waitForFunction(() => window.cybrLight?.snapshot().ready, null, {timeout:180000});
    const label = await page.evaluate(
      () => new URL(location.href).searchParams.get("capture") || "noise",
    );
    if (!/^[a-z0-9-]+$/.test(label)) throw Error("Invalid capture label");
    await page.evaluate(async () => {
      window.cybrLight.pause();
      await window.cybrLight.waitIdle();
      document.querySelector("#mode").value = "reference";
      window.cybrLight.reset();
    });
    for (let i = 0; i < 4; i++)
      await page.evaluate(() =>
        window.cybrLight.verifySteps(Array(256).fill(null)),
      );
    await page
      .locator("#viewport")
      .screenshot({ path: `output/playwright/${label}-reference1024.png` });
    return await page.evaluate(() => window.cybrLight.snapshot());
  } finally {
    await page.close();
    await owner.bringToFront();
  }
};
