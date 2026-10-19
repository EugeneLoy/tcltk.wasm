// @ts-check

const { test, expect } = require("@playwright/test");
const { evalTcl, openTkApp } = require("../support/tcltk");

test.use({ viewport: { width: 1440, height: 1000 } });

async function openSample(page, wm = true) {
  await openTkApp(page);
  await expect(page.locator("#tk-window-manager")).toBeChecked();
  if (!wm) await page.locator("#tk-window-manager").uncheck();
  const result = await evalTcl(page, [
    "namespace eval ::fullscreenRegression {variable events {}; variable calls 0}",
    "button .fullscreenProbe -text Probe -command {incr ::fullscreenRegression::calls}",
    "place .fullscreenProbe -x 100 -y 80 -width 130 -height 42",
    "foreach {event name} {<Motion> motion <ButtonPress-1> press <ButtonRelease-1> release} {",
    "  bind all $event [format {lappend ::fullscreenRegression::events [list %s %%W %%X %%Y %%x %%y]} $name]",
    "}",
    ".imeViewport yview moveto 1",
    "update",
    "join [list [winfo id .] [winfo id .fullscreenProbe] [winfo id .imeViewport.content.checks.buttons.fullscreen]] ,",
  ].join("\n"));
  const [client, probe, enter] = String(result).split(",").map(Number);
  const identity = await page.evaluate((id) => {
    const m = /** @type {any} */ (window).Module;
    return { frame: m._X11WasmManagerWindowIdentity(id, 0),
      metadata: m._X11WasmManagerWindowIdentity(id, 1) };
  }, client);
  await page.evaluate(() => {
    const target = /** @type {any} */ (window);
    target.__fullscreenRegressionDOM = [];
    for (const type of ["pointermove", "pointerdown", "pointerup"]) {
      document.addEventListener(type, (event) => {
        const e = /** @type {PointerEvent} */ (event);
        const xid = (node) => node instanceof Element
          ? node.closest("[data-x11-wasm-xid]")?.getAttribute("data-x11-wasm-xid") : null;
        target.__fullscreenRegressionDOM.push({ type, trusted: e.isTrusted,
          client: [e.clientX, e.clientY], target: xid(e.target),
          hit: xid(document.elementFromPoint(e.clientX, e.clientY)) });
      }, true);
    }
  });
  return { client, probe, enter, ...identity };
}

async function geometry(page, ids) {
  const tk = String(await evalTcl(page, "update; " + [
    "join [list [wm attributes . -fullscreen] [wm attributes . -zoomed]",
    "[winfo rootx .] [winfo rooty .] [winfo width .] [winfo height .]] ,",
  ].join(" "))).split(",").map(Number);
  const dom = await page.evaluate((ids) => {
    const b = /** @type {any} */ (window).Module.x11WasmBackend;
    b.flush();
    const rect = (element) => {
      const r = element.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    };
    const resources = Object.fromEntries(["frame", "metadata", "client", "probe"].map((name) => {
      const r = b.resources.get(ids[name]);
      return [name, { id: r.id, parent: r.parent,
        committed: [r.x, r.y, r.width, r.height],
        pending: [r.pendingX, r.pendingY, r.pendingWidth, r.pendingHeight],
        rect: rect(r.element), canvasRect: rect(r.canvas),
        backing: [r.canvas.width, r.canvas.height] }];
    }));
    return { viewport: [innerWidth, innerHeight], resources,
      fullscreen: document.fullscreenElement?.getAttribute("data-x11-wasm-xid") || null,
      rootSize: [b.getRootWidth(), b.getRootHeight()], rootRect: rect(b.rootElement) };
  }, ids);
  return { tk, ...dom };
}

async function settleRoot(page, fullscreen = true) {
  await page.waitForFunction((active) => !!document.fullscreenElement === active, fullscreen);
  await expect.poll(() => page.evaluate((active) => {
    const b = /** @type {any} */ (window).Module.x11WasmBackend;
    b.flush();
    const r = b.rootElement;
    const expected = active ? [innerWidth, innerHeight] : [r.clientWidth, r.clientHeight];
    return [b.getRootWidth(), b.getRootHeight()].every((v, i) => v === expected[i]);
  }, fullscreen)).toBe(true);
}

async function enterSample(page, ids) {
  await evalTcl(page, ".imeViewport yview moveto 1; update");
  await page.locator(`[data-x11-wasm-xid="${ids.enter}"]`).click();
  await settleRoot(page);
  await expect.poll(() => evalTcl(page, "update; wm attributes . -fullscreen")).toBe("1");
}

async function enterFromShell(page) {
  await page.locator("#tcl-command").fill("::imeSample::fullscreenReport enter");
  await page.locator("#tcl-run").click();
  await settleRoot(page);
}

async function exitFullscreen(page) {
  if (await page.evaluate(() => !!document.fullscreenElement)) {
    await page.evaluate(() => document.exitFullscreen());
  }
  await settleRoot(page, false);
  await expect.poll(() => evalTcl(page, "update; wm attributes . -fullscreen")).toBe("0");
}

async function expectFullGeometry(page, ids, records) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("missing fullscreen test viewport");
  await expect.poll(async () => {
    const s = await geometry(page, ids);
    return s.tk.slice(2);
  }).toEqual([0, 0, viewport.width, viewport.height]);
  const s = await geometry(page, ids);
  records.push({ phase: "fullscreen geometry", ...s });
  expect(s.fullscreen).toBe(String(ids.client));
  expect(s.rootSize).toEqual(s.viewport);
  expect(s.tk[0]).toBe(1);
  for (const name of ["frame", "client", "metadata"]) {
    const r = s.resources[name];
    expect(r.committed, name).toEqual([0, 0, ...s.viewport]);
    expect(r.pending, name).toEqual(r.committed);
    expect(r.rect.slice(2), name).toEqual(s.viewport);
    expect(r.canvasRect.slice(2), name).toEqual(s.viewport);
    expect(r.backing, name).toEqual(s.viewport);
  }
  expect(s.resources.client.rect).toEqual([0, 0, ...s.viewport]);
  return s;
}

async function pointer(page, ids, click, records) {
  await evalTcl(page, "set ::fullscreenRegression::events {}; set ::fullscreenRegression::calls 0");
  const point = await page.evaluate((id) => {
    const target = /** @type {any} */ (window);
    target.__fullscreenRegressionDOM = [];
    const e = target.Module.x11WasmBackend.resources.get(id).element;
    const r = e.getBoundingClientRect();
    const x = Math.floor(r.left + r.width / 2), y = Math.floor(r.top + r.height / 2);
    return { x, y, local: [x - r.left, y - r.top],
      hit: e.contains(document.elementFromPoint(x, y)) };
  }, ids.probe);
  await page.mouse.move(point.x - 3, point.y - 2);
  await page.mouse.move(point.x, point.y);
  if (click) await page.mouse.click(point.x, point.y);
  const native = String(await evalTcl(page, "update; " + [
    "join [list $::fullscreenRegression::calls [join $::fullscreenRegression::events {;}]",
    "[winfo pointerx .] [winfo pointery .] [winfo containing [winfo pointerx .] [winfo pointery .]]] |",
  ].join(" "))).split("|");
  const dom = await page.evaluate(() => /** @type {any} */ (window).__fullscreenRegressionDOM);
  const events = native[1].split(";").filter(Boolean).map((line) => line.split(" "));
  const result = { point, calls: Number(native[0]), events,
    nativePointer: native.slice(2), dom, click };
  records.push({ phase: "pointer", ...result });
  return result;
}

function expectPointer(result, ids, fullscreen, click) {
  expect(result.point.hit).toBe(true);
  const moves = result.dom.filter((e) => e.type === "pointermove");
  expect(moves.length).toBeGreaterThan(0);
  for (const event of moves) {
    expect(event).toMatchObject({ target: String(ids.probe), hit: String(ids.probe) });
  }
  expect(result.dom.every((e) => e.trusted)).toBe(true);
  const motion = result.events.filter((e) => e[0] === "motion").at(-1);
  expect(motion?.[1]).toBe(".fullscreenProbe");
  if (fullscreen) {
    const expected = [String(result.point.x), String(result.point.y), ...result.point.local.map(String)];
    expect(motion?.slice(2)).toEqual(expected);
    expect(result.nativePointer).toEqual([String(result.point.x), String(result.point.y), ".fullscreenProbe"]);
    for (const name of click ? ["press", "release"] : []) {
      expect(result.events.find((e) => e[0] === name)).toEqual([name, ".fullscreenProbe", ...expected]);
    }
  }
  if (click) {
    expect(result.calls).toBe(1);
    expect(result.dom.find((e) => e.type === "pointerdown")).toMatchObject({ target: String(ids.probe) });
  }
}

async function recordRun(page, testInfo, run) {
  const records = [];
  try {
    await run(records);
  } finally {
    if (await page.evaluate(() => !!document.fullscreenElement)) {
      await page.evaluate(() => document.exitFullscreen());
    }
    await testInfo.attach("fullscreen-observations", {
      body: JSON.stringify(records, null, 2), contentType: "application/json",
    });
  }
}

for (const wm of [true, false]) {
  test(`sample fullscreen geometry and Motion follow repeated resize with WM ${wm ? "ON" : "OFF"}`, async ({ page }, testInfo) => {
    const ids = await openSample(page, wm);
    await recordRun(page, testInfo, async (records) => {
      const normal = await geometry(page, ids);
      records.push({ phase: "normal", ...normal });
      for (let cycle = 0; cycle < 2; cycle++) {
        await enterSample(page, ids);
        for (const [width, height] of [[1440, 1000], [1280, 820], [1360, 900]]) {
          await page.setViewportSize({ width, height });
          await settleRoot(page);
          await expectFullGeometry(page, ids, records);
          expectPointer(await pointer(page, ids, false, records), ids, true, false);
        }
        await exitFullscreen(page);
        const restored = await geometry(page, ids);
        records.push({ phase: "restored", cycle, ...restored });
        expect(restored.tk).toEqual(normal.tk);
        expect(restored.resources.frame.committed).toEqual(normal.resources.frame.committed);
        expect(restored.resources.client.backing).toEqual(normal.resources.client.backing);
      }
    });
  });

  test(`sample fullscreen clicks deliver root local coordinates and commands with WM ${wm ? "ON" : "OFF"}`, async ({ page }, testInfo) => {
    const ids = await openSample(page, wm);
    await recordRun(page, testInfo, async (records) => {
      expectPointer(await pointer(page, ids, true, records), ids, false, true);
      for (let cycle = 0; cycle < 2; cycle++) {
        await enterSample(page, ids);
        await expectFullGeometry(page, ids, records);
        expectPointer(await pointer(page, ids, true, records), ids, true, true);
        expect(await page.evaluate(() => document.fullscreenElement?.getAttribute("data-x11-wasm-xid")))
          .toBe(String(ids.client));
        await exitFullscreen(page);
        expectPointer(await pointer(page, ids, true, records), ids, false, true);
      }
    });
  });
}

test("sample native fullscreen survives repeated no-op manager raises independently of geometry", async ({ page }, testInfo) => {
  const ids = await openSample(page);
  await recordRun(page, testInfo, async (records) => {
    for (let cycle = 0; cycle < 2; cycle++) {
      await enterSample(page, ids);
      records.push({ phase: "before raise", ...await geometry(page, ids) });
      const result = await pointer(page, ids, true, records);
      expect(result.dom.some((e) => e.type === "pointerdown" && e.trusted)).toBe(true);
      expect(await page.evaluate(() => document.fullscreenElement?.getAttribute("data-x11-wasm-xid")))
        .toBe(String(ids.client));
      await exitFullscreen(page);
    }
  });
});

test("hinted sample preserves normal and zoomed restore geometry across native fullscreen", async ({ page }, testInfo) => {
  const ids = await openSample(page);
  await evalTcl(page, [
    "wm minsize . 20 15", "wm grid . 24 16 8 6", "wm maxsize . 60 40",
    "wm geometry . 32x24+43+71", "update",
  ].join("\n"));
  await recordRun(page, testInfo, async (records) => {
    const normal = await geometry(page, ids);
    records.push({ phase: "hinted normal", ...normal });
    for (const zoomed of [false, true]) {
      if (zoomed) await evalTcl(page, "wm attributes . -zoomed 1; update");
      const before = await geometry(page, ids);
      expect(before.tk[1]).toBe(Number(zoomed));
      await enterFromShell(page);
      for (const [width, height] of [[1440, 1000], [1280, 820], [1440, 1000]]) {
        await page.setViewportSize({ width, height });
        await settleRoot(page);
        await expectFullGeometry(page, ids, records);
        expectPointer(await pointer(page, ids, false, records), ids, true, false);
      }
      await exitFullscreen(page);
      const restored = await geometry(page, ids);
      records.push({ phase: "hinted restore", zoomed, ...restored });
      expect(restored.tk).toEqual(before.tk);
      expect(restored.resources.frame.committed).toEqual(before.resources.frame.committed);
      expect(restored.resources.client.backing).toEqual(before.resources.client.backing);
      if (zoomed) await evalTcl(page, "wm attributes . -zoomed 0; update");
      expect((await geometry(page, ids)).tk).toEqual(normal.tk);
    }
  });
});
