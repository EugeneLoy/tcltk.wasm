// @ts-check

const { test, expect } = require("@playwright/test");

test("Tk browser backend retains generic monospace advances", async ({ page }) => {
  await page.goto("/tcltk.html");
  await expect(page.locator("#tk-browser-status")).toHaveText("running", {
    timeout: 15000,
  });
  const [narrow, wide] = await page.evaluate(() => {
    const backend = /** @type {any} */ (window).Module.x11WasmBackend;
    return [
      backend.measureText(32, "monospace", "i"),
      backend.measureText(32, "monospace", "W"),
    ];
  });
  expect(narrow).toBeGreaterThan(0);
  expect(wide).toBe(narrow);
});

test("Tk caret advances follow named fonts on long ASCII runs", async ({ page }) => {
  const script = [
    "set values {}",
    "foreach family {Helvetica Times Courier} {",
    "  set f [font create -family $family -size -18]",
    "  entry .e -font $f -width 80",
    "  pack .e",
    "  set text [string repeat 0123456789 6]",
    "  .e insert 0 $text",
    "  update",
    "  set start [lindex [.e bbox 0] 0]",
    "  .e icursor 30",
    "  set advance [expr {[lindex [.e bbox insert] 0]-$start}]",
    "  set expected [font measure $f [string range $text 0 29]]",
    "  lappend values $family $advance $expected [.e index @[expr {$start+$expected}]]",
    "  destroy .e",
    "  font delete $f",
    "}",
    "join $values |",
  ].join("\n");
  await page.goto(`/tcltk.html?${new URLSearchParams({ eval: script })}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const values = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  ).split("|");
  expect(values).toHaveLength(12);
  for (let index = 0; index < values.length; index += 4) {
    const [family, advance, expected, hit] = values.slice(index, index + 4);
    expect(Number(advance), family).toBeGreaterThan(0);
    expect(advance, family).toBe(expected);
    expect(hit, family).toBe("30");
  }
});

test("Tk selection indices retain complete UTF-8 grapheme strings", async ({ page }) => {
  const prefixes = [
    "abc", "e\u0301", "\ud83d\ude00",
    "\ud83d\udc69\u200d\ud83d\udcbb", "\ud83c\uddef\ud83c\uddf5",
  ];
  const script = [
    `set prefixes {${prefixes.map((prefix) => `{${prefix}}`).join(" ")}}`,
    "entry .e -font {Helvetica -24}",
    "pack .e",
    "set values {}",
    "foreach prefix $prefixes {",
    "  .e delete 0 end",
    "  .e insert 0 ${prefix}xyz",
    "  set n [string length $prefix]",
    "  .e icursor $n",
    "  .e selection range 0 $n",
    "  lappend values [.e index insert] [.e index sel.first] [.e index sel.last]",
    "  lappend values [string length [encoding convertto utf-8 $prefix]]",
    "  lappend values [selection get -selection PRIMARY]",
    "}",
    "join $values |",
  ].join("\n");
  await page.goto(`/tcltk.html?${new URLSearchParams({ eval: script })}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const values = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  ).split("|");
  prefixes.forEach((prefix, index) => {
    expect(values.slice(index * 5, index * 5 + 5), prefix).toEqual([
      String(prefix.length),
      "0",
      String(prefix.length),
      String(Buffer.byteLength(prefix, "utf8")),
      prefix,
    ]);
  });
});

test("Tk text drawing has the same origin on RTL pages", async ({ page }) => {
  const script = [
    "pack [canvas .c -width 240 -height 80 -background white -highlightthickness 0]",
    ".c create text 50 40 -anchor w -text {Wi e\u0301!} -font {Helvetica -32} -fill black",
    "update",
    "winfo id .c",
  ].join("\n");
  const images = [];
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.dir =
        new URLSearchParams(location.search).get("dir") || "ltr";
    });
  });
  for (const direction of ["ltr", "rtl"]) {
    const query = new URLSearchParams({ eval: script, dir: direction });
    await page.goto(`/tcltk.html?${query}`);
    await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
      timeout: 15000,
    });
    const id = Number((await page.locator("#tk-browser-result").textContent())?.trim());
    images.push(await page.locator(`[data-x11-wasm-xid="${id}"] > canvas`)
      .evaluate(async (canvas) => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        /** @type {any} */ (window).Module.x11WasmBackend.flush();
        const context = /** @type {HTMLCanvasElement} */ (canvas).getContext("2d");
        if (!context) {
          throw new Error("missing Tk text context");
        }
        return Array.from(context.getImageData(0, 0, 240, 80).data);
      }));
  }
  const ink = images[0].filter((value, index) => index % 4 !== 3 && value < 100);
  const differences = images[1].filter((value, index) => value !== images[0][index]);
  expect(ink.length).toBeGreaterThan(100);
  expect(differences.length).toBe(0);
});
