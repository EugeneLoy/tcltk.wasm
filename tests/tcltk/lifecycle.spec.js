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
