// @ts-check

const { test, expect } = require("@playwright/test");
const { evalTcl } = require("../support/tcltk");
const { dispatchComposition, screenshotDifference } = require("../../third-party/x11.wasm/tests/support/preedit");

async function openEditor(page, kind) {
  const script = [
    "tk useinputmethods 1",
    "wm geometry . 420x170+20+20",
    "set ::value base; set ::writes 0; set ::keys 0",
    kind === "entry"
      ? "entry .editor -textvariable ::value -width 32 -font {Helvetica 14} -background white -foreground black -insertofftime 0"
      : "text .editor -width 32 -height 3 -font {Helvetica 14} -background white -foreground black -insertofftime 0",
    kind === "entry" ? ".editor icursor end" : ".editor insert 1.0 base; .editor mark set insert end-1c",
    "pack .editor -padx 20 -pady 20",
    "entry .second; pack .second",
    "trace add variable ::value write {apply {{args} {incr ::writes}}}",
    "bind .editor <KeyPress> {incr ::keys}",
    "focus -force .editor",
    "update",
    "list ready [winfo id .editor] [winfo id .second]",
  ].join("\n");
  await page.goto(`/tcltk.html?${new URLSearchParams({ eval: script })}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", { timeout: 15000 });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "").trim().split(/\s+/);
  expect(ready[0]).toBe("ready");
  await expect(page.locator(".x11-wasm-input")).toBeFocused();
  await expect(page.locator(".x11-wasm-input")).toHaveAttribute("data-x11-wasm-ic-window", String(Number(ready[1])));
  return { editor: page.locator(`[data-x11-wasm-xid="${Number(ready[1])}"]`), id: Number(ready[1]) };
}

function editorValue(kind) {
  return kind === "entry" ? ".editor get" : ".editor get 1.0 end-1c";
}

for (const kind of ["entry", "text"]) {
  test(`Tk ${kind} shows preedit without modifying its committed text`, async ({ page }) => {
    const { editor } = await openEditor(page, kind);
    const box = await editor.boundingBox();
    expect(box).not.toBeNull();
    const before = await page.screenshot({ clip: box });
    const inputBox = await page.locator(".x11-wasm-input").boundingBox();
    const preedit = page.locator(".x11-wasm-preedit");
    await dispatchComposition(page, "compositionstart", "に");
    await expect(preedit).toBeVisible();
    await expect(preedit).toHaveText("に");
    expect(await evalTcl(page, `list [${editorValue(kind)}] $::writes $::keys`)).toBe("base 0 0");
    await dispatchComposition(page, "compositionupdate", "日本語");
    await expect(preedit).toHaveText("日本語");
    const after = await page.screenshot({ clip: box });
    const changed = await screenshotDifference(page, before, after);
    expect(changed.count, "preedit must change actual rendered pixels").toBeGreaterThan(20);
    expect(await editor.boundingBox()).toEqual(box);
    expect(await page.locator(".x11-wasm-input").boundingBox()).toEqual(inputBox);
    await expect(page.locator(".x11-wasm-input")).toBeFocused();
    expect(await preedit.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
    expect(await evalTcl(page, `list [${editorValue(kind)}] $::writes $::keys`)).toBe("base 0 0");
    await dispatchComposition(page, "compositionend", "日本語");
    await expect(preedit).toBeHidden();
    await expect.poll(() => evalTcl(page, editorValue(kind))).toBe("base日本語");
    expect(await evalTcl(page, "set ::keys")).toBe("3");
    if (kind === "entry") expect(await evalTcl(page, "set ::writes")).toBe("3");
  });
}

test("Tk preedit renders HTML-looking text literally and clears empty updates", async ({ page }) => {
  await openEditor(page, "entry");
  const literal = '<img src=x onerror="window.preeditInjected=1">&';
  const preedit = page.locator(".x11-wasm-preedit");
  await dispatchComposition(page, "compositionstart", literal);
  await expect(preedit).toBeVisible();
  await expect(preedit).toHaveText(literal);
  await expect(preedit.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => /** @type {any} */ (window).preeditInjected)).toBeUndefined();
  expect(await evalTcl(page, ".editor get")).toBe("base");
  await dispatchComposition(page, "compositionupdate", "");
  await expect(preedit).toBeHidden();
  await dispatchComposition(page, "compositionend", "");
  expect(await evalTcl(page, "list [.editor get] $::writes $::keys")).toBe("base 0 0");
});

test("Tk preedit hides on focus changes without moving the committed text", async ({ page }) => {
  await openEditor(page, "entry");
  const preedit = page.locator(".x11-wasm-preedit");
  await dispatchComposition(page, "compositionstart", "に");
  await expect(preedit).toBeVisible();
  await evalTcl(page, "focus -force .second; update");
  await expect(preedit).toBeHidden();
  await dispatchComposition(page, "compositionupdate", "日本語");
  await expect(preedit).toBeHidden();
  expect(await evalTcl(page, "list [.editor get] [.second get] $::writes $::keys")).toBe("base {} 0 0");
  await dispatchComposition(page, "compositionend", "日本語");
  await expect(preedit).toBeHidden();
  await expect.poll(() => evalTcl(page, "list [.editor get] [.second get] $::keys")).toBe("base日本語 {} 3");
});

for (const action of ["pack forget .editor", "destroy .editor"]) {
  test(`Tk preedit is removed after ${action}`, async ({ page }) => {
    await openEditor(page, "entry");
    const preedit = page.locator(".x11-wasm-preedit");
    await dispatchComposition(page, "compositionstart", "未確定");
    await expect(preedit).toBeVisible();
    await evalTcl(page, `${action}; focus -force .second; update`);
    await expect(preedit).toBeHidden();
    await dispatchComposition(page, "compositionupdate", "遅延");
    await dispatchComposition(page, "compositionend", "遅延");
    await expect(preedit).toBeHidden();
    expect(await evalTcl(page, ".second get")).toBe("");
  });
}
