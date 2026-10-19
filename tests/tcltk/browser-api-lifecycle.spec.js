// @ts-check

const { test, expect } = require("@playwright/test");

async function runScript(page, script) {
  await page.goto(`/tcltk.html?${new URLSearchParams({ eval: script })}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
}

for (const [kind, command] of [
  ["open", "::browser::getOpenFile"],
  ["directory", "::browser::chooseDirectory"],
  ["color", "::browser::chooseColor"],
]) {
  test(`mock ${kind} input cleans up after click throws and can reopen`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userActivation", {
        configurable: true,
        value: { isActive: true },
      });
      for (const name of ["showOpenFilePicker", "showDirectoryPicker"]) {
        Object.defineProperty(window, name, { configurable: true, value: undefined });
      }
      let calls = 0;
      HTMLInputElement.prototype.click = function () {
        calls++;
        if (calls === 1) {
          throw new DOMException("picker denied", "NotAllowedError");
        }
        this.dispatchEvent(new Event("cancel"));
      };
    });

    await runScript(page, [
      `set first [catch {${command}} message options]`,
      `set second [catch {${command}} value]`,
      "join [list ready $first [dict get $options -errorcode] $second $value] |",
    ].join("\n"));
    await expect(page.locator("#tk-browser-result")).toHaveText(
      "ready|1|TK BROWSER DIALOG_ERROR|0|",
    );
    await expect(page.locator('input[type="file"], input[type="color"]')).toHaveCount(0);
  });

  test(`mock asynchronous ${kind} cancel restores Tk focus on repeated use`, async ({ page }) => {
    await page.addInitScript(() => {
      for (const name of ["showOpenFilePicker", "showDirectoryPicker"]) {
        Object.defineProperty(window, name, { configurable: true, value: undefined });
      }
      HTMLInputElement.prototype.click = function () {
        setTimeout(() => {
          this.focus();
          this.dispatchEvent(new Event("cancel"));
        }, 30);
      };
    });
    await runScript(page, [
      "entry .target",
      "set ::calls 0",
      `button .choose -text Choose -command {incr ::calls; set code [catch {${command}} value]; browser::setResult [list done $::calls $code [string length $value]]}`,
      "pack .target .choose",
      "focus -force .target",
      "update",
      "winfo id .choose",
    ].join("\n"));
    const id = Number.parseInt(await page.locator("#tk-browser-result").innerText(), 0);
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.locator(`[data-x11-wasm-xid="${id}"]`).click();
      await expect(page.locator("#tk-browser-result")).toHaveText(`done ${attempt} 0 0`);
      await expect(page.locator(".x11-wasm-input")).toBeFocused();
    }
    await expect(page.locator('input[type="file"], input[type="color"]')).toHaveCount(0);
  });
}

test("mock native pickers preserve cancel and unavailable contracts before retry", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
    for (const [api, kind] of [
      ["showOpenFilePicker", "open"],
      ["showSaveFilePicker", "save"],
      ["showDirectoryPicker", "directory"],
    ]) {
      let calls = 0;
      Object.defineProperty(window, api, {
        configurable: true,
        value: async () => {
          calls++;
          if (calls <= 2) {
            throw new DOMException("picker rejected", calls === 1 ? "AbortError" : "NotAllowedError");
          }
          return kind === "open"
            ? [{ getFile: async () => new File(["retry"], "retry.txt") }]
            : { name: `retry-${kind}` };
        },
      });
    }
  });
  await runScript(page, [
    "set results [list ready]",
    "foreach command {::browser::getOpenFile ::browser::getSaveFile ::browser::chooseDirectory} {",
    "  lappend results [catch {$command} value] [string length $value]",
    "  lappend results [catch {$command} value options] [dict get $options -errorcode]",
    "  lappend results [catch {$command} value] [file exists $value]",
    "}",
    "join $results |",
  ].join("\n"));
  await expect(page.locator("#tk-browser-result")).toHaveText(
    "ready" + "|0|0|1|TK BROWSER DIALOG_UNAVAILABLE|0|1".repeat(3),
  );
});

test("mock asynchronous save hook restores focus after denial and reuse", async ({ page }) => {
  await page.addInitScript(() => {
    const target = /** @type {Window & { Module?: Record<string, unknown> }} */ (window);
    const module = target.Module || {};
    let calls = 0;
    module.tkBrowserSaveFile = async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const input = document.querySelector(".x11-wasm-input");
      if (input instanceof HTMLElement) {
        input.blur();
      }
      calls++;
      if (calls === 1) {
        throw new DOMException("save denied", "NotAllowedError");
      }
      return calls === 2 ? null : { name: "retry.txt" };
    };
    target.Module = module;
  });
  await runScript(page, [
    "entry .target",
    "set ::calls 0",
    "button .save -text Save -command {incr ::calls; set code [catch {::browser::getSaveFile} value]; browser::setResult [list done $::calls $code]}",
    "pack .target .save",
    "focus -force .target",
    "update",
    "winfo id .save",
  ].join("\n"));
  const id = Number.parseInt(await page.locator("#tk-browser-result").innerText(), 0);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.locator(`[data-x11-wasm-xid="${id}"]`).click();
    await expect(page.locator("#tk-browser-result")).toHaveText(`done ${attempt} ${attempt === 1 ? 1 : 0}`);
    await expect(page.locator(".x11-wasm-input")).toBeFocused();
  }
});
