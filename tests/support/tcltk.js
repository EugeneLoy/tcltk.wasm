// @ts-check

const { expect } = require("@playwright/test");

/**
 * Evaluate after a browser action has completed, rather than racing a Tcl timer.
 * @param {import("@playwright/test").Page} page
 * @param {string} script
 */
async function evalTcl(page, script) {
  const result = await page.evaluate(async (source) => {
    const target = /** @type {Window & { HEAPU8?: Uint8Array, Module?: {
      _malloc?: (size: number) => number, _free?: (pointer: number) => void,
      _TkBrowserEval?: (pointer: number) => number | Promise<number>,
      HEAPU8?: Uint8Array, tkBrowserEvalResult?: string
    } }} */ (window);
    const module = target.Module;
    if (!module?._malloc || !module._free || !module._TkBrowserEval) {
      throw new Error("missing Tcl evaluation hooks");
    }
    const bytes = new TextEncoder().encode(source);
    const pointer = module._malloc(bytes.length + 1);
    if (!pointer) {
      throw new Error("failed to allocate Tcl script");
    }
    try {
      const heap = target.HEAPU8 || module.HEAPU8;
      if (!heap) {
        throw new Error("missing Tcl wasm heap");
      }
      heap.set(bytes, pointer);
      heap[pointer + bytes.length] = 0;
      const code = await module._TkBrowserEval(pointer);
      return { code, value: module.tkBrowserEvalResult };
    } finally {
      module._free(pointer);
    }
  }, script);
  expect(result.code, result.value).toBe(0);
  return result.value;
}

module.exports = { evalTcl };
