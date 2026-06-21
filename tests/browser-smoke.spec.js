// @ts-check

const { test, expect } = require("@playwright/test");

/**
 * @typedef {object} TkBrowserResourceSnapshot
 * @property {"root" | "window" | "pixmap"} kind
 * @property {boolean} mapped
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} pendingX
 * @property {number} pendingY
 * @property {number} pendingWidth
 * @property {number} pendingHeight
 * @property {boolean} pendingMapped
 * @property {HTMLElement | null} element
 * @property {HTMLCanvasElement | OffscreenCanvas | null} canvas
 */

/**
 * @typedef {object} TkBrowserBackendSnapshot
 * @property {Map<number, TkBrowserResourceSnapshot>} resources
 * @property {Set<TkBrowserResourceSnapshot>} dirtyResources
 * @property {boolean} flushScheduled
 * @property {() => void} flush
 */

test("browser harness reaches a terminal startup state", async ({ page }) => {
  /** @type {string[]} */
  const consoleMessages = [];
  /** @type {string[]} */
  const pageErrors = [];

  page.on("console", (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message);
  });

  await page.goto("/tcltk.html");
  const status = page.locator("#tk-browser-status");
  try {
    await expect(status).not.toHaveText("loading", { timeout: 15000 });
  } catch (error) {
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        "Console messages:",
        ...consoleMessages,
        "Page errors:",
        ...pageErrors,
      ].join("\n"),
    );
  }

  const statusText = (await status.textContent()) || "";
  expect(pageErrors, consoleMessages.join("\n")).toEqual([]);
  expect(statusText, consoleMessages.join("\n")).toBe("running");
  await expect(page.locator("#tk-browser-root")).toHaveClass(/tk-browser-root/);
  await expect(page.locator("#tk-browser-root > canvas")).toHaveCount(1);
  expect(
    await page.locator("#tk-browser-root .tk-browser-window").count(),
  ).toBeGreaterThan(0);
  const backendState = await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const backend =
      /** @type {Window & { Module?: { tkBrowserBackend?: TkBrowserBackendSnapshot } }} */ (
        window
      ).Module?.tkBrowserBackend;
    if (!backend) {
      throw new Error("missing Tk browser backend");
    }
    backend.flush();
    const resources = Array.from(backend.resources.values());
    const mappedWindows = resources.filter(
      (resource) => resource.kind === "window" && resource.mapped,
    );
    return {
      dirtyCount: backend.dirtyResources.size,
      flushScheduled: backend.flushScheduled,
      mappedWindowCount: mappedWindows.length,
      pendingMismatchCount: resources.filter(
        (resource) =>
          resource.x !== resource.pendingX ||
          resource.y !== resource.pendingY ||
          resource.width !== resource.pendingWidth ||
          resource.height !== resource.pendingHeight ||
          resource.mapped !== resource.pendingMapped,
      ).length,
      geometryMismatchCount: mappedWindows.filter(
        (resource) =>
          !resource.element ||
          resource.element.style.display === "none" ||
          !resource.canvas ||
          resource.canvas.width !== resource.width ||
          resource.canvas.height !== resource.height,
      ).length,
    };
  });
  expect(backendState.mappedWindowCount).toBeGreaterThan(0);
  expect(backendState.pendingMismatchCount).toBe(0);
  expect(backendState.geometryMismatchCount).toBe(0);
  expect(backendState.dirtyCount).toBe(0);
  expect(backendState.flushScheduled).toBe(false);

  await page.locator("#tk-browser-root").click({ position: { x: 40, y: 72 } });
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains("tk-browser-input"),
  );
  await page.keyboard.type("abc");
  await expect(status).toHaveText("input:abc");

  await page.evaluate(() => {
    const input = document.querySelector(".tk-browser-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    input.value = "";
    input.dispatchEvent(
      new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "",
      }),
    );
    input.dispatchEvent(
      new CompositionEvent("compositionupdate", {
        bubbles: true,
        data: "\u3042",
      }),
    );
  });
  await expect(status).toHaveText("preedit:\u3042");

  await page.evaluate(() => {
    const input = document.querySelector(".tk-browser-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    input.value = "\u3042";
    input.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "\u3042",
      }),
    );
  });
  await expect(status).toHaveText("input:abc\u3042");
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
    .locator(`[data-tk-xid="${first.id}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing label canvas");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { tkBrowserBackend?: TkBrowserBackendSnapshot } }} */ (
          window
        ).Module?.tkBrowserBackend;
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

test("Tk grid propagates requested and actual label size", async ({ page }) => {
  const script = [
    "frame .f",
    "label .f.l -text {hello}",
    "grid .f.l",
    "pack .f",
    "update idletasks",
    "list [winfo reqwidth .f.l] [winfo reqheight .f.l] [winfo width .f.l] [winfo height .f.l] [winfo reqwidth .f] [winfo reqheight .f] [winfo width .f] [winfo height .f] [winfo id .f.l]",
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
    expect(values, `unexpected Tcl result: ${result}`).toHaveLength(9);
    const [
      reqWidth,
      reqHeight,
      width,
      height,
      frameReqWidth,
      frameReqHeight,
      frameWidth,
      frameHeight,
      id,
    ] = values;
    for (const value of [
      reqWidth,
      reqHeight,
      width,
      height,
      frameReqWidth,
      frameReqHeight,
      frameWidth,
      frameHeight,
      id,
    ]) {
      expect(value, `unexpected Tcl result: ${result}`).toBeGreaterThan(0);
    }
    return {
      values: values.slice(0, 8),
      id,
      width,
      height,
    };
  };

  const first = await readGeometry();
  const domSize = await page
    .locator(`[data-tk-xid="${first.id}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing grid label canvas");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { tkBrowserBackend?: TkBrowserBackendSnapshot } }} */ (
          window
        ).Module?.tkBrowserBackend;
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

test("Tk canvas draws rectangle, line, and text", async ({ page }) => {
  const script = [
    "pack [canvas .c -width 200 -height 100 -background white]",
    ".c create rectangle 10 10 80 60 -fill red",
    ".c create line 0 0 200 100",
    ".c create text 100 50 -text {Tk/Wasm}",
    "update",
    "winfo id .c",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const canvasId = Number.parseInt(
    ((await page.locator("#tk-browser-result").textContent()) || "").trim(),
    0,
  );
  expect(canvasId).toBeGreaterThan(0);

  const samples = await page
    .locator(`[data-tk-xid="${canvasId}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing canvas element");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing 2d context");
      }
      /** @param {number} x @param {number} y */
      const pixel = (x, y) => {
        const data = context.getImageData(x, y, 1, 1).data;
        return Array.from(data);
      };
      const textData = context.getImageData(68, 35, 70, 28).data;
      let darkTextPixels = 0;
      for (let i = 0; i < textData.length; i += 4) {
        const r = textData[i];
        const g = textData[i + 1];
        const b = textData[i + 2];
        const a = textData[i + 3];
        const x = (i / 4) % 70;
        const y = Math.floor(i / 4 / 70);
        const onDiagonal = Math.abs(35 + y - (68 + x) / 2) <= 1;
        if (!onDiagonal && a > 0 && r < 80 && g < 80 && b < 80) {
          darkTextPixels++;
        }
      }
      return {
        red: pixel(20, 40),
        line: pixel(180, 90),
        darkTextPixels,
      };
    });

  expect(samples.red[0]).toBeGreaterThan(180);
  expect(samples.red[1]).toBeLessThan(80);
  expect(samples.red[2]).toBeLessThan(80);
  expect(samples.red[3]).toBe(255);
  expect(samples.line[0]).toBeLessThan(80);
  expect(samples.line[1]).toBeLessThan(80);
  expect(samples.line[2]).toBeLessThan(80);
  expect(samples.line[3]).toBe(255);
  expect(samples.darkTextPixels).toBeGreaterThan(20);
});

test("DOM input is delivered through Tk window events", async ({ page }) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .target -width 160 -height 120 -background white",
    "pack .target",
    "update idletasks",
    "bind .target <Enter> {::record [list enter %x %y %X %Y %s]}",
    "bind .target <Leave> {::record [list leave %x %y %X %Y %s]}",
    "bind .target <FocusIn> {::record [list focusin]}",
    "bind .target <FocusOut> {::record [list focusout]}",
    "bind .target <ButtonPress-1> {::record [list button %b %x %y %X %Y %s]}",
    "bind .target <KeyPress> {::record [list key %K %k %A %s]}",
    "bind .target <KeyRelease> {::record [list keyrelease %K %k %A %s]}",
    "bind .target <MouseWheel> {::record [list wheel %D %x %y %s]}",
    "list ready [winfo id .target]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(ready[0], `unexpected Tcl result: ${ready.join(" ")}`).toBe("ready");
  const targetId = Number.parseInt(ready[1], 0);
  expect(targetId, `unexpected target window id: ${ready[1]}`).toBeGreaterThan(
    0,
  );

  const status = page.locator("#tk-browser-status");
  const target = page.locator(`[data-tk-xid="${targetId}"]`);
  await target.hover({ position: { x: 4, y: 5 } });
  await expect(status).toHaveText(/enter \d+ \d+ \d+ \d+ 0/);

  await target.click({ position: { x: 4, y: 5 } });
  await expect(status).toContainText(/button 1 \d+ \d+ \d+ \d+ 0/);
  await page.evaluate(() => {
    const input = document.querySelector(".tk-browser-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    input.focus();
    input.dispatchEvent(new FocusEvent("focus"));
  });
  await expect(status).toContainText("focusin");
  await page.evaluate(() => {
    const input = document.querySelector(".tk-browser-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    for (const type of ["keydown", "keyup"]) {
      input.dispatchEvent(
        new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
        }),
      );
    }
  });
  await expect(status).toContainText("key Return 13");
  await expect(status).toContainText("keyrelease Return 13");

  await page.mouse.wheel(0, 100);
  await expect(status).toContainText(/wheel -120 \d+ \d+ 0/);

  await page.mouse.move(220, 5);
  await expect(status).toContainText("leave");
  await page.evaluate(() => {
    const input = document.querySelector(".tk-browser-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    input.blur();
    input.dispatchEvent(new FocusEvent("blur"));
  });
  await expect(status).toContainText("focusout");
});

test("root hit-test follows Tk stacking order and mapped visibility", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .bottom -width 80 -height 60 -background white",
    "frame .top -width 80 -height 60 -background black",
    "place .bottom -x 20 -y 20 -width 80 -height 60",
    "place .top -x 20 -y 20 -width 80 -height 60",
    "bind .bottom <ButtonPress-1> {::record [list bottom %x %y %X %Y]; lower .bottom; update idletasks}",
    "bind .top <ButtonPress-1> {::record [list top %x %y %X %Y]; place forget .top; update idletasks}",
    "raise .bottom",
    "update idletasks",
    "list ready [winfo id .bottom] [winfo id .top]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  const status = page.locator("#tk-browser-status");
  const root = page.locator("#tk-browser-root");
  const readEvents = async () =>
    ((await status.textContent()) || "")
      .split("|")
      .filter((event) => /^(bottom|top) /.test(event));
  /** @param {number} index @param {"bottom" | "top"} name */
  const expectHit = async (index, name) => {
    await expect
      .poll(async () => (await readEvents()).length)
      .toBeGreaterThan(index);
    const events = await readEvents();
    const match = events[index].match(/^(bottom|top) (\d+) (\d+) (\d+) (\d+)$/);
    expect(match, `unexpected event: ${events[index]}`).not.toBeNull();
    if (!match) {
      return;
    }
    expect(match[1]).toBe(name);
    expect(Number(match[4]) - Number(match[2])).toBe(20);
    expect(Number(match[5]) - Number(match[3])).toBe(20);
  };

  await root.click({ position: { x: 30, y: 30 } });
  await expectHit(0, "bottom");

  await root.click({ position: { x: 30, y: 30 } });
  await expectHit(1, "top");

  await root.click({ position: { x: 30, y: 30 } });
  await expectHit(2, "bottom");
});

test("pointer grab retargets DOM pointer events through Tk", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .grab -width 80 -height 60 -background white",
    "frame .outside -width 80 -height 60 -background black",
    "pack .grab .outside -side left",
    "update idletasks",
    "bind .grab <ButtonPress-1> {::record [list grab-button %b %x %y %X %Y %s]}",
    "bind .grab <MouseWheel> {::record [list grab-wheel %D %x %y %s]}",
    "grab set .grab",
    "list ready [winfo id .grab] [winfo id .outside]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(ready[0], `unexpected Tcl result: ${ready.join(" ")}`).toBe("ready");
  const outsideId = Number.parseInt(ready[2], 0);
  expect(
    outsideId,
    `unexpected outside window id: ${ready[2]}`,
  ).toBeGreaterThan(0);

  const status = page.locator("#tk-browser-status");
  const outside = page.locator(`[data-tk-xid="${outsideId}"]`);
  await outside.click({ position: { x: 8, y: 9 } });
  await expect(status).toContainText(/grab-button 1 \d+ \d+ \d+ \d+ 0/);

  await outside.hover({ position: { x: 8, y: 9 } });
  await page.mouse.wheel(0, 100);
  await expect(status).toContainText(/grab-wheel -120 \d+ \d+ 0/);
});

test("DOM pointer capture keeps pointer sequence on press window", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .capture -width 80 -height 60 -background white",
    "frame .outside -width 80 -height 60 -background black",
    "pack .capture .outside -side left",
    "update idletasks",
    "bind .capture <ButtonPress-1> {::record [list capture-button %b %x %y]}",
    "bind .capture <B1-Motion> {::record [list capture-motion %x %y %s]}",
    "bind .capture <ButtonRelease-1> {::record [list capture-release %b %x %y]}",
    "list ready [winfo id .capture]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(ready[0], `unexpected Tcl result: ${ready.join(" ")}`).toBe("ready");
  const captureId = Number.parseInt(ready[1], 0);
  expect(
    captureId,
    `unexpected capture window id: ${ready[1]}`,
  ).toBeGreaterThan(0);

  const status = page.locator("#tk-browser-status");
  const capture = page.locator(`[data-tk-xid="${captureId}"]`);
  const box = await capture.boundingBox();
  if (!box) {
    throw new Error("missing capture window box");
  }
  await page.mouse.move(box.x + 8, box.y + 9);
  await page.mouse.down();
  await expect(status).toContainText(/capture-button 1 \d+ \d+/);

  await page.mouse.move(box.x + 100, box.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect(status).toContainText(/capture-motion \d+ \d+/);
  await expect(status).toContainText(/capture-release 1 \d+ \d+/);
  const events = ((await status.textContent()) || "").split("|");
  const motions = events.filter((event) => event.startsWith("capture-motion "));
  const motion = motions[motions.length - 1];
  const release = events.find((event) => event.startsWith("capture-release "));
  expect(motion, `unexpected events: ${events.join("|")}`).toBeTruthy();
  expect(release, `unexpected events: ${events.join("|")}`).toBeTruthy();
  const motionX = Number(motion?.split(/\s+/)[1]);
  const releaseX = Number(release?.split(/\s+/)[2]);
  expect(motionX).toBeGreaterThan(80);
  expect(releaseX).toBeGreaterThan(80);
});
