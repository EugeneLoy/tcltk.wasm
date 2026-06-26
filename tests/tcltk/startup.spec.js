// @ts-check

const { test, expect } = require("@playwright/test");

test("Tcl/Tk browser harness reaches running state", async ({ page }) => {
  await page.goto("/tcltk.html");
  await expect(page.locator("#tk-browser-status")).toHaveText("running", {
    timeout: 15000,
  });
  await expect(page.locator("#tk-browser-root")).toHaveClass(/x11-wasm-root/);
  await expect(page.locator("#tk-browser-root > canvas")).toHaveCount(1);
  expect(
    await page.locator("#tk-browser-root .x11-wasm-window").count(),
  ).toBeGreaterThan(0);
});

test("Tk startup options are separated from browser eval scripts", async ({
  page,
}) => {
  const script = [
    "update idletasks",
    "if {[info exists geometry]} {set parsedGeometry $geometry} else {set parsedGeometry {}}",
    "join [list ready $argc [llength $argv] [lindex $argv 0] [lindex $argv 1] $parsedGeometry [wm geometry .]] |",
  ].join("\n");
  const query = new URLSearchParams();
  query.append("argv", "-geometry");
  query.append("argv", "120x80+11+13");
  query.append("argv", "app-one");
  query.append("arg", "app two");
  query.set("eval", script);

  await page.goto(`/tcltk.html?${query.toString()}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual([
    "ready",
    "2",
    "2",
    "app-one",
    "app two",
    "120x80+11+13",
    "120x80+11+13",
  ]);
});

test("URL eval scripts are not swallowed by application argv separator", async ({
  page,
}) => {
  const query = new URLSearchParams();
  query.append("argv", "--");
  query.append("arg", "literal");
  query.append("eval", "set ::urlEvalOrder first");
  query.append("eval", "list ready $::urlEvalOrder $argc [join $argv ,]");

  await page.goto(`/tcltk.html?${query.toString()}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result).toEqual(["ready", "first", "1", "literal"]);
});

test("Tk busy creates an InputOnly browser window without canvas", async ({
  page,
}) => {
  const script = [
    "frame .target -width 90 -height 50 -background white",
    "pack .target",
    "update",
    "tk busy hold .target",
    "update",
    "list ready [tk busy status .target] [winfo id .target_Busy] [winfo id .target]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result[0]).toBe("ready");
  expect(result[1]).toBe("1");
  const busyId = Number.parseInt(result[2], 0);
  const targetId = Number.parseInt(result[3], 0);
  expect(busyId).toBeGreaterThan(0);
  expect(targetId).toBeGreaterThan(0);

  const snapshot = await page.evaluate(async (busyId) => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot & { flush?: Function } } }} */ (
        window
      ).Module?.x11WasmBackend;
    backend?.flush?.();
    const resource = backend?.resources.get(busyId);
    const element = document.querySelector(`[data-x11-wasm-xid="${busyId}"]`);
    return {
      kind: resource?.kind,
      mapped: resource?.mapped,
      windowClass: resource?.windowClass,
      hasCanvas: !!resource?.canvas,
      childCanvasCount: element?.querySelectorAll("canvas").length ?? -1,
      className: element instanceof HTMLElement ? element.className : "",
      classAttr:
        element instanceof HTMLElement
          ? element.getAttribute("data-x11-wasm-window-class") || ""
          : "",
      display: element instanceof HTMLElement ? element.style.display : "",
      width: resource?.width,
      height: resource?.height,
    };
  }, busyId);

  expect(snapshot).toEqual({
    kind: "window",
    mapped: true,
    windowClass: 2,
    hasCanvas: false,
    childCanvasCount: 0,
    className: "x11-wasm-window x11-wasm-input-only",
    classAttr: "2",
    display: "",
    width: 90,
    height: 50,
  });
});

test("Tk screen dimensions follow browser root element size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 840, height: 620 });
  const script = [
    "proc ::reportScreen {} {",
    "  browser::setResult [list ready [winfo screenwidth .] [winfo screenheight .]]",
    "}",
    "after 250 ::reportScreen",
    "list waiting",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  await page.setViewportSize({ width: 760, height: 560 });
  await expect
    .poll(async () => (await page.locator("#tk-browser-result").textContent()) || "")
    .toMatch(/^ready /);

  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split(/\s+/);
  expect(result).toEqual(["ready", expect.any(String), expect.any(String)]);
  const screenWidth = Number.parseInt(result[1], 10);
  const screenHeight = Number.parseInt(result[2], 10);
  expect(screenWidth).toBeGreaterThan(0);
  expect(screenHeight).toBeGreaterThan(0);

  const rootState = await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const root = document.getElementById("tk-browser-root");
    const canvas = root?.querySelector(":scope > canvas");
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot & { rootWindow?: number } } }} */ (
        window
      ).Module?.x11WasmBackend;
    if (!root || !(canvas instanceof HTMLCanvasElement) || !backend) {
      throw new Error("missing browser root state");
    }
    backend.flush();
    const resource = backend.resources.get(backend.rootWindow || 0);
    return {
      clientWidth: root.clientWidth,
      clientHeight: root.clientHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      resourceWidth: resource?.width,
      resourceHeight: resource?.height,
    };
  });
  expect(rootState).toEqual({
    clientWidth: screenWidth,
    clientHeight: screenHeight,
    canvasWidth: screenWidth,
    canvasHeight: screenHeight,
    resourceWidth: screenWidth,
    resourceHeight: screenHeight,
  });
});

test("Tk geometry manager reports requested and actual label size", async ({
  page,
}) => {
  const script = [
    "label .l -text {hello}",
    "pack .l",
    "update idletasks",
    "list [winfo reqwidth .l] [winfo reqheight .l] [winfo width .l] [winfo height .l] [winfo id .l]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  const readGeometry = async () => {
    const result = (
      (await page.locator("#tk-browser-result").textContent()) || ""
    ).trim();
    const values = result.split(/\s+/).map((value) => Number(value));
    expect(values, `unexpected Tcl result: ${result}`).toHaveLength(5);
    const [reqWidth, reqHeight, width, height, id] = values;
    expect(reqWidth, `unexpected Tcl result: ${result}`).toBeGreaterThan(0);
    expect(reqHeight, `unexpected Tcl result: ${result}`).toBeGreaterThan(0);
    expect(width, `unexpected Tcl result: ${result}`).toBeGreaterThan(0);
    expect(height, `unexpected Tcl result: ${result}`).toBeGreaterThan(0);
    expect(id, `unexpected Tcl result: ${result}`).toBeGreaterThan(0);
    return { values: [reqWidth, reqHeight, width, height], id, width, height };
  };

  const first = await readGeometry();
  const domSize = await page
    .locator(`[data-x11-wasm-xid="${first.id}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing label canvas");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      return { width: canvas.width, height: canvas.height };
    });
  expect(domSize).toEqual({ width: first.width, height: first.height });

  await page.reload();
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  expect((await readGeometry()).values).toEqual(first.values);
});
