// @ts-check

const { test, expect } = require("@playwright/test");

test("Tk wm title updates the browser document title", async ({ page }) => {
  const title = "Browser Port WM Title";
  const childTitle = "Child WM Title";
  const script = [
    `wm title . {${title}}`,
    "toplevel .child",
    `wm title .child {${childTitle}}`,
    "update",
    "join [list [wm title .] [wm title .child] [winfo id .child]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toHaveLength(3);
  expect(result[0]).toBe(title);
  expect(result[1]).toBe(childTitle);
  const childId = Number.parseInt(result[2], 0);
  expect(childId).toBeGreaterThan(0);
  await expect(page).toHaveTitle(title);
  await expect(page.locator(`[data-x11-wasm-xid="${childId}"]`)).toHaveAttribute(
    "data-x11-wasm-title",
    childTitle,
  );
});

test("Tk wm iconname updates browser window metadata", async ({ page }) => {
  const iconName = "Browser Port Icon Name";
  const script = [
    "toplevel .iconname",
    `wm iconname .iconname {${iconName}}`,
    "update",
    "join [list ready [wm iconname .iconname] [winfo id .iconname]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual(["ready", iconName, expect.any(String)]);
  const windowId = Number.parseInt(result[2], 0);
  expect(windowId).toBeGreaterThan(0);
  await expect(page.locator(`[data-x11-wasm-xid="${windowId}"]`)).toHaveAttribute(
    "data-x11-wasm-icon-name",
    iconName,
  );
});

test("Tk wm iconposition updates browser WM_HINTS metadata", async ({
  page,
}) => {
  const script = [
    "toplevel .wmhints",
    "label .wmhints.l -text hints",
    "pack .wmhints.l",
    "update",
    "wm iconposition .wmhints 17 29",
    "update",
    "join [list ready [join [wm iconposition .wmhints] ,] [winfo id .wmhints]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual(["ready", "17,29", expect.any(String)]);
  const windowId = Number.parseInt(result[2], 0);
  expect(windowId).toBeGreaterThan(0);
  const hints = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate((element) => ({
      flags: Number.parseInt(
        element.getAttribute("data-x11-wasm-wm-hints-flags") || "0",
        10,
      ),
      input: element.getAttribute("data-x11-wasm-input-hint"),
      initialState: element.getAttribute("data-x11-wasm-initial-state"),
      iconX: element.getAttribute("data-x11-wasm-icon-x"),
      iconY: element.getAttribute("data-x11-wasm-icon-y"),
    }));
  expect(hints.flags & (1 << 0)).toBeTruthy();
  expect(hints.flags & (1 << 1)).toBeTruthy();
  expect(hints.flags & (1 << 4)).toBeTruthy();
  expect(hints.input).toBe("1");
  expect(hints.initialState).toBe("1");
  expect(hints.iconX).toBe("17");
  expect(hints.iconY).toBe("29");
});

test("Tk wm iconwindow displays browser icon proxy while iconic", async ({
  page,
}) => {
  const script = [
    "toplevel .iconOwner",
    "toplevel .iconProxy",
    "label .iconOwner.l -text owner",
    "label .iconProxy.l -text icon",
    "pack .iconOwner.l",
    "pack .iconProxy.l",
    "wm geometry .iconProxy 48x28",
    "wm iconwindow .iconOwner .iconProxy",
    "wm iconposition .iconOwner 31 43",
    "update",
    "set ownerId [winfo id .iconOwner]",
    "set iconId [winfo id .iconProxy]",
    "set iconPath [wm iconwindow .iconOwner]",
    "set iconPosition [join [wm iconposition .iconOwner] ,]",
    "wm iconify .iconOwner",
    "update",
    "list ready $ownerId $iconId $iconPath $iconPosition [wm state .iconOwner]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toHaveLength(6);
  expect(result[0]).toBe("ready");
  expect(result[3]).toBe(".iconProxy");
  expect(result[4]).toBe("31,43");
  expect(result[5]).toBe("iconic");
  const ownerId = Number.parseInt(result[1], 0);
  const iconId = Number.parseInt(result[2], 0);
  expect(ownerId).toBeGreaterThan(0);
  expect(iconId).toBeGreaterThan(0);

  const snapshot = await page.evaluate(async ({ ownerId, iconId }) => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot & { flush?: Function } } }} */ (
        window
      ).Module?.x11WasmBackend;
    backend?.flush?.();
    const owner = document.querySelector(`[data-x11-wasm-xid="${ownerId}"]`);
    const icon = document.querySelector(`[data-x11-wasm-xid="${iconId}"]`);
    if (!(owner instanceof HTMLElement) || !(icon instanceof HTMLElement)) {
      throw new Error("missing Tk iconwindow DOM elements");
    }
    return {
      iconDisplay: icon.style.display,
      iconLeft: icon.style.left,
      iconOwner: icon.getAttribute("data-x11-wasm-icon-owner"),
      iconProxyActive: icon.getAttribute("data-x11-wasm-icon-proxy-active"),
      iconProxyOwner: icon.getAttribute("data-x11-wasm-icon-proxy-owner"),
      iconProxyX: icon.getAttribute("data-x11-wasm-icon-proxy-x"),
      iconProxyY: icon.getAttribute("data-x11-wasm-icon-proxy-y"),
      iconTop: icon.style.top,
      iconViewable: icon.getAttribute("data-x11-wasm-viewable"),
      ownerDisplay: owner.style.display,
      ownerIconWindow: owner.getAttribute("data-x11-wasm-icon-window"),
      ownerState: owner.getAttribute("data-x11-wasm-wm-state"),
      ownerViewable: owner.getAttribute("data-x11-wasm-viewable"),
    };
  }, { ownerId, iconId });

  expect(snapshot).toEqual({
    iconDisplay: "",
    iconLeft: "31px",
    iconOwner: String(ownerId),
    iconProxyActive: "1",
    iconProxyOwner: String(ownerId),
    iconProxyX: "31",
    iconProxyY: "43",
    iconTop: "43px",
    iconViewable: "1",
    ownerDisplay: "none",
    ownerIconWindow: String(iconId),
    ownerState: "iconic",
    ownerViewable: "0",
  });
});

test("Tk wm iconbitmap updates browser icon metadata", async ({ page }) => {
  const script = [
    "toplevel .iconbitmap",
    "label .iconbitmap.l -text bitmap",
    "pack .iconbitmap.l",
    "update",
    "wm iconbitmap .iconbitmap questhead",
    "wm iconmask .iconbitmap questhead",
    "update",
    "join [list ready [wm iconbitmap .iconbitmap] [wm iconmask .iconbitmap] [winfo id .iconbitmap]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual(["ready", "questhead", "questhead", expect.any(String)]);
  const windowId = Number.parseInt(result[3], 0);
  expect(windowId).toBeGreaterThan(0);

  const icon = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate(async (element) => {
      const href = element.getAttribute("data-x11-wasm-icon-bitmap-href") || "";
      const image = new Image();
      image.src = href;
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing bitmap icon canvas context");
      }
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0;
      let opaque = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const alpha = data[offset + 3];
        if (alpha === 0) {
          transparent++;
        } else if (alpha === 255) {
          opaque++;
        }
      }
      const documentIcon = document.querySelector("link[data-x11-wasm-icon]");
      return {
        flags: Number.parseInt(
          element.getAttribute("data-x11-wasm-wm-hints-flags") || "0",
          10,
        ),
        pixmap: element.getAttribute("data-x11-wasm-icon-pixmap"),
        mask: element.getAttribute("data-x11-wasm-icon-mask"),
        href,
        width: Number.parseInt(
          element.getAttribute("data-x11-wasm-icon-bitmap-width") || "0",
          10,
        ),
        height: Number.parseInt(
          element.getAttribute("data-x11-wasm-icon-bitmap-height") || "0",
          10,
        ),
        documentHref: documentIcon?.getAttribute("href") || "",
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        transparent,
        opaque,
      };
    });
  expect(icon.flags & (1 << 2)).toBeTruthy();
  expect(icon.flags & (1 << 5)).toBeTruthy();
  expect(icon.pixmap).toMatch(/^\d+$/);
  expect(icon.mask).toMatch(/^\d+$/);
  expect(icon.href).toContain("data:image/png");
  expect(icon.documentHref).toBe(icon.href);
  expect(icon.width).toBe(icon.naturalWidth);
  expect(icon.height).toBe(icon.naturalHeight);
  expect(icon.naturalWidth).toBeGreaterThan(0);
  expect(icon.naturalHeight).toBeGreaterThan(0);
  expect(icon.transparent).toBeGreaterThan(0);
  expect(icon.opaque).toBeGreaterThan(0);
});

test("Tk wm iconbitmap accepts browser native app bitmap aliases", async ({
  page,
}) => {
  const cases = [
    { name: "stop", width: 17, height: 17 },
    { name: "note", width: 8, height: 21 },
    { name: "caution", width: 6, height: 19 },
    { name: "folder", width: 20, height: 22 },
    { name: "document", width: 17, height: 27 },
  ];
  const script = [
    `set names {${cases.map((entry) => entry.name).join(" ")}}`,
    "set result [list ready]",
    "foreach name $names {",
    "    set path .native_$name",
    "    toplevel $path",
    "    label $path.l -text $name",
    "    pack $path.l",
    "    update",
    "    wm iconbitmap $path $name",
    "    wm iconmask $path $name",
    "    update",
    "    lappend result $name [wm iconbitmap $path] [wm iconmask $path] [winfo id $path]",
    "}",
    "join $result |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result[0], `unexpected Tcl result: ${result.join("|")}`).toBe(
    "ready",
  );
  const windows = [];
  for (let index = 0; index < cases.length; index++) {
    const offset = 1 + index * 4;
    const entry = cases[index];
    expect(result[offset]).toBe(entry.name);
    expect(result[offset + 1]).toBe(entry.name);
    expect(result[offset + 2]).toBe(entry.name);
    const windowId = Number.parseInt(result[offset + 3], 0);
    expect(windowId).toBeGreaterThan(0);
    windows.push({ ...entry, windowId });
  }

  const icons = await page.evaluate(async (windows) => {
    return Promise.all(
      windows.map(async ({ name, windowId }) => {
        const element = document.querySelector(`[data-x11-wasm-xid="${windowId}"]`);
        if (!(element instanceof HTMLElement)) {
          throw new Error(`missing native icon window ${name}`);
        }
        const href = element.getAttribute("data-x11-wasm-icon-bitmap-href") || "";
        const image = new Image();
        image.src = href;
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        });
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("missing native icon canvas context");
        }
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height)
          .data;
        let transparent = 0;
        let opaque = 0;
        for (let offset = 0; offset < data.length; offset += 4) {
          const alpha = data[offset + 3];
          if (alpha === 0) {
            transparent++;
          } else if (alpha === 255) {
            opaque++;
          }
        }
        return {
          name,
          flags: Number.parseInt(
            element.getAttribute("data-x11-wasm-wm-hints-flags") || "0",
            10,
          ),
          pixmap: element.getAttribute("data-x11-wasm-icon-pixmap"),
          mask: element.getAttribute("data-x11-wasm-icon-mask"),
          href,
          width: Number.parseInt(
            element.getAttribute("data-x11-wasm-icon-bitmap-width") || "0",
            10,
          ),
          height: Number.parseInt(
            element.getAttribute("data-x11-wasm-icon-bitmap-height") || "0",
            10,
          ),
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          transparent,
          opaque,
        };
      }),
    );
  }, windows);

  for (const icon of icons) {
    const entry = cases.find((candidate) => candidate.name === icon.name);
    expect(entry, `unexpected icon ${icon.name}`).toBeTruthy();
    expect(icon.flags & (1 << 2)).toBeTruthy();
    expect(icon.flags & (1 << 5)).toBeTruthy();
    expect(icon.pixmap).toMatch(/^\d+$/);
    expect(icon.mask).toMatch(/^\d+$/);
    expect(icon.href).toContain("data:image/png");
    expect(icon.width).toBe(entry?.width);
    expect(icon.height).toBe(entry?.height);
    expect(icon.naturalWidth).toBe(entry?.width);
    expect(icon.naturalHeight).toBe(entry?.height);
    expect(icon.transparent).toBeGreaterThan(0);
    expect(icon.opaque).toBeGreaterThan(0);
  }
});

test("Tk wm iconphoto takes precedence over iconbitmap favicon", async ({
  page,
}) => {
  const script = [
    "toplevel .iconpriority",
    "label .iconpriority.l -text priority",
    "pack .iconpriority.l",
    "update",
    "wm iconbitmap .iconpriority questhead",
    "wm iconmask .iconpriority questhead",
    "image create photo priorityIcon -width 8 -height 8",
    "priorityIcon put #3366ff -to 0 0 8 8",
    "wm iconphoto .iconpriority priorityIcon",
    "update",
    "list ready [winfo id .iconpriority]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result).toEqual(["ready", expect.any(String)]);
  const windowId = Number.parseInt(result[1], 0);
  expect(windowId).toBeGreaterThan(0);

  const icon = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate((element) => {
      const documentIcon = document.querySelector("link[data-x11-wasm-icon]");
      return {
        bitmapHref: element.getAttribute("data-x11-wasm-icon-bitmap-href") || "",
        photoHref: element.getAttribute("data-x11-wasm-icon-photo-href") || "",
        photoWidth: element.getAttribute("data-x11-wasm-icon-photo-width"),
        photoHeight: element.getAttribute("data-x11-wasm-icon-photo-height"),
        documentHref: documentIcon?.getAttribute("href") || "",
      };
    });
  expect(icon.bitmapHref).toContain("data:image/png");
  expect(icon.photoHref).toContain("data:image/png");
  expect(icon.photoHref).not.toBe(icon.bitmapHref);
  expect(icon.photoWidth).toBe("8");
  expect(icon.photoHeight).toBe("8");
  expect(icon.documentHref).toBe(icon.photoHref);
});

test("Tk wm iconphoto updates browser icon metadata", async ({ page }) => {
  const script = [
    "toplevel .iconphoto",
    "label .iconphoto.l -text photo",
    "pack .iconphoto.l",
    "update",
    "image create photo icon16 -width 16 -height 16",
    "icon16 put #ff0000 -to 0 0 16 16",
    "image create photo icon32 -width 32 -height 32",
    "icon32 put #00ff00 -to 0 0 32 32",
    "wm iconphoto .iconphoto icon16 icon32",
    "update",
    "list ready [winfo id .iconphoto]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result).toEqual(["ready", expect.any(String)]);
  const windowId = Number.parseInt(result[1], 0);
  expect(windowId).toBeGreaterThan(0);
  const icon = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate(async (element) => {
      const href = element.getAttribute("data-x11-wasm-icon-photo-href") || "";
      const image = new Image();
      image.src = href;
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing icon canvas context");
      }
      context.drawImage(image, 0, 0);
      const center = Array.from(
        context.getImageData(
          Math.floor(image.naturalWidth / 2),
          Math.floor(image.naturalHeight / 2),
          1,
          1,
        ).data,
      );
      const documentIcon = document.querySelector("link[data-x11-wasm-icon]");
      return {
        count: element.getAttribute("data-x11-wasm-icon-photo-count"),
        sizes: element.getAttribute("data-x11-wasm-icon-photo-sizes"),
        width: element.getAttribute("data-x11-wasm-icon-photo-width"),
        height: element.getAttribute("data-x11-wasm-icon-photo-height"),
        href,
        documentHref: documentIcon?.getAttribute("href") || "",
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        center,
      };
    });
  expect(icon.count).toBe("2");
  expect(icon.sizes).toBe("16x16 32x32");
  expect(icon.width).toBe("32");
  expect(icon.height).toBe("32");
  expect(icon.href).toContain("data:image/png");
  expect(icon.documentHref).toBe(icon.href);
  expect(icon.naturalWidth).toBe(32);
  expect(icon.naturalHeight).toBe(32);
  expect(icon.center[0]).toBeLessThan(80);
  expect(icon.center[1]).toBeGreaterThan(180);
  expect(icon.center[2]).toBeLessThan(80);
  expect(icon.center[3]).toBe(255);
});

test("Tk window destroy refreshes browser favicon ownership", async ({
  page,
}) => {
  const fallbackScript = [
    "toplevel .fallbackIconOwner",
    "label .fallbackIconOwner.l -text fallback",
    "pack .fallbackIconOwner.l",
    "update",
    "image create photo fallbackIcon -width 8 -height 8",
    "fallbackIcon put #3366ff -to 0 0 8 8",
    "wm iconphoto .fallbackIconOwner fallbackIcon",
    "toplevel .staleIconOwner",
    "label .staleIconOwner.l -text stale",
    "pack .staleIconOwner.l",
    "update",
    "image create photo staleIcon -width 8 -height 8",
    "staleIcon put #ff0000 -to 0 0 8 8",
    "wm iconphoto .staleIconOwner staleIcon",
    "update",
    "set fallbackId [winfo id .fallbackIconOwner]",
    "set staleId [winfo id .staleIconOwner]",
    "destroy .staleIconOwner",
    "update",
    "list ready $fallbackId $staleId",
  ].join("\n");
  let query = new URLSearchParams({ eval: fallbackScript }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  let result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result).toEqual(["ready", expect.any(String), expect.any(String)]);
  const fallbackId = Number.parseInt(result[1], 0);
  const staleId = Number.parseInt(result[2], 0);
  expect(fallbackId).toBeGreaterThan(0);
  expect(staleId).toBeGreaterThan(0);

  let icon = await page.evaluate(([fallbackId, staleId]) => {
    const fallback = document.querySelector(`[data-x11-wasm-xid="${fallbackId}"]`);
    const stale = document.querySelector(`[data-x11-wasm-xid="${staleId}"]`);
    const documentIcon = document.querySelector("link[data-x11-wasm-icon]");
    return {
      fallbackHref: fallback?.getAttribute("data-x11-wasm-icon-photo-href") || "",
      stalePresent: Boolean(stale),
      documentHref: documentIcon?.getAttribute("href") || "",
    };
  }, [fallbackId, staleId]);
  expect(icon.fallbackHref).toContain("data:image/png");
  expect(icon.stalePresent).toBe(false);
  expect(icon.documentHref).toBe(icon.fallbackHref);

  const removalScript = [
    "toplevel .lastIconOwner",
    "label .lastIconOwner.l -text last",
    "pack .lastIconOwner.l",
    "update",
    "image create photo lastIcon -width 8 -height 8",
    "lastIcon put #00aa00 -to 0 0 8 8",
    "wm iconphoto .lastIconOwner lastIcon",
    "update",
    "set ownerId [winfo id .lastIconOwner]",
    "destroy .lastIconOwner",
    "update",
    "list ready $ownerId",
  ].join("\n");
  query = new URLSearchParams({ eval: removalScript }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result).toEqual(["ready", expect.any(String)]);
  const ownerId = Number.parseInt(result[1], 0);
  expect(ownerId).toBeGreaterThan(0);

  icon = await page.evaluate((ownerId) => {
    return {
      ownerPresent: Boolean(document.querySelector(`[data-x11-wasm-xid="${ownerId}"]`)),
      documentHref:
        document
          .querySelector("link[data-x11-wasm-icon]")
          ?.getAttribute("href") || "",
    };
  }, ownerId);
  expect(icon.ownerPresent).toBe(false);
  expect(icon.documentHref).toBe("");
});

test("Tk wm transient keeps dialog stacked above parent", async ({ page }) => {
  const script = [
    "set ::events {}",
    "proc ::record {event} {",
    "    lappend ::events $event",
    "    browser::setStatus [join $::events {|}]",
    "}",
    "toplevel .transientParent",
    "wm geometry .transientParent 160x120+30+30",
    "frame .transientParent.fill -width 160 -height 120 -background white",
    "pack .transientParent.fill -fill both -expand 1",
    "bind .transientParent.fill <ButtonPress-1> {::record parent}",
    "toplevel .transientDialog",
    "wm geometry .transientDialog 160x120+30+30",
    "frame .transientDialog.fill -width 160 -height 120 -background black",
    "pack .transientDialog.fill -fill both -expand 1",
    "bind .transientDialog.fill <ButtonPress-1> {::record dialog}",
    "wm transient .transientDialog .transientParent",
    "update",
    "raise .transientDialog",
    "update",
    "raise .transientParent",
    "update",
    "join [list ready [wm transient .transientDialog] [winfo id .transientDialog] [winfo id .transientParent]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual([
    "ready",
    ".transientParent",
    expect.any(String),
    expect.any(String),
  ]);
  const dialogId = Number.parseInt(result[2], 0);
  const parentId = Number.parseInt(result[3], 0);
  expect(dialogId).toBeGreaterThan(0);
  expect(parentId).toBeGreaterThan(0);
  await expect(page.locator(`[data-x11-wasm-xid="${dialogId}"]`)).toHaveAttribute(
    "data-x11-wasm-transient-for",
    String(parentId),
  );
  const stack = await page.evaluate(
    ({ dialogId, parentId }) => {
      const root = document.getElementById("tk-browser-root");
      const dialog = document.querySelector(`[data-x11-wasm-xid="${dialogId}"]`);
      const parent = document.querySelector(`[data-x11-wasm-xid="${parentId}"]`);
      if (!root || !dialog || !parent || !dialog.parentElement) {
        return {
          hitsDialog: false,
          hitsParent: false,
          parentIndex: -1,
          dialogIndex: -1,
        };
      }
      const stackElementFor = (element) => {
        let current = element;
        while (current.parentElement) {
          const parentWindow = current.parentElement.closest(
            ".x11-wasm-window",
          );
          if (!parentWindow) {
            break;
          }
          current = parentWindow;
        }
        return current;
      };
      const parentStack = stackElementFor(parent);
      const dialogStack = stackElementFor(dialog);
      const rect = root.getBoundingClientRect();
      const pointElement = document.elementFromPoint(
        rect.left + 60,
        rect.top + 60,
      );
      const siblings = Array.from(dialogStack.parentElement?.children || []);
      return {
        hitsDialog: dialog.contains(pointElement),
        hitsParent: parent.contains(pointElement),
        parentIndex: siblings.indexOf(parentStack),
        dialogIndex: siblings.indexOf(dialogStack),
      };
    },
    { dialogId, parentId },
  );
  expect(stack.hitsDialog).toBe(true);
  expect(stack.hitsParent).toBe(false);
  expect(stack.parentIndex).toBeGreaterThanOrEqual(0);
  expect(stack.dialogIndex).toBeGreaterThan(stack.parentIndex);

  await page.locator("#tk-browser-root").click({ position: { x: 60, y: 60 } });
  await expect(page.locator("#tk-browser-status")).toContainText("dialog");
  expect(
    ((await page.locator("#tk-browser-status").textContent()) || "").includes(
      "parent",
    ),
  ).toBe(false);
});

test("Tk wm protocol updates browser window metadata", async ({ page }) => {
  const protocolName = "MY_BROWSER_PROTOCOL";
  const script = [
    "toplevel .protocols",
    `wm protocol .protocols ${protocolName} {set ::customProtocol 1}`,
    "update",
    `join [list ready [join [lsort [wm protocol .protocols]] ,] [winfo id .protocols]] |`,
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual(["ready", protocolName, expect.any(String)]);
  const windowId = Number.parseInt(result[2], 0);
  expect(windowId).toBeGreaterThan(0);
  const protocolState = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate((element, id) => {
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      return {
        attribute: element.getAttribute("data-x11-wasm-protocols"),
        protocols: backend?.resources.get(id)?.protocols || [],
      };
    }, windowId);
  expect(protocolState.attribute?.split(/\s+/)).toEqual(
    expect.arrayContaining(["WM_DELETE_WINDOW", protocolName]),
  );
  expect(protocolState.protocols).toEqual(
    expect.arrayContaining(["WM_DELETE_WINDOW", protocolName]),
  );
});

test("browser backend dispatches WM_PROTOCOLS to Tk protocol handlers", async ({
  page,
}) => {
  const protocolName = "MY_BROWSER_PROTOCOL";
  const script = [
    "set ::customProtocol 0",
    "set ::deleteProtocol 0",
    "toplevel .protocolDispatch",
    `wm protocol .protocolDispatch ${protocolName} {incr ::customProtocol; browser::setStatus [list custom $::customProtocol $::deleteProtocol]}`,
    "wm protocol .protocolDispatch WM_DELETE_WINDOW {incr ::deleteProtocol; browser::setStatus [list delete $::customProtocol $::deleteProtocol]}",
    "update",
    "join [list ready [winfo id .protocolDispatch]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual(["ready", expect.any(String)]);
  const windowId = Number.parseInt(result[1], 0);
  expect(windowId).toBeGreaterThan(0);

  const dispatch = await page.evaluate(
    ({ id, protocol }) => {
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot & { dispatchWindowProtocol?: Function, requestWindowClose?: Function } } }} */ (
          window
        ).Module?.x11WasmBackend;
      if (!backend?.dispatchWindowProtocol || !backend?.requestWindowClose) {
        throw new Error("missing protocol dispatch helpers");
      }
      return {
        custom: backend.dispatchWindowProtocol(id, protocol),
        missing: backend.dispatchWindowProtocol(id, "NOT_REGISTERED"),
      };
    },
    { id: windowId, protocol: protocolName },
  );
  expect(dispatch.custom).toBe(1);
  expect(dispatch.missing).toBe(0);
  await expect(page.locator("#tk-browser-status")).toHaveText("custom 1 0");

  const close = await page.evaluate((id) => {
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot & { requestWindowClose?: Function } } }} */ (
        window
      ).Module?.x11WasmBackend;
    return backend?.requestWindowClose?.(id) || 0;
  }, windowId);
  expect(close).toBe(1);
  await expect(page.locator("#tk-browser-status")).toHaveText("delete 1 1");

  const domClose = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate((element, id) => {
      const event = new CustomEvent("x11wasmwindowclose", {
        bubbles: true,
        cancelable: true,
        detail: { time: 4242 },
      });
      const dispatchResult = element.dispatchEvent(event);
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      const resource = backend?.resources.get(id);
      return {
        dispatchResult,
        closeRequestCount: resource?.closeRequestCount,
        lastCloseRequestTime: resource?.lastCloseRequestTime,
        closeRequestStatus: resource?.closeRequestStatus,
        attrCount: element.getAttribute("data-x11-wasm-close-request-count"),
        attrTime: element.getAttribute("data-x11-wasm-close-request-time"),
        attrStatus: element.getAttribute("data-x11-wasm-close-request-status"),
      };
    }, windowId);
  expect(domClose).toEqual({
    dispatchResult: false,
    closeRequestCount: 2,
    lastCloseRequestTime: 4242,
    closeRequestStatus: "dispatched",
    attrCount: "2",
    attrTime: "4242",
    attrStatus: "dispatched",
  });
  await expect(page.locator("#tk-browser-status")).toHaveText("delete 1 2");
});

test("Tk wm command and class update browser window metadata", async ({
  page,
}) => {
  const command = "wish script.tcl --flag";
  const className = "meta";
  const classValue = "BrowserTool";
  const script = [
    `toplevel .${className} -class ${classValue}`,
    `wm command .${className} {${command}}`,
    "update",
    `join [list ready [wm command .${className}] [winfo name .${className}] [winfo class .${className}] [winfo id .${className}]] |`,
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual([
    "ready",
    command,
    className,
    classValue,
    expect.any(String),
  ]);
  const windowId = Number.parseInt(result[4], 0);
  expect(windowId).toBeGreaterThan(0);
  const window = page.locator(`[data-x11-wasm-xid="${windowId}"]`);
  await expect(window).toHaveAttribute("data-x11-wasm-command", command);
  await expect(window).toHaveAttribute("data-x11-wasm-class-name", className);
  await expect(window).toHaveAttribute("data-x11-wasm-class", classValue);
});

test("Tk wm command clear removes browser window metadata", async ({
  page,
}) => {
  const script = [
    "toplevel .commandClear",
    "wm command .commandClear {wish stale.tcl}",
    "update",
    "wm command .commandClear {}",
    "update",
    "join [list ready [wm command .commandClear] [winfo id .commandClear]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual(["ready", "", expect.any(String)]);
  const windowId = Number.parseInt(result[2], 0);
  expect(windowId).toBeGreaterThan(0);
  await expect(page.locator(`[data-x11-wasm-xid="${windowId}"]`)).not.toHaveAttribute(
    "data-x11-wasm-command",
    /.+/,
  );
});

test("Tk wm alpha updates browser window opacity", async ({ page }) => {
  const script = [
    "toplevel .alpha",
    "label .alpha.l -text alpha",
    "pack .alpha.l",
    "update",
    "wm attributes .alpha -alpha 0.5",
    "update",
    "join [list ready [wm attributes .alpha -alpha] [winfo id .alpha]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual(["ready", expect.any(String), expect.any(String)]);
  expect(Number.parseFloat(result[1])).toBeCloseTo(0.5, 5);
  const windowId = Number.parseInt(result[2], 0);
  expect(windowId).toBeGreaterThan(0);
  const alpha = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate((element) => ({
      style: Number.parseFloat(element.style.opacity || "1"),
      metadata: Number.parseFloat(element.getAttribute("data-x11-wasm-alpha") || "1"),
    }));
  expect(alpha.style).toBeCloseTo(0.5, 5);
  expect(alpha.metadata).toBeCloseTo(0.5, 5);
});

test("Tk wm state attributes update browser window metadata", async ({
  page,
}) => {
  const script = [
    "toplevel .state",
    "label .state.l -text state",
    "pack .state.l",
    "update",
    "wm attributes .state -topmost 1",
    "wm attributes .state -zoomed 1",
    "wm attributes .state -fullscreen 1",
    "update",
    "join [list ready [wm attributes .state -topmost] [wm attributes .state -zoomed] [wm attributes .state -fullscreen] [winfo id .state]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual(["ready", "1", "1", "1", expect.any(String)]);
  const windowId = Number.parseInt(result[4], 0);
  expect(windowId).toBeGreaterThan(0);
  const state = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate((element, id) => {
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      const resource = backend?.resources.get(id);
      const root = backend?.rootWindow
        ? backend.resources.get(backend.rootWindow)
        : undefined;
      return {
        topmostAttribute: element.getAttribute("data-x11-wasm-topmost"),
        zoomedAttribute: element.getAttribute("data-x11-wasm-zoomed"),
        fullscreenAttribute: element.getAttribute("data-x11-wasm-fullscreen"),
        topmost: resource?.topmost,
        zoomed: resource?.zoomed,
        fullscreen: resource?.fullscreen,
        zIndex: element.style.zIndex,
        left: element.style.left,
        top: element.style.top,
        width: element.style.width,
        height: element.style.height,
        rootWidth: root?.width || 0,
        rootHeight: root?.height || 0,
      };
    }, windowId);
  expect(state).toMatchObject({
    topmostAttribute: "1",
    zoomedAttribute: "1",
    fullscreenAttribute: "1",
    topmost: true,
    zoomed: true,
    fullscreen: true,
    zIndex: "1",
    left: "0px",
    top: "0px",
  });
  expect(state.rootWidth).toBeGreaterThan(0);
  expect(state.rootHeight).toBeGreaterThan(0);
  expect(state.width).toBe(`${state.rootWidth}px`);
  expect(state.height).toBe(`${state.rootHeight}px`);
});

test("Tk wm normal size hints update browser window metadata", async ({
  page,
}) => {
  const script = [
    "toplevel .sizehints",
    "label .sizehints.l -text hints",
    "pack .sizehints.l",
    "update",
    "wm minsize .sizehints 240 120",
    "wm maxsize .sizehints 360 220",
    "update",
    "join [list ready [join [wm minsize .sizehints] ,] [join [wm maxsize .sizehints] ,] [winfo id .sizehints]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual(["ready", "240,120", "360,220", expect.any(String)]);
  const windowId = Number.parseInt(result[3], 0);
  expect(windowId).toBeGreaterThan(0);
  const hints = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate((element) => ({
      flags: Number.parseInt(
        element.getAttribute("data-x11-wasm-size-hints-flags") || "0",
        10,
      ),
      minWidth: element.getAttribute("data-x11-wasm-min-width"),
      minHeight: element.getAttribute("data-x11-wasm-min-height"),
      maxWidth: element.getAttribute("data-x11-wasm-max-width"),
      maxHeight: element.getAttribute("data-x11-wasm-max-height"),
      widthInc: element.getAttribute("data-x11-wasm-width-inc"),
      heightInc: element.getAttribute("data-x11-wasm-height-inc"),
      styleMinWidth: getComputedStyle(element).minWidth,
      styleMinHeight: getComputedStyle(element).minHeight,
      styleMaxWidth: getComputedStyle(element).maxWidth,
      styleMaxHeight: getComputedStyle(element).maxHeight,
    }));
  expect(hints.flags & (1 << 4)).toBeTruthy();
  expect(hints.flags & (1 << 5)).toBeTruthy();
  expect(hints.flags & (1 << 6)).toBeTruthy();
  expect(hints.minWidth).toBe("240");
  expect(hints.minHeight).toBe("120");
  expect(hints.maxWidth).toBe("360");
  expect(hints.maxHeight).toBe("220");
  expect(hints.widthInc).toBe("1");
  expect(hints.heightInc).toBe("1");
  expect(hints.styleMinWidth).toBe("240px");
  expect(hints.styleMinHeight).toBe("120px");
	expect(hints.styleMaxWidth).toBe("360px");
	expect(hints.styleMaxHeight).toBe("220px");
});

test("Tk wm aspect applies exact aspect ratio to browser CSS", async ({
  page,
}) => {
  const script = [
    "toplevel .aspect",
    "label .aspect.l -text aspect",
    "pack .aspect.l",
    "update",
    "wm aspect .aspect 4 3 4 3",
    "update",
    "join [list ready [join [wm aspect .aspect] ,] [winfo id .aspect]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result).toEqual(["ready", "4,3,4,3", expect.any(String)]);
  const windowId = Number.parseInt(result[2], 0);
  expect(windowId).toBeGreaterThan(0);

  const hints = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate((element) => ({
      maxAspectX: element.getAttribute("data-x11-wasm-max-aspect-x"),
      maxAspectY: element.getAttribute("data-x11-wasm-max-aspect-y"),
      minAspectX: element.getAttribute("data-x11-wasm-min-aspect-x"),
      minAspectY: element.getAttribute("data-x11-wasm-min-aspect-y"),
      styleAspectRatio:
        element instanceof HTMLElement ? element.style.aspectRatio : "",
    }));
  expect(hints.minAspectX).toBe("4");
  expect(hints.minAspectY).toBe("3");
  expect(hints.maxAspectX).toBe("4");
  expect(hints.maxAspectY).toBe("3");
  expect(hints.styleAspectRatio).toBe("4 / 3");
});

test("Tk wm resizable constraints update browser window CSS", async ({
  page,
}) => {
  const script = [
    "toplevel .resizable",
    "label .resizable.l -text resizable",
    "pack .resizable.l",
    "wm geometry .resizable 260x160",
    "update",
    "wm resizable .resizable 0 1",
    "update",
    "join [list ready [join [wm resizable .resizable] ,] [winfo id .resizable] [winfo width .resizable] [winfo height .resizable]] |",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = (
    (await page.locator("#tk-browser-result").textContent()) || ""
  )
    .trim()
    .split("|");
  expect(result[0]).toBe("ready");
  expect(result[1]).toBe("0,1");
  const windowId = Number.parseInt(result[2], 0);
  const windowWidth = Number.parseInt(result[3], 10);
  expect(windowId).toBeGreaterThan(0);
  expect(windowWidth).toBeGreaterThan(0);

  const constraints = await page
    .locator(`[data-x11-wasm-xid="${windowId}"]`)
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
      };
    });
  expect(constraints.minWidth).toBe(`${windowWidth}px`);
  expect(constraints.maxWidth).toBe(`${windowWidth}px`);
});

test("Tk window attributes update browser DOM style", async ({ page }) => {
  const script = [
    "frame .styled -width 72 -height 48 -background #123456 -cursor xterm",
    "pack .styled",
    "update idletasks",
    "list ready [winfo id .styled]",
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
  const styledId = Number.parseInt(ready[1], 0);
  expect(styledId, `unexpected styled window id: ${ready[1]}`).toBeGreaterThan(
    0,
  );

  const style = await page
    .locator(`[data-x11-wasm-xid="${styledId}"]`)
    .evaluate(async (element) => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const computed = getComputedStyle(element);
      return {
        backgroundColor: computed.backgroundColor,
        cursor: computed.cursor,
      };
    });

  expect(style).toEqual({
    backgroundColor: "rgb(18, 52, 86)",
    cursor: "text",
  });
});

test("Tk override-redirect updates browser window attributes metadata", async ({
  page,
}) => {
  const script = [
    "toplevel .override",
    "label .override.l -text override",
    "pack .override.l",
    "update",
    "set windowId [winfo id .override]",
    "set frameId [wm frame .override]",
    "wm overrideredirect .override 1",
    "update",
    "list ready $windowId $frameId [wm overrideredirect .override]",
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
  expect(ready[3]).toBe("1");
  const windowId = Number.parseInt(ready[1], 0);
  const frameId = Number.parseInt(ready[2], 0);
  expect(windowId).toBeGreaterThan(0);
  expect(frameId).toBeGreaterThan(0);

  for (const id of [windowId, frameId]) {
    const attributes = await page
      .locator(`[data-x11-wasm-xid="${id}"]`)
      .evaluate((element) => ({
        overrideRedirect: element.getAttribute("data-x11-wasm-override-redirect"),
        bitGravity: element.getAttribute("data-x11-wasm-bit-gravity"),
        winGravity: element.getAttribute("data-x11-wasm-win-gravity"),
        backingStore: element.getAttribute("data-x11-wasm-backing-store"),
      }));
    expect(attributes).toEqual({
      overrideRedirect: "1",
      bitGravity: "1",
      winGravity: "1",
      backingStore: "0",
    });
  }
});

test("Tk accepts common named colors in windows and canvas", async ({ page }) => {
  const script = [
    "frame .named -width 48 -height 32 -background {light blue}",
    "frame .x11 -width 48 -height 32 -background {Dark Slate Gray}",
    "pack .named .x11 -side left",
    "pack [canvas .c -width 48 -height 32 -background white]",
    ".c create rectangle 4 4 44 28 -fill orange -outline {}",
    "update",
    "set yellow [winfo rgb . yellow]",
    "set gray75 [winfo rgb . gray75]",
    "set goldenrod [winfo rgb . {light goldenrod}]",
    "set alice [winfo rgb . {alice blue}]",
    "set dodger [winfo rgb . DodgerBlue]",
    "set green [winfo rgb . green]",
    "set lime [winfo rgb . lime]",
    "list ready [winfo id .named] [winfo id .x11] [winfo id .c] [lindex $yellow 0] [lindex $yellow 1] [lindex $yellow 2] [lindex $gray75 0] [lindex $gray75 1] [lindex $gray75 2] [lindex $goldenrod 0] [lindex $goldenrod 1] [lindex $goldenrod 2] [lindex $alice 0] [lindex $alice 1] [lindex $alice 2] [lindex $dodger 0] [lindex $dodger 1] [lindex $dodger 2] [lindex $green 0] [lindex $green 1] [lindex $green 2] [lindex $lime 0] [lindex $lime 1] [lindex $lime 2]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toHaveLength(25);
  expect(result[0]).toBe("ready");
  expect(result.slice(4, 7)).toEqual(["65535", "65535", "0"]);
  expect(result.slice(7, 10)).toEqual(["49087", "49087", "49087"]);
  expect(result.slice(10, 13)).toEqual(["61166", "56797", "33410"]);
  expect(result.slice(13, 16)).toEqual(["61680", "63736", "65535"]);
  expect(result.slice(16, 19)).toEqual(["7710", "37008", "65535"]);
  expect(result.slice(19, 22)).toEqual(["0", "32896", "0"]);
  expect(result.slice(22, 25)).toEqual(["0", "65535", "0"]);
  const frameId = Number.parseInt(result[1], 0);
  const x11FrameId = Number.parseInt(result[2], 0);
  const canvasId = Number.parseInt(result[3], 0);
  expect(frameId).toBeGreaterThan(0);
  expect(x11FrameId).toBeGreaterThan(0);
  expect(canvasId).toBeGreaterThan(0);

  const samples = await page.evaluate(
    async ({ frameId, x11FrameId, canvasId }) => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      const frame = document.querySelector(`[data-x11-wasm-xid="${frameId}"]`);
      const x11Frame = document.querySelector(`[data-x11-wasm-xid="${x11FrameId}"]`);
      const canvas = document.querySelector(
        `[data-x11-wasm-xid="${canvasId}"] > canvas`,
      );
      if (!(frame instanceof HTMLElement)) {
        throw new Error("missing named color frame");
      }
      if (!(x11Frame instanceof HTMLElement)) {
        throw new Error("missing X11 named color frame");
      }
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("missing named color canvas");
      }
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing named color canvas context");
      }
      return {
        backgroundColor: getComputedStyle(frame).backgroundColor,
        x11BackgroundColor: getComputedStyle(x11Frame).backgroundColor,
        orange: Array.from(context.getImageData(12, 12, 1, 1).data),
      };
    },
    { frameId, x11FrameId, canvasId },
  );

  expect(samples.backgroundColor).toBe("rgb(173, 216, 230)");
  expect(samples.x11BackgroundColor).toBe("rgb(47, 79, 79)");
  expect(samples.orange[0]).toBeGreaterThan(240);
  expect(samples.orange[1]).toBeGreaterThan(140);
  expect(samples.orange[1]).toBeLessThan(190);
  expect(samples.orange[2]).toBeLessThan(40);
  expect(samples.orange[3]).toBe(255);
});

test("Tk bitmap cursor maps to browser image cursor", async ({ page }) => {
  const script = [
    "set source [open cursor-source.xbm w]",
    "puts $source {#define cursor_source_width 8}",
    "puts $source {#define cursor_source_height 8}",
    "puts $source {#define cursor_source_x_hot 1}",
    "puts $source {#define cursor_source_y_hot 1}",
    "puts $source \"static unsigned char cursor_source_bits\\[\\] = {\"",
    "puts $source \"   0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81};\"",
    "close $source",
    "set mask [open cursor-mask.xbm w]",
    "puts $mask {#define cursor_mask_width 8}",
    "puts $mask {#define cursor_mask_height 8}",
    "puts $mask \"static unsigned char cursor_mask_bits\\[\\] = {\"",
    "puts $mask \"   0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff};\"",
    "close $mask",
    "frame .cursor -width 72 -height 48 -cursor {@cursor-source.xbm cursor-mask.xbm red blue}",
    "pack .cursor",
    "update idletasks",
    "list ready [winfo id .cursor]",
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
  const cursorId = Number.parseInt(ready[1], 0);
  expect(cursorId, `unexpected cursor window id: ${ready[1]}`).toBeGreaterThan(
    0,
  );

  const cursor = await page
    .locator(`[data-x11-wasm-xid="${cursorId}"]`)
    .evaluate(async (element) => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      return getComputedStyle(element).cursor;
    });

  expect(cursor).toContain("data:image/png");
  expect(cursor).toContain("auto");
});

test("Tk colored glyph cursors map to browser image cursors", async ({
  page,
}) => {
  const script = [
    "frame .colored -width 72 -height 48 -cursor {watch red blue}",
    "frame .foreground -width 72 -height 48 -cursor {watch red}",
    "pack .colored .foreground",
    "update idletasks",
    "list ready [winfo id .colored] [winfo id .foreground]",
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
  const coloredId = Number.parseInt(ready[1], 0);
  const foregroundId = Number.parseInt(ready[2], 0);
  expect(coloredId).toBeGreaterThan(0);
  expect(foregroundId).toBeGreaterThan(0);

  const samples = await page.evaluate(async ({ coloredId, foregroundId }) => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
        window
      ).Module?.x11WasmBackend;
    backend?.flush();

    const readCursorPixels = async (id) => {
      const element = document.querySelector(`[data-x11-wasm-xid="${id}"]`);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`missing cursor window ${id}`);
      }
      const cursor = getComputedStyle(element).cursor;
      const match = cursor.match(/url\("([^"]+)"\)/);
      if (!match) {
        throw new Error(`missing image cursor: ${cursor}`);
      }
      const image = new Image();
      image.src = match[1];
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("missing cursor canvas context");
      }
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      const counts = { red: 0, blue: 0, transparent: 0 };
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] || 0;
        const green = pixels[index + 1] || 0;
        const blue = pixels[index + 2] || 0;
        const alpha = pixels[index + 3] || 0;
        if (alpha === 0) {
          counts.transparent += 1;
        } else if (red > 200 && green < 80 && blue < 80) {
          counts.red += 1;
        } else if (blue > 200 && red < 80 && green < 80) {
          counts.blue += 1;
        }
      }
      return { cursor, counts };
    };

    return {
      colored: await readCursorPixels(coloredId),
      foreground: await readCursorPixels(foregroundId),
    };
  }, { coloredId, foregroundId });

  expect(samples.colored.cursor).toContain("data:image/png");
  expect(samples.colored.counts.red).toBeGreaterThan(0);
  expect(samples.colored.counts.blue).toBeGreaterThan(0);
  expect(samples.colored.counts.transparent).toBeGreaterThan(0);
  expect(samples.foreground.cursor).toContain("data:image/png");
  expect(samples.foreground.counts.red).toBeGreaterThan(0);
  expect(samples.foreground.counts.blue).toBe(0);
  expect(samples.foreground.counts.transparent).toBeGreaterThan(0);
});

test("Tk X cursor font shapes map to browser CSS cursors", async ({ page }) => {
  const cursorNames = [
    "question_arrow",
    "circle",
    "exchange",
    "bottom_tee",
    "left_tee",
    "cross_reverse",
    "box_spiral",
    "draft_large",
    "draft_small",
    "draped_box",
    "gobbler",
    "gumby",
    "heart",
    "spider",
    "spraycan",
    "star",
  ];
  const script = [
    "set ids {}",
    `set cursors {${cursorNames.join(" ")}}`,
    "set column 0",
    "foreach cursor $cursors {",
    "  set path .cursor$column",
    "  frame $path -width 32 -height 24 -cursor $cursor",
    "  grid $path -row 0 -column $column",
    "  lappend ids [winfo id $path]",
    "  incr column",
    "}",
    "update idletasks",
    "list ready {*}$ids",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result[0], `unexpected Tcl result: ${result.join(" ")}`).toBe("ready");
  const cursorIds = result.slice(1).map((id) => Number.parseInt(id, 0));
  expect(cursorIds).toHaveLength(cursorNames.length);
  for (const id of cursorIds) {
    expect(id).toBeGreaterThan(0);
  }

  const cursors = await page.evaluate(async (ids) => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
        window
      ).Module?.x11WasmBackend;
    backend?.flush();
    return ids.map((id) => {
      const element = document.querySelector(`[data-x11-wasm-xid="${id}"]`);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`missing cursor window ${id}`);
      }
      return getComputedStyle(element).cursor;
    });
  }, cursorIds);

  expect(cursors).toEqual([
    "help",
    "not-allowed",
    "copy",
    "ns-resize",
    "ew-resize",
    "crosshair",
    "progress",
    "crosshair",
    "crosshair",
    "default",
    "grab",
    "grab",
    "pointer",
    "grab",
    "crosshair",
    "pointer",
  ]);
});

test("Tk wm iconify and withdraw hide browser windows", async ({ page }) => {
  const script = [
    "toplevel .icon",
    "toplevel .withdrawn",
    "toplevel .restored",
    "foreach w {.icon .withdrawn .restored} {",
    "    label $w.l -text $w",
    "    pack $w.l",
    "}",
    "update",
    "set iconId [winfo id .icon]",
    "set iconFrame [wm frame .icon]",
    "set withdrawnId [winfo id .withdrawn]",
    "set withdrawnFrame [wm frame .withdrawn]",
    "set restoredId [winfo id .restored]",
    "wm iconify .icon",
    "wm withdraw .withdrawn",
    "wm withdraw .restored",
    "update",
    "set iconState [wm state .icon]",
    "set withdrawnState [wm state .withdrawn]",
    "wm deiconify .restored",
    "update",
    "list ready $iconId $iconFrame $iconState $withdrawnId $withdrawnFrame $withdrawnState $restoredId [wm state .restored]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toHaveLength(9);
  expect(result[0]).toBe("ready");
  expect(result[3]).toBe("iconic");
  expect(result[6]).toBe("withdrawn");
  expect(result[8]).toBe("normal");

  const iconId = Number.parseInt(result[1], 0);
  const iconFrameId = Number.parseInt(result[2], 0);
  const withdrawnId = Number.parseInt(result[4], 0);
  const withdrawnFrameId = Number.parseInt(result[5], 0);
  const restoredId = Number.parseInt(result[7], 0);
  for (const id of [
    iconId,
    iconFrameId,
    withdrawnId,
    withdrawnFrameId,
    restoredId,
  ]) {
    expect(id).toBeGreaterThan(0);
  }

  await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const backend =
      /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
        window
      ).Module?.x11WasmBackend;
    backend?.flush();
  });
  await expect(page.locator(`[data-x11-wasm-xid="${iconId}"]`)).toHaveAttribute(
    "data-x11-wasm-wm-state",
    "iconic",
  );
  await expect(page.locator(`[data-x11-wasm-xid="${withdrawnId}"]`)).toHaveAttribute(
    "data-x11-wasm-wm-state",
    "withdrawn",
  );
  await expect(page.locator(`[data-x11-wasm-xid="${restoredId}"]`)).toHaveAttribute(
    "data-x11-wasm-wm-state",
    "normal",
  );
  await expect(page.locator(`[data-x11-wasm-xid="${iconId}"]`)).toBeHidden();
  await expect(page.locator(`[data-x11-wasm-xid="${iconFrameId}"]`)).toBeHidden();
  await expect(page.locator(`[data-x11-wasm-xid="${withdrawnId}"]`)).toBeHidden();
  await expect(
    page.locator(`[data-x11-wasm-xid="${withdrawnFrameId}"]`),
  ).toBeHidden();
  await expect(page.locator(`[data-x11-wasm-xid="${restoredId}"]`)).toBeVisible();
});

test("Tk wm colormapwindows roundtrips window lists", async ({ page }) => {
  const script = [
    "toplevel .colors",
    "frame .colors.a -width 20 -height 20",
    "frame .colors.b -width 20 -height 20",
    "pack .colors.a .colors.b",
    "update",
    "wm colormapwindows .colors [list .colors.a .colors.b]",
    "list ready [join [wm colormapwindows .colors] {|}] [winfo id .colors] [winfo id .colors.a] [winfo id .colors.b]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toHaveLength(5);
  expect(result[0]).toBe("ready");
  expect(result[1]).toBe(".colors.a|.colors.b");
  const colorsId = Number.parseInt(result[2], 0);
  const firstId = Number.parseInt(result[3], 0);
  const secondId = Number.parseInt(result[4], 0);
  expect(colorsId).toBeGreaterThan(0);
  expect(firstId).toBeGreaterThan(0);
  expect(secondId).toBeGreaterThan(0);
  const colormapWindows = await page
    .locator(`[data-x11-wasm-xid="${colorsId}"]`)
    .getAttribute("data-x11-wasm-colormap-windows");
  expect(colormapWindows).not.toBeNull();
  const colormapWindowIds = (colormapWindows || "")
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 0));
  expect(colormapWindowIds).toHaveLength(3);
  expect(colormapWindowIds[0]).toBe(firstId);
  expect(colormapWindowIds[1]).toBe(secondId);
  expect(colormapWindowIds[2]).toBeGreaterThan(0);
});

test("Tk private colormap allocates and releases window colors", async ({
  page,
}) => {
  const script = [
    "toplevel .private -colormap new",
    "frame .private.a -width 24 -height 20 -background #123456",
    "frame .private.b -width 24 -height 20 -background #789abc",
    "pack .private.a .private.b -side left",
    "update",
    "set privateId [winfo id .private]",
    "destroy .private.a .private.b",
    "update",
    "frame .private.c -width 24 -height 20 -background #345678",
    "pack .private.c",
    "update",
    "set rgb [winfo rgb .private #345678]",
    "list ready $privateId [winfo id .private.c] [winfo colormapfull .private] {*}$rgb",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toHaveLength(7);
  expect(result[0]).toBe("ready");
  const privateId = Number.parseInt(result[1], 0);
  const colorFrameId = Number.parseInt(result[2], 0);
  expect(privateId).toBeGreaterThan(0);
  expect(colorFrameId).toBeGreaterThan(0);
  expect(result[3]).toBe("0");
  expect(result.slice(4)).toEqual(["13364", "22102", "30840"]);

  const privateColormap = await page
    .locator(`[data-x11-wasm-xid="${privateId}"]`)
    .getAttribute("data-x11-wasm-colormap");
  const colorFrameColormap = await page
    .locator(`[data-x11-wasm-xid="${colorFrameId}"]`)
    .getAttribute("data-x11-wasm-colormap");
  expect(Number.parseInt(privateColormap || "0", 10)).toBeGreaterThan(0);
  expect(colorFrameColormap).toBe(privateColormap);

  const backgroundColor = await page
    .locator(`[data-x11-wasm-xid="${colorFrameId}"]`)
    .evaluate(async (element) => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const backend =
        /** @type {Window & { Module?: { x11WasmBackend?: X11WasmBackendSnapshot } }} */ (
          window
        ).Module?.x11WasmBackend;
      backend?.flush();
      return getComputedStyle(element).backgroundColor;
    });

  expect(backgroundColor).toBe("rgb(52, 86, 120)");
});

test("Tk wm client machine updates window properties", async ({ page }) => {
  const script = [
    "toplevel .client",
    "label .client.l -text client",
    "pack .client.l",
    "toplevel .clientClear",
    "label .clientClear.l -text clear",
    "pack .clientClear.l",
    "update",
    "wm client .client BrowserClient",
    "wm client .clientClear StaleClient",
    "update",
    "set first [wm client .client]",
    "set clientId [winfo id .client]",
    "wm client .clientClear {}",
    "update",
    "list ready $first $clientId [wm client .clientClear] [winfo id .clientClear]",
  ].join("\n");
  const query = new URLSearchParams({ eval: script }).toString();

  await page.goto(`/tcltk.html?${query}`);
  await expect(page.locator("#tk-browser-status")).toHaveText("eval ok", {
    timeout: 15000,
  });
  const result = ((await page.locator("#tk-browser-result").textContent()) || "")
    .trim()
    .split(/\s+/);
  expect(result, `unexpected Tcl result: ${result.join(" ")}`).toHaveLength(5);
  expect(result[0]).toBe("ready");
  expect(result[1]).toBe("BrowserClient");
  expect(result[3]).toBe("{}");
  const clientId = Number.parseInt(result[2], 0);
  const clearId = Number.parseInt(result[4], 0);
  expect(clientId).toBeGreaterThan(0);
  expect(clearId).toBeGreaterThan(0);
  await expect(page.locator(`[data-x11-wasm-xid="${clientId}"]`)).toHaveAttribute(
    "data-x11-wasm-client-machine",
    "BrowserClient",
  );
  await expect(page.locator(`[data-x11-wasm-xid="${clearId}"]`)).not.toHaveAttribute(
    "data-x11-wasm-client-machine",
  );
});
