// @ts-check

const { test, expect } = require("@playwright/test");

for (const count of [3, 8]) {
  test(`Tk menubar with ${count} cascades maps its client and invokes a command`, async ({
    page,
  }) => {
    const script = [
      "catch {destroy .root}",
      "menu .m",
      ". configure -menu .m",
      ...Array.from({ length: count }, (_, index) => {
        const item = index + 1;
        return [
          `menu .m.${item}`,
          `.m.${item} add command -label New${item} -command {browser::setStatus {selected ${item}}}`,
          `.m add cascade -label File${item} -menu .m.${item}`,
        ].join("\n");
      }),
      "update",
      "set bar {}",
      'foreach child [winfo children .] {if {[winfo class $child] eq "Menu" && [$child cget -type] eq "menubar"} {set bar $child}}',
      "set popup [$bar entrycget 1 -menu]",
      "list ready [winfo id .] [winfo id $bar] [winfo id $popup] [$bar xposition 1] [$bar yposition 1] [winfo reqwidth $popup] [winfo reqheight $popup]",
    ].join("\n");
    await page.goto(`/tcltk.html?${new URLSearchParams({ eval: script })}`);
    await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
      timeout: 15000,
    });
    const ready = ((await page.locator("#tk-browser-result").textContent()) || "")
      .trim()
      .split(/\s+/);
    expect(ready[0]).toBe("ready");
    const clientId = Number.parseInt(ready[1], 0);
    const barId = Number.parseInt(ready[2], 0);
    const popupId = Number.parseInt(ready[3], 0);
    const bar = page.locator(`[data-x11-wasm-xid="${barId}"]`);
    const popup = page.locator(`[data-x11-wasm-xid="${popupId}"]`);
    await expect(page.locator(`[data-x11-wasm-xid="${clientId}"]`)).toBeVisible();
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(
      box.x + Number(ready[4]) + 15,
      box.y + Number(ready[5]) + 10,
    );
    await expect(popup).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await popup.boundingBox();
        return bounds && [bounds.width, bounds.height];
      })
      .toEqual([Number(ready[6]), Number(ready[7])]);
    const popupBox = await popup.boundingBox();
    expect(popupBox).not.toBeNull();
    await page.mouse.click(
      popupBox.x + popupBox.width / 2,
      popupBox.y + popupBox.height - 8,
    );
    await expect(page.locator("#tk-browser-status")).toHaveText("selected 1");
    await expect(popup).toBeHidden();
  });
}

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

test("Tk option menu updates its variable from press-drag-release", async ({
  page,
}) => {
  const script = [
    "set ::choice Alpha",
    "proc ::recordChoice {args} {browser::setStatus $::choice}",
    "trace add variable ::choice write ::recordChoice",
    "set menu [tk_optionMenu .choice ::choice Alpha Beta Gamma]",
    "pack .choice -padx 20 -pady 20",
    "update",
    "list ready [winfo id .choice] [winfo id $menu] $::choice [winfo width .choice] [winfo height .choice]",
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
  expect(buttonId, `unexpected option menu id: ${ready[1]}`).toBeGreaterThan(0);
  expect(menuId, `unexpected option menu menu id: ${ready[2]}`).toBeGreaterThan(
    0,
  );
  expect(ready[3]).toBe("Alpha");

  const button = page.locator(`[data-x11-wasm-xid="${buttonId}"]`);
  const menu = page.locator(`[data-x11-wasm-xid="${menuId}"]`);
  await expect(button).toBeVisible();
  const buttonBox = await button.boundingBox();
  expect(buttonBox, "missing option menu bounding box").not.toBeNull();

  await page.mouse.move(
    buttonBox.x + buttonBox.width / 2,
    buttonBox.y + buttonBox.height / 2,
  );
  await page.mouse.down();
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox, "missing option menu menu bounding box").not.toBeNull();
  await page.mouse.move(
    menuBox.x + Math.min(menuBox.width - 2, Math.max(4, menuBox.width / 2)),
    menuBox.y + Math.min(menuBox.height - 2, Math.max(4, menuBox.height / 2)),
  );
  await page.mouse.up();

  await expect(page.locator("#tk-browser-status")).toHaveText("Beta");
  await expect(menu).toBeHidden();
});
