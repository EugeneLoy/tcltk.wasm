// @ts-check

const { test, expect } = require("@playwright/test");

async function openActualTkManager(page) {
  const script = [
    "wm withdraw .",
    "tk useinputmethods 1",
    "set ::firstValue {}; set ::secondValue {}; set ::refused 0",
    "foreach name {first second} x {80 360} {",
    "  toplevel .$name",
    "  wm title .$name $name",
    "  wm geometry .$name 220x100+${x}+90",
    "  entry .$name.editor -textvariable ::${name}Value",
    "  pack .$name.editor -fill x",
    "  bind .$name.editor <KeyRelease> {browser::setStatus [list typed [focus] $::firstValue $::secondValue]}",
    "}",
    "wm protocol .first WM_DELETE_WINDOW {incr ::refused; browser::setResult [list refused $::refused [winfo exists .first]]; browser::setStatus [list refused $::refused [winfo exists .first]]}",
    "focus -force .first.editor",
    "update",
    "list ready [winfo id .first] [winfo id .first.editor] [winfo id .second] [winfo id .second.editor]",
  ].join("\n");
  await page.goto(`/tcltk.html?${new URLSearchParams({ eval: script })}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", { timeout: 15000 });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "").trim().split(/\s+/);
  expect(ready[0]).toBe("ready");
  const client = Number(ready[1]);
  const secondClient = Number(ready[3]);
  const state = await page.evaluate(({ client, secondClient }) => {
    const module = /** @type {any} */ (window).Module;
    const missing = ["_X11WasmManagerWindowIdentity", "_X11WasmManagerActivateWindow",
      "_X11WasmManagerCloseWindow", "_X11WasmManagerConfigureWindow", "_X11WasmTestManagerFocusWindow"]
      .filter((name) => typeof module[name] !== "function");
    if (typeof module.x11WasmBackend?.setWindowManagerEnabled !== "function") missing.push("manager UI");
    if (missing.length) return { missing, frame: 0, nativeFocus: 0, secondFrame: 0 };
    module.x11WasmBackend.setWindowManagerEnabled(true);
    return { missing, frame: module._X11WasmManagerWindowIdentity(client, 0),
      nativeFocus: module._X11WasmTestManagerFocusWindow(),
      secondFrame: module._X11WasmManagerWindowIdentity(secondClient, 0) };
  }, { client, secondClient });
  if (process.env.PLAYWRIGHT_REQUIRE_MANAGER === "1") expect(state.missing).toEqual([]);
  test.skip(state.missing.length > 0, `expected pending: ${state.missing.join(", ")}`);
  expect(state.frame).toBeGreaterThan(0);
  return { frame: state.frame, editor: Number(ready[2]), client, nativeFocus: state.nativeFocus,
    secondFrame: state.secondFrame, secondClient, secondEditor: Number(ready[4]) };
}

async function expectEditorFocus(page, editor, nativeTargets) {
  const allowed = Array.isArray(nativeTargets) ? nativeTargets : [nativeTargets];
  await expect(page.locator(".x11-wasm-input")).toBeFocused();
  const readFocus = () => page.evaluate(() =>
    /** @type {any} */ (window).Module._X11WasmTestManagerFocusWindow());
  await expect.poll(async () => allowed.includes(await readFocus())).toBe(true);
  const nativeFocus = await readFocus();
  await expect(page.locator(".x11-wasm-input")).toHaveAttribute("data-x11-wasm-focus-window", String(nativeFocus));
  await expect(page.locator(".x11-wasm-input")).toHaveAttribute("data-x11-wasm-ic-window", String(editor));
}

for (const activation of ["pointer", "keyboard"]) {
  test(`actual Tk close refusal restores text input after ${activation} activation`, async ({ page }) => {
    const { frame, editor, nativeFocus } = await openActualTkManager(page);
    await expectEditorFocus(page, editor, nativeFocus);
    const close = page.locator(`[data-x11-wasm-frame="${frame}"] [data-x11-wasm-decoration="close"]`);
    for (let count = 1; count <= 2; count++) {
      if (activation === "pointer") await close.click();
      else {
        await close.focus();
        await page.keyboard.press("Enter");
      }
      await expect(page.locator("#tk-browser-result")).toHaveText(`refused ${count} 1`);
      await expect(page.locator(`[data-x11-wasm-frame="${frame}"]`)).toHaveCount(1);
      await expectEditorFocus(page, editor, nativeFocus);
      await page.keyboard.type("x");
      await expect(page.locator("#tk-browser-status")).toHaveText(`typed .first.editor ${"x".repeat(count)} {}`);
    }
  });
}

test("actual Tk titlebar activation preserves editor focus and accepts text", async ({ page }) => {
  const { frame, editor, client, secondEditor } = await openActualTkManager(page);
  await page.locator(`[data-x11-wasm-xid="${secondEditor}"]`).click({ position: { x: 10, y: 10 } });
  await page.keyboard.type("second");
  await expect(page.locator("#tk-browser-status")).toHaveText("typed .second.editor {} second");
  await page.locator(`[data-x11-wasm-frame="${frame}"] [data-x11-wasm-decoration="move"]`).click({ position: { x: 35, y: 10 } });
  await expectEditorFocus(page, editor, [frame, client, editor]);
  await page.keyboard.type("first");
  await expect(page.locator("#tk-browser-status")).toHaveText("typed .first.editor first second");
});

test("actual Tk background close refusal preserves the current editor focus", async ({ page }) => {
  const { frame, secondFrame, secondClient, secondEditor } = await openActualTkManager(page);
  await page.locator(`[data-x11-wasm-xid="${secondEditor}"]`).click({ position: { x: 10, y: 10 } });
  await page.keyboard.type("keep");
  await expect(page.locator("#tk-browser-status")).toHaveText("typed .second.editor {} keep");
  await expectEditorFocus(page, secondEditor, [secondFrame, secondClient, secondEditor]);
  const nativeFocus = await page.evaluate(() => /** @type {any} */ (window).Module._X11WasmTestManagerFocusWindow());
  await page.locator(`[data-x11-wasm-frame="${frame}"] [data-x11-wasm-decoration="close"]`).click();
  await expect(page.locator("#tk-browser-result")).toHaveText("refused 1 1");
  await expectEditorFocus(page, secondEditor, nativeFocus);
  await page.keyboard.type("typing");
  await expect(page.locator("#tk-browser-status")).toHaveText("typed .second.editor {} keeptyping");
});
