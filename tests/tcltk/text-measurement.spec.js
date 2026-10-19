// @ts-check

const { test, expect } = require("@playwright/test");
const {
  openTextPage, evalText, drawnTextRun, pixelBounds, measureTextProbe,
} = require("../support/text-oracle");

const clusters = [
  ["combining acute", "e\u0301"],
  ["regional indicator flag", "\ud83c\uddef\ud83c\uddf5"],
  ["ZWJ emoji", "\ud83d\udc69\u200d\ud83d\udcbb"],
];

for (const [name, prefix] of clusters) {
  test(`Tk measures ${name} by its drawn advance`, async ({ page }) => {
    const values = (await openTextPage(page, [
      `set prefix {${prefix}}`,
      "canvas .c -width 360 -height 80 -background white -highlightthickness 0",
      "pack .c",
      ".c create text 12 40 -anchor w -text ${prefix}| -font {Helvetica -32}",
      "update",
      "join [list [font measure {Helvetica -32} $prefix] [string length $prefix] [string length [encoding convertto utf-8 $prefix]] [winfo id .c]] |",
    ].join("\n"))).split("|").map(Number);
    const run = await drawnTextRun(page, prefix);
    expect((await pixelBounds(page, values[3])).count).toBeGreaterThan(20);
    expect(values[1], "Tcl indices remain UTF-16 units").toBe(prefix.length);
    expect(values[2], "external UTF-8 bytes are not Tcl indices")
      .toBe(Buffer.byteLength(prefix));
    expect(run.advance).toBeGreaterThan(0);
    expect(values[0], `font measure versus fillText: ${JSON.stringify(run)}`)
      .toBe(run.advance);
  });

  test(`Tk entry and text ${name} boundaries follow painted regions`, async ({ page }) => {
    const values = (await openTextPage(page, [
      `set prefix {${prefix}}`,
      "set value ${prefix}Mxyz",
      "set n [string length $prefix]",
      "entry .e -font {Helvetica -32} -width 18 -background white -borderwidth 0 -highlightthickness 0 -selectborderwidth 0 -selectbackground #00ff00 -selectforeground black -exportselection 0",
      "text .t -font {Helvetica -32} -width 18 -height 2 -background white -borderwidth 0 -highlightthickness 0 -padx 0 -pady 0 -selectborderwidth 0 -selectbackground #00ff00 -inactiveselectbackground #00ff00 -selectforeground black -exportselection 0",
      "canvas .c -width 200 -height 60 -background white -highlightthickness 0",
      "pack .e .t .c -anchor w",
      ".c create text 12 30 -anchor w -text ${prefix}| -font {Helvetica -32}",
      ".e insert 0 $value",
      ".t insert 1.0 $value",
      ".e icursor $n",
      ".t mark set insert 1.$n",
      ".e selection range 0 $n",
      ".t tag add sel 1.0 1.$n",
      "update",
      ["join [list [winfo id .e] [winfo id .t] [lindex [.e bbox 0] 0] [lindex [.e bbox insert] 0]",
        "[lindex [.t bbox 1.0] 0] [lindex [.t bbox insert] 0] [lindex [.t bbox 1.0] 1]",
        "[.e index insert] [.t index insert] [.e index sel.last] [.t index sel.last]",
        "[binary encode hex [encoding convertto utf-8 [string range [.e get] [.e index sel.first] [expr {[.e index sel.last]-1}]]]] [binary encode hex [encoding convertto utf-8 [.t get sel.first sel.last]]]] |"].join(" "),
    ].join("\n"))).split("|");
    const run = await drawnTextRun(page, prefix);
    const [entryId, textId, ex, eb, tx, tb, ty] = values.slice(0, 7).map(Number);
    expect(values.slice(7), "selection and caret preserve Tcl indices").toEqual([
      String(prefix.length), `1.${prefix.length}`, String(prefix.length),
      `1.${prefix.length}`, Buffer.from(prefix).toString("hex"), Buffer.from(prefix).toString("hex"),
    ]);
    const geometry = {
      entry: eb - ex,
      text: tb - tx,
      entrySelection: (await pixelBounds(page, entryId, "green")).width,
      textSelection: (await pixelBounds(page, textId, "green")).width,
    };
    expect(geometry, "bbox/caret/selection must end at the painted boundary").toEqual({
      entry: run.advance, text: run.advance,
      entrySelection: run.advance, textSelection: run.advance,
    });
    for (const delta of [-1, 0, 1]) {
      const hits = (await evalText(page, [
        `set eh [.e index @${ex + run.advance + delta}]`,
        `set th [.t index @${tx + run.advance + delta},${ty + 4}]`,
        "join [concat [.e bbox $eh] [.t bbox $th]] |",
      ].join("\n"))).split("|").map(Number);
      for (const [offset, origin] of [[0, ex], [4, tx]]) {
        const x = hits[offset] - origin;
        const width = hits[offset + 2];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(run.advance);
        if (delta >= 0) expect(x, "boundary hit affinity").toBe(run.advance);
        else expect(x + width, "left hit must cover the painted pixel")
          .toBeGreaterThanOrEqual(run.advance - 1);
      }
    }
    const boxes = (await evalText(page, [
      "set boxes {}",
      "for {set i 0} {$i <= $n} {incr i} {lappend boxes {*}[.e bbox $i] {*}[.t bbox 1.$i]}",
      "join $boxes |",
    ].join("\n"))).split("|").map(Number);
    for (const [offset, origin] of [[0, ex], [4, tx]]) {
      let previous = 0;
      for (let i = 0; i <= prefix.length; i++) {
        const x = boxes[i * 8 + offset] - origin;
        const width = boxes[i * 8 + offset + 2];
        expect(x, `full-context index ${i}`).toBeGreaterThanOrEqual(previous);
        expect(x).toBeLessThanOrEqual(run.advance);
        expect(width).toBeGreaterThanOrEqual(0);
        if (i < prefix.length) expect(x + width).toBeLessThanOrEqual(run.advance);
        previous = x;
      }
    }
  });
}

for (const [name, prefix] of [["ZWSP", "\u200b"], ["ZWJ", "\u200d"]]) {
  test(`Tk preserves a legitimate zero advance for ${name}`, async ({ page }) => {
    const measured = Number(await openTextPage(page, [
      `set prefix {${prefix}}`,
      "foreach c {.c .reference} {canvas $c -width 120 -height 70 -background white -highlightthickness 0; pack $c}",
      ".c create text 12 35 -anchor w -text ${prefix}| -font {Helvetica -32}",
      ".reference create text 12 35 -anchor w -text | -font {Helvetica -32}",
      "update",
      "font measure {Helvetica -32} $prefix",
    ].join("\n")));
    const run = await drawnTextRun(page, prefix);
    expect(run.advance, "the marker is painted at the original x").toBe(0);
    const images = await page.locator("[data-x11-wasm-xid] > canvas").evaluateAll((canvases) => {
      window.Module.x11WasmBackend.flush();
      return canvases.filter((canvas) => canvas.width === 120 && canvas.height === 70)
        .map((canvas) => Array.from(canvas.getContext("2d").getImageData(0, 0, 120, 70).data));
    });
    expect(images).toHaveLength(2);
    expect(images[0].filter((value, index) => index % 4 !== 3 && value < 80).length)
      .toBeGreaterThan(20);
    expect(images[0], "zero-width text must not displace or add painted pixels")
      .toEqual(images[1]);
    expect(measured, "zero is a valid width, not an unavailable-backend signal").toBe(0);
  });
}

test("Tk_MeasureChars retains ASCII flags and byte-limited context ranges", async ({ page }) => {
  await openTextPage(page, [
    "set value {ab cd}",
    "set context XX${value}TAIL",
    "set empty {}",
    "canvas .c -width 300 -height 70 -background white -highlightthickness 0",
    "pack .c",
    ".c create text 12 35 -anchor w -text ${value}| -font {Helvetica -32}",
    "update",
  ].join("\n"));
  const run = await drawnTextRun(page, "ab cd");
  expect(run.glyphs.map((glyph) => glyph.text)).toEqual(Array.from("ab cd"));
  const positions = [...run.glyphs.map((glyph) => glyph.x), run.advance];
  const cases = [];
  const expected = [];
  for (let flags = 0; flags < 8; flags++) {
    const whole = Boolean(flags & 1), least = Boolean(flags & 2), partial = Boolean(flags & 4);
    const limits = [
      [-7, 5],
      [0, least ? 1 : 0],
      [1, least || (!whole && partial) ? 1 : 0],
      [positions[1], whole && !least ? 0 : 1],
      [positions[2], 2],
      [positions[3] + 1, whole ? 2 : partial ? 4 : 3],
      [run.advance - 1, partial ? 5 : whole ? 2 : 4],
      [run.advance, 5],
    ];
    for (const [max, count] of limits) {
      for (const context of [false, true]) {
        cases.push({ variable: context ? "context" : "value", start: context ? 2 : 0,
          length: 5, max, flags, context });
        expected.push([count, positions[count], context ? 11 : 5]);
      }
    }
    for (const max of [-1, 0, 1]) {
      cases.push({ variable: "empty", max, flags });
      expected.push([0, 0, 0]);
    }
  }
  const results = await measureTextProbe(page, cases);
  results.forEach((result, index) => {
    expect(result, JSON.stringify(cases[index])).toEqual(expected[index]);
  });
});

for (const [name, prefix] of clusters) {
  for (const representation of ["literal", "Tcl Unicode"]) {
    test(`Tk native ${name} byte returns preserve ${representation} source`, async ({ page }) => {
      const codeUnits = Array.from({ length: prefix.length }, (_, index) =>
        prefix.charCodeAt(index));
      const source = representation === "literal"
        ? `set prefix {${prefix}}`
        : `set prefix [format ${"%c".repeat(codeUnits.length)} ${codeUnits.join(" ")}]`;
      const [prefixBytes, firstBytes, sourceBytes, indices] = (await openTextPage(page, [
        source,
        "set n [string length $prefix]",
        "set value ${prefix}Q",
        // string bytelength, not encoding convertto, describes the native source.
        `set first [string range $prefix 0 ${prefix.codePointAt(0) > 0xffff ? 1 : 0}]`,
        "canvas .c -width 300 -height 70 -background white -highlightthickness 0",
        "pack .c",
        `.c create text 12 35 -anchor w -text {${prefix}|} -font {Helvetica -32}`,
        "update",
        "join [list [string bytelength $prefix] [string bytelength $first] [string bytelength $value] $n] |",
      ].join("\n"))).split("|").map(Number);
      const run = await drawnTextRun(page, prefix);
      expect(indices).toBe(prefix.length);
      // A literal can retain canonical four-byte UTF-8, while Tcl string
      // operations can materialize six-byte surrogate pairs. Inspect this
      // actual source rather than assuming Buffer.byteLength describes it.
      const firstScalarBytes = prefix.codePointAt(0) > 0xffff && representation === "literal"
        ? (prefixBytes - Buffer.byteLength(prefix) === 0 ? 4 : firstBytes)
        : firstBytes;
      const requests = [];
      const expected = [];
      for (let flags = 0; flags < 8; flags++) {
        const whole = Boolean(flags & 1), least = Boolean(flags & 2), partial = Boolean(flags & 4);
        for (const context of [false, true]) {
          for (const [max, bytes, width] of [
            [0, least ? firstScalarBytes : 0, least ? run.advance : 0],
            [run.advance - 1, least || (!whole && partial) ? firstScalarBytes : 0,
              least || (!whole && partial) ? run.advance : 0],
            [run.advance, whole && !least ? 0 : prefixBytes,
              whole && !least ? 0 : run.advance],
          ]) {
            requests.push({ max, flags, context });
            expected.push([bytes, width, sourceBytes]);
          }
          requests.push({ length: prefixBytes, max: -7, flags, context });
          expected.push([prefixBytes, run.advance, sourceBytes]);
        }
        // The tail of an intact grapheme has zero advance in full context.
        requests.push({ start: firstScalarBytes, length: prefixBytes - firstScalarBytes,
          max: -1, flags, context: true });
        expected.push([prefixBytes - firstScalarBytes, 0, sourceBytes]);
      }
      const results = await measureTextProbe(page, requests);
      results.forEach((result, index) => {
        expect(result, JSON.stringify(requests[index])).toEqual(expected[index]);
      });
    });
  }
}

test("Tk native byte ranges retain embedded modified UTF-8 NUL", async ({ page }) => {
  const bytes = Number(await openTextPage(page, [
    "set value [format A%cB 0]",
    "string bytelength $value",
  ].join("\n")));
  expect(bytes).toBe(4);
  const requests = [];
  for (let flags = 0; flags < 8; flags++) {
    for (const context of [false, true]) {
      for (const [start, length] of [[0, 4], [0, 3], [1, 2], [3, 1], [4, 0], [0, 1]]) {
        requests.push({ start, length, max: -1, flags, context });
      }
    }
  }
  const results = await measureTextProbe(page, requests);
  results.forEach(([count, width, total], index) => {
    expect(count, JSON.stringify(requests[index])).toBe(requests[index].length);
    expect(total).toBe(4);
    expect(width).toBeGreaterThanOrEqual(0);
    if (count === 0) expect(width).toBe(0);
  });
  const whole = results[0][1];
  expect(whole, "bytes after NUL must still be measured").toBeGreaterThan(results[1][1]);
  expect(whole).toBe(results[5][1] + results[2][1] + results[3][1]);
});
