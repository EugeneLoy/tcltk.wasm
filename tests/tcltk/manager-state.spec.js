// @ts-check

const { test, expect } = require("@playwright/test");

async function evalTcl(page, source) {
  const result = await page.evaluate(async (source) => {
    const target = /** @type {any} */ (window);
    while (target.Asyncify?.currData) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const module = target.Module;
    const bytes = new TextEncoder().encode(`${source}\0`);
    const pointer = module._malloc(bytes.length);
    try {
      target.HEAPU8.set(bytes, pointer);
      let code = module._TkBrowserEval(pointer);
      if (code && typeof code.then === "function") {
        code = await code;
      } else if (target.Asyncify?.currData) {
        code = await target.Asyncify.whenDone();
      }
      return { code, value: module.tkBrowserEvalResult };
    } finally {
      module._free(pointer);
    }
  }, source);
  expect(result.code, result.value).toBe(0);
  return result.value;
}

async function idsFor(page, path = ".") {
  const value = await evalTcl(page, `join [list [winfo id ${path}] [wm frame ${path}]] |`);
  const [client, wmFrame] = value.split("|").map((value) => Number.parseInt(value, 0));
  expect(client).toBeGreaterThan(0);
  expect(wmFrame).toBeGreaterThan(0);
  // Tk's wm frame can name the metadata client rather than the decorated native frame.
  const identity = await page.evaluate((client) => {
    const query = /** @type {any} */ (window).Module._X11WasmManagerWindowIdentity;
    return typeof query === "function" ? { frame: query(client, 0), metadata: query(client, 1) } : null;
  }, client);
  if (identity) {
    expect(identity.frame).toBeGreaterThan(0);
    expect(identity.metadata).toBeGreaterThan(0);
  }
  return { client, wmFrame, frame: identity?.frame || wmFrame,
    metadata: identity?.metadata || client };
}

async function openTkManager(page, { enabled = true, transients = false } = {}) {
  const script = [
    "wm title . {W7 Owner}",
    "wm geometry . 240x160+80+100",
    "wm minsize . 40 30",
    "wm maxsize . 2000 2000",
    "frame .fill -background white",
    "pack .fill -fill both -expand 1",
    "bind .fill <ButtonPress-1> {browser::setResult owner-hit}",
    ...(transients ? [
      "set ::modalCalls 0",
      "foreach w {.dialog .kept} {",
      "  toplevel $w",
      "  wm title $w $w",
      "  wm geometry $w 160x100+110+140",
      "  wm transient $w .",
      "  frame $w.fill -background cyan",
      "  pack $w.fill -fill both -expand 1",
      "}",
      "bind .dialog.fill <ButtonPress-1> {browser::setResult dialog-hit}",
      "button .dialog.ok -text Continue -command {incr ::modalCalls; browser::setResult [list modal $::modalCalls]}",
      "place .dialog.ok -x 10 -y 10",
      "wm withdraw .kept",
    ] : []),
    "update",
    "list ready",
  ].join("\n");
  await page.goto(`/tcltk.html?${new URLSearchParams({ eval: script })}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", { timeout: 15000 });
  const owner = await idsFor(page);
  if (enabled) {
    await page.evaluate(() => {
      const target = /** @type {any} */ (window);
      const backend = target.Module.x11WasmBackend;
      if (typeof backend.setWindowManagerEnabled !== "function" ||
          typeof target.Module._X11WasmManagerSetWindowState !== "function") {
        throw new Error("missing native window manager state integration");
      }
      backend.setWindowManagerEnabled(true);
      backend.flush();
    });
    await expect(frameFor(page, owner)).toBeVisible();
  }
  return { owner, dialog: transients ? await idsFor(page, ".dialog") : null };
}

function frameFor(page, ids) {
  return page.locator(`[data-x11-wasm-frame="${ids.frame}"]`);
}

function actionFor(page, ids, action) {
  return frameFor(page, ids).locator(`[data-x11-wasm-decoration="${action}"]`);
}

function taskFor(page, ids) {
  return page.locator(`[data-x11-wasm-taskbar] [data-x11-wasm-task="${ids.frame}"][data-x11-wasm-decoration="restore"]`);
}

async function tkState(page, path = ".") {
  const value = await evalTcl(page, "update\n" + [
    `join [list [wm state ${path}] [winfo ismapped ${path}]`,
    `  [wm attributes ${path} -zoomed] [wm attributes ${path} -topmost]`,
    `  [winfo rootx ${path}] [winfo rooty ${path}]`,
    `  [winfo width ${path}] [winfo height ${path}] [grab current]] |`,
  ].join(" "));
  const [state, mapped, zoomed, topmost, x, y, width, height, grab] = value.split("|");
  return { state, mapped: Number(mapped), zoomed: Number(zoomed), topmost: Number(topmost),
    geometry: [x, y, width, height].map(Number), grab };
}

async function expectTkState(page, ids, expected, path = ".") {
  await expect.poll(() => tkState(page, path)).toMatchObject(expected);
  const flags = await page.evaluate((ids) => {
    const module = /** @type {any} */ (window).Module;
    const query = module._X11WasmTestWindowHasNetWmState;
    if (typeof query !== "function") throw new Error("missing native EWMH property reader");
    return [query(ids.frame, 2), query(ids.frame, 3)];
  }, ids);
  if (expected.zoomed !== undefined) expect(flags).toEqual([expected.zoomed, expected.zoomed]);
}

async function setManagerEnabled(page, enabled) {
  await page.evaluate((enabled) => {
    const backend = /** @type {any} */ (window).Module.x11WasmBackend;
    backend.setWindowManagerEnabled(enabled);
    backend.flush();
  }, enabled);
}

test("programmatic baseline restores transients without revealing explicitly withdrawn dialogs", async ({ page }) => {
  await openTkManager(page, { enabled: false, transients: true });
  for (const hidden of ["iconic", "withdrawn"]) {
    await evalTcl(page, `wm state . ${hidden}; update`);
    expect(await tkState(page)).toMatchObject({ state: hidden, mapped: 0 });
    expect(await tkState(page, ".dialog")).toMatchObject({ state: "withdrawn", mapped: 0 });
    await evalTcl(page, "wm state . normal; update");
    expect(await tkState(page)).toMatchObject({ state: "normal", mapped: 1 });
    expect(await tkState(page, ".dialog")).toMatchObject({ state: "normal", mapped: 1 });
    expect(await tkState(page, ".kept")).toMatchObject({ state: "withdrawn", mapped: 0 });
  }
});

test("Tk root maximizes minimizes and restores through native state and the taskbar", async ({ page }) => {
  const { owner } = await openTkManager(page);
  const normal = (await tkState(page)).geometry;
  await actionFor(page, owner, "maximize").click();
  await expectTkState(page, owner, { state: "normal", mapped: 1, zoomed: 1 });
  await expect(actionFor(page, owner, "maximize")).toHaveAttribute("aria-label", "Restore");
  await actionFor(page, owner, "minimize").click();
  await expectTkState(page, owner, { state: "iconic", mapped: 0, zoomed: 1 });
  await expect(frameFor(page, owner)).toBeHidden();
  await taskFor(page, owner).click();
  await expectTkState(page, owner, { state: "normal", mapped: 1, zoomed: 1 });
  await actionFor(page, owner, "maximize").click();
  await expectTkState(page, owner, { state: "normal", mapped: 1, zoomed: 0, geometry: normal });
  await expect(page.locator(".x11-wasm-input")).toBeFocused();
});

for (const iconic of [false, true]) {
  test(`Tk restore geometry survives root resize and manager toggles while ${iconic ? "iconic" : "zoomed"}`, async ({ page }) => {
    const { owner } = await openTkManager(page);
    const normal = (await tkState(page)).geometry;
    await actionFor(page, owner, "maximize").click();
    await expectTkState(page, owner, { zoomed: 1 });
    if (iconic) await actionFor(page, owner, "minimize").click();
    await page.locator("#tk-browser-root").evaluate((element) => {
      element.style.width = "600px";
      element.style.height = "460px";
    });
    await expectTkState(page, owner, iconic
      ? { state: "iconic", mapped: 0, zoomed: 1 }
      : { state: "normal", mapped: 1, zoomed: 1, geometry: [0, 28, 600, 400] });
    await setManagerEnabled(page, false);
    await expect(frameFor(page, owner)).toHaveCount(0);
    await expect(page.locator("[data-x11-wasm-taskbar]")).toHaveCount(0);
    await page.locator("#tk-browser-root").evaluate((element) => {
      element.style.width = "560px";
      element.style.height = "420px";
    });
    await setManagerEnabled(page, true);
    if (iconic) {
      await expectTkState(page, owner, { state: "iconic", mapped: 0, zoomed: 1 });
      await taskFor(page, owner).click();
    }
    await expectTkState(page, owner, { state: "normal", mapped: 1, zoomed: 1,
      geometry: [0, 28, 560, 360] });
    await actionFor(page, owner, "maximize").click();
    await expectTkState(page, owner, { zoomed: 0, geometry: normal });
  });
}

test("programmatic Tk state and geometry roundtrip through the manager controls", async ({ page }) => {
  const { owner } = await openTkManager(page);
  await evalTcl(page, "wm attributes . -topmost 1; wm attributes . -zoomed 1; update");
  await expectTkState(page, owner, { state: "normal", mapped: 1, zoomed: 1, topmost: 1 });
  await expect(actionFor(page, owner, "maximize")).toHaveAttribute("aria-label", "Restore");
  await evalTcl(page, "wm geometry . 210x130+95+120; update");
  const programmed = (await tkState(page)).geometry;
  expect(programmed).toEqual([95, 120, 210, 130]);
  await actionFor(page, owner, "maximize").click();
  await expectTkState(page, owner, { zoomed: 0, topmost: 1, geometry: programmed });
  await evalTcl(page, "wm state . iconic; update");
  await expectTkState(page, owner, { state: "iconic", mapped: 0 });
  await taskFor(page, owner).click();
  await expectTkState(page, owner, { state: "normal", mapped: 1, zoomed: 0, geometry: programmed });
  await evalTcl(page, "wm state . withdrawn; update");
  await expect(taskFor(page, owner)).toHaveCount(0);
  await evalTcl(page, "wm state . normal; update");
  await expect(frameFor(page, owner)).toBeVisible();
  await expect(taskFor(page, owner)).toBeVisible();
});

test("owner taskbar restore preserves transient ordering and explicitly hidden dialogs", async ({ page }) => {
  const { owner, dialog } = await openTkManager(page, { transients: true });
  await actionFor(page, owner, "minimize").click();
  await expectTkState(page, owner, { state: "iconic", mapped: 0 });
  await expect.poll(() => tkState(page, ".dialog")).toMatchObject({ mapped: 0 });
  await expect(frameFor(page, dialog)).toBeHidden();
  await taskFor(page, owner).click();
  await expectTkState(page, owner, { state: "normal", mapped: 1 });
  await expect.poll(() => tkState(page, ".dialog")).toMatchObject({ state: "normal", mapped: 1 });
  expect(await tkState(page, ".kept")).toMatchObject({ state: "withdrawn", mapped: 0 });
  await frameFor(page, owner).locator('[data-x11-wasm-decoration="move"]').click({ position: { x: 80, y: 14 } });
  expect(await evalTcl(page, "expr {[lsearch -exact [wm stackorder .] .dialog] > [lsearch -exact [wm stackorder .] .]}")).toBe("1");
  const fill = Number.parseInt(await evalTcl(page, "winfo id .dialog.fill"), 0);
  await page.locator(`[data-x11-wasm-xid="${fill}"]`).click({ position: { x: 100, y: 70 } });
  await expect(page.locator("#tk-browser-result")).toHaveText("dialog-hit");
});

test("Tk global modal grab blocks manager state actions without losing modal input", async ({ page }) => {
  const { owner, dialog } = await openTkManager(page, { transients: true });
  await evalTcl(page, "grab set -global .dialog; focus -force .dialog; update");
  expect(await evalTcl(page, "grab status .dialog")).toBe("global");
  const before = await tkState(page);
  await expect(actionFor(page, owner, "minimize")).toBeDisabled();
  await expect(actionFor(page, owner, "maximize")).toBeDisabled();
  await actionFor(page, owner, "minimize").click({ force: true });
  await actionFor(page, owner, "maximize").click({ force: true });
  expect(await tkState(page)).toEqual(before);
  expect(await evalTcl(page, "grab current")).toBe(".dialog");
  const button = Number.parseInt(await evalTcl(page, "winfo id .dialog.ok"), 0);
  await page.locator(`[data-x11-wasm-xid="${button}"]`).click();
  await expect(page.locator("#tk-browser-result")).toHaveText("modal 1");
  await expect(frameFor(page, dialog)).toBeVisible();
  await evalTcl(page, "grab release .dialog; update");
  await expect(actionFor(page, owner, "maximize")).toBeEnabled();
  await actionFor(page, owner, "maximize").click();
  await expectTkState(page, owner, { zoomed: 1 });
});

test("Tk local grab retains client event capture while decorations are enabled", async ({ page }) => {
  await openTkManager(page, { transients: true });
  await evalTcl(page, [
    "set ::ownerHits 0",
    "set ::modalHits 0",
    "bind .fill <ButtonPress-1> {incr ::ownerHits}",
    "bind .dialog <ButtonPress-1> {incr ::modalHits}",
    "grab set .dialog",
    "focus -force .dialog",
    "update",
  ].join("\n"));
  expect(await evalTcl(page, "grab status .dialog")).toBe("local");
  const fill = Number.parseInt(await evalTcl(page, "winfo id .fill"), 0);
  await page.locator(`[data-x11-wasm-xid="${fill}"]`).click({ position: { x: 10, y: 20 } });
  expect(await evalTcl(page, "list $::ownerHits $::modalHits [grab current]")).toBe("0 1 .dialog");
  const button = Number.parseInt(await evalTcl(page, "winfo id .dialog.ok"), 0);
  await page.locator(`[data-x11-wasm-xid="${button}"]`).click();
  await expect(page.locator("#tk-browser-result")).toHaveText("modal 1");
  expect(await evalTcl(page, "grab current")).toBe(".dialog");
  await evalTcl(page, "grab release .dialog; update");
});

test("destroying a zoomed Tk client removes its task and saved normal geometry", async ({ page }) => {
  const { dialog } = await openTkManager(page, { transients: true });
  if (!dialog) throw new Error("missing transient client");
  await actionFor(page, dialog, "maximize").click();
  await expectTkState(page, dialog, { zoomed: 1 }, ".dialog");
  expect(await page.evaluate((id) =>
    /** @type {any} */ (window).Module.x11WasmBackend.managerRestoreGeometries.has(id), dialog.frame)).toBe(true);
  await evalTcl(page, "destroy .dialog; update");
  await expect(frameFor(page, dialog)).toHaveCount(0);
  await expect(taskFor(page, dialog)).toHaveCount(0);
  expect(await page.evaluate((id) =>
    /** @type {any} */ (window).Module.x11WasmBackend.managerRestoreGeometries.has(id), dialog.frame)).toBe(false);
  await evalTcl(page, "toplevel .dialog; wm geometry .dialog 145x90+150+160; update");
  const replacement = await idsFor(page, ".dialog");
  expect(replacement.frame).not.toBe(dialog.frame);
  await expectTkState(page, replacement, { state: "normal", mapped: 1, zoomed: 0,
    geometry: [150, 160, 145, 90] }, ".dialog");
});
