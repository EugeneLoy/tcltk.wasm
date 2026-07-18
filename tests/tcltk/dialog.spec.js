// @ts-check

const { test, expect } = require("@playwright/test");

async function installActivationProbe(page) {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & {
       *   __activationProbe?: {
       *     active: boolean,
       *     alerts: Array<{ text: string, active: boolean }>,
       *     inputClicks: Array<{ type: string, active: boolean }>
       *   }
       * }} */ (window);
    const probe = {
      active: false,
      alerts: [],
      inputClicks: [],
    };
    const armActivation = () => {
      probe.active = true;
      setTimeout(() => {
        probe.active = false;
      }, 0);
    };
    const originalInputClick = HTMLInputElement.prototype.click;

    target.__activationProbe = probe;
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: {
        get isActive() {
          return probe.active;
        },
      },
    });
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: undefined,
    });
    document.addEventListener("pointerdown", armActivation, true);
    document.addEventListener("pointerup", armActivation, true);
    document.addEventListener("keydown", armActivation, true);
    document.addEventListener("keyup", armActivation, true);
    window.alert = (text) => {
      probe.alerts.push({
        active: window.navigator.userActivation.isActive,
        text: String(text || ""),
      });
    };
    HTMLInputElement.prototype.click = function click() {
      probe.inputClicks.push({
        active: window.navigator.userActivation.isActive,
        type: this.type,
      });
      if (this.type === "file") {
        this.dispatchEvent(new Event("cancel"));
        return;
      }
      return originalInputClick.call(this);
    };
  });
}

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

test("Tk button messageBox keeps the pointer user activation", async ({
  page,
}) => {
  await installActivationProbe(page);

  const script = [
    "button .message -text Message -command {set result [::browser::messageBox -type ok -message {Click alert}]; browser::setResult [list message $result]}",
    "pack .message -padx 20 -pady 20",
    "update",
    "list ready [winfo id .message]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  const buttonId = Number.parseInt(ready[1], 0);

  await page.locator(`[data-x11-wasm-xid="${buttonId}"]`).click();
  await expect(page.locator("#tk-browser-result")).toHaveText("message ok");

  const alerts = await page.evaluate(() => {
    return (
      /** @type {Window & { __activationProbe?: { alerts: unknown[] } }} */ (
        window
      ).__activationProbe?.alerts || []
    );
  });
  expect(alerts).toEqual([
    expect.objectContaining({
      active: true,
      text: "Click alert",
    }),
  ]);
});

test("Tk button messageBox observes native pointer user activation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & {
       *   __nativeActivationLog?: Array<{ event: string, active: boolean }>
       * }} */ (window);
    const active = () => {
      const activation = window.navigator && window.navigator.userActivation;
      return !activation || !!activation.isActive;
    };

    target.__nativeActivationLog = [];
    document.addEventListener(
      "pointerdown",
      () => target.__nativeActivationLog?.push({ event: "down", active: active() }),
      true,
    );
    document.addEventListener(
      "pointerup",
      () => target.__nativeActivationLog?.push({ event: "up", active: active() }),
      true,
    );
    window.alert = () => {
      target.__nativeActivationLog?.push({ event: "alert", active: active() });
    };
  });

  const script = [
    "button .message -text Message -command {set result [::browser::messageBox -type ok -message {Native activation alert}]; browser::setResult [list message $result]}",
    "pack .message -padx 20 -pady 20",
    "update",
    "list ready [winfo id .message]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  const buttonId = Number.parseInt(ready[1], 0);

  await page.locator(`[data-x11-wasm-xid="${buttonId}"]`).click();
  await expect(page.locator("#tk-browser-result")).toHaveText("message ok");

  const log = await page.evaluate(() => {
    return (
      /** @type {Window & { __nativeActivationLog?: unknown[] }} */ (window)
        .__nativeActivationLog || []
    );
  });
  expect(log).toEqual([
    expect.objectContaining({ event: "down", active: true }),
    expect.objectContaining({ event: "up", active: true }),
    expect.objectContaining({ event: "alert", active: true }),
  ]);
});

test("Tk button messageBox restores browser input focus after alert blur", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { __alertBlurCount?: number }} */ (window);

    target.__alertBlurCount = 0;
    window.alert = () => {
      const input = document.querySelector(".x11-wasm-input");
      if (input instanceof HTMLElement) {
        input.blur();
        target.__alertBlurCount = (target.__alertBlurCount || 0) + 1;
      }
    };
  });

  const script = [
    "entry .target",
    "button .message -text Message -command {set result [::browser::messageBox -type ok -message {Focus alert}]; browser::setResult [list message $result]}",
    "pack .target .message -padx 20 -pady 4",
    "bind all <KeyPress> {browser::setStatus [list key %W %K %A [focus]]}",
    "focus -force .target",
    "update",
    "list ready [winfo id .target] [winfo id .message] [focus]",
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
  expect(ready[3], `expected focus on entry: ${ready.join(" ")}`).toBe(
    ".target",
  );
  const entryId = Number.parseInt(ready[1], 0);
  const buttonId = Number.parseInt(ready[2], 0);

  await page.locator(`[data-x11-wasm-xid="${buttonId}"]`).click();
  await expect(page.locator("#tk-browser-result")).toHaveText("message ok");

  const focusState = await page.evaluate((expectedEntryId) => {
    const input = document.querySelector(".x11-wasm-input");
    const focusedWindow = Number.parseInt(
      input?.getAttribute("data-x11-wasm-focus-window") || "0",
      0,
    );
    return {
      alertBlurCount:
        /** @type {Window & { __alertBlurCount?: number }} */ (window)
          .__alertBlurCount || 0,
      activeInput: document.activeElement === input,
      focusedWindow,
      expectedEntryId,
    };
  }, entryId);
  expect(focusState).toEqual({
    activeInput: true,
    alertBlurCount: 1,
    expectedEntryId: entryId,
    focusedWindow: expect.any(Number),
  });
  expect(focusState.focusedWindow).toBeGreaterThan(0);

  await page.keyboard.type("z");
  await expect(page.locator("#tk-browser-status")).toHaveText(/key .* z z .*/);
});

test("Tk button messageBox keeps activation behind pending Tcl timers", async ({
  page,
}) => {
  await installActivationProbe(page);

  const script = [
    "set ::timerCount 0",
    "proc ::recordTimer {} {incr ::timerCount}",
    "button .message -text Message -command {set result [::browser::messageBox -type ok -message {Timer-delayed alert}]; browser::setResult [list message $result $::timerCount]}",
    "bind .message <ButtonPress-1> {for {set i 0} {$i < 400} {incr i} {after 0 ::recordTimer}}",
    "pack .message -padx 20 -pady 20",
    "update",
    "list ready [winfo id .message]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  const buttonId = Number.parseInt(ready[1], 0);

  await page.locator(`[data-x11-wasm-xid="${buttonId}"]`).click();
  await expect(page.locator("#tk-browser-result")).toHaveText(/message ok \d+/);

  const alerts = await page.evaluate(() => {
    return (
      /** @type {Window & { __activationProbe?: { alerts: unknown[] } }} */ (
        window
      ).__activationProbe?.alerts || []
    );
  });
  expect(alerts).toEqual([
    expect.objectContaining({
      active: true,
      text: "Timer-delayed alert",
    }),
  ]);
});

test("Tk button open dialog clicks hidden file input during activation", async ({
  page,
}) => {
  await installActivationProbe(page);

  const script = [
    "button .open -text Open -command {set code [catch {::browser::getOpenFile -title {Open title}} result options]; set error {}; if {$code != 0 && [dict exists $options -errorcode]} {set error [dict get $options -errorcode]}; browser::setResult [join [list open $code $result $error] |]}",
    "pack .open -padx 20 -pady 20",
    "update",
    "list ready [winfo id .open]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const ready = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  const buttonId = Number.parseInt(ready[1], 0);

  await page.locator(`[data-x11-wasm-xid="${buttonId}"]`).click();
  await expect(page.locator("#tk-browser-result")).toHaveText("open|0||");

  const inputClicks = await page.evaluate(() => {
    return (
      /** @type {Window & { __activationProbe?: { inputClicks: unknown[] } }} */ (
        window
      ).__activationProbe?.inputClicks || []
    );
  });
  expect(inputClicks).toEqual([
    expect.objectContaining({
      active: true,
      type: "file",
    }),
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

test("Tk file dialog filetypes feed browser picker options", async ({ page }) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { __nativePickerOptions?: Record<string, unknown> }} */ (
        window
      );

    target.__nativePickerOptions = {};
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async (options) => {
        target.__nativePickerOptions.open = options;
        return [
          {
            name: "picked.md",
            getFile: async () =>
              new File(["picked text"], "picked.md", { type: "text/markdown" }),
          },
        ];
      },
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async (options) => {
        target.__nativePickerOptions.save = options;
        return {
          name: "note.txt",
          createWritable: async () => ({
            close: async () => {},
            write: async () => {},
          }),
        };
      },
    });
  });

  const fileTypes = "{{Text {.txt .md}} {Images {*.png *.jpg}} {All *}}";
  const script = [
    `set openPath [::browser::getOpenFile -filetypes ${fileTypes}]`,
    "set fh [open $openPath r]",
    "set opened [read $fh]",
    "close $fh",
    `set savePath [::browser::getSaveFile -initialfile note -defaultextension .txt -filetypes ${fileTypes}]`,
    "join [list ready $opened [file exists $savePath]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  expect((await page.locator("#tk-browser-result").textContent()) || "").toBe(
    "ready|picked text|1",
  );

  const pickerOptions = await page.evaluate(() => {
    return (
      /** @type {Window & { __nativePickerOptions?: Record<string, unknown> }} */ (
        window
      ).__nativePickerOptions || {}
    );
  });

  expect(pickerOptions).toEqual({
    open: {
      multiple: false,
      types: [
        {
          description: "Text",
          accept: { "text/plain": [".txt", ".md"] },
        },
        {
          description: "Images",
          accept: { "image/*": [".png", ".jpg"] },
        },
      ],
    },
    save: {
      suggestedName: "note.txt",
      types: [
        {
          description: "Text",
          accept: { "text/plain": [".txt", ".md"] },
        },
        {
          description: "Images",
          accept: { "image/*": [".png", ".jpg"] },
        },
      ],
    },
  });
});

test("Tk open dialog filetypes feed hidden input accept", async ({ page }) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { __hiddenInputs?: unknown[] }} */ (window);
    const click = HTMLInputElement.prototype.click;

    target.__hiddenInputs = [];
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: undefined,
    });
    HTMLInputElement.prototype.click = function clickHiddenInput() {
      target.__hiddenInputs?.push({
        accept: this.accept,
        multiple: this.multiple,
        type: this.type,
      });
      this.dispatchEvent(new Event("cancel"));
    };
    window.addEventListener(
      "pagehide",
      () => {
        HTMLInputElement.prototype.click = click;
      },
      { once: true },
    );
  });

  const script = [
    "set result [::browser::getOpenFile -multiple 1 -filetypes {{Text {.txt .md}} {Images {*.png}} {All *}}]",
    "join [list ready $result] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  expect((await page.locator("#tk-browser-result").textContent()) || "").toBe(
    "ready|",
  );

  const hiddenInputs = await page.evaluate(() => {
    return (
      /** @type {Window & { __hiddenInputs?: unknown[] }} */ (window)
        .__hiddenInputs || []
    );
  });

  expect(hiddenInputs).toEqual([
    {
      accept: ".txt,.md,.png",
      multiple: true,
      type: "file",
    },
  ]);
});

test("Tk directory dialogs bridge browser directory pickers", async ({ page }) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { __directoryPickerCalls?: unknown[] }} */ (window);

    target.__directoryPickerCalls = [];
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = { kind: "directory", name: "Native Project" };
        target.__directoryPickerCalls?.push(handle);
        return handle;
      },
    });
  });

  const script = [
    "set dirPath [::browser::chooseDirectory -title {Choose directory} -mustexist 1]",
    "join [list ready [file isdirectory $dirPath] $dirPath] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split("|");
  expect(result[0]).toBe("ready");
  expect(result[1]).toBe("1");
  expect(result[2]).toMatch(/^\/browser\/directory\/[0-9]+-Native_Project$/);

  const state = await page.evaluate((dirPath) => {
    const module =
      /** @type {Window & { Module?: { tkBrowserDialogState?: { directoryHandles?: Record<string, unknown> } }, __directoryPickerCalls?: unknown[] }} */ (
        window
      ).Module || {};
    return {
      calls:
        /** @type {Window & { __directoryPickerCalls?: unknown[] }} */ (window)
          .__directoryPickerCalls || [],
      handle:
        module.tkBrowserDialogState?.directoryHandles?.[
          /** @type {string} */ (dirPath)
        ],
    };
  }, result[2]);

  expect(state).toEqual({
    calls: [{ kind: "directory", name: "Native Project" }],
    handle: { kind: "directory", name: "Native Project" },
  });
});

test("Tk directory hidden input fallback imports selected files", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const click = HTMLInputElement.prototype.click;
    const target =
      /** @type {Window & { __directoryInputs?: unknown[] }} */ (window);

    target.__directoryInputs = [];
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: undefined,
    });
    HTMLInputElement.prototype.click = function clickDirectoryInput() {
      const file = new File(["nested text"], "nested.txt", {
        type: "text/plain",
      });
      Object.defineProperty(file, "webkitRelativePath", {
        configurable: true,
        value: "Project Folder/sub dir/nested.txt",
      });
      target.__directoryInputs?.push({
        multiple: this.multiple,
        type: this.type,
        webkitdirectory: this.webkitdirectory,
      });
      Object.defineProperty(this, "files", {
        configurable: true,
        value: [file],
      });
      this.dispatchEvent(new Event("change"));
    };
    window.addEventListener(
      "pagehide",
      () => {
        HTMLInputElement.prototype.click = click;
      },
      { once: true },
    );
  });

  const script = [
    "set dirPath [::browser::chooseDirectory -title {Hidden directory}]",
    "set filePath [file join $dirPath sub_dir nested.txt]",
    "set fh [open $filePath r]",
    "set text [read $fh]",
    "close $fh",
    "join [list ready [file isdirectory $dirPath] [file exists $filePath] $text] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  expect(((await page.locator("#tk-browser-result").textContent()) || "").trim())
    .toBe("ready|1|1|nested text");

  const inputs = await page.evaluate(() => {
    return (
      /** @type {Window & { __directoryInputs?: unknown[] }} */ (window)
        .__directoryInputs || []
    );
  });
  expect(inputs).toEqual([
    {
      multiple: true,
      type: "file",
      webkitdirectory: true,
    },
  ]);
});

test("Tk chooseColor bridges the browser color input", async ({ page }) => {
  await page.addInitScript(() => {
    const click = HTMLInputElement.prototype.click;
    const target =
      /** @type {Window & { __colorInputs?: unknown[] }} */ (window);

    target.__colorInputs = [];
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
    HTMLInputElement.prototype.click = function clickColorInput() {
      target.__colorInputs?.push({
        initialValue: this.value,
        type: this.type,
      });
      this.value = "#abcdef";
      this.dispatchEvent(new Event("change"));
    };
    window.addEventListener(
      "pagehide",
      () => {
        HTMLInputElement.prototype.click = click;
      },
      { once: true },
    );
  });

  const script = [
    "join [list ready [::browser::chooseColor -title {Pick color} -initialcolor #123456]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  expect((await page.locator("#tk-browser-result").textContent()) || "").toBe(
    "ready|#abcdef",
  );

  const inputs = await page.evaluate(() => {
    return (
      /** @type {Window & { __colorInputs?: unknown[] }} */ (window)
        .__colorInputs || []
    );
  });
  expect(inputs).toEqual([{ initialValue: "#123456", type: "color" }]);
});

test("browser save flush writes File System Access handles", async ({ page }) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { __saveWrites?: unknown[] }} */ (window);

    target.__saveWrites = [];
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => ({
        name: "native-save.txt",
        createWritable: async () => ({
          close: async () => {
            target.__saveWrites?.push({ op: "close" });
          },
          write: async (bytes) => {
            target.__saveWrites?.push({
              op: "write",
              text: new TextDecoder().decode(bytes),
            });
          },
        }),
      }),
    });
  });

  const script = [
    "set savePath [::browser::getSaveFile -initialfile native-save -defaultextension .txt]",
    "set fh [open $savePath w]",
    "puts -nonewline $fh {native save text}",
    "close $fh",
    "::browser::flushSaveFile $savePath",
    "join [list ready [file exists $savePath]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  expect((await page.locator("#tk-browser-result").textContent()) || "").toBe(
    "ready|1",
  );

  const writes = await page.evaluate(() => {
    return (
      /** @type {Window & { __saveWrites?: unknown[] }} */ (window)
        .__saveWrites || []
    );
  });
  expect(writes).toEqual([
    { op: "write", text: "native save text" },
    { op: "close" },
  ]);
});

test("browser save flush falls back to Blob download", async ({ page }) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { __downloads?: unknown[], __downloadText?: Promise<string> }} */ (
        window
      );
    const click = HTMLAnchorElement.prototype.click;
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;

    target.__downloads = [];
    URL.createObjectURL = (blob) => {
      target.__downloadText = blob.text();
      return "blob:tk-browser-test";
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function clickDownload() {
      target.__downloads?.push({
        download: this.download,
        href: this.href,
      });
    };
    window.addEventListener(
      "pagehide",
      () => {
        HTMLAnchorElement.prototype.click = click;
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
      },
      { once: true },
    );
  });

  const script = [
    "set path blob-save.txt",
    "set fh [open $path w]",
    "puts -nonewline $fh {blob save text}",
    "close $fh",
    "::browser::flushSaveFile $path exported.txt",
    "join [list ready [file exists $path]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  expect((await page.locator("#tk-browser-result").textContent()) || "").toBe(
    "ready|1",
  );

  const download = await page.evaluate(async () => {
    const target =
      /** @type {Window & { __downloads?: unknown[], __downloadText?: Promise<string> }} */ (
        window
      );
    return {
      downloads: target.__downloads || [],
      text: await target.__downloadText,
    };
  });
  expect(download).toEqual({
    downloads: [{ download: "exported.txt", href: "blob:tk-browser-test" }],
    text: "blob save text",
  });
});

test("Tk save dialog falls back to Blob download path without picker API", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const target =
      /** @type {Window & { __downloads?: unknown[], __downloadText?: Promise<string> }} */ (
        window
      );
    const click = HTMLAnchorElement.prototype.click;
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;

    target.__downloads = [];
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
    URL.createObjectURL = (blob) => {
      target.__downloadText = blob.text();
      return "blob:tk-browser-save-fallback";
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function clickDownload() {
      target.__downloads?.push({
        download: this.download,
        href: this.href,
      });
    };
    window.addEventListener(
      "pagehide",
      () => {
        HTMLAnchorElement.prototype.click = click;
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
      },
      { once: true },
    );
  });

  const script = [
    "button .save -text Save -command {",
    "    set code [catch {",
    "        set savePath [tk_getSaveFile -initialfile firefox-save -defaultextension .txt]",
    "        set fh [open $savePath w]",
    "        puts -nonewline $fh {fallback save text}",
    "        close $fh",
    "        ::browser::flushSaveFile $savePath exported-fallback.txt",
    "        list ok [file exists $savePath] $savePath",
    "    } result options]",
    "    if {$code == 0} {",
    "        browser::setResult [join $result |]",
    "    } else {",
    "        set error {}",
    "        if {[dict exists $options -errorcode]} {set error [dict get $options -errorcode]}",
    "        browser::setResult [join [list error $result $error] |]",
    "    }",
    "}",
    "pack .save -padx 20 -pady 20",
    "update",
    "list ready [winfo id .save]",
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

  await page.locator(`[data-x11-wasm-xid="${buttonId}"]`).click();
  await expect(page.locator("#tk-browser-result")).toHaveText(/^ok\|1\|/);

  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split("|");
  expect(result[0]).toBe("ok");
  expect(result[1]).toBe("1");
  expect(result[2]).toMatch(/^\/browser\/save\/[0-9]+-firefox-save\.txt$/);

  const download = await page.evaluate(async () => {
    const target =
      /** @type {Window & { __downloads?: unknown[], __downloadText?: Promise<string> }} */ (
        window
      );
    return {
      downloads: target.__downloads || [],
      text: await target.__downloadText,
    };
  });
  expect(download).toEqual({
    downloads: [
      {
        download: "exported-fallback.txt",
        href: "blob:tk-browser-save-fallback",
      },
    ],
    text: "fallback save text",
  });
});

test("Tk native dialog wrappers preserve unavailable errors when Tk fallback cannot wait", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: { isActive: false },
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
  });

  const script = [
    "set code [catch {tk_getSaveFile -initialfile no-activation} result options]",
    "join [list ready $code $result [dict get $options -errorcode]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });

  expect(((await page.locator("#tk-browser-result").textContent()) || "").trim())
    .toBe("ready|1|browser native dialog is not available|TK BROWSER DIALOG_UNAVAILABLE");
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
    "foreach command [list {::browser::getOpenFile} {::browser::getSaveFile} {::browser::chooseDirectory} {::browser::chooseColor} {::browser::messageBox -message Test}] {",
    "    set code [catch {uplevel #0 $command} result options]",
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
    "1",
    "TK BROWSER DIALOG_UNAVAILABLE",
  ]);
});
