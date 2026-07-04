// @ts-check

const { test, expect } = require("@playwright/test");

test("Tk messageBox uses the synchronous browser native hook", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { Module?: Record<string, unknown>, __messageBoxes?: unknown[] }} */ (
        window
      );
    const module = target.Module || {};

    target.__messageBoxes = [];
    module.tkBrowserMessageBox = (options) => {
      target.__messageBoxes?.push(options);
      return options && options.type === "yesno" ? "no" : "ok";
    };
    target.Module = module;
  });

  const script = [
    "set first [tk_messageBox -type ok -title {Browser Title} -message {Hello} -detail {Details} -icon warning]",
    "set second [tk_messageBox -type yesno -message {Continue?} -default no]",
    "list ready $first $second",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  await expect(page.locator("#tk-browser-result")).toHaveText("ready ok no");

  const calls = await page.evaluate(() => {
    return (
      /** @type {Window & { __messageBoxes?: unknown[] }} */ (window)
        .__messageBoxes || []
    );
  });

  expect(calls).toEqual([
    {
      defaultButton: "ok",
      detail: "Details",
      icon: "warning",
      message: "Hello",
      title: "Browser Title",
      type: "ok",
    },
    {
      defaultButton: "no",
      detail: "",
      icon: "info",
      message: "Continue?",
      title: "",
      type: "yesno",
    },
  ]);
});

test("Tk messageBox keeps Tk fallback for browser-unsupported button sets", async ({
  page,
}) => {
  const script = [
    "set code [catch {::browser::messageBox -type yesnocancel -message {Pick}} result options]",
    "set fallback [expr {[llength [info commands ::tk::browser::messageBoxFallback]] > 0}]",
    "set wrapper [expr {[string match {*messageBoxFallback*} [info body ::tk_messageBox]]}]",
    "join [list ready $code $result [dict get $options -errorcode] $fallback $wrapper] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split("|");

  expect(result).toEqual([
    "ready",
    "1",
    "browser native message box cannot represent -type yesnocancel",
    "TK BROWSER UNSUPPORTED_MESSAGEBOX_TYPE",
    "1",
    "1",
  ]);
});
