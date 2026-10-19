// @ts-check

const { expect } = require("@playwright/test");

async function openTextPage(page, script) {
  await page.addInitScript(() => {
    const fills = [];
    const rectangles = [];
    const prototypes = [CanvasRenderingContext2D.prototype];
    if (typeof OffscreenCanvasRenderingContext2D !== "undefined") {
      prototypes.push(OffscreenCanvasRenderingContext2D.prototype);
    }
    for (const prototype of prototypes) {
      const fillText = prototype.fillText;
      const fillRect = prototype.fillRect;
      prototype.fillText = function (text, x, y, ...rest) {
        fills.push({ text, x, y, font: this.font });
        return fillText.call(this, text, x, y, ...rest);
      };
      prototype.fillRect = function (x, y, width, height) {
        rectangles.push({ x, y, width, height, color: String(this.fillStyle) });
        return fillRect.call(this, x, y, width, height);
      };
    }
    window.__textOracle = { fills, rectangles };
  });
  const query = new URLSearchParams({ eval: `catch {destroy .root}\n${script}` });
  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  return (await page.locator("#tk-browser-result").textContent()) || "";
}

async function evalText(page, script) {
  const { code, result, serial } = await page.evaluate(async (source) => {
    const module = window.Module;
    const oracle = window.__textOracle;
    const serial = oracle.serial = (oracle.serial || 0) + 1;
    const quoted = source.replace(/[\\$"\[]/g, "\\$&");
    const wrapped = `set ::textOracleLastResult [uplevel #0 "${quoted}"]\n`
      + `set ::textOracleLastResult "${serial}\\n$::textOracleLastResult"`;
    const bytes = new TextEncoder().encode(`${wrapped}\0`);
    const pointer = module._malloc(bytes.length);
    try {
      window.HEAPU8.set(bytes, pointer);
      let code = module._TkBrowserEval(pointer);
      if (code && typeof code.then === "function") {
        code = await code;
      } else if (window.Asyncify?.currData) {
        // A direct Emscripten export can unwind poll(0) with a numeric return.
        code = await window.Asyncify.whenDone();
      }
      return { code, result: module.tkBrowserEvalResult, serial };
    } finally {
      module._free(pointer);
    }
  }, script);
  expect(code, result).toBe(0);
  expect(result.startsWith(`${serial}\n`), `fresh Tcl evaluation serial ${serial}: ${result}`).toBe(true);
  return result.slice(String(serial).length + 1);
}

async function drawnTextRun(page, text) {
  return page.evaluate(async (prefix) => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    window.Module.x11WasmBackend.flush();
    const fills = window.__textOracle.fills;
    // The marker's actual origin is independent of every measurement API.
    for (let start = fills.length - 1; start >= 0; start--) {
      let joined = "";
      for (let end = start; end < fills.length; end++) {
        const call = fills[end];
        if (call.font !== fills[start].font || call.y !== fills[start].y) break;
        if (joined === prefix && call.text === "|") {
          return {
            x: fills[start].x,
            y: fills[start].y,
            advance: call.x - fills[start].x,
            font: call.font,
            glyphs: fills.slice(start, end).map((fill) => ({
              text: fill.text, x: fill.x - fills[start].x,
            })),
          };
        }
        joined += call.text;
        if (!`${prefix}|`.startsWith(joined)) break;
      }
    }
    throw new Error(`missing fillText run ${JSON.stringify(`${prefix}|`)}: ${JSON.stringify(fills.slice(-20))}`);
  }, text);
}

async function pixelBounds(page, id, color = "ink") {
  return page.locator(`[data-x11-wasm-xid="${id}"] > canvas`).evaluate(
    (canvas, wanted) => {
      window.Module.x11WasmBackend.flush();
      const context = canvas.getContext("2d");
      if (!context) throw new Error("missing text canvas context");
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
      let count = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const offset = (y * canvas.width + x) * 4;
          const [r, g, b, a] = data.subarray(offset, offset + 4);
          const match = wanted === "green"
            ? g > 200 && r < 50 && b < 50 && a > 200
            : wanted === "magenta"
              ? r === 255 && g === 0 && b === 255 && a > 200
              : r < 80 && g < 80 && b < 80 && a > 200;
          if (match) {
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
            count++;
          }
        }
      }
      return { left, top, right, bottom, count, width: right - left + 1 };
    }, color,
  );
}

async function measureTextProbe(page, requests) {
  return page.evaluate((cases) => {
    const module = window.Module;
    if (typeof module._TkBrowserTestMeasureChars !== "function") {
      throw new Error("missing test-only Tk_MeasureChars export; relink the browser harness");
    }
    const pointers = [];
    const copy = (value) => {
      const bytes = new TextEncoder().encode(`${value}\0`);
      const pointer = module._malloc(bytes.length);
      pointers.push(pointer);
      window.HEAPU8.set(bytes, pointer);
      return pointer;
    };
    const font = copy("Helvetica -32");
    try {
      return cases.map(({ variable = "value", start = 0, length = -1,
        max = -1, flags = 0, context = false }) => {
        const code = module._TkBrowserTestMeasureChars(font, copy(variable),
          start, length, max, flags, context ? 1 : 0);
        if (code !== 0) throw new Error(`Tk measurement probe failed: ${code}`);
        const result = document.querySelector("#tk-browser-result").textContent;
        return result.trim().split(/\s+/).map(Number);
      });
    } finally {
      for (const pointer of pointers) module._free(pointer);
    }
  }, requests);
}

module.exports = { openTextPage, evalText, drawnTextRun, pixelBounds, measureTextProbe };
