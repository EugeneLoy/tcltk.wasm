// @ts-check

const { test, expect } = require("@playwright/test");

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
    .locator(`[data-x11-wasm-xid="${first.id}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing grid label canvas");
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

test("Tk font metrics scale with requested size", async ({ page }) => {
  const script = [
    "set small [font create -family Helvetica -size 12]",
    "set large [font create -family Helvetica -size 24]",
    "set smallWidth [font measure $small 000000]",
    "set largeWidth [font measure $large 000000]",
    "set narrowWidth [font measure $small iiiiii]",
    "set wideWidth [font measure $small WWWWWW]",
    "set smallLine [font metrics $small -linespace]",
    "set largeLine [font metrics $large -linespace]",
    [
      "list ready $smallWidth $largeWidth",
      "[expr {$largeWidth > $smallWidth}] $narrowWidth $wideWidth",
      "[expr {$wideWidth > $narrowWidth}] $smallLine $largeLine",
      "[expr {$largeLine > $smallLine}]",
    ].join(" "),
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split(/\s+/);

  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toHaveLength(
    10,
  );
  expect(result[0]).toBe("ready");
  expect(Number(result[1])).toBeGreaterThan(0);
  expect(Number(result[2])).toBeGreaterThan(Number(result[1]));
  expect(result[3]).toBe("1");
  expect(Number(result[4])).toBeGreaterThan(0);
  expect(Number(result[5])).toBeGreaterThan(Number(result[4]));
  expect(result[6]).toBe("1");
  expect(Number(result[7])).toBeGreaterThan(0);
  expect(Number(result[8])).toBeGreaterThan(Number(result[7]));
  expect(result[9]).toBe("1");
});

test("Tk font families expose browser fallback fonts", async ({ page }) => {
  const script = [
    "set families [font families]",
    "set lower {}",
    "foreach family $families {lappend lower [string tolower $family]}",
    [
      "list ready [expr {[llength $families] >= 4}]",
      "[expr {[lsearch -exact $lower fixed] >= 0}]",
      "[expr {[lsearch -exact $lower helvetica] >= 0}]",
      "[expr {[lsearch -exact $lower courier] >= 0}]",
    ].join(" "),
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split(/\s+/);

  expect(result).toEqual(["ready", "1", "1", "1", "1"]);
});

test("Tk visual lookup rejects unavailable visual ids", async ({ page }) => {
  const script = [
    "set visuals [winfo visualsavailable . includeids]",
    "set code [catch {frame .bad -visual 2147483647} msg]",
    "list ready $code [string match {*appropriate visual*} $msg] [llength $visuals]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split(/\s+/);

  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toHaveLength(4);
  expect(result[0]).toBe("ready");
  expect(result[1]).toBe("1");
  expect(result[2]).toBe("1");
  expect(Number(result[3])).toBeGreaterThan(0);
});

test("Tk canvas text honors requested font size", async ({ page }) => {
  const script = [
    "pack [canvas .c -width 240 -height 96 -background white]",
    ".c create text 12 34 -anchor w -text Text -font {Helvetica 10} -fill black",
    ".c create text 112 76 -anchor w -text Text -font {Helvetica 36} -fill black",
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
    .locator(`[data-x11-wasm-xid="${canvasId}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing canvas element");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing canvas context");
      }
      /**
       * @param {{ x: number, y: number, width: number, height: number }} rect
       */
      const measureDarkBounds = (rect) => {
        const data = context.getImageData(
          rect.x,
          rect.y,
          rect.width,
          rect.height,
        ).data;
        let count = 0;
        let top = rect.height;
        let bottom = -1;
        for (let offset = 0; offset < data.length; offset += 4) {
          const row = Math.floor(offset / 4 / rect.width);
          if (
            data[offset + 3] > 0 &&
            data[offset] < 160 &&
            data[offset + 1] < 160 &&
            data[offset + 2] < 160
          ) {
            count++;
            top = Math.min(top, row);
            bottom = Math.max(bottom, row);
          }
        }
        return { count, height: bottom >= top ? bottom - top + 1 : 0 };
      };

      return {
        small: measureDarkBounds({ x: 0, y: 0, width: 96, height: 54 }),
        large: measureDarkBounds({ x: 96, y: 20, width: 140, height: 76 }),
      };
    });

  expect(samples.small.count).toBeGreaterThan(10);
  expect(samples.large.count).toBeGreaterThan(samples.small.count * 2);
  expect(samples.large.height).toBeGreaterThan(samples.small.height * 1.6);
});

test("Tk angled canvas text keeps its glyph clip mask", async ({ page }) => {
  const script = [
    "pack [canvas .c -width 180 -height 130 -background white]",
    ".c create text 42 92 -anchor w -text Tilt -font {Helvetica 28} -angle 45 -fill black",
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

  const sample = await page
    .locator(`[data-x11-wasm-xid="${canvasId}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing canvas element");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing canvas context");
      }
      const rect = { x: 25, y: 20, width: 110, height: 90 };
      const data = context.getImageData(
        rect.x,
        rect.y,
        rect.width,
        rect.height,
      ).data;
      let dark = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        if (
          data[offset + 3] > 0 &&
          data[offset] < 80 &&
          data[offset + 1] < 80 &&
          data[offset + 2] < 80
        ) {
          dark++;
        }
      }
      return { dark, area: rect.width * rect.height };
    });

  expect(sample.dark).toBeGreaterThan(40);
  expect(sample.dark).toBeLessThan(sample.area * 0.22);
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
    .locator(`[data-x11-wasm-xid="${canvasId}"] > canvas`)
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

test("Tk canvas applies GC line width and dash style", async ({ page }) => {
  const script = [
    "pack [canvas .c -width 140 -height 48 -background white]",
    ".c create line 10 24 130 24 -fill #ff0000 -width 6 -dash {10 10}",
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
    .locator(`[data-x11-wasm-xid="${canvasId}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing canvas element");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing canvas context");
      }
      /**
       * @param {{ x: number, y: number, width: number, height: number }} rect
       */
      const countRed = (rect) => {
        const data = context.getImageData(
          rect.x,
          rect.y,
          rect.width,
          rect.height,
        ).data;
        let count = 0;
        for (let offset = 0; offset < data.length; offset += 4) {
          if (
            data[offset] > 180 &&
            data[offset + 1] < 80 &&
            data[offset + 2] < 80 &&
            data[offset + 3] === 255
          ) {
            count++;
          }
        }
        return count;
      };
      return {
        firstDash: countRed({ x: 12, y: 21, width: 6, height: 6 }),
        firstGap: countRed({ x: 24, y: 21, width: 6, height: 6 }),
      };
    });

  expect(samples.firstDash).toBeGreaterThan(20);
  expect(samples.firstGap).toBeLessThan(6);
});

test("Tk canvas applies asymmetric GC dash patterns", async ({ page }) => {
  const script = [
    "pack [canvas .c -width 160 -height 48 -background white]",
    ".c create line 10 24 150 24 -fill #ff0000 -width 6 -dash {20 5 5 5}",
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
    .locator(`[data-x11-wasm-xid="${canvasId}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing canvas element");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing canvas context");
      }
      /**
       * @param {{ x: number, y: number, width: number, height: number }} rect
       */
      const countRed = (rect) => {
        const data = context.getImageData(
          rect.x,
          rect.y,
          rect.width,
          rect.height,
        ).data;
        let count = 0;
        for (let offset = 0; offset < data.length; offset += 4) {
          if (
            data[offset] > 180 &&
            data[offset + 1] < 80 &&
            data[offset + 2] < 80 &&
            data[offset + 3] === 255
          ) {
            count++;
          }
        }
        return count;
      };
      return {
        longDash: countRed({ x: 14, y: 21, width: 8, height: 6 }),
        firstGap: countRed({ x: 31, y: 21, width: 3, height: 6 }),
        shortDash: countRed({ x: 36, y: 21, width: 3, height: 6 }),
        secondGap: countRed({ x: 42, y: 21, width: 3, height: 6 }),
      };
    });

  expect(samples.longDash).toBeGreaterThan(28);
  expect(samples.firstGap).toBeLessThan(4);
  expect(samples.shortDash).toBeGreaterThan(8);
  expect(samples.secondGap).toBeLessThan(4);
});

test("Tk canvas applies stippled fill style", async ({ page }) => {
  const script = [
    "pack [canvas .c -width 84 -height 64 -background white]",
    ".c create rectangle 10 10 74 54 -fill #ff0000 -outline {} -stipple gray50",
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
    .locator(`[data-x11-wasm-xid="${canvasId}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing canvas element");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing canvas context");
      }
      const data = context.getImageData(12, 12, 56, 36).data;
      let red = 0;
      let white = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        if (
          data[offset] > 180 &&
          data[offset + 1] < 80 &&
          data[offset + 2] < 80 &&
          data[offset + 3] === 255
        ) {
          red++;
        } else if (
          data[offset] > 220 &&
          data[offset + 1] > 220 &&
          data[offset + 2] > 220 &&
          data[offset + 3] === 255
        ) {
          white++;
        }
      }
      return { red, white };
    });

  expect(samples.red).toBeGreaterThan(400);
  expect(samples.red).toBeLessThan(1600);
  expect(samples.white).toBeGreaterThan(400);
});

test("Tk canvas draws oval arcs and filled polygons", async ({ page }) => {
  const script = [
    "pack [canvas .c -width 240 -height 120 -background white]",
    ".c create oval 10 10 70 70 -fill #00ff00 -outline {}",
    ".c create oval 90 10 150 70 -outline blue -width 3",
    ".c create polygon 170 10 225 35 185 80 -fill #ff00ff -outline {}",
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
    .locator(`[data-x11-wasm-xid="${canvasId}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing canvas element");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing 2d context");
      }
      /**
       * @param {{ x: number, y: number, width: number, height: number }} rect
       * @param {(r: number, g: number, b: number, a: number) => boolean} matches
       */
      const countMatchingPixels = (rect, matches) => {
        const data = context.getImageData(
          rect.x,
          rect.y,
          rect.width,
          rect.height,
        ).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (matches(data[i], data[i + 1], data[i + 2], data[i + 3])) {
            count++;
          }
        }
        return count;
      };

      return {
        greenPixels: countMatchingPixels(
          { x: 28, y: 28, width: 24, height: 24 },
          (r, g, b, a) => a === 255 && r < 80 && g > 180 && b < 80,
        ),
        blueOutlinePixels: countMatchingPixels(
          { x: 88, y: 30, width: 10, height: 24 },
          (r, g, b, a) => a > 0 && r < 80 && g < 120 && b > 150,
        ),
        magentaPixels: countMatchingPixels(
          { x: 186, y: 28, width: 28, height: 24 },
          (r, g, b, a) => a === 255 && r > 180 && g < 80 && b > 180,
        ),
      };
    });

  expect(samples.greenPixels).toBeGreaterThan(200);
  expect(samples.blueOutlinePixels).toBeGreaterThan(8);
  expect(samples.magentaPixels).toBeGreaterThan(100);
});

test("Tk canvas draws built-in bitmap items with foreground color", async ({
  page,
}) => {
  const script = [
    "pack [canvas .c -width 64 -height 64 -background white]",
    ".c create bitmap 32 32 -bitmap gray50 -foreground #ff0000",
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

  const redPixelCount = await page
    .locator(`[data-x11-wasm-xid="${canvasId}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing canvas element");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing canvas context");
      }
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        if (
          data[offset] > 180 &&
          data[offset + 1] < 80 &&
          data[offset + 2] < 80 &&
          data[offset + 3] === 255
        ) {
          count++;
        }
      }
      return count;
    });

  expect(redPixelCount).toBeGreaterThan(8);
});

test("Tk canvas draws browser native bitmap aliases", async ({ page }) => {
  const script = [
    "pack [canvas .c -width 100 -height 44 -background white]",
    ".c create bitmap 18 22 -bitmap stop -foreground #ff0000",
    ".c create bitmap 50 22 -bitmap note -foreground #0000ff",
    ".c create bitmap 82 22 -bitmap caution -foreground #00ff00",
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

  const colorCounts = await page
    .locator(`[data-x11-wasm-xid="${canvasId}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing canvas element");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing canvas context");
      }
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = { red: 0, blue: 0, green: 0 };
      for (let offset = 0; offset < data.length; offset += 4) {
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const alpha = data[offset + 3];

        if (alpha !== 255) {
          continue;
        }
        if (red > 180 && green < 80 && blue < 80) {
          counts.red++;
        } else if (red < 80 && green < 80 && blue > 180) {
          counts.blue++;
        } else if (red < 80 && green > 180 && blue < 80) {
          counts.green++;
        }
      }
      return counts;
    });

  expect(colorCounts.red).toBeGreaterThan(20);
  expect(colorCounts.blue).toBeGreaterThan(8);
  expect(colorCounts.green).toBeGreaterThan(8);
});

test("Tk bitmap images apply separate clip masks and background color", async ({
  page,
}) => {
  const bitmapData = [
    "#define sample_width 4",
    "#define sample_height 1",
    "static unsigned char sample_bits[] = { 0x05 };",
  ].join("\n");
  const maskData = [
    "#define sample_width 4",
    "#define sample_height 1",
    "static unsigned char sample_bits[] = { 0x03 };",
  ].join("\n");
  const script = [
    `set bitmapData {${bitmapData}}`,
    `set maskData {${maskData}}`,
    "image create bitmap sample -data $bitmapData -maskdata $maskData -foreground #ff0000 -background #0000ff",
    "pack [canvas .c -width 12 -height 8 -background white]",
    ".c create image 2 2 -image sample -anchor nw",
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
    .locator(`[data-x11-wasm-xid="${canvasId}"] > canvas`)
    .evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing canvas element");
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing canvas context");
      }
      const pixel = (x, y) => Array.from(context.getImageData(x, y, 1, 1).data);
      return {
        red: pixel(2, 2),
        blue: pixel(3, 2),
        maskedOut: pixel(4, 2),
      };
    });

  expect(samples.red[0]).toBeGreaterThan(180);
  expect(samples.red[1]).toBeLessThan(80);
  expect(samples.red[2]).toBeLessThan(80);
  expect(samples.red[3]).toBe(255);
  expect(samples.blue[0]).toBeLessThan(80);
  expect(samples.blue[1]).toBeLessThan(80);
  expect(samples.blue[2]).toBeGreaterThan(180);
  expect(samples.blue[3]).toBe(255);
  expect(samples.maskedOut[0]).toBeGreaterThan(220);
  expect(samples.maskedOut[1]).toBeGreaterThan(220);
  expect(samples.maskedOut[2]).toBeGreaterThan(220);
  expect(samples.maskedOut[3]).toBe(255);
});
