// @ts-check

const { test, expect } = require("@playwright/test");

test("Tk popup menu dispatches command from browser pointer input", async ({
  page,
}) => {
  const script = [
    "proc ::recordMenu {value} {browser::setStatus $value}",
    "menu .popup -tearoff 0",
    ".popup add command -label Alpha -command {::recordMenu alpha}",
    ".popup add command -label Beta -command {::recordMenu beta}",
    "update",
    "tk_popup .popup 40 40",
    "update",
    "list ready [winfo id .popup] [winfo ismapped .popup] [winfo width .popup] [winfo height .popup]",
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
  const menuId = Number.parseInt(ready[1], 0);
  const menuWidth = Number.parseInt(ready[3], 10);
  const menuHeight = Number.parseInt(ready[4], 10);
  expect(menuId, `unexpected menu window id: ${ready[1]}`).toBeGreaterThan(0);
  expect(ready[2]).toBe("1");
  expect(menuWidth).toBeGreaterThan(10);
  expect(menuHeight).toBeGreaterThan(10);

  const menu = page.locator(`[data-x11-wasm-xid="${menuId}"]`);
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box, "missing menu bounding box").not.toBeNull();
  expect(Math.round(box.width)).toBe(menuWidth);
  expect(Math.round(box.height)).toBe(menuHeight);
  await page.mouse.click(
    box.x + Math.min(menuWidth - 2, Math.max(4, menuWidth / 2)),
    box.y + Math.min(menuHeight - 2, Math.max(4, menuHeight / 4)),
  );

  await expect(page.locator("#tk-browser-status")).toHaveText("alpha");
  await expect(menu).toBeHidden();
});

test("Tk menubutton invokes menu entry from press-drag-release", async ({
  page,
}) => {
  const script = [
    "proc ::recordMenu {value} {browser::setStatus $value}",
    "menubutton .mb -text Choices -menu .mb.menu -relief raised",
    "menu .mb.menu -tearoff 0",
    ".mb.menu add command -label Alpha -command {::recordMenu alpha}",
    ".mb.menu add command -label Beta -command {::recordMenu beta}",
    "pack .mb -padx 20 -pady 20",
    "update",
    "list ready [winfo id .mb] [winfo id .mb.menu] [winfo width .mb] [winfo height .mb]",
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
  const buttonId = Number.parseInt(ready[1], 0);
  const menuId = Number.parseInt(ready[2], 0);
  expect(buttonId, `unexpected menubutton id: ${ready[1]}`).toBeGreaterThan(0);
  expect(menuId, `unexpected menu id: ${ready[2]}`).toBeGreaterThan(0);

  const button = page.locator(`[data-x11-wasm-xid="${buttonId}"]`);
  const menu = page.locator(`[data-x11-wasm-xid="${menuId}"]`);
  await expect(button).toBeVisible();
  const buttonBox = await button.boundingBox();
  expect(buttonBox, "missing menubutton bounding box").not.toBeNull();

  await page.mouse.move(
    buttonBox.x + buttonBox.width / 2,
    buttonBox.y + buttonBox.height / 2,
  );
  await page.mouse.down();
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox, "missing menubutton menu bounding box").not.toBeNull();
  await page.mouse.move(
    menuBox.x + Math.min(menuBox.width - 2, Math.max(4, menuBox.width / 2)),
    menuBox.y + Math.min(menuBox.height - 2, Math.max(4, menuBox.height / 4)),
  );
  await page.mouse.up();

  await expect(page.locator("#tk-browser-status")).toHaveText("alpha");
  await expect(menu).toBeHidden();
});
