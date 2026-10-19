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

test("text oracle waits for asynchronous update and propagates Tcl errors", async ({ page }) => {
  await openTextPage(page, "set oracleState ready");
  for (let serial = 1; serial <= 3; serial++) {
    expect(await evalText(page, `update\nset oracleState result${serial}`))
      .toBe(`result${serial}`);
  }
  await expect(evalText(page, "update\nerror {text oracle error sentinel}"))
    .rejects.toThrow("text oracle error sentinel");
  expect(await evalText(page, "update\nset oracleState recovered")).toBe("recovered");
});

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
        else expect([0, run.advance], "left or right caret affinity").toContain(x);
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
      const scalarUnits = prefix.codePointAt(0) > 0xffff ? 2 : 1;
      const scalarBoxes = Array.from({ length: scalarUnits }, (_, index) => ({
        x: boxes[index * 8 + offset] - origin,
        width: boxes[index * 8 + offset + 2],
      }));
      expect(Math.min(...scalarBoxes.map((box) => box.x))).toBe(0);
      expect(Math.max(...scalarBoxes.map((box) => box.x + box.width)),
        "the first Unicode scalar's Tcl-unit union covers its painted glyph")
        .toBe(run.advance);
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

for (const [name, prefix] of clusters) {
  test(`Tk ${name} wrap preserves glyphs at fitting and undersized widths`, async ({ page }) => {
    const glyphId = Number(await openTextPage(page, [
      `set prefix {${prefix}}`,
      "canvas .c -width 260 -height 70 -background white -highlightthickness 0",
      "canvas .glyph -width 260 -height 70 -background white -highlightthickness 0",
      "canvas .w -width 260 -height 200 -background white -highlightthickness 0",
      "frame .holder -width 260 -height 200",
      "pack .c .glyph .w .holder -anchor w",
      ".c create text 12 35 -anchor w -text ${prefix}| -font {Helvetica -32}",
      ".glyph create text 12 8 -anchor nw -text $prefix -font {Helvetica -32}",
      "text .holder.t -font {Helvetica -32} -wrap char -background white -borderwidth 0 -highlightthickness 0 -padx 0 -pady 0 -insertwidth 0",
      "update",
      "winfo id .glyph",
    ].join("\n")));
    const run = await drawnTextRun(page, prefix);
    const glyphPixels = (await pixelBounds(page, glyphId, "nonwhite")).count;
    expect(glyphPixels, "independent complete-glyph reference is nonblank").toBeGreaterThan(20);
    for (const width of [run.advance * 2, run.advance - 1, 1]) {
      await page.evaluate(() => { window.__textOracle.fills.length = 0; });
      const values = (await evalText(page, [
        ".w delete all",
        `set width ${width}`,
        "set value [string repeat $prefix 3]",
        ".w create text 12 8 -anchor nw -width $width -text $value -font {Helvetica -32}",
        "place .holder.t -x 0 -y 0 -width $width -height 200",
        ".holder.t delete 1.0 end",
        ".holder.t insert 1.0 $value",
        "update",
        "join [list [binary encode hex [encoding convertto utf-8 [.holder.t get 1.0 end-1c]]] [.holder.t count -displaylines 1.0 end] [winfo id .w]] |",
      ].join("\n"))).split("|");
      expect(values[0], `width=${width}: text content survives wrapping`)
        .toBe(Buffer.from(prefix.repeat(3)).toString("hex"));
      expect(Number(values[1]), "wrapping must make finite forward progress")
        .toBeLessThanOrEqual(prefix.length * 3 + 1);
      const fills = await page.evaluate(() => {
        window.Module.x11WasmBackend.flush();
        return Array.from(new Map(window.__textOracle.fills
          .map((fill) => [JSON.stringify(fill), fill])).values());
      });
      const complex = fills.filter((fill) => fill.font.startsWith("32px "));
      expect(complex.length, `width=${width}: a nonempty scene is required`)
        .toBeGreaterThanOrEqual(3);
      expect(complex.map((fill) => fill.text), `width=${width}: no re-shaped tail glyphs`)
        .not.toContain("\ufffd");
      expect(complex.every((fill) => fill.text === prefix),
        `width=${width}: complete glyphs only: ${JSON.stringify(complex)}`).toBe(true);
      const lines = new Set(complex.map((fill) => fill.y));
      expect(lines.size, `width=${width}: paint must actually wrap`).toBeGreaterThan(1);
      expect((await pixelBounds(page, Number(values[2]), "nonwhite")).count,
        `width=${width}: exactly three complete glyphs survive pixel readback`)
        .toBe(glyphPixels * 3);
    }
  });

  test(`Tk ${name} underline and xview track painted cluster boundaries`, async ({ page }) => {
    await openTextPage(page, [
      `set prefix {${prefix}}`,
      "canvas .c -width 300 -height 70 -background white -highlightthickness 0",
      "canvas .under -width 300 -height 70 -background white -highlightthickness 0",
      "entry .e -font {Helvetica -32} -width 4 -background white -borderwidth 0 -highlightthickness 0",
      "text .t -font {Helvetica -32} -width 4 -height 2 -wrap none -background white -borderwidth 0 -highlightthickness 0 -padx 0 -pady 0",
      "pack .c .under .e .t -anchor w",
      ".c create text 12 35 -anchor w -text ${prefix}| -font {Helvetica -32}",
      ".under create text 12 35 -anchor w -text $prefix -font {Helvetica -32 underline}",
      "set value [string repeat $prefix 12]",
      ".e insert 0 $value",
      ".t insert 1.0 $value",
      "update",
    ].join("\n"));
    const run = await drawnTextRun(page, prefix);
    const underlines = await page.evaluate(() => window.__textOracle.rectangles
      .filter((rect) => rect.color === "#000000" && rect.height > 0 && rect.height <= 3));
    expect(underlines.some((rect) => rect.width === run.advance),
      `underline extent must equal actual glyph advance: ${JSON.stringify(underlines)}`).toBe(true);
    const n = prefix.length * 6;
    const values = (await evalText(page, [
      `.e xview ${n}`,
      ".t xview moveto 0.5",
      "update",
      `join [list [lindex [.e bbox ${n}] 0] [lindex [.e bbox [expr {${n}+[string length $prefix]}]] 0] [lindex [.t bbox 1.${n}] 0] [lindex [.t bbox 1.[expr {${n}+[string length $prefix]}]] 0]] |`,
    ].join("\n"))).split("|").map(Number);
    expect(values.every(Number.isFinite), "scrolled cluster boundaries remain visible").toBe(true);
    expect(values[1] - values[0], "entry xview retains one painted cluster width")
      .toBe(run.advance);
    expect(values[3] - values[2], "text xview retains one painted cluster width")
      .toBe(run.advance);
  });

  test(`Tk canvas ${name} bbox, caret, selection and hits use full context`, async ({ page }) => {
    const values = (await openTextPage(page, [
      `set prefix {${prefix}}`,
      "set n [string length $prefix]",
      "canvas .reference -width 300 -height 70 -background white -highlightthickness 0",
      "canvas .c -width 300 -height 80 -background white -highlightthickness 0 -selectbackground #00ff00 -selectforeground black -selectborderwidth 0 -insertbackground #ff00ff -insertwidth 2 -insertofftime 0",
      "pack .reference .c -anchor w",
      ".reference create text 12 35 -anchor w -text ${prefix}| -font {Helvetica -32}",
      "set item [.c create text 40 12 -anchor nw -text ${prefix}M -font {Helvetica -32}]",
      ".c select from $item 0",
      ".c select to $item [expr {$n-1}]",
      ".c icursor $item $n",
      "update",
      "join [concat [list [winfo id .c] [.c index $item insert] [.c index $item sel.first] [.c index $item sel.last]] [.c bbox $item]] |",
    ].join("\n"))).split("|").map(Number);
    const run = await drawnTextRun(page, prefix);
    expect(values.slice(1, 4)).toEqual([prefix.length, 0, prefix.length - 1]);
    const selection = await pixelBounds(page, values[0], "green");
    expect(selection.count).toBeGreaterThan(0);
    expect(selection.left).toBe(40);
    expect(selection.width, "selection covers the drawn cluster, not an isolated tail")
      .toBe(run.advance);
    await evalText(page, ".c focus $item; focus -force .c; update");
    const caret = await pixelBounds(page, values[0], "magenta");
    expect(caret.count, "caret must actually be painted").toBeGreaterThan(0);
    expect(caret.left).toBe(40 + run.advance - 1);
    const widths = await evalText(page, "font measure {Helvetica -32} M");
    // Canvas text bboxes include one pixel of padding on each side.
    expect(values[6] - values[4]).toBe(run.advance + Number(widths) + 2);
    for (const delta of [-1, 0, 1]) {
      const index = Number(await evalText(page, `.c index $item @${40 + run.advance + delta},20`));
      if (delta >= 0) expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(prefix.length);
    }
    const selected = await evalText(page,
      "binary encode hex [encoding convertto utf-8 [selection get -selection PRIMARY]]");
    expect(selected).toBe(Buffer.from(prefix).toString("hex"));
  });
}
