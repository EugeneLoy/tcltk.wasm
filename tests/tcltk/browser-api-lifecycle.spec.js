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
