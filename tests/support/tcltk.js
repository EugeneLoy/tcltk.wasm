// @ts-check

const { expect } = require("@playwright/test");
const path = require("node:path");

/**
 * Serve the real sample shell alongside the configured native build artifacts.
 * @param {import("@playwright/test").Page} page
 * @param {string=} script
 */
async function openTkApp(page, script) {
  await page.route("**/app.html*", (route) => route.fulfill({
    path: path.resolve(__dirname, "../../browser/app/app.html"),
    contentType: "text/html",
  }));
  const query = script === undefined ? "" : `?${new URLSearchParams({ eval: script })}`;
  await page.goto(`/app.html${query}`);
  await expect(page.locator("#tcl-run")).toBeEnabled({ timeout: 15000 });
  await page.waitForFunction(() => {
    const target = /** @type {any} */ (window);
    return target.Module.tkBrowserEvalResult !== undefined && !target.Asyncify?.currData;
  });
}

/**
 * Evaluate after a browser action has completed, rather than racing a Tcl timer.
 * @param {import("@playwright/test").Page} page
 * @param {string} script
 */
async function evalTcl(page, script) {
  const result = await page.evaluate(async (source) => {
    const target = /** @type {Window & {
      HEAPU8?: Uint8Array, __tkTestEvalPending?: boolean,
      Asyncify?: { currData?: number | null, whenDone: () => Promise<number> },
      Module?: {
      _malloc?: (size: number) => number, _free?: (pointer: number) => void,
      _TkBrowserEval?: (pointer: number) => number | Promise<number>,
      HEAPU8?: Uint8Array, tkBrowserEvalResult?: string
    } }} */ (window);
    const module = target.Module;
    if (!module?._malloc || !module._free || !module._TkBrowserEval) {
      throw new Error("missing Tcl evaluation hooks");
    }
    if (target.__tkTestEvalPending) {
      throw new Error("Tcl evaluation is already in progress");
    }
    target.__tkTestEvalPending = true;
    let pointer = 0;
    try {
      // Native polling may already own Asyncify's single completion waiter.
      while (target.Asyncify?.currData) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const bytes = new TextEncoder().encode(source);
      pointer = module._malloc(bytes.length + 1);
      if (!pointer) {
        throw new Error("failed to allocate Tcl script");
      }
      const heap = target.HEAPU8 || module.HEAPU8;
      if (!heap) {
        throw new Error("missing Tcl wasm heap");
      }
      heap.set(bytes, pointer);
      heap[pointer + bytes.length] = 0;
      let code = module._TkBrowserEval(pointer);
      if (typeof code !== "number") {
        code = await code;
      } else if (target.Asyncify?.currData) {
        code = await target.Asyncify.whenDone();
      }
      return { code, value: module.tkBrowserEvalResult };
    } finally {
      if (pointer) module._free(pointer);
      target.__tkTestEvalPending = false;
    }
  }, script);
  expect(result.code, result.value).toBe(0);
  return result.value;
}

module.exports = { evalTcl, openTkApp };
