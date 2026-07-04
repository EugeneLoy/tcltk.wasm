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
    "TK BROWSER DIALOG_UNAVAILABLE MESSAGEBOX_TYPE",
    "1",
    "1",
  ]);
});

test("Tk native file dialogs bridge through browser hooks", async ({ page }) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { Module?: Record<string, unknown>, __dialogs?: unknown[] }} */ (
        window
      );
    const module = target.Module || {};

    target.__dialogs = [];
    module.tkBrowserOpenFile = async (options) => {
      target.__dialogs?.push({ kind: "open", options });
      return [{ name: "sample one.txt", text: "hello from open" }];
    };
    module.tkBrowserSaveFile = async (options) => {
      target.__dialogs?.push({ kind: "save", options });
      return { name: "report.txt" };
    };
    module.tkBrowserFlushSaveFile = async (payload) => {
      target.__dialogs?.push({
        kind: "flush",
        name: payload.name,
        path: payload.path,
        text: payload.text,
      });
    };
    module.tkBrowserChooseDirectory = async (options) => {
      target.__dialogs?.push({ kind: "directory", options });
      return { name: "Project Folder" };
    };
    module.tkBrowserChooseColor = async (options) => {
      target.__dialogs?.push({ kind: "color", options });
      return "#336699";
    };
    target.Module = module;
  });

  const script = [
    "set openPath [tk_getOpenFile -title {Open title} -initialfile sample.txt -filetypes {{Text {.txt}}}]",
    "set fh [open $openPath r]",
    "set opened [read $fh]",
    "close $fh",
    "set savePath [tk_getSaveFile -title {Save title} -initialfile report -defaultextension .txt]",
    "set out [open $savePath w]",
    "puts -nonewline $out {saved text}",
    "close $out",
    "browser::flushSaveFile $savePath exported.txt",
    "set dirPath [tk_chooseDirectory -title {Dir title} -mustexist 1]",
    "set color [tk_chooseColor -title {Color title} -initialcolor #112233]",
    "join [list ready $opened [file exists $openPath] [file exists $savePath] [file isdirectory $dirPath] $color] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split("|");

  expect(result).toEqual(["ready", "hello from open", "1", "1", "1", "#336699"]);

  const calls = await page.evaluate(() => {
    return (
      /** @type {Window & { __dialogs?: unknown[] }} */ (window).__dialogs || []
    );
  });

  expect(calls).toEqual([
    {
      kind: "open",
      options: {
        fileTypes: "{Text {.txt}}",
        initialDir: "",
        initialFile: "sample.txt",
        multiple: false,
        title: "Open title",
      },
    },
    {
      kind: "save",
      options: {
        defaultExtension: ".txt",
        fileTypes: "",
        initialDir: "",
        initialFile: "report",
        title: "Save title",
      },
    },
    {
      kind: "flush",
      name: "exported.txt",
      path: expect.stringMatching(/^\/browser\/save\/[0-9]+-report\.txt$/),
      text: "saved text",
    },
    {
      kind: "directory",
      options: {
        initialDir: "",
        mustExist: true,
        title: "Dir title",
      },
    },
    {
      kind: "color",
      options: {
        initialColor: "#112233",
        title: "Color title",
      },
    },
  ]);
});

test("Tk native file dialogs return empty strings on browser cancel", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { Module?: Record<string, unknown> }} */ (window);
    const module = target.Module || {};

    module.tkBrowserOpenFile = async () => null;
    module.tkBrowserSaveFile = async () => "";
    module.tkBrowserChooseDirectory = async () => undefined;
    module.tkBrowserChooseColor = async () => null;
    target.Module = module;
  });

  const script = [
    "join [list ready [tk_getOpenFile] [tk_getSaveFile] [tk_chooseDirectory] [tk_chooseColor]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  expect((await page.locator("#tk-browser-result").textContent()) || "").toBe(
    "ready||||",
  );
});

test("browser native dialogs report unavailable without user activation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window.navigator, "userActivation", {
        configurable: true,
        value: { isActive: false },
      });
    } catch {
      // Keep the test on the browser's native userActivation when it is read-only.
    }
  });

  const script = [
    "set values [list ready]",
    "foreach command {::browser::getOpenFile ::browser::getSaveFile ::browser::chooseDirectory ::browser::chooseColor} {",
    "    set code [catch {$command} result options]",
    "    lappend values $code [dict get $options -errorcode]",
    "}",
    "join $values |",
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
    "TK BROWSER DIALOG_UNAVAILABLE",
    "1",
    "TK BROWSER DIALOG_UNAVAILABLE",
    "1",
    "TK BROWSER DIALOG_UNAVAILABLE",
    "1",
    "TK BROWSER DIALOG_UNAVAILABLE",
  ]);
});
