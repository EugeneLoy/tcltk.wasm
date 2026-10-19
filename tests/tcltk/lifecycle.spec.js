// @ts-check

const { test, expect } = require("@playwright/test");

for (const action of ["destroy .holder", "wm withdraw .holder"]) {
  test(`composition target is retired by ${action}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const script = [
      "tk useinputmethods 1",
      "set ::events {}",
      "proc ::record {event} {lappend ::events $event; browser::setStatus [join $::events |]}",
      "toplevel .holder",
      "entry .holder.first",
      "entry .second",
      "pack .holder.first",
      "pack .second",
      "update",
      `bind .holder.first <<X11WasmCompositionStart>> {::record start; ${action}; focus -force .second; update; ::record changed}`,
      "foreach widget {.holder.first .second} {",
      "  bind $widget <<X11WasmCompositionUpdate>> {::record [list late-update %W %d]}",
      "  bind $widget <<X11WasmCompositionEnd>> {::record [list late-end %W %d]}",
      "}",
      "bind .second <KeyPress> {::record [list second-key %A]}",
      "focus -force .holder.first",
      "update",
      "list ready [winfo id .holder.first]",
    ].join("\n");
    await page.goto(`/tcltk.html?${new URLSearchParams({ eval: script })}`);
    await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", { timeout: 15000 });
    const ready = ((await page.locator("#tk-browser-result").textContent()) || "").trim().split(/\s+/);
    expect(ready[0]).toBe("ready");
    const dispatch = async (type, data) => page.locator(".x11-wasm-input").evaluate((input, { type, data }) => {
      input.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
    }, { type, data });
    await dispatch("compositionstart", "draft");
    const status = page.locator("#tk-browser-status");
    await expect(status).toHaveText("start|changed");
    await dispatch("compositionupdate", "late");
    await dispatch("compositionend", "late");
    await page.locator(".x11-wasm-input").evaluate((element) => {
      const input = /** @type {HTMLTextAreaElement} */ (element);
      input.value = "n";
      input.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "n" }));
    });
    await page.keyboard.type("x");
    await expect(status).toHaveText("start|changed|second-key n|second-key x");
    expect(errors).toEqual([]);
  });
}

for (const action of ["pointercancel", "lostpointercapture", "blur"]) {
  test(`Tk implicit pointer capture retires on ${action}`, async ({ page }) => {
    const script = [
      "frame .first -width 100 -height 60",
      "frame .second -width 100 -height 60",
      "pack .first .second -side left",
      "bind .first <ButtonPress-1> {browser::setStatus pressed}",
      "bind .second <Motion> {browser::setStatus [list outside %s]}",
      "bind .second <ButtonPress-1> {browser::setStatus resumed}",
      "update",
      "list ready [winfo id .first] [winfo id .second]",
    ].join("\n");
    await page.goto(`/tcltk.html?${new URLSearchParams({ eval: script })}`);
    await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", { timeout: 15000 });
    const ready = ((await page.locator("#tk-browser-result").textContent()) || "").trim().split(/\s+/);
    const first = page.locator(`[data-x11-wasm-xid="${Number(ready[1])}"]`);
    const second = page.locator(`[data-x11-wasm-xid="${Number(ready[2])}"]`);
    await first.hover({ position: { x: 10, y: 10 } });
    await page.mouse.down();
    await expect(page.locator("#tk-browser-status")).toHaveText("pressed");
    await page.mouse.move((await first.boundingBox()).x + 11, (await first.boundingBox()).y + 10);
    try {
      const before = await page.evaluate((action) => {
        const backend = /** @type {any} */ (window).Module.x11WasmBackend;
        const before = backend.pointerCaptureWindow;
        const pointerId = backend.capturedPointerId;
        if (action === "blur") window.dispatchEvent(new Event("blur"));
        else if (action === "lostpointercapture") backend.rootElement.releasePointerCapture(pointerId);
        else backend.rootElement.dispatchEvent(new PointerEvent("pointercancel", { pointerId }));
        return before;
      }, action);
      expect(before).toBe(Number(ready[1]));
      const box = await second.boundingBox();
      await page.mouse.move(box.x + 10, box.y + 10);
      await expect.poll(() => page.evaluate(() => {
        const backend = /** @type {any} */ (window).Module.x11WasmBackend;
        return backend.pointerCaptureWindow;
      })).toBe(0);
      await page.mouse.up();
      await page.mouse.move(box.x + 11, box.y + 10);
      await expect(page.locator("#tk-browser-status")).toHaveText("outside 0");
      await second.click({ position: { x: 10, y: 10 } });
      await expect(page.locator("#tk-browser-status")).toHaveText("resumed");
    } finally {
      await page.mouse.up();
    }
  });
}
