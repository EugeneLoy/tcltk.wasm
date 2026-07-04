// @ts-check

const { test, expect } = require("@playwright/test");

test("Tk create events are delivered for child windows", async ({ page }) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {lappend ::events $event}",
    "frame .parent -width 120 -height 80 -background white",
    "pack .parent",
    "update idletasks",
    "bind .parent <Create> {::record [list create %W %i %x %y %w %h %B]}",
    "frame .parent.child -width 31 -height 17 -borderwidth 2",
    "place .parent.child -x 6 -y 7",
    "update",
    "set event {}",
    "if {[llength $::events] > 0} {set event [lindex $::events 0]}",
    "concat [list ready [llength $::events]] $event [list [winfo id .parent] [winfo id .parent.child]]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result[0], `unexpected Tcl result: ${result.join(" ")}`).toBe("ready");
  expect(Number(result[1]), `unexpected event count: ${result.join(" ")}`).toBe(
    1,
  );
  expect(result[2]).toBe("create");
  expect(result[3]).toBe(".parent");
  expect(Number.parseInt(result[4], 0)).toBeGreaterThan(0);
  expect(Number.parseInt(result[4], 0)).not.toBe(Number.parseInt(result[9], 0));
  expect(Number(result[7])).toBe(31);
  expect(Number(result[8])).toBe(17);
});

test("Tk visibility events are delivered when windows map", async ({ page }) => {
  const script = [
    "set ::events {}",
    "frame .vis -width 90 -height 40 -background white",
    "frame .vis.child -width 22 -height 11 -background blue",
    "pack .vis.child",
    "bind .vis.child <Visibility> {lappend ::events [list %W %s]}",
    "after 0 {pack .vis}",
    "set timeout [after 1000 {destroy .vis}]",
    "set code [catch {tkwait visibility .vis.child} message]",
    "catch {after cancel $timeout}",
    "if {$code} {",
    "  list error $message",
    "} else {",
    "  update",
    "  set event {}",
    "  if {[llength $::events] > 0} {set event [lindex $::events 0]}",
    "  concat [list ready [llength $::events] [winfo ismapped .vis.child]] $event",
    "}",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result[0], `unexpected Tcl result: ${result.join(" ")}`).toBe("ready");
  expect(
    Number(result[1]),
    `unexpected event count: ${result.join(" ")}`,
  ).toBeGreaterThan(0);
  expect(result[2]).toBe("1");
  expect(result[3]).toBe(".vis.child");
  expect(result[4]).toBe("VisibilityUnobscured");
});

test("event generate -subwindow accepts browser window ids", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {lappend ::events $event}",
    "frame .parent -width 120 -height 80 -background white",
    "frame .parent.child -width 30 -height 20 -background blue",
    "place .parent.child -x 6 -y 7",
    "pack .parent",
    "update idletasks",
    "bind .parent <Motion> {::record [list motion %W %x %y %X %Y %s %S]}",
    "set childId [winfo id .parent.child]",
    "event generate .parent <Motion> -x 14 -y 15 -rootx 140 -rooty 150 -state 256 -subwindow $childId",
    "update",
    "concat [list ready [llength $::events] [winfo id .parent] $childId] [lindex $::events 0]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toHaveLength(12);
  expect(result[0]).toBe("ready");
  expect(result[1]).toBe("1");
  const parentId = Number.parseInt(result[2], 0);
  const childId = Number.parseInt(result[3], 0);
  expect(parentId).toBeGreaterThan(0);
  expect(childId).toBeGreaterThan(0);
  expect(parentId).not.toBe(childId);
  expect(result.slice(4, 11)).toEqual([
    "motion",
    ".parent",
    "14",
    "15",
    "140",
    "150",
    "256",
  ]);
  expect(Number.parseInt(result[11], 0)).toBe(childId);
});

test("DOM input is delivered through Tk window events", async ({ page }) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .target -width 160 -height 120 -background white",
    "pack .target",
    "update idletasks",
    "bind .target <Enter> {::record [list enter %x %y %X %Y %s]}",
    "bind .target <Leave> {::record [list leave %x %y %X %Y %s]}",
    "bind .target <FocusIn> {::record [list focusin]}",
    "bind .target <FocusOut> {::record [list focusout]}",
    "bind .target <ButtonPress-1> {::record [list button %b %x %y %X %Y %s]}",
    "bind .target <KeyPress> {::record [list key %K %k %A %s]}",
    "bind .target <KeyRelease> {::record [list keyrelease %K %k %A %s]}",
    "bind .target <MouseWheel> {::record [list wheel %D %x %y %s]}",
    "list ready [winfo id .target]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-result")).toHaveText(/ready\s+\d+/, {
    timeout: 15000,
  });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(ready[0], `unexpected Tcl result: ${ready.join(" ")}`).toBe("ready");
  const targetId = Number.parseInt(ready[1], 0);
  expect(targetId, `unexpected target window id: ${ready[1]}`).toBeGreaterThan(
    0,
  );

  const status = page.locator("#tk-browser-status");
  const target = page.locator(`[data-x11-wasm-xid="${targetId}"]`);
  const eventMask = Number.parseInt(
    (await target.getAttribute("data-x11-wasm-event-mask")) || "0",
    10,
  );
  expect(eventMask).toBeGreaterThan(0);
  expect(eventMask & (1 << 0)).toBeTruthy();
  expect(eventMask & (1 << 1)).toBeTruthy();
  expect(eventMask & (1 << 2)).toBeTruthy();
  expect(eventMask & (1 << 4)).toBeTruthy();
  expect(eventMask & (1 << 5)).toBeTruthy();
  expect(eventMask & (1 << 21)).toBeTruthy();
  expect(eventMask & (1 << 28)).toBeTruthy();
  await target.hover({ position: { x: 4, y: 5 } });
  await expect(status).toHaveText(/enter \d+ \d+ \d+ \d+ 0/);

  await target.click({ position: { x: 4, y: 5 } });
  await expect(status).toContainText(/button 1 \d+ \d+ \d+ \d+ 0/);
  await page.evaluate(() => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    input.focus();
    input.dispatchEvent(new FocusEvent("focus"));
  });
  await expect(status).toContainText("focusin");
  await page.keyboard.type("a");
  await expect(status).toContainText(/key a \d+ a 0/);
  await expect(status).toContainText(/keyrelease a \d+ \{\} 0/);

  await page.evaluate(() => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    for (const type of ["keydown", "keyup"]) {
      input.dispatchEvent(
        new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
        }),
      );
    }
  });
  await expect(status).toContainText("key Return 13");
  await expect(status).toContainText("keyrelease Return 13");

  await page.mouse.wheel(0, 100);
  await expect(status).toContainText(/wheel -120 \d+ \d+ 0/);

  await page.mouse.move(220, 5);
  await expect(status).toContainText("leave");
  await page.evaluate(() => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    input.blur();
    input.dispatchEvent(new FocusEvent("blur"));
  });
  await expect(status).toContainText("focusout");
});

test("Tk entry caret is drawn after browser focus", async ({ page }) => {
  const script = [
    "set ::events {}",
    "proc ::report {} {",
    "    set bbox {}",
    "    catch {set bbox [.target bbox insert]}",
    "    browser::setResult [list state [focus] $::events [.target index insert] $bbox [.target get]]",
    "}",
    "entry .target -width 42 -insertbackground red -insertwidth 4 -insertofftime 0 -insertontime 60000",
    ".target insert 0 abc",
    "pack .target -padx 20 -pady 20",
    "update idletasks",
    "bind .target <FocusIn> {lappend ::events [list in %d %m %W]; after idle ::report}",
    "bind .target <FocusOut> {lappend ::events [list out %d %m %W]; after idle ::report}",
    "bind .target <KeyRelease> {after idle ::report}",
    "list ready [winfo id .target]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-result")).toHaveText(/ready\s+\d+/, {
    timeout: 15000,
  });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(ready[0], `unexpected Tcl result: ${ready.join(" ")}`).toBe("ready");
  const targetId = Number.parseInt(ready[1], 0);
  expect(targetId, `unexpected target window id: ${ready[1]}`).toBeGreaterThan(
    0,
  );

  await page.evaluate(() => {
    const browserWindow =
      /** @type {Window & { Module?: { x11WasmBackend?: { drawRectangle?: Function, __entryCaretWrapped?: boolean } }, __entryCaretRects?: Array<{ pixel: number, width: number, height: number, fill: boolean }> }} */ (
        window
      );
    const backend = browserWindow.Module?.x11WasmBackend;
    browserWindow.__entryCaretRects = [];
    if (!backend?.drawRectangle || backend.__entryCaretWrapped) {
      return;
    }
    const drawRectangle = backend.drawRectangle.bind(backend);
    backend.drawRectangle = function (id, pixel, x, y, width, height, fill) {
      browserWindow.__entryCaretRects?.push({ pixel, width, height, fill });
      return drawRectangle(id, pixel, x, y, width, height, fill);
    };
    backend.__entryCaretWrapped = true;
  });

  const target = page.locator(`[data-x11-wasm-xid="${targetId}"]`);
  await target.click({ position: { x: 36, y: 10 } });
  await page.keyboard.type("z");
  await expect(page.locator("#tk-browser-result")).toContainText(
    "state .target",
  );

  const result = (await page.locator("#tk-browser-result").textContent()) || "";
  expect(result).toContain("{in NotifyAncestor NotifyNormal .target}");
  expect(result).not.toContain("{out ");
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            (
              /** @type {Window & { __entryCaretRects?: Array<{ pixel: number, width: number, height: number, fill: boolean }> }} */ (
                window
              )
            ).__entryCaretRects || []
          ).filter(
            (rect) =>
              (rect.pixel & 0xffffff) === 0xff0000 &&
              rect.fill &&
              rect.width >= 4 &&
              rect.height > 0,
          ).length,
      ),
    )
    .toBeGreaterThan(0);
});

test("Tk key bindings receive control characters from XLookupString", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::recordKey {keysym keycode char state} {",
    "    set code -1",
    "    if {[string length $char] > 0} {",
    "        scan $char %c code",
    "    }",
    "    lappend ::events [list $keysym $keycode $code $state]",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .target -width 160 -height 80 -background white -takefocus 1",
    "pack .target",
    "update idletasks",
    "bind .target <KeyPress> {::recordKey %K %k %A %s}",
    "focus -force .target",
    "update",
    "list ready [winfo id .target] [focus]",
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
  expect(ready[2]).toBe(".target");

  const status = page.locator("#tk-browser-status");
  const dispatchKey = async (key, code, keyCode) => {
    await page.evaluate(
      ({ key, code, keyCode }) => {
        const input = document.querySelector(".x11-wasm-input");
        if (!(input instanceof HTMLTextAreaElement)) {
          throw new Error("missing browser input textarea");
        }
        input.focus();
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key,
            code,
            keyCode,
            which: keyCode,
          }),
        );
      },
      { key, code, keyCode },
    );
  };

  await dispatchKey("Enter", "Enter", 13);
  await expect(status).toContainText("Return 13 13 0");
  await dispatchKey("Tab", "Tab", 9);
  await expect(status).toContainText("Tab 9 9 0");
  await dispatchKey("Backspace", "Backspace", 8);
  await expect(status).toContainText("BackSpace 8 8 0");
  await dispatchKey("Escape", "Escape", 27);
  await expect(status).toContainText("Escape 27 27 0");
  await dispatchKey("Delete", "Delete", 46);
  await expect(status).toContainText("Delete 46 127 0");
});

test("DOM wheel events accumulate pixel deltas and mark horizontal scroll", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .target -width 160 -height 120 -background white",
    "pack .target",
    "update idletasks",
    "bind .target <MouseWheel> {::record [list wheel %D %x %y %s]}",
    "list ready [winfo id .target]",
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
  const targetId = Number.parseInt(ready[1], 0);
  expect(targetId).toBeGreaterThan(0);

  const status = page.locator("#tk-browser-status");
  const target = page.locator(`[data-x11-wasm-xid="${targetId}"]`);
  await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fire = (deltaX, deltaY) => {
      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 8,
          clientY: rect.top + 9,
          deltaX,
          deltaY,
          deltaMode: 0,
        }),
      );
    };
    fire(0, 25);
    fire(0, 25);
    fire(0, 25);
  });
  expect(await status.textContent()).toBe("eval ok");

  await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 8,
        clientY: rect.top + 9,
        deltaY: 25,
        deltaMode: 0,
      }),
    );
  });
  await expect(status).toContainText(/wheel -120 \d+ \d+ 0/);

  await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 8,
        clientY: rect.top + 9,
        deltaX: 100,
        deltaY: 0,
        deltaMode: 0,
      }),
    );
  });
  await expect(status).toContainText(/wheel -120 \d+ \d+ 1/);
});

test("Tk modifier bindings resolve browser modifier map", async ({ page }) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "proc ::recordControl {keysym char state} {",
    "    set code -1",
    "    if {[string length $char] > 0} {scan $char %c code}",
    "    ::record [list control $keysym $code $state]",
    "}",
    "frame .target -width 160 -height 80 -background white -takefocus 1",
    "pack .target",
    "update idletasks",
    "bind .target <Control-Key-a> {::recordControl %K %A %s}",
    "bind .target <Alt-Key-a> {::record [list alt %K %A %s]}",
    "bind .target <Meta-Key-a> {::record [list meta %K %A %s]}",
    "bind .target <KeyPress> {::record [list key %K %k %s]}",
    "focus -force .target",
    "list ready [winfo id .target] [focus]",
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
  expect(ready[2], `expected focus on target: ${ready.join(" ")}`).toBe(
    ".target",
  );
  const targetId = Number.parseInt(ready[1], 0);
  expect(targetId, `unexpected target window id: ${ready[1]}`).toBeGreaterThan(
    0,
  );

  const status = page.locator("#tk-browser-status");
  await page.locator(`[data-x11-wasm-xid="${targetId}"]`).click({
    position: { x: 4, y: 5 },
  });
  await page.evaluate(() => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    /** @param {KeyboardEventInit} init */
    const fire = (init) => {
      for (const type of ["keydown", "keyup"]) {
        input.dispatchEvent(
          new KeyboardEvent(type, {
            bubbles: true,
            cancelable: true,
            key: "a",
            code: "KeyA",
            keyCode: 65,
            which: 65,
            ...init,
          }),
        );
      }
    };
    /** @param {KeyboardEventInit} init */
    const fireRightModifier = (init) => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          location: 2,
          ...init,
        }),
      );
    };
    input.focus();
    fire({ ctrlKey: true });
    fire({ altKey: true });
    fire({ metaKey: true });
    fireRightModifier({
      key: "Shift",
      code: "ShiftRight",
      keyCode: 161,
      which: 161,
      shiftKey: true,
    });
    fireRightModifier({
      key: "Control",
      code: "ControlRight",
      keyCode: 163,
      which: 163,
      ctrlKey: true,
    });
    fireRightModifier({
      key: "Alt",
      code: "AltRight",
      keyCode: 165,
      which: 165,
      altKey: true,
    });
    fireRightModifier({
      key: "Meta",
      code: "MetaRight",
      keyCode: 92,
      which: 92,
      metaKey: true,
    });
  });

  await expect(status).toContainText(/control a 1 4/);
  await expect(status).toContainText(/alt a a 8/);
  await expect(status).toContainText(/meta a a 64/);
  await expect(status).toContainText(/key Shift_R 161 1/);
  await expect(status).toContainText(/key Control_R 163 4/);
  await expect(status).toContainText(/key Alt_R 165 8/);
  await expect(status).toContainText(/key Meta_R 92 64/);
});

test("browser command aliases reach Tk virtual and script shortcuts", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::report {} {browser::setResult [list events $::events]}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    after idle ::report",
    "}",
    "entry .target",
    ".target insert 0 shortcut",
    ".target selection range 0 end",
    "pack .target",
    "bind .target <<Copy>> {::record [list standard copy %W]}",
    "bind all <Meta-Shift-Key-S> {::record [list script save %W]; break}",
    "focus -force .target",
    "update",
    "list ready [winfo id .target] [focus]",
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
  expect(ready[2], `expected focus on target: ${ready.join(" ")}`).toBe(
    ".target",
  );

  await page.evaluate(() => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    /** @param {KeyboardEventInit} init */
    const fire = (init) => {
      for (const type of ["keydown", "keyup"]) {
        input.dispatchEvent(
          new KeyboardEvent(type, {
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        );
      }
    };
    input.focus();
    fire({
      key: "c",
      code: "KeyC",
      keyCode: 67,
      which: 67,
      metaKey: true,
    });
    fire({
      key: "S",
      code: "KeyS",
      keyCode: 83,
      which: 83,
      metaKey: true,
      shiftKey: true,
    });
  });

  await expect(page.locator("#tk-browser-result")).toHaveText(
    "events {{standard copy .target} {script save .target}}",
  );
});

test("browser command shortcuts do not select hidden textarea text", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::report {} {browser::setResult [list events $::events]}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    after idle ::report",
    "}",
    "entry .target",
    "pack .target",
    "bind .target <Meta-Key-a> {::record [list meta a %s]}",
    "bind .target <Control-Key-a> {::record [list control a %s]}",
    "focus -force .target",
    "update",
    "list ready [winfo id .target] [focus]",
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
  expect(ready[2], `expected focus on target: ${ready.join(" ")}`).toBe(
    ".target",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.classList.contains("x11-wasm-input"),
      ),
    )
    .toBe(true);

  const initial = await page.evaluate(() => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    input.value = "hidden textarea content that must not be selected";
    input.setSelectionRange(input.value.length, input.value.length);
    const rect = input.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      valueLength: input.value.length,
    };
  });
  expect(initial).toMatchObject({
    width: 1,
    height: 1,
    selectionStart: initial.valueLength,
    selectionEnd: initial.valueLength,
  });

  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const expectedEvent =
    modifier === "Meta" ? /events \{\{meta a 64\}\}/ : /events \{\{control a 4\}\}/;
  await page.keyboard.down(modifier);
  await page.keyboard.press("KeyA");
  const during = await page.evaluate(() => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    const rect = input.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      valueLength: input.value.length,
    };
  });
  await expect(page.locator("#tk-browser-result")).toHaveText(expectedEvent);
  expect(during).toMatchObject({
    width: 1,
    height: 1,
    selectionStart: during.valueLength,
    selectionEnd: during.valueLength,
  });
  await page.keyboard.up(modifier);
});

test("Tk generated shifted ASCII keysyms infer Shift state", async ({ page }) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "}",
    "frame .target -width 160 -height 80 -background white -takefocus 1",
    "pack .target",
    "update idletasks",
    "bind .target <KeyPress> {::record [list %K %A %s]}",
    "focus -force .target",
    "event generate .target <KeyPress> -keysym A",
    "event generate .target <KeyPress> -keysym exclam",
    "update",
    "list ready [join $::events {|}]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim();
  expect(result).toContain("A A 1");
  expect(result).toContain("exclam ! 1");
});

test("Tk generated Latin-1 keysyms resolve through XStringToKeysym", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {keysym char state} {",
    "    set code -1",
    "    if {[string length $char] > 0} {scan $char %c code}",
    "    lappend ::events [list $keysym $code $state]",
    "}",
    "frame .target -width 160 -height 80 -background white -takefocus 1",
    "pack .target",
    "update idletasks",
    "bind .target <KeyPress> {::record %K %A %s}",
    "focus -force .target",
    "event generate .target <KeyPress> -keysym eacute",
    "event generate .target <KeyPress> -keysym adiaeresis",
    "update",
    "list ready [join $::events {|}]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim();
  expect(result).toContain("eacute 233 0");
  expect(result).toContain("adiaeresis 228 0");
});

test("input method context preserves DOM key text", async ({ page }) => {
  const script = [
    "tk useinputmethods 1",
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .target -width 160 -height 80 -background white",
    "pack .target",
    "update idletasks",
    "bind .target <FocusIn> {::record [list focusin]}",
    "bind .target <KeyPress> {::record [list key %K %A]}",
    "bind .target <KeyRelease> {::record [list keyrelease %K %A]}",
    "list ready [winfo id .target] [tk useinputmethods]",
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
  expect(ready[2], `input methods were not enabled: ${ready.join(" ")}`).toBe(
    "1",
  );
  const targetId = Number.parseInt(ready[1], 0);
  expect(targetId, `unexpected target window id: ${ready[1]}`).toBeGreaterThan(
    0,
  );

  const status = page.locator("#tk-browser-status");
  const target = page.locator(`[data-x11-wasm-xid="${targetId}"]`);
  await target.click({ position: { x: 4, y: 5 } });
  await page.evaluate(() => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    input.focus();
    input.dispatchEvent(new FocusEvent("focus"));
  });
  await expect(status).toContainText("focusin");
  await page.keyboard.type("a");
  await expect(status).toContainText("key a a");
  await expect(status).toContainText("keyrelease a {}");
  const beforeImeControlKey = (await status.textContent()) || "";
  await page.evaluate(() => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    for (const type of ["keydown", "keyup"]) {
      input.dispatchEvent(
        new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          key: "Process",
          code: "Process",
          keyCode: 229,
          which: 229,
        }),
      );
    }
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(status).toHaveText(beforeImeControlKey);
  await page.keyboard.type("あ");
  await expect(status).toContainText(/key .* あ/);
});

test("DOM composition events surface as Tk virtual events", async ({
  page,
}) => {
  const script = [
    "tk useinputmethods 1",
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "entry .target",
    "pack .target",
    "update idletasks",
    "bind .target <<X11WasmCompositionStart>> {::record [list start %d]}",
    "bind .target <<X11WasmCompositionUpdate>> {::record [list update %d]}",
    "bind .target <<X11WasmCompositionEnd>> {::record [list end %d]}",
    "bind .target <KeyPress> {::record [list key %K %A]}",
    "focus -force .target",
    "update",
    "list ready [winfo id .target] [focus] [tk useinputmethods]",
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
  expect(ready[2], `expected focus on target: ${ready.join(" ")}`).toBe(
    ".target",
  );
  expect(ready[3], `input methods were not enabled: ${ready.join(" ")}`).toBe(
    "1",
  );
  const targetId = Number.parseInt(ready[1], 0);
  expect(targetId, `unexpected target window id: ${ready[1]}`).toBeGreaterThan(
    0,
  );

  const status = page.locator("#tk-browser-status");
  await page.evaluate((windowId) => {
    const input = document.querySelector(".x11-wasm-input");
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: { focusInput?: Function } } }} */ (
        window
      ).Module?.x11WasmBackend;
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    backend?.focusInput?.(true, windowId);
    input.focus();
    input.dispatchEvent(new FocusEvent("focus"));
  }, targetId);

  const dispatchComposition = async (type, data) => {
    await page.evaluate(
      ({ type, data }) => {
        const input = document.querySelector(".x11-wasm-input");
        if (!(input instanceof HTMLTextAreaElement)) {
          throw new Error("missing browser input textarea");
        }
        const event =
          typeof CompositionEvent === "function"
            ? new CompositionEvent(type, {
                bubbles: true,
                cancelable: true,
                data,
              })
            : new Event(type, { bubbles: true, cancelable: true });
        if (!("data" in event)) {
          Object.defineProperty(event, "data", { value: data });
        }
        input.dispatchEvent(event);
      },
      { type, data },
    );
  };

  await dispatchComposition("compositionstart", "k");
  await expect(status).toContainText("start k");
  await dispatchComposition("compositionupdate", "か");
  await expect(status).toContainText("update か");
  await dispatchComposition("compositionend", "か");
  await expect(status).toContainText("end か");
  await expect(status).toContainText(/key .* か/);
});

test("DOM composition target survives Tk focus changes", async ({ page }) => {
  const script = [
    "tk useinputmethods 1",
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "entry .first",
    "entry .second",
    "pack .first",
    "pack .second",
    "update idletasks",
    "bind .first <<X11WasmCompositionStart>> {::record [list first start %d]; focus -force .second; update}",
    "bind .first <<X11WasmCompositionUpdate>> {::record [list first update %d]}",
    "bind .first <<X11WasmCompositionEnd>> {::record [list first end %d]}",
    "bind .first <KeyPress> {::record [list first key %K %A]}",
    "bind .second <<X11WasmCompositionStart>> {::record [list second start %d]}",
    "bind .second <<X11WasmCompositionUpdate>> {::record [list second update %d]}",
    "bind .second <<X11WasmCompositionEnd>> {::record [list second end %d]}",
    "bind .second <KeyPress> {::record [list second key %K %A]}",
    "focus -force .first",
    "update",
    "list ready [winfo id .first] [winfo id .second] [focus] [tk useinputmethods]",
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
  expect(ready[3], `expected focus on first: ${ready.join(" ")}`).toBe(
    ".first",
  );
  expect(ready[4], `input methods were not enabled: ${ready.join(" ")}`).toBe(
    "1",
  );
  const firstId = Number.parseInt(ready[1], 0);
  const secondId = Number.parseInt(ready[2], 0);
  expect(firstId, `unexpected first window id: ${ready[1]}`).toBeGreaterThan(0);
  expect(secondId, `unexpected second window id: ${ready[2]}`).toBeGreaterThan(
    0,
  );

  const status = page.locator("#tk-browser-status");
  await page.evaluate((windowId) => {
    const input = document.querySelector(".x11-wasm-input");
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: { focusInput?: Function } } }} */ (
        window
      ).Module?.x11WasmBackend;
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    backend?.focusInput?.(true, windowId);
    input.focus();
    input.dispatchEvent(new FocusEvent("focus"));
  }, firstId);

  const dispatchComposition = async (type, data) => {
    await page.evaluate(
      ({ type, data }) => {
        const input = document.querySelector(".x11-wasm-input");
        if (!(input instanceof HTMLTextAreaElement)) {
          throw new Error("missing browser input textarea");
        }
        const event =
          typeof CompositionEvent === "function"
            ? new CompositionEvent(type, {
                bubbles: true,
                cancelable: true,
                data,
              })
            : new Event(type, { bubbles: true, cancelable: true });
        if (!("data" in event)) {
          Object.defineProperty(event, "data", { value: data });
        }
        input.dispatchEvent(event);
      },
      { type, data },
    );
  };

  await dispatchComposition("compositionstart", "k");
  await expect(status).toContainText("first start k");
  await dispatchComposition("compositionupdate", "か");
  await expect(status).toContainText("first update か");
  await dispatchComposition("compositionend", "か");
  await expect(status).toContainText("first end か");
  await expect(status).toContainText(/first key .* か/);
  await expect(status).not.toContainText("second start");
  await expect(status).not.toContainText("second update");
  await expect(status).not.toContainText("second end");
  await expect(status).not.toContainText("second key");
});

test("Tk focus -force claims browser input without pointer click", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .first -width 80 -height 80 -background gray -takefocus 1",
    "frame .target -width 160 -height 80 -background white -takefocus 1",
    "pack .first",
    "pack .target",
    "update idletasks",
    "bind .target <KeyPress> {::record [list key %K %A %s]}",
    "focus -force .first",
    "update",
    "focus -force .target",
    "update",
    "list ready [winfo id .first] [winfo id .target] [focus]",
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
  expect(ready[3], `expected focus on target: ${ready.join(" ")}`).toBe(
    ".target",
  );
  const firstId = Number.parseInt(ready[1], 0);
  const targetId = Number.parseInt(ready[2], 0);
  expect(firstId, `unexpected first window id: ${ready[1]}`).toBeGreaterThan(0);
  expect(targetId, `unexpected target window id: ${ready[2]}`).toBeGreaterThan(
    0,
  );
  const first = page.locator(`[data-x11-wasm-xid="${firstId}"]`);
  const target = page.locator(`[data-x11-wasm-xid="${targetId}"]`);
  await expect(first).toBeAttached();
  await expect(target).toBeAttached();
  expect(
    await page.evaluate(
      () => document.activeElement?.classList.contains("x11-wasm-input"),
    ),
  ).toBe(true);
  const focusSnapshot = await page.evaluate(() => {
    const focusedWindows = Array.from(
      document.querySelectorAll('[data-x11-wasm-focused="1"]'),
      (element) =>
        Number.parseInt(element.getAttribute("data-x11-wasm-xid") || "0", 0),
    ).filter((id) => id > 0);
    const inputFocusWindow = Number.parseInt(
      document
        .querySelector(".x11-wasm-input")
        ?.getAttribute("data-x11-wasm-focus-window") || "0",
      0,
    );
    const backendFocusWindow =
      /** @type {Window & { Module?: { x11WasmBackend?: { focusedWindow?: number } } }} */ (
        window
      ).Module?.x11WasmBackend?.focusedWindow || 0;
    return { backendFocusWindow, focusedWindows, inputFocusWindow };
  });
  expect(focusSnapshot.focusedWindows).toHaveLength(1);
  expect(focusSnapshot.focusedWindows[0]).not.toBe(firstId);
  expect(focusSnapshot.inputFocusWindow).toBe(focusSnapshot.focusedWindows[0]);
  expect(focusSnapshot.backendFocusWindow).toBe(
    focusSnapshot.focusedWindows[0],
  );

  await page.keyboard.type("a");
  await expect(page.locator("#tk-browser-status")).toContainText("key a a 0");
});

test("root hit-test follows Tk stacking order and mapped visibility", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .bottom -width 80 -height 60 -background white",
    "frame .top -width 80 -height 60 -background black",
    "place .bottom -x 20 -y 20 -width 80 -height 60",
    "place .top -x 20 -y 20 -width 80 -height 60",
    "bind .bottom <ButtonPress-1> {::record [list bottom %x %y %X %Y]; lower .bottom; update idletasks}",
    "bind .top <ButtonPress-1> {::record [list top %x %y %X %Y]; place forget .top; update idletasks}",
    "raise .bottom",
    "update idletasks",
    "list ready [winfo id .bottom] [winfo id .top]",
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
  const bottomId = Number.parseInt(ready[1], 0);
  const topId = Number.parseInt(ready[2], 0);
  expect(bottomId).toBeGreaterThan(0);
  expect(topId).toBeGreaterThan(0);

  const status = page.locator("#tk-browser-status");
  const root = page.locator("#tk-browser-root");
  const visualTopId = await root.evaluate((rootElement) => {
    const rect = rootElement.getBoundingClientRect();
    const pointElement = document.elementFromPoint(rect.left + 30, rect.top + 30);
    const windowElement = pointElement?.closest(".x11-wasm-window");
    return Number.parseInt(
      windowElement?.getAttribute("data-x11-wasm-xid") || "0",
      0,
    );
  });
  expect(visualTopId).toBe(bottomId);

  const readEvents = async () =>
    ((await status.textContent()) || "")
      .split("|")
      .filter((event) => /^(bottom|top) /.test(event));
  /** @param {number} index @param {"bottom" | "top"} name */
  const expectHit = async (index, name) => {
    await expect
      .poll(async () => (await readEvents()).length)
      .toBeGreaterThan(index);
    const events = await readEvents();
    const match = events[index].match(/^(bottom|top) (\d+) (\d+) (\d+) (\d+)$/);
    expect(match, `unexpected event: ${events[index]}`).not.toBeNull();
    if (!match) {
      return;
    }
    expect(match[1]).toBe(name);
    expect(Number(match[4]) - Number(match[2])).toBe(20);
    expect(Number(match[5]) - Number(match[3])).toBe(20);
  };

  await root.click({ position: { x: 30, y: 30 } });
  await expectHit(0, "bottom");

  await root.click({ position: { x: 30, y: 30 } });
  await expectHit(1, "top");

  await root.click({ position: { x: 30, y: 30 } });
  await expectHit(2, "bottom");
});

test("pointer grab retargets DOM pointer events through Tk", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .grab -width 80 -height 60 -background white",
    "frame .outside -width 80 -height 60 -background black",
    "pack .grab .outside -side left",
    "update idletasks",
    "bind .grab <ButtonPress-1> {::record [list grab-button %b %x %y %X %Y %s]}",
    "bind .grab <MouseWheel> {::record [list grab-wheel %D %x %y %s]}",
    "grab set .grab",
    "list ready [winfo id .grab] [winfo id .outside]",
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
  const outsideId = Number.parseInt(ready[2], 0);
  expect(
    outsideId,
    `unexpected outside window id: ${ready[2]}`,
  ).toBeGreaterThan(0);

  const status = page.locator("#tk-browser-status");
  const outside = page.locator(`[data-x11-wasm-xid="${outsideId}"]`);
  await outside.click({ position: { x: 8, y: 9 } });
  await expect(status).toContainText(/grab-button 1 \d+ \d+ \d+ \d+ 0/);

  await outside.hover({ position: { x: 8, y: 9 } });
  await page.mouse.wheel(0, 100);
  await expect(status).toContainText(/grab-wheel -120 \d+ \d+ 0/);
});

test("global grab rejects unviewable windows", async ({ page }) => {
  const script = [
    "frame .hidden -width 80 -height 60",
    "set status [catch {grab set -global .hidden} message options]",
    "join [list ready $status $message [join [dict get $options -errorcode] ,] [grab status .hidden]] {|}",
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
    .split("|");
  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toEqual([
    "ready",
    "1",
    "grab failed: window not viewable",
    "TK,GRAB,UNVIEWABLE",
    "none",
  ]);
});


test("Tk event generate warp updates browser pointer state", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.addEventListener("x11wasmpointerwarp", (event) => {
      const detail =
        event instanceof CustomEvent && event.detail ? event.detail : {};
      const target = /** @type {Window & { __pointerWarpEvents?: unknown[] }} */ (
        window
      );
      target.__pointerWarpEvents = target.__pointerWarpEvents || [];
      target.__pointerWarpEvents.push(detail);
    });
  });

  const script = [
    "set ::motion {}",
    "proc ::record {x y X Y state} {",
    "    set ::motion [list $x $y $X $Y $state]",
    "}",
    "frame .target -width 100 -height 80 -background white",
    "pack .target",
    "update idletasks",
    "bind .target <Motion> {::record %x %y %X %Y %s}",
    "event generate .target <Motion> -x 37 -y 29 -warp 1",
    "update",
    "set pointer [winfo pointerxy .]",
    "concat [list ready [lindex $pointer 0] [lindex $pointer 1]] $::motion",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toHaveLength(8);
  expect(result[0]).toBe("ready");
  expect(Number(result[1])).toBe(37);
  expect(Number(result[2])).toBe(29);
  expect(Number(result[3])).toBe(37);
  expect(Number(result[4])).toBe(29);
  expect(Number(result[5])).toBe(37);
  expect(Number(result[6])).toBe(29);
  expect(Number(result[7])).toBe(0);

  const warp = await page.evaluate(() => {
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot & { pointerWarpCount?: number, lastWarpPointer?: { count?: number, rootX?: number, rootY?: number, targetWindow?: number, time?: number } } }, __pointerWarpEvents?: unknown[] }} */ (
        window
      ).Module?.x11WasmBackend;
    const root = document.getElementById("tk-browser-root");
    return {
      count: backend?.pointerWarpCount,
      last: backend?.lastWarpPointer,
      rootCaptureWindow: root?.getAttribute("data-x11-wasm-pointer-capture-window"),
      rootPointerWindow: root?.getAttribute("data-x11-wasm-pointer-window"),
      rootPointerState: root?.getAttribute("data-x11-wasm-pointer-state"),
      rootWarpWindow: root?.getAttribute("data-x11-wasm-pointer-warp-window"),
      rootWarpCount: root?.getAttribute("data-x11-wasm-pointer-warp-count"),
      rootX: root?.getAttribute("data-x11-wasm-pointer-x"),
      rootY: root?.getAttribute("data-x11-wasm-pointer-y"),
      events:
        /** @type {Window & { __pointerWarpEvents?: unknown[] }} */ (window)
          .__pointerWarpEvents || [],
    };
  });
  expect(warp.count).toBeGreaterThanOrEqual(1);
  expect(warp.rootWarpCount).toBe(String(warp.count));
  expect(warp.rootX).toBe("37");
  expect(warp.rootY).toBe("29");
  expect(warp.rootCaptureWindow).toBe("0");
  expect(warp.rootPointerState).toBe("0");
  expect(warp.last).toEqual(
    expect.objectContaining({
      rootX: 37,
      rootY: 29,
    }),
  );
  expect(warp.rootPointerWindow).toBe(String(warp.last?.targetWindow));
  expect(warp.rootWarpWindow).toBe(String(warp.last?.targetWindow));
  expect(warp.events).toContainEqual(
    expect.objectContaining({
      count: warp.count,
      rootX: 37,
      rootY: 29,
    }),
  );
});

test("global keyboard grab retargets DOM key events through Tk", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .grab -width 80 -height 60 -background white -takefocus 1",
    "frame .outside -width 80 -height 60 -background black -takefocus 1",
    "pack .grab .outside -side left",
    "update idletasks",
    "bind .grab <KeyPress> {::record [list grab-key %K %A %s]}",
    "bind .outside <KeyPress> {::record [list outside-key %K %A %s]}",
    "focus -force .outside",
    "grab -global .grab",
    "list ready [winfo id .grab] [winfo id .outside] [focus]",
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
  expect(ready[3], `expected focus on outside window: ${ready.join(" ")}`).toBe(
    ".outside",
  );

  const status = page.locator("#tk-browser-status");
  const root = page.locator("#tk-browser-root");
  await root.click({ position: { x: 4, y: 4 } });
  await page.keyboard.type("a");
  await expect(status).toContainText(/grab-key a a 0/);
  expect(((await status.textContent()) || "").includes("outside-key a")).toBe(
    false,
  );
});

test("local keyboard grab retargets DOM key events through Tk", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .grab -width 80 -height 60 -background white -takefocus 1",
    "frame .outside -width 80 -height 60 -background black -takefocus 1",
    "pack .grab .outside -side left",
    "update idletasks",
    "bind .grab <KeyPress> {::record [list grab-key %K %A %s]}",
    "bind .outside <KeyPress> {::record [list outside-key %K %A %s]}",
    "focus -force .outside",
    "grab set .grab",
    "list ready [winfo id .grab] [winfo id .outside] [focus] [grab current]",
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
  expect(ready[3], `expected focus on outside window: ${ready.join(" ")}`).toBe(
    ".outside",
  );
  expect(
    ready[4],
    `expected local grab on grab window: ${ready.join(" ")}`,
  ).toBe(".grab");

  const status = page.locator("#tk-browser-status");
  const root = page.locator("#tk-browser-root");
  await root.click({ position: { x: 4, y: 4 } });
  await page.keyboard.type("a");
  await expect(status).toContainText(/grab-key a a 0/);
  expect(((await status.textContent()) || "").includes("outside-key a")).toBe(
    false,
  );
});

test("DOM pointer capture keeps pointer sequence on press window", async ({
  page,
}) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "frame .capture -width 80 -height 60 -background white",
    "frame .outside -width 80 -height 60 -background black",
    "pack .capture .outside -side left",
    "update idletasks",
    "bind .capture <ButtonPress-1> {::record [list capture-button %b %x %y]}",
    "bind .capture <B1-Motion> {::record [list capture-motion %x %y %s]}",
    "bind .capture <ButtonRelease-1> {::record [list capture-release %b %x %y]}",
    "list ready [winfo id .capture]",
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
  const captureId = Number.parseInt(ready[1], 0);
  expect(
    captureId,
    `unexpected capture window id: ${ready[1]}`,
  ).toBeGreaterThan(0);

  const status = page.locator("#tk-browser-status");
  const capture = page.locator(`[data-x11-wasm-xid="${captureId}"]`);
  const box = await capture.boundingBox();
  if (!box) {
    throw new Error("missing capture window box");
  }
  await page.mouse.move(box.x + 8, box.y + 9);
  await page.mouse.down();
  await expect(status).toContainText(/capture-button 1 \d+ \d+/);

  await page.mouse.move(box.x + 100, box.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect(status).toContainText(/capture-motion \d+ \d+/);
  await expect(status).toContainText(/capture-release 1 \d+ \d+/);
  const events = ((await status.textContent()) || "").split("|");
  const motions = events.filter((event) => event.startsWith("capture-motion "));
  const motion = motions[motions.length - 1];
  const release = events.find((event) => event.startsWith("capture-release "));
  expect(motion, `unexpected events: ${events.join("|")}`).toBeTruthy();
  expect(release, `unexpected events: ${events.join("|")}`).toBeTruthy();
  const motionX = Number(motion?.split(/\s+/)[1]);
  const releaseX = Number(release?.split(/\s+/)[2]);
  expect(motionX).toBeGreaterThan(80);
  expect(releaseX).toBeGreaterThan(80);
});
