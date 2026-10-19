// @ts-check

const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { evalTcl } = require("../support/tcltk");

async function serveApp(page) {
  await page.route("**/app.html*", (route) => route.fulfill({
    path: path.resolve(__dirname, "../../browser/app/app.html"),
    contentType: "text/html",
  }));
}

async function openFakeApp(page, withBackend) {
  await page.addInitScript((withBackend) => {
    const target = /** @type {any} */ (window);
    const state = {
      scripts: /** @type {string[]} */ ([]),
      toggles: /** @type {boolean[]} */ ([]),
      postRuns: 0, optIn: false,
    };
    target.__wmFake = state;
    const module = {
      HEAPU8: new Uint8Array(65536),
      _malloc: () => 8,
      _free: () => {},
      postRun: () => { state.postRuns++; },
      _TkBrowserEval: (pointer) => {
        const end = module.HEAPU8.indexOf(0, pointer);
        state.scripts.push(new TextDecoder().decode(module.HEAPU8.subarray(pointer, end)));
        module.tkBrowserEvalResult = "fake eval result";
        return 0;
      },
    };
    if (withBackend) {
      module.x11WasmBackend = {
        setWindowManagerEnabled: (enabled) => { state.toggles.push(enabled); },
      };
    }
    target.Module = module;
  }, withBackend);
  await page.route("**/tcltk.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: "window.__wmFake.optIn = Module.x11WasmWindowManager; Module.postRun.forEach(callback => callback());",
  }));
  await serveApp(page);
  const query = new URLSearchParams();
  query.append("eval", "set ::wmQuery first");
  query.append("eval", "list $::wmQuery");
  query.append("argv", "--");
  query.append("arg", "literal");
  await page.goto(`/app.html?${query}`);
  await expect(page.locator("#tcl-run")).toBeEnabled();
}

test.describe("sample configuration", () => {
  test("sample opts in before startup without replacing query scripts or hooks", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openFakeApp(page, false);
    const state = await page.evaluate(() => {
      const target = /** @type {any} */ (window);
      return {
        ...target.__wmFake,
        startup: target.Module.tkBrowserEvalScripts,
        arguments: target.Module.arguments,
      };
    });
    expect(state).toEqual({
      scripts: [], toggles: [], postRuns: 1, optIn: true,
      startup: ["set ::wmQuery first", "list $::wmQuery"],
      arguments: ["--", "literal"],
    });
    await expect(page.locator("#tk-window-manager")).toBeDisabled();
    await expect(page.locator("#tk-window-manager")).not.toBeChecked();
    await expect(page.locator("#tcl-wm-sample")).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test("sample checkbox passes strict booleans to the runtime toggle", async ({ page }) => {
    await openFakeApp(page, true);
    const toggle = page.locator("#tk-window-manager");
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await toggle.check();
    await toggle.uncheck();
    expect(await page.evaluate(() => /** @type {any} */ (window).__wmFake.toggles))
      .toEqual([false, true, false]);
  });

  test("sample windows are created only by an explicit button action", async ({ page }) => {
    await openFakeApp(page, false);
    expect(await page.evaluate(() => /** @type {any} */ (window).__wmFake.scripts)).toEqual([]);
    await page.locator("#tcl-wm-sample").click();
    await expect(page.locator("#tcl-wm-sample")).toBeEnabled();
    const scripts = await page.evaluate(() => /** @type {any} */ (window).__wmFake.scripts);
    expect(scripts).toHaveLength(1);
    for (const source of ["proc ::wmSample::open", "proc ::wmSample::close",
      ".wmNormal", ".wmDialog", ".wmUtility", ".wmTransient", ".wmPopup",
      "WM_DELETE_WINDOW", "wm minsize", "wm maxsize", "wm aspect", "wm grid",
      "wm resizable", "wm overrideredirect"]) {
      expect(scripts[0]).toContain(source);
    }
    await expect(page.locator("#tcl-shell-output")).toContainText("= fake eval result");
  });
});

async function openApp(page, script) {
  await serveApp(page);
  const query = script === undefined ? "" : `?${new URLSearchParams({ eval: script })}`;
  await page.goto(`/app.html${query}`);
  await expect(page.locator("#tcl-run")).toBeEnabled({ timeout: 15000 });
  await page.waitForFunction(() => {
    const target = /** @type {any} */ (window);
    return target.Module.tkBrowserEvalResult !== undefined && !target.Asyncify?.currData;
  });
  await expect(page.locator("#tk-window-manager")).toBeEnabled();
  await expect(page.locator("#tk-window-manager")).toBeChecked();
}

async function openInputWindow(page) {
  await openApp(page, [
    "catch {destroy .root}",
    "wm title . {Integration window}",
    "wm geometry . 320x220+40+60",
    "entry .input -width 20",
    "pack .input -padx 12 -pady 12",
    "focus -force .input",
    "update",
    "list ready",
  ].join("\n"));
  const ids = ((await evalTcl(page, "join [list [winfo id .] [winfo id .input] [wm frame .]] ,")) || "").split(",").map(Number);
  const identity = await page.evaluate((clientId) => {
    const query = /** @type {any} */ (window).Module._X11WasmManagerWindowIdentity;
    return [0, 1, 2].map((field) => query(clientId, field));
  }, ids[0]);
  const [frameId, metadataId, protocolId] = identity;
  expect(frameId).toBeGreaterThan(0);
  expect(metadataId).toBe(ids[0]);
  expect(protocolId).toBe(frameId);
  expect(ids[2]).toBe(ids[0]);
  const frame = page.locator(`[data-x11-wasm-frame="${frameId}"]`);
  await expect(frame).toBeVisible();
  return { clientId: ids[0], inputId: ids[1], frameId, frame };
}

async function frameGeometry(page, frameId) {
  const state = await page.evaluate((id) => {
    const backend = /** @type {any} */ (window).Module.x11WasmBackend;
    backend.flush();
    const resource = backend.resources.get(id);
    const rect = resource.element.getBoundingClientRect();
    const root = backend.rootElement.getBoundingClientRect();
    return {
      resource: [resource.x, resource.y, resource.width, resource.height],
      dom: [rect.left - root.left - backend.rootElement.clientLeft,
        rect.top - root.top - backend.rootElement.clientTop,
        rect.width - resource.borderWidth * 2, rect.height - resource.borderWidth * 2],
    };
  }, frameId);
  const native = ((await evalTcl(page,
    "update; join [list [winfo rootx .] [winfo rooty .] [winfo width .] [winfo height .]] ,")) || "")
    .split(",").map(Number);
  expect(state.resource).toEqual(native);
  return { ...state, native };
}

async function drag(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + Math.min(40, box.width / 2);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

async function canvasInk(page, id) {
  return page.locator(`[data-x11-wasm-xid="${id}"] > canvas`).evaluate((element) => {
    const canvas = /** @type {HTMLCanvasElement} */ (element);
    /** @type {any} */ (window).Module.x11WasmBackend.flush();
    const context = canvas.getContext("2d");
    if (!context) throw new Error("missing native Tk canvas context");
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset] < 100 && data[offset + 1] < 100 && data[offset + 2] < 100 && data[offset + 3] > 200) ink++;
    }
    return ink;
  });
}

test.describe("native integration", () => {
  test("decorated Tk input remains native and paints pixels", async ({ page }) => {
    const { frameId, inputId } = await openInputWindow(page);
    await page.locator(`[data-x11-wasm-xid="${inputId}"]`).click();
    await page.keyboard.type("native input");
    await expect.poll(() => evalTcl(page, "update; .input get")).toBe("native input");
    const geometry = await frameGeometry(page, frameId);
    expect(geometry.dom).toEqual(geometry.native);
    expect(await canvasInk(page, inputId)).toBeGreaterThan(20);
  });

  test("sample exposes hints and routes refused and accepted native close requests", async ({ page }) => {
    await openApp(page, "set ::querySeed preserved");
    expect(await evalTcl(page, "info exists ::wmSample::windows")).toBe("0");
    await page.locator("#tcl-wm-sample").click();
    await expect(page.locator("#tcl-wm-sample")).toBeEnabled();
    await expect(page.locator("#tk-browser-result")).toHaveText(/^wm-sample /);
    const ids = ((await evalTcl(page,
      "join [lmap window $::wmSample::windows {winfo id $window}] ,")) || "").split(",").map(Number);
    const frames = await page.evaluate((ids) => {
      const module = /** @type {any} */ (window).Module;
      module.x11WasmBackend.flush();
      return ids.map((id) => module._X11WasmManagerWindowIdentity(id, 0));
    }, ids);
    for (const id of frames.slice(0, 4)) {
      await expect(page.locator(`[data-x11-wasm-frame="${id}"]`)).toBeVisible();
    }
    await expect(page.locator(`[data-x11-wasm-xid="${ids[4]}"]`)).toBeVisible();
    await expect(page.locator(`[data-x11-wasm-frame]:has([data-x11-wasm-xid="${ids[4]}"])`)).toHaveCount(0);
    expect(await evalTcl(page, [
      "join [list [wm minsize .wmNormal] [wm maxsize .wmNormal] [wm aspect .wmNormal]",
      "[wm resizable .wmNormal] [wm resizable .wmDialog] [wm resizable .wmUtility]",
      "[wm grid .wmTransient] [wm overrideredirect .wmPopup] $::querySeed] |",
    ].join(" "))).toBe("220 160|480 360|4 3 16 9|1 1|0 0|1 0|24 8 8 16|1|preserved");
    const close = page.locator(`[data-x11-wasm-frame="${frames[2]}"] [data-x11-wasm-decoration="close"]`);
    await close.click();
    await expect(page.locator("#tk-browser-result")).toHaveText("close-rejected .wmUtility 1");
    expect(await evalTcl(page, "winfo exists .wmUtility")).toBe("1");
    await evalTcl(page, "set ::wmSample::closeAllowed 1");
    await close.click();
    await expect(page.locator("#tk-browser-result")).toHaveText("close-accepted .wmUtility 2");
    expect(await evalTcl(page, "winfo exists .wmUtility")).toBe("0");
    await page.locator("#tcl-wm-sample").click();
    await expect(page.locator("#tcl-wm-sample")).toBeEnabled();
    expect(await evalTcl(page, "list $::wmSample::closeAllowed $::wmSample::closeRequests [winfo exists .wmUtility]"))
      .toBe("0 0 1");
  });

  test("repeated move and resize preserve native geometry and client DOM coordinates", async ({ page }) => {
    const { frameId, frame } = await openInputWindow(page);
    for (let index = 0; index < 3; index++) {
      const before = await frameGeometry(page, frameId);
      await drag(page, frame.locator('[data-x11-wasm-decoration="move"]'), 24, 18);
      await evalTcl(page, "update");
      const moved = await frameGeometry(page, frameId);
      expect(moved.native).toEqual([before.native[0] + 24, before.native[1] + 18,
        before.native[2], before.native[3]]);
      expect(moved.dom).toEqual(moved.native);
      await drag(page, frame.locator('[data-x11-wasm-decoration="resize-se"]'), 24, 16);
      await evalTcl(page, "update");
      const resized = await frameGeometry(page, frameId);
      expect(resized.native).toEqual([moved.native[0], moved.native[1], moved.native[2] + 24, moved.native[3] + 16]);
      expect(resized.dom).toEqual(resized.native);
      expect(await evalTcl(page, "join [list [winfo width .] [winfo height .]] ,"))
        .toBe(`${resized.native[2]},${resized.native[3]}`);
    }
  });

  test("checkbox disable cancels capture and restores wrapper and client geometry ownership", async ({ page }) => {
    const { frameId, clientId, frame } = await openInputWindow(page);
    const before = await frameGeometry(page, frameId);
    const bar = await frame.locator('[data-x11-wasm-decoration="move"]').boundingBox();
    await page.mouse.move(bar.x + 40, bar.y + bar.height / 2);
    await page.mouse.down();
    try {
      const captured = await page.evaluate(() => {
        const gesture = /** @type {any} */ (window).Module.x11WasmBackend.managerGesture;
        return !!gesture?.capture.hasPointerCapture(gesture.pointerId);
      });
      expect(captured).toBe(true);
      const toggle = page.locator("#tk-window-manager");
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect(toggle).not.toBeChecked();
      const cleanup = await page.evaluate(([frameId, clientId]) => {
        const backend = /** @type {any} */ (window).Module.x11WasmBackend;
        return {
          enabled: backend.windowManagerEnabled,
          gesture: backend.managerGesture,
          observer: backend.managerObserver,
          listeners: backend.managerListeners,
          frames: backend.managerFrames.size,
          owned: [frameId, clientId].map((id) => backend.resources.get(id).managerGeometryOwned),
        };
      }, [frameId, clientId]);
      expect(cleanup).toEqual({ enabled: false, gesture: null, observer: null,
        listeners: null, frames: 0, owned: [false, false] });
      await expect(page.locator("[data-x11-wasm-taskbar]")).toHaveCount(0);
      expect(await frameGeometry(page, frameId)).toEqual(before);
    } finally {
      await page.mouse.up();
    }
    await page.locator("#tk-window-manager").check();
    await expect(frame).toBeVisible();
    expect(await frameGeometry(page, frameId)).toEqual(before);
  });

  test("repeated maximize minimize and task restore retain native state and normal geometry", async ({ page }) => {
    const { frameId, frame } = await openInputWindow(page);
    const initial = await frameGeometry(page, frameId);
    const maximize = frame.locator('[data-x11-wasm-decoration="maximize"]');
    const minimize = frame.locator('[data-x11-wasm-decoration="minimize"]');
    const task = page.locator(`[data-x11-wasm-task="${frameId}"][data-x11-wasm-decoration="restore"]`);
    for (let index = 0; index < 3; index++) {
      await maximize.click();
      await expect.poll(() => evalTcl(page, "update; wm attributes . -zoomed")).toBe("1");
      await expect(maximize).toHaveAttribute("aria-label", "Restore");
      await minimize.click();
      await expect.poll(() => evalTcl(page, "update; wm state .")).toBe("iconic");
      await expect(frame).toBeHidden();
      await expect(task).toBeVisible();
      await task.click();
      await expect.poll(() => evalTcl(page, "update; list [wm state .] [wm attributes . -zoomed]"))
        .toBe("normal 1");
      await expect(frame).toBeVisible();
      await maximize.click();
      await expect.poll(() => evalTcl(page, "update; wm attributes . -zoomed")).toBe("0");
      expect(await frameGeometry(page, frameId)).toEqual(initial);
      await minimize.click();
      await expect.poll(() => evalTcl(page, "update; wm state .")).toBe("iconic");
      await task.click();
      await expect.poll(() => evalTcl(page, "update; list [wm state .] [wm attributes . -zoomed]"))
        .toBe("normal 0");
      expect(await frameGeometry(page, frameId)).toEqual(initial);
    }
  });
});

test("standalone native fixture resolves wrapper client and close source without mocks", async ({ page }) => {
  await page.goto("/tcltk.html?eval=list+ready");
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", { timeout: 15000 });
  expect(await page.evaluate(() => {
    const module = /** @type {any} */ (window).Module;
    return { optIn: module.x11WasmWindowManager === true,
      enabled: module.x11WasmBackend.windowManagerEnabled,
      frames: module.x11WasmBackend.managerFrames.size };
  })).toEqual({ optIn: false, enabled: false, frames: 0 });
  await page.route("**/x11.{html,js,wasm}", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (!name || !["x11.html", "x11.js", "x11.wasm"].includes(name)) {
      throw new Error("unexpected standalone fixture asset");
    }
    return route.fulfill({ path: path.resolve(__dirname, "../../third-party/x11.wasm/build/browser", name) });
  });
  await page.goto("/x11.html");
  await expect(page.locator("#x11-wasm-status")).toHaveText("running", { timeout: 15000 });
  const native = await page.evaluate(() => {
    const module = /** @type {any} */ (window).Module;
    if (module.x11WasmBackend.windowManagerEnabled) throw new Error("standalone fixture must default to disabled");
    module.x11WasmBackend.setWindowManagerEnabled(true);
    const frame = module._X11WasmTestManagerWindow(1);
    const client = module._X11WasmTestManagerPart(1);
    module._X11WasmTestGeometryConfigure(frame, 15, 40, 60, 220, 140, 0);
    module.x11WasmBackend.flush();
    return {
      frame, client,
      identity: [0, 1, 2].map((field) => module._X11WasmManagerWindowIdentity(client, field)),
      geometry: [0, 1, 2, 3].map((field) => module._X11WasmTestGeometryValue(frame, field)),
    };
  });
  expect(native.identity).toEqual([native.frame, native.client, native.frame]);
  expect(native.geometry).toEqual([40, 60, 220, 140]);
  const frame = page.locator(`[data-x11-wasm-frame="${native.frame}"]`);
  await expect(frame).toBeVisible();
  await frame.locator('[data-x11-wasm-decoration="close"]').click();
  const close = await page.evaluate((id) => {
    const module = /** @type {any} */ (window).Module;
    return {
      delivered: module._X11WasmTestManagerCloseEvent(id),
      width: module._X11WasmTestGeometryValue(id, 2),
    };
  }, native.frame);
  expect(close).toEqual({ delivered: 1, width: 220 });
  await expect(frame).toBeVisible();
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000, dpr: 1 },
  { name: "mobile", width: 390, height: 844, dpr: 2 },
]) {
  test.describe(`native visual QA ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr });
    test("sample retains IME and dialog controls without initial extra windows", async ({ page }, testInfo) => {
      await openApp(page);
      expect(await evalTcl(page, [
        "join [list [winfo exists .imeViewport.content.form.entry] [winfo exists .imeViewport.content.form.text]",
        "[winfo exists .imeViewport.content.checks.buttons.open] [winfo exists .imeViewport.content.checks.buttons.message]",
        "[info exists ::wmSample::windows]] ,",
      ].join(" "))).toBe("1,1,1,1,0");
      const layout = await page.evaluate(() => {
        const controlElement = document.querySelector(".window-controls");
        const titleElement = document.querySelector(".window-title");
        if (!controlElement || !titleElement) throw new Error("missing window toolbar");
        const controls = controlElement.getBoundingClientRect();
        const title = titleElement.getBoundingClientRect();
        return {
          fitsPage: document.documentElement.scrollWidth <= window.innerWidth,
          fitsTitle: controls.left >= title.left && controls.right <= title.right &&
            controls.top >= title.top && controls.bottom <= title.bottom,
        };
      });
      expect(layout).toEqual({ fitsPage: true, fitsTitle: true });
      await page.locator("#tk-browser-root").scrollIntoViewIfNeeded();
      const ids = ((await evalTcl(page,
        "update; join [list [winfo id .] [winfo id .imeViewport.content.form.entry] [winfo id .imeViewport.content.form.initial] [winfo id .imeViewport.content.checks.buttons.message]] ,")) || "")
        .split(",").map(Number);
      const bounds = await page.evaluate((client) => {
        const module = /** @type {any} */ (window).Module;
        const backend = module.x11WasmBackend;
        backend.flush();
        const frameId = module._X11WasmManagerWindowIdentity(client, 0);
        const frame = document.querySelector(`[data-x11-wasm-frame="${frameId}"]`);
        if (!frame) throw new Error("missing native sample frame");
        const root = backend.rootElement.getBoundingClientRect();
        const box = frame.getBoundingClientRect();
        const controls = [...frame.querySelectorAll("button")];
        return {
          frameInside: box.left >= root.left && box.right <= root.right && box.top >= root.top && box.bottom <= root.bottom,
          controlsHit: controls.every((control) => {
            const rect = control.getBoundingClientRect();
            return control.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }),
          dpr: devicePixelRatio,
        };
      }, ids[0]);
      expect(bounds).toEqual({ frameInside: true, controlsHit: true, dpr: viewport.dpr });
      const entry = page.locator(`[data-x11-wasm-xid="${ids[1]}"]`);
      await entry.click();
      await page.keyboard.type("sample input");
      await expect.poll(() => evalTcl(page, "update; .imeViewport.content.form.entry get")).toBe("sample input");
      expect(await canvasInk(page, ids[1])).toBeGreaterThan(20);
      expect(await canvasInk(page, ids[2])).toBeGreaterThan(20);
      await evalTcl(page, "list ready");
      await page.screenshot({ path: testInfo.outputPath(`initial-${viewport.name}.png`), fullPage: true });
      await evalTcl(page, ".imeViewport yview moveto 1; update; list ready");
      expect(await evalTcl(page, [
        "join [lmap name {run metrics caret draw display fullscreen exitfull open save directory color message} {",
        "expr {[winfo width .imeViewport.content.checks.buttons.$name] >= [winfo reqwidth .imeViewport.content.checks.buttons.$name]}",
        "}] ,",
      ].join(" "))).toBe("1,1,1,1,1,1,1,1,1,1,1,1");
      const message = page.locator(`[data-x11-wasm-xid="${ids[3]}"]`);
      await expect(message).toBeVisible();
      const dialogs = [];
      page.on("dialog", async (dialog) => {
        dialogs.push(dialog.type());
        await dialog.dismiss();
      });
      await message.click();
      await expect.poll(() => evalTcl(page, "update; .imeViewport.content.checks.output get 1.0 end"))
        .toContain("dialog message status ok");
      expect(dialogs).toEqual(["confirm"]);
      expect(await canvasInk(page, ids[3])).toBeGreaterThan(20);
      await page.screenshot({ path: testInfo.outputPath(`checks-${viewport.name}.png`), fullPage: true });
      await page.locator("#tcl-wm-sample").click();
      await expect(page.locator("#tcl-wm-sample")).toBeEnabled();
      await expect(page.locator("#tk-browser-result")).toHaveText(/^wm-sample /);
      if (viewport.name === "mobile") {
        const layout = () => page.evaluate(() => {
          const output = document.getElementById("tcl-shell-output");
          const root = document.getElementById("tk-browser-root");
          if (!output || !root) throw new Error("missing sample layout");
          return { pageHeight: document.documentElement.scrollHeight,
            windowTop: root.getBoundingClientRect().top + window.scrollY,
            outputHeight: output.clientHeight, outputScroll: output.scrollHeight };
        });
        const before = await layout();
        expect(before.outputHeight).toBe(180);
        expect(before.outputScroll).toBeGreaterThan(before.outputHeight);
        for (let repeat = 0; repeat < 2; repeat++) {
          await page.locator("#tcl-wm-sample").click();
          await expect(page.locator("#tcl-wm-sample")).toBeEnabled();
          const after = await layout();
          expect(after.pageHeight).toBe(before.pageHeight);
          expect(after.windowTop).toBe(before.windowTop);
          expect(after.outputHeight).toBe(180);
          expect(after.outputScroll).toBeGreaterThan(before.outputScroll);
        }
      }
      await page.locator("#tk-browser-root").scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`sample-${viewport.name}.png`), fullPage: true });
      const assets = await page.evaluate(() => {
        const root = document.getElementById("tk-browser-root");
        if (!root) throw new Error("missing sample root");
        const frames = [...root.querySelectorAll("[data-x11-wasm-frame]")];
        return {
          frames: frames.length,
          icons: frames.every((frame) => !!frame.querySelector('[data-x11-wasm-decoration="close"] svg')),
          canvases: root.querySelectorAll("canvas").length,
        };
      });
      expect(assets.frames).toBeGreaterThanOrEqual(4);
      expect(assets.icons).toBe(true);
      expect(assets.canvases).toBeGreaterThan(0);
      await evalTcl(page, "foreach window $::wmSample::windows {catch {destroy $window}}; update");
      await page.locator("#tcl-command").fill([
        "set ::shellClick 0",
        "button .again -text {Created from shell} -command {incr ::shellClick; browser::setResult shell-clicked}",
        "pack .again -padx 12 -pady 12",
        "update; list shell-ready",
      ].join("\n"));
      await page.locator("#tcl-run").click();
      await expect(page.locator("#tcl-shell-output")).toContainText("= shell-ready");
      const again = Number(await evalTcl(page, "winfo id .again"));
      const againElement = page.locator(`[data-x11-wasm-xid="${again}"]`);
      await againElement.scrollIntoViewIfNeeded();
      expect(await againElement.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      })).toBe(true);
      expect(await evalTcl(page, [
        "join [list [winfo parent .imeViewport.content]",
        "[winfo containing [expr {[winfo rootx .again] + [winfo width .again] / 2}]",
        "[expr {[winfo rooty .again] + [winfo height .again] / 2}]]] ,",
      ].join(" "))).toBe(".imeViewport,.again");
      await againElement.click();
      await expect.poll(() => evalTcl(page, "update; set ::shellClick")).toBe("1");
      expect(await canvasInk(page, again)).toBeGreaterThan(20);
      await page.locator("#tcl-demo").click();
      await expect(page.locator("#tcl-demo")).toBeEnabled();
      const close = Number(await evalTcl(page, "winfo id .demo.close"));
      await page.locator(`[data-x11-wasm-xid="${close}"]`).click();
      await expect.poll(() => evalTcl(page, "update; winfo exists .demo")).toBe("0");
      await page.locator("#tcl-clear").click();
      await expect(page.locator("#tcl-shell-output")).toHaveText("");
    });
  });
}
