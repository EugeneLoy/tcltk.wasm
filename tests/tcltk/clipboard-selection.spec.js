// @ts-check

const { test, expect } = require("@playwright/test");

test("Tk clipboard selection roundtrips inside the browser port", async ({
  page,
}) => {
  const value = "clipboard text from Tk";
  const script = [
    "clipboard clear",
    `clipboard append {${value}}`,
    "update",
    "clipboard get",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  await expect(page.locator("#tk-browser-result")).toHaveText(value);
});

test("Tk clipboard updates browser clipboard bridge", async ({ page }) => {
  await page.addInitScript(() => {
    const clipboard = {
      writes: [],
      writeText(text) {
        this.writes.push(String(text));
        return Promise.resolve();
      },
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
  });

  const script = [
    "clipboard clear",
    "clipboard append {first }",
    "clipboard append {second}",
    "update",
    "set first [clipboard get]",
    "clipboard clear",
    "update",
    "set clearStatus [catch {clipboard get} clearMessage]",
    "clipboard append {final}",
    "update",
    "list ready $first $clearStatus [clipboard get]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  await expect(page.locator("#tk-browser-result")).toHaveText(
    "ready {first second} 1 final",
  );

  const clipboard = await page.evaluate(async () => {
    await Promise.resolve();
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: { clipboardText?: string, clipboardWriteStatus?: string } } }} */ (
        window
      ).Module?.x11WasmBackend;
    const nativeClipboard =
      /** @type {Navigator & { clipboard?: { writes?: string[] } }} */ (
        navigator
      ).clipboard;
    return {
      stored: backend?.clipboardText,
      status: backend?.clipboardWriteStatus,
      writes: nativeClipboard?.writes || [],
    };
  });
  expect(clipboard.stored).toBe("final");
  expect(clipboard.status).toBe("written");
  expect(clipboard.writes).toEqual([
    "",
    "first ",
    "first second",
    "",
    "final",
  ]);
});

test("Tk clipboard get reads text cached from browser paste", async ({
  page,
}) => {
  const value = "external clipboard \u3042\u3044\u3046";
  const script = [
    "package require Tk",
    "browser::setResult waiting",
    "after 1000 {",
    "  set status [catch {clipboard get} value]",
    "  browser::setResult [list ready $status $value]",
    "}",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  const cached = await page.evaluate((text) => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    const event = new Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", {
      value: {
        /** @param {string} type */
        getData(type) {
          return type === "text/plain" ? text : "";
        },
      },
    });
    input.dispatchEvent(event);

    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: { externalClipboardAvailable?: boolean, externalClipboardText?: string } } }} */ (
        window
      ).Module?.x11WasmBackend;
    return {
      available: backend?.externalClipboardAvailable,
      text: backend?.externalClipboardText,
    };
  }, value);
  expect(cached).toEqual({ available: true, text: value });
  await expect(page.locator("#tk-browser-result")).toHaveText(
    `ready 0 {${value}}`,
    { timeout: 15000 },
  );
});

test("Tk clipboard get reads text synced from navigator clipboard", async ({
  page,
}) => {
  const value = "navigator clipboard text \u304b\u304d\u304f";
  await page.addInitScript((text) => {
    const clipboard = {
      reads: 0,
      text,
      readText() {
        this.reads += 1;
        return Promise.resolve(this.text);
      },
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
  }, value);

  const script = [
    "package require Tk",
    "browser::setResult waiting",
    "after 1000 {",
    "  set status [catch {clipboard get} value]",
    "  browser::setResult [list ready $status $value]",
    "}",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  const synced = await page.evaluate(async () => {
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: { syncExternalClipboardText?: Function, externalClipboardAvailable?: boolean, externalClipboardText?: string, clipboardReadStatus?: string, clipboardReadCount?: number } } }} */ (
        window
      ).Module?.x11WasmBackend;
    const nativeClipboard =
      /** @type {Navigator & { clipboard?: { reads?: number } }} */ (navigator)
        .clipboard;
    if (!backend?.syncExternalClipboardText) {
      throw new Error("missing clipboard read sync backend hook");
    }
    await backend.syncExternalClipboardText();
    return {
      available: backend.externalClipboardAvailable,
      count: backend.clipboardReadCount,
      reads: nativeClipboard?.reads || 0,
      status: backend.clipboardReadStatus,
      text: backend.externalClipboardText,
    };
  });

  expect(synced.available).toBe(true);
  expect(synced.count).toBeGreaterThanOrEqual(1);
  expect(synced.reads).toBeGreaterThanOrEqual(1);
  expect(synced.status).toBe("read");
  expect(synced.text).toBe(value);
  await expect(page.locator("#tk-browser-result")).toHaveText(
    `ready 0 {${value}}`,
    { timeout: 15000 },
  );
});

test("Tk browser paste selection advertises targets and timestamp", async ({
  page,
}) => {
  const value = "external clipboard targets";
  const script = [
    "package require Tk",
    "browser::setResult waiting",
    "after 1000 {",
    "  set targetsStatus [catch {selection get -selection CLIPBOARD -type TARGETS} targets]",
    "  set timestampStatus [catch {selection get -selection CLIPBOARD -type TIMESTAMP} timestamp]",
    "  set stringStatus [catch {selection get -selection CLIPBOARD -type STRING} stringText]",
    "  set textStatus [catch {selection get -selection CLIPBOARD -type TEXT} text]",
    "  set compoundStatus [catch {selection get -selection CLIPBOARD -type COMPOUND_TEXT} compoundText]",
    "  set utf8Status [catch {selection get -selection CLIPBOARD -type UTF8_STRING} utf8Text]",
    "  set hasString [expr {$targetsStatus == 0 && {STRING} in $targets}]",
    "  set hasUtf8 [expr {$targetsStatus == 0 && {UTF8_STRING} in $targets}]",
    "  set hasText [expr {$targetsStatus == 0 && {TEXT} in $targets}]",
    "  set hasCompound [expr {$targetsStatus == 0 && {COMPOUND_TEXT} in $targets}]",
    "  set hasTargets [expr {$targetsStatus == 0 && {TARGETS} in $targets}]",
    "  set hasTimestamp [expr {$targetsStatus == 0 && {TIMESTAMP} in $targets}]",
    "  set timestampIsInteger [expr {$timestampStatus == 0 && [string is integer -strict $timestamp]}]",
    "  browser::setResult [list ready $targetsStatus $hasString $hasUtf8 $hasText $hasCompound $hasTargets $hasTimestamp $timestampStatus $timestampIsInteger $stringStatus $stringText $textStatus $text $compoundStatus $compoundText $utf8Status $utf8Text]",
    "}",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  await page.evaluate((text) => {
    const input = document.querySelector(".x11-wasm-input");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("missing browser input textarea");
    }
    const event = new Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", {
      value: {
        /** @param {string} type */
        getData(type) {
          return type === "text/plain" ? text : "";
        },
      },
    });
    input.dispatchEvent(event);
  }, value);

  await expect(page.locator("#tk-browser-result")).toHaveText(
    `ready 0 1 1 1 1 1 1 0 1 0 {${value}} 0 {${value}} 0 {${value}} 0 {${value}}`,
    { timeout: 15000 },
  );
});

test("Tk primary selection ownership hands off between windows", async ({
  page,
}) => {
  const script = [
    "set ::selectionPayload {browser selection data}",
    "set ::selectionEvents {}",
    "set ::selectionRequests {}",
    "proc __tkBrowserSelectionHandler {type offset maxChars} {",
    "  lappend ::selectionRequests $type $offset $maxChars",
    "  return $::selectionPayload",
    "}",
    "proc __tkBrowserLostSelection {} {",
    "  lappend ::selectionEvents lost",
    "}",
    "frame .selA",
    "frame .selB",
    "pack .selA .selB",
    "selection handle -selection PRIMARY .selA {__tkBrowserSelectionHandler STRING} STRING",
    "selection own -selection PRIMARY -command __tkBrowserLostSelection .selA",
    "update",
    "set firstOwner [selection own -selection PRIMARY]",
    "set firstValue [selection get -selection PRIMARY]",
    "selection own -selection PRIMARY -command {lappend ::selectionEvents lostB} .selB",
    "update",
    "set secondOwner [selection own -selection PRIMARY]",
    "selection clear -selection PRIMARY .selB",
    "update",
    "set afterClear [selection own -selection PRIMARY]",
    "set clearStatus [catch {selection get -selection PRIMARY} clearMessage]",
    "set clearMissing [expr {$clearStatus == 1 && [string match {*selection doesn't exist*} $clearMessage]}]",
    "list ready $firstOwner $firstValue [join $::selectionEvents ,] $secondOwner $afterClear $clearMissing [join $::selectionRequests ,]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  await expect(page.locator("#tk-browser-result")).toHaveText(
    "ready .selA {browser selection data} lost,lostB .selB {} 1 STRING,0,4000",
  );
});

test("Tk send registry exposes the browser interpreter locally", async ({
  page,
}) => {
  const script = [
    "set names [winfo interps]",
    "list ready [expr {[llength $names] >= 1}]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);

  expect(result).toEqual(["ready", "1"]);
});
