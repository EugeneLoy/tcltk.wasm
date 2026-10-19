// @ts-check

const { test, expect } = require("@playwright/test");

async function evalTcl(page, script) {
  return page.evaluate(async (script) => {
    const global = /** @type {any} */ (window);
    const module = global.Module;
    while (global.Asyncify?.currData) await new Promise((resolve) => setTimeout(resolve, 0));
    const bytes = new TextEncoder().encode(script + "\0");
    const pointer = module._malloc(bytes.length);
    global.HEAPU8.set(bytes, pointer);
    try {
      const result = module._TkBrowserEval(pointer);
      const code = result?.then ? await result : global.Asyncify?.currData
        ? await global.Asyncify.whenDone() : result;
      if (code !== 0) throw new Error(module.tkBrowserEvalResult);
      return String(module.tkBrowserEvalResult);
    } finally {
      module._free(pointer);
    }
  }, script);
}

test("Tk continuous manager resize survives redraw pixmap allocation and disposal", async ({ page }, testInfo) => {
  const script = "wm geometry . 320x220+40+60; entry .input; pack .input; update; winfo id .";
  await page.goto(`/tcltk.html?${new URLSearchParams({ eval: script })}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok");
  const client = Number(await page.locator("#tk-browser-result").textContent());
  const frame = await page.evaluate((client) => {
    const global = /** @type {any} */ (window);
    const module = global.Module;
    const backend = module.x11WasmBackend;
    const frame = module._X11WasmManagerWindowIdentity(client, 0);
    backend.setWindowManagerEnabled(true);
    backend.flush();
    const lifecycle = [];
    global.managerPixmapLifecycle = lifecycle;
    const create = backend.createPixmap;
    backend.createPixmap = function (id, ...args) {
      const result = create.call(this, id, ...args);
      const resource = this.resources.get(id);
      if (this.stackingResourceFor(resource).id === frame) {
        lifecycle.push({ action: "create", id, gesture: this.managerGesture?.id === frame });
      }
      return result;
    };
    const destroy = backend.destroyResource;
    backend.destroyResource = function (id) {
      const resource = this.resources.get(id);
      if (resource?.kind === "pixmap" && this.stackingResourceFor(resource).id === frame) {
        lifecycle.push({ action: "destroy", id, gesture: this.managerGesture?.id === frame });
      }
      return destroy.call(this, id);
    };
    return frame;
  }, client);
  expect(frame).toBeGreaterThan(0);
  const edge = await page.locator(
    `[data-x11-wasm-frame="${frame}"] [data-x11-wasm-decoration="resize-se"]`,
  ).boundingBox();
  if (!edge) throw new Error("missing resize handle");
  const x = edge.x + edge.width / 2;
  const y = edge.y + edge.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y + 16, { steps: 4 });
  const retained = await page.evaluate((frame) => {
    const gesture = /** @type {any} */ (window).Module.x11WasmBackend.managerGesture;
    return gesture?.id === frame && gesture.capture.hasPointerCapture(gesture.pointerId);
  }, frame);
  await page.mouse.up();
  const geometry = await evalTcl(page, "update; wm geometry .");
  const lifecycle = await page.evaluate(() => /** @type {any} */ (window).managerPixmapLifecycle);
  await testInfo.attach("pixmap-resize", {
    body: JSON.stringify({ geometry, retained, lifecycle }, null, 2), contentType: "application/json",
  });
  expect(geometry).toBe("344x236+40+60");
  expect(retained).toBe(true);
  const created = new Set(lifecycle.filter((event) => event.action === "create" && event.gesture)
    .map((event) => event.id));
  expect(lifecycle.some((event) => event.action === "destroy" && event.gesture && created.has(event.id)))
    .toBe(true);
});
