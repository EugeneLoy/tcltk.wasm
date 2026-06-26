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

test("TkpSync transfers browser X events through the Tk event queue", async ({
  page,
}) => {
  await page.goto("/tcltk.html");
  await expect(page.locator("#tk-browser-status")).toHaveText("running", {
    timeout: 15000,
  });

  const result = await page.evaluate(() => {
    const module =
      /** @type {Window & { Module?: { _TkBrowserTestTkpSyncTransfersBrowserEvents?: Function } }} */ (
        window
      ).Module;
    if (!module?._TkBrowserTestTkpSyncTransfersBrowserEvents) {
      throw new Error("missing TkpSync browser event transfer test hook");
    }
    return module._TkBrowserTestTkpSyncTransfersBrowserEvents();
  });

  expect(result).toBe(1);
});
