// @ts-check

const { test, expect } = require("@playwright/test");

test("browser Unix event source dispatches registered file handlers", async ({
  page,
}) => {
  await page.goto("/tcltk.html");
  await expect(page.locator("#tk-browser-status")).toHaveText("running", {
    timeout: 15000,
  });

  const result = await page.evaluate(() => {
    const module =
      /** @type {Window & { Module?: { _TkBrowserTestUnixEventFileHandlers?: Function } }} */ (
        window
      ).Module;
    if (!module?._TkBrowserTestUnixEventFileHandlers) {
      throw new Error("missing Unix event file handler test hook");
    }
    return module._TkBrowserTestUnixEventFileHandlers();
  });

  expect(result).toBe(1);
});
