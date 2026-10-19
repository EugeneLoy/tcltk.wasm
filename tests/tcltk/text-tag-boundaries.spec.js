// @ts-check

const { test, expect } = require("@playwright/test");
const { openTextPage, evalText, drawnTextRun } = require("../support/text-oracle");

const cases = [
  { name: "combining acute", text: "e\u0301", scalar: 1, tiny: 17 },
  { name: "flag", text: "\ud83c\uddef\ud83c\uddf5", scalar: 2, tiny: 31 },
  { name: "ZWJ", text: "\ud83d\udc69\u200d\ud83d\udcbb", scalar: 2, tiny: 31 },
];

function scriptFor(text, scalar, width, tagged, unicode = false) {
  const units = Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
  return [
    unicode
      ? `set prefix [format ${"%c".repeat(text.length)} ${units.join(" ")}]`
      : `set prefix {${text}}`,
    "set n [string length $prefix]",
    "canvas .oracle -width 260 -height 70 -highlightthickness 0",
    "frame .holder -width 1000 -height 240",
    "pack .oracle .holder -anchor w",
    ".oracle create text 12 35 -anchor w -text ${prefix}| -font {Helvetica -32}",
    "text .holder.t -font {Helvetica -32} -wrap char -borderwidth 0 -highlightthickness 0 -padx 0 -pady 0 -insertwidth 0",
    ".holder.t insert 1.0 [string repeat $prefix 3]",
    ".holder.t tag configure part -foreground red",
    ...(tagged ? [`.holder.t tag add part 1.0 1.${scalar}`] : []),
    `place .holder.t -x 0 -y 0 -width ${width} -height 240`,
    "update",
    ".holder.t get 1.0 end-1c",
  ].join("\n");
}

async function assertLayout(page, text, width, expectedLines) {
  const oracle = await drawnTextRun(page, text);
  const values = (await evalText(page, [
    "set ys {}",
    "for {set i 0} {$i < 3*$n} {incr i} {",
    "  lappend ys [lindex [.holder.t dlineinfo 1.$i] 1]",
    "}",
    "join [list [.holder.t count -displaylines 1.0 end] $ys [string equal [.holder.t get 1.0 end-1c] [string repeat $prefix 3]]] |",
  ].join("\n"))).split("|");
  expect(Number(values[0])).toBe(expectedLines);
  expect(values[2]).toBe("1");
  const ys = values[1].split(" ").map(Number);
  expect(ys).toHaveLength(3 * text.length);
  for (let cluster = 0; cluster < 3; cluster++) {
    const row = ys[cluster * text.length];
    expect(ys.slice(cluster * text.length, (cluster + 1) * text.length))
      .toEqual(new Array(text.length).fill(row));
    if (expectedLines === 3 && cluster > 0) {
      expect(row).toBeGreaterThan(ys[(cluster - 1) * text.length]);
    }
  }
  const fills = await page.evaluate(() => window.__textOracle.fills
    .filter(fill => fill.font.startsWith("32px") && fill.text !== "|"));
  expect(fills.length).toBeGreaterThan(0);
  expect(fills.every(fill => fill.text === text), JSON.stringify(fills)).toBe(true);
  expect(oracle.advance).toBeGreaterThan(0);
  if (expectedLines === 3) expect(width).toBeLessThan(oracle.advance);
}

for (const { name, text, scalar, tiny } of cases) {
  for (const width of [1000, tiny]) {
    for (const tagged of [false, true]) {
      test(`Tk ${name} foreground boundary width ${width} tag ${tagged}`, async ({ page }) => {
        await openTextPage(page, scriptFor(text, scalar, width, tagged));
        await assertLayout(page, text, width, width === 1000 ? 1 : 3);
        const values = (await evalText(page, [
          ".holder.t mark set insert 1.$n",
          ".holder.t tag add sel 1.0 1.$n",
          "update",
          "join [list [.holder.t tag ranges part] [.holder.t tag ranges sel] [.holder.t index insert] [.holder.t bbox insert] [.holder.t bbox 1.$n]] |",
        ].join("\n"))).split("|");
        expect(values[0]).toBe(tagged ? `1.0 1.${scalar}` : "");
        expect(values[1]).toBe(`1.0 1.${text.length}`);
        expect(values[2]).toBe(`1.${text.length}`);
        expect(values[3]).toBe(values[4]);
        const hits = (await evalText(page, [
          "set ys [lindex [.holder.t dlineinfo 1.$n] 1]",
          ".holder.t index @0,[expr {$ys+8}]",
        ].join("\n"))).split(".");
        expect(Number(hits[1])).toBe(width === 1000 ? 0 : text.length);
      });
    }
  }
}

for (const [name, text] of [
  ["keycap", "1\ufe0f\u20e3"],
  ["mid-surrogate ZWJ", "\ud83d\udc69\u200d\ud83d\udcbb"],
  ["mid-surrogate flag", "\ud83c\uddef\ud83c\uddf5"],
  ["VS heart", "\u2764\ufe0f"],
]) {
  test(`Tk tagged ${name} keeps full context at an ordinary line end`, async ({ page }) => {
    await openTextPage(page, scriptFor(text, 1, 1000, true));
    const oracle = await drawnTextRun(page, text);
    const width = Number(await evalText(page, "font measure {Helvetica -32} AAAAAA")) + oracle.advance - 1;
    await page.evaluate(() => { window.__textOracle.fills.length = 0; });
    const values = (await evalText(page, [
      ".holder.t insert 1.0 AAAAAA",
      `place configure .holder.t -width ${width}`,
      "update",
      "set rows {}",
      "for {set i 6} {$i < 6+$n} {incr i} {lappend rows [lindex [.holder.t dlineinfo 1.$i] 1]}",
      "join [list $rows [.holder.t get 1.0 end-1c]] |",
    ].join("\n"))).split("|");
    const rows = values[0].split(" ").map(Number);
    expect(rows).toEqual(new Array(text.length).fill(rows[0]));
    expect(rows[0]).toBeGreaterThan(0);
    expect(values[1]).toBe("AAAAAA" + text.repeat(3));
  });
}

for (const { name, text, scalar, tiny } of cases) {
  test(`Tk ${name} tag, selection, edits and resize invalidate context`, async ({ page }) => {
    await openTextPage(page, scriptFor(text, scalar, 1000, true));
    await assertLayout(page, text, 1000, 1);
    for (const [width, change] of [
      [tiny, ".holder.t tag configure part -foreground blue"],
      [1000, `.holder.t tag remove part 1.0 end\n.holder.t tag add part 1.$n 1.${text.length + scalar}`],
      [tiny, `.holder.t tag add sel 1.$n 1.${text.length + scalar}`],
      [1000, ".holder.t tag remove sel 1.0 end"],
      [tiny, `.holder.t delete 1.0 end\n.holder.t insert 1.0 [string repeat $prefix 3]\n.holder.t tag add part 1.0 1.${scalar}`],
    ]) {
      await evalText(page, `${change}\nplace configure .holder.t -width ${width}\nupdate`);
      await assertLayout(page, text, width, width === 1000 ? 1 : 3);
    }
  });
}

for (const [name, setup] of [
  ["newline", ".t insert 1.0 \"e\\n\\u0301\""],
  ["tab", ".t insert 1.0 \"e\\t\\u0301\""],
  ["image", "image create photo p -width 1 -height 1\n.t insert 1.0 e\n.t image create end -image p\n.t insert end \"\\u0301\""],
  ["window", "frame .t.child -width 1 -height 1\n.t insert 1.0 e\n.t window create end -window .t.child\n.t insert end \"\\u0301\""],
  ["elide", ".t insert 1.0 \"ex\\u0301\"\n.t tag configure hide -elide 1\n.t tag add hide 1.1 1.2"],
  ["font", ".t insert 1.0 \"e\\u0301\"\n.t tag configure other -font {Courier -32}\n.t tag add other 1.1 1.2"],
  ["offset", ".t insert 1.0 \"e\\u0301\"\n.t tag configure other -offset 4\n.t tag add other 1.1 1.2"],
]) {
  test(`Tk text context stops at ${name}`, async ({ page }) => {
    await openTextPage(page, [
      "text .t -font {Helvetica -32} -wrap char -width 30 -height 5",
      "pack .t", setup, "update", ".t count -displaylines 1.0 end",
    ].join("\n"));
    const fills = await page.evaluate(() => window.__textOracle.fills);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.some(fill => fill.text === "e\u0301"), JSON.stringify(fills)).toBe(false);
  });
}

for (const [name, text, scalar, tiny] of [
  ["mid-surrogate ZWJ", "\ud83d\udc69\u200d\ud83d\udcbb", 1, 31],
  ["mid-surrogate flag", "\ud83c\uddef\ud83c\uddf5", 1, 31],
  ["VS heart", "\u2764\ufe0f", 1, 31],
  ["keycap", "1\ufe0f\u20e3", 1, 31],
]) {
  test(`Tk ${name} multiple Tcl Unicode-unit tags retain context`, async ({ page }) => {
    await openTextPage(page, scriptFor(text, scalar, tiny, true, true));
    await evalText(page, [
      ".holder.t tag configure second -foreground blue",
      ".holder.t tag configure third -foreground green",
      ".holder.t tag add second 1.1 1.2",
      `.holder.t tag add third 1.${text.length + 1} 1.${text.length + 2}`,
      "update",
    ].join("\n"));
    await assertLayout(page, text, tiny, 3);
    const ranges = (await evalText(page,
      "join [list [.holder.t tag ranges part] [.holder.t tag ranges second] [.holder.t tag ranges third]] |")).split("|");
    expect(ranges).toEqual([`1.0 1.${scalar}`, "1.1 1.2", `1.${text.length + 1} 1.${text.length + 2}`]);
  });
}

for (const wrap of ["char", "word"]) {
  test(`Tk repeated RI units retain separate tags with ${wrap} wrap`, async ({ page }) => {
    const text = "\ud83c\uddef\ud83c\uddf5";
    await openTextPage(page, scriptFor(text, 1, 31, true, true));
    await evalText(page, [
      `.holder.t configure -wrap ${wrap}`,
      "for {set i 0} {$i < 3*$n} {incr i} {",
      "  .holder.t tag configure unit$i -foreground [lindex {red blue green} [expr {$i%3}]]",
      "  .holder.t tag add unit$i 1.$i 1.[expr {$i+1}]",
      "}",
      "update",
    ].join("\n"));
    await assertLayout(page, text, 31, 3);
  });
}

for (const text of ["\ud83c\uddef\ud83c\uddf5", "\ud83d\udc69\u200d\ud83d\udcbb"]) {
  test(`Tk literal ${text} paints intact across a surrogate-unit tag`, async ({ page }) => {
    await openTextPage(page, scriptFor(text, 1, 31, true));
    await drawnTextRun(page, text);
    const fills = await page.evaluate(() => window.__textOracle.fills
      .filter(fill => fill.font.startsWith("32px") && fill.text !== "|"));
    expect(fills.every(fill => fill.text === text), JSON.stringify(fills)).toBe(true);
    expect(await evalText(page, ".holder.t get 1.0 end-1c")).toBe(text.repeat(3));
    // Canonical UTF-8 split mid-scalar has a separate pre-existing B-tree
    // index-count issue; the Unicode-unit cases above check exact Tcl indices.
    expect(await evalText(page, ".holder.t tag ranges part")).toBe("1.0 1.1");
  });
}
