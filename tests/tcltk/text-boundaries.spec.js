// @ts-check

const { test, expect } = require("@playwright/test");

test("Tk browser backend retains generic monospace advances", async ({ page }) => {
  await page.goto("/tcltk.html");
  await expect(page.locator("#tk-browser-status")).toHaveText("running", {
    timeout: 15000,
  });
  const [narrow, wide] = await page.evaluate(() => {
    const backend = /** @type {any} */ (window).Module.x11WasmBackend;
    return [
      backend.measureText(32, "monospace", "i"),
      backend.measureText(32, "monospace", "W"),
    ];
  });
  expect(narrow).toBeGreaterThan(0);
  expect(wide).toBe(narrow);
});

