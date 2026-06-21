// @ts-check
/*
 * tk-browser-dom.js --
 *
 *	Small DOM/canvas backend for the Browser/WASM Tk platform. This module
 *	is intentionally framework-free: the C side talks in XID-shaped resource
 *	operations, while this layer owns the browser representation.
 */

(function attachTkBrowserDOM(global) {
  "use strict";

  /** @typedef {"root" | "window" | "pixmap"} ResourceKind */

  /**
   * @typedef {object} TkBrowserDamage
   * @property {number} x
   * @property {number} y
   * @property {number} width
   * @property {number} height
   */

  /**
   * @typedef {object} TkBrowserResource
   * @property {number} id
   * @property {ResourceKind} kind
   * @property {number} parent
   * @property {number} x
   * @property {number} y
   * @property {number} width
   * @property {number} height
   * @property {number} borderWidth
   * @property {number} pendingX
   * @property {number} pendingY
   * @property {number} pendingWidth
   * @property {number} pendingHeight
   * @property {number} pendingBorderWidth
   * @property {number} depth
   * @property {number} eventMask
   * @property {boolean} mapped
   * @property {boolean} pendingMapped
   * @property {boolean} geometryDirty
   * @property {boolean} dirty
   * @property {TkBrowserDamage | null} damage
   * @property {number} damageSerial
   * @property {HTMLElement | null} element
   * @property {HTMLCanvasElement | OffscreenCanvas | null} canvas
   * @property {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null} context
   */

  /**
   * @typedef {object} TkBrowserBackendOptions
   * @property {string | HTMLElement=} root
   * @property {Document=} document
   * @property {any=} module
   */

  const RESOURCE_ATTR = "data-tk-xid";
  const STYLE_ID = "tk-browser-dom-style";
  const KEY_PRESS = 2;
  const KEY_RELEASE = 3;
  const BUTTON_PRESS = 4;
  const BUTTON_RELEASE = 5;
  const MOTION_NOTIFY = 6;
  const ENTER_NOTIFY = 7;
  const LEAVE_NOTIFY = 8;
  const FOCUS_IN = 9;
  const FOCUS_OUT = 10;
  const SHIFT_MASK = 1 << 0;
  const CONTROL_MASK = 1 << 2;
  const MOD1_MASK = 1 << 3;
  const BUTTON1_MASK = 1 << 8;
  const BUTTON2_MASK = 1 << 9;
  const BUTTON3_MASK = 1 << 10;
  const UNICODE_KEYSYM_BASE = 0x01000000;
  const COMPOSITION_START = 1;
  const COMPOSITION_UPDATE = 2;
  const COMPOSITION_END = 3;
  /** @type {Record<string, number>} */
  const KEY_SYMS = {
    Backspace: 0xff08,
    Tab: 0xff09,
    Enter: 0xff0d,
    Escape: 0xff1b,
    Home: 0xff50,
    ArrowLeft: 0xff51,
    ArrowUp: 0xff52,
    ArrowRight: 0xff53,
    ArrowDown: 0xff54,
    PageUp: 0xff55,
    PageDown: 0xff56,
    End: 0xff57,
    Insert: 0xff63,
    Delete: 0xffff,
  };

  /**
   * @param {number} value
   * @param {number} fallback
   * @returns {number}
   */
  function positiveInt(value, fallback) {
    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return Math.max(1, Math.floor(value));
  }

  /**
   * @param {number} pixel
   * @returns {string}
   */
  function pixelToCss(pixel) {
    const value = Number(pixel) >>> 0;
    const red = (value >> 16) & 0xff;
    const green = (value >> 8) & 0xff;
    const blue = value & 0xff;
    return `rgb(${red} ${green} ${blue})`;
  }

  /**
   * @param {number} codepoint
   * @returns {number}
   */
  function codepointToKeysym(codepoint) {
    if (codepoint <= 0xff) {
      return codepoint;
    }
    if (codepoint <= 0x10ffff) {
      return (UNICODE_KEYSYM_BASE | codepoint) >>> 0;
    }
    return 0;
  }

  /**
   * @param {KeyboardEvent | MouseEvent | PointerEvent} event
   * @returns {number}
   */
  function modifierState(event) {
    let state = 0;
    if (event.shiftKey) {
      state |= SHIFT_MASK;
    }
    if (event.ctrlKey) {
      state |= CONTROL_MASK;
    }
    if (event.altKey || event.metaKey) {
      state |= MOD1_MASK;
    }
    return state;
  }

  /**
   * @param {PointerEvent} event
   * @returns {number}
   */
  function pointerButtonStateFromButtons(event, buttons) {
    let state = modifierState(event);
    if (buttons & 1) {
      state |= BUTTON1_MASK;
    }
    if (buttons & 4) {
      state |= BUTTON2_MASK;
    }
    if (buttons & 2) {
      state |= BUTTON3_MASK;
    }
    return state;
  }

  /**
   * @param {PointerEvent} event
   * @returns {number}
   */
  function pointerButtonState(event) {
    return pointerButtonStateFromButtons(event, event.buttons);
  }

  /**
   * @param {number} button
   * @returns {number}
   */
  function domButtonMask(button) {
    if (button === 1) {
      return 4;
    }
    if (button === 2) {
      return 2;
    }
    return 1;
  }

  /**
   * @param {number} type
   * @param {PointerEvent} event
   * @returns {number}
   */
  function pointerEventButtonState(type, event) {
    let buttons = event.buttons;
    const buttonMask = domButtonMask(event.button);

    if (type === BUTTON_PRESS) {
      buttons &= ~buttonMask;
    } else if (type === BUTTON_RELEASE) {
      buttons |= buttonMask;
    }
    return pointerButtonStateFromButtons(event, buttons);
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {number}
   */
  function keySymForKeyboardEvent(event) {
    const mapped = KEY_SYMS[event.key];
    if (typeof mapped === "number") {
      return mapped;
    }
    if (event.key && event.key.length > 0) {
      const codepoint = event.key.codePointAt(0);
      return typeof codepoint === "number" ? codepointToKeysym(codepoint) : 0;
    }
    return 0;
  }

  /**
   * @param {KeyboardEvent} event
   * @param {number} keySym
   * @returns {number}
   */
  function keyCodeForKeyboardEvent(event, keySym) {
    const legacyCode = event.keyCode || event.which;
    if (legacyCode > 0) {
      return legacyCode;
    }
    const fallback = keySym & 0xff;
    return fallback > 0 ? fallback : 0;
  }

  /**
   * @param {PointerEvent} event
   * @returns {number}
   */
  function xButtonFromPointerEvent(event) {
    if (event.button === 1) {
      return 2;
    }
    if (event.button === 2) {
      return 3;
    }
    return 1;
  }

  /**
   * @param {number} value
   * @returns {number}
   */
  function eventTime(value) {
    return Math.max(0, Math.floor(value));
  }

  /**
   * @param {WheelEvent} event
   * @returns {number}
   */
  function wheelDeltaForEvent(event) {
    if (event.deltaY < 0) {
      return 120;
    }
    if (event.deltaY > 0) {
      return -120;
    }
    if (event.deltaX < 0) {
      return 120;
    }
    if (event.deltaX > 0) {
      return -120;
    }
    return 0;
  }

  /**
   * @param {Document} document
   */
  function ensureStyle(document) {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.tk-browser-root {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  touch-action: none;
  user-select: none;
}
.tk-browser-window {
  position: absolute;
  overflow: hidden;
  box-sizing: border-box;
  transform-origin: 0 0;
}
.tk-browser-window > canvas,
.tk-browser-root > canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.tk-browser-input {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  border: 0;
  padding: 0;
  opacity: 0;
  resize: none;
  pointer-events: none;
}
`;
    document.head.appendChild(style);
  }

  class TkBrowserDOMBackend {
    /**
     * @param {TkBrowserBackendOptions=} options
     */
    constructor(options = {}) {
      /** @private @type {Document | null} */
      this.document = options.document || global.document || null;
      /** @private @type {any} */
      this.module =
        options.module || (typeof Module !== "undefined" ? Module : null);
      /** @private @type {HTMLElement | null} */
      this.rootElement = null;
      /** @private @type {HTMLTextAreaElement | null} */
      this.inputElement = null;
      /** @private @type {Map<number, TkBrowserResource>} */
      this.resources = new Map();
      /** @private @type {Set<TkBrowserResource>} */
      this.dirtyResources = new Set();
      /** @private @type {string | HTMLElement | undefined} */
      this.rootOption = options.root;
      /** @private */
      this.rootWindow = 0;
      /** @private */
      this.lastPointerRootX = 0;
      /** @private */
      this.lastPointerRootY = 0;
      /** @private */
      this.composing = false;
      /** @private */
      this.compositionText = "";
      /** @private */
      this.listenersInstalled = false;
      /** @private @type {number | null} */
      this.capturedPointerId = null;
      /** @private @type {Element | null} */
      this.capturedPointerElement = null;
      /** @private */
      this.flushScheduled = false;
      /** @private */
      this.damageSerial = 1;
    }

    /**
     * @param {number} width
     * @param {number} height
     * @param {number} rootXid
     * @returns {number}
     */
    init(width, height, rootXid) {
      const document = this.document;
      if (!document) {
        return 0;
      }
      ensureStyle(document);
      const root = this.resolveRootElement();
      const rootWidth = positiveInt(width, 1024);
      const rootHeight = positiveInt(height, 768);
      root.classList.add("tk-browser-root");
      root.style.width = `${rootWidth}px`;
      root.style.height = `${rootHeight}px`;
      root.setAttribute(RESOURCE_ATTR, String(rootXid));
      root.tabIndex = root.tabIndex < 0 ? 0 : root.tabIndex;

      /** @type {HTMLCanvasElement | null} */
      let canvas = root.querySelector(":scope > canvas");
      if (!canvas) {
        canvas = document.createElement("canvas");
        root.insertBefore(canvas, root.firstChild);
      }
      canvas.width = rootWidth;
      canvas.height = rootHeight;

      this.rootElement = root;
      this.resources.set(rootXid, {
        id: rootXid,
        kind: "root",
        parent: 0,
        x: 0,
        y: 0,
        width: rootWidth,
        height: rootHeight,
        borderWidth: 0,
        pendingX: 0,
        pendingY: 0,
        pendingWidth: rootWidth,
        pendingHeight: rootHeight,
        pendingBorderWidth: 0,
        depth: 24,
        eventMask: 0,
        mapped: true,
        pendingMapped: true,
        geometryDirty: false,
        dirty: false,
        damage: null,
        damageSerial: 0,
        element: root,
        canvas,
        context: canvas.getContext("2d"),
      });
      this.rootWindow = rootXid;
      this.ensureInputElement();
      this.installEventListeners(root);
      return 0;
    }

    /**
     * @returns {HTMLElement}
     */
    resolveRootElement() {
      const document = this.document;
      if (!document) {
        throw new Error("TkBrowserDOMBackend requires a document");
      }
      if (this.rootOption instanceof global.HTMLElement) {
        return this.rootOption;
      }
      if (typeof this.rootOption === "string") {
        const found = document.querySelector(this.rootOption);
        if (found instanceof global.HTMLElement) {
          return found;
        }
      }
      let root = document.getElementById("tk-browser-root");
      if (!(root instanceof global.HTMLElement)) {
        root = document.createElement("div");
        root.id = "tk-browser-root";
        document.body.appendChild(root);
      }
      return root;
    }

    /**
     * @param {number} id
     * @param {number} parent
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {number} depth
     * @param {number} eventMask
     * @returns {number}
     */
    createWindow(id, parent, x, y, width, height, depth, eventMask) {
      const document = this.document;
      if (!document || !this.rootElement) {
        return 0;
      }
      const parentResource =
        this.resources.get(parent) || this.resources.values().next().value;
      const parentElement =
        parentResource && parentResource.element
          ? parentResource.element
          : this.rootElement;
      const element = document.createElement("div");
      const canvas = document.createElement("canvas");
      const resource = this.createResourceRecord(
        id,
        "window",
        parent,
        x,
        y,
        width,
        height,
        depth,
        eventMask,
        element,
        canvas,
      );

      element.className = "tk-browser-window";
      element.setAttribute(RESOURCE_ATTR, String(id));
      element.style.display = "none";
      element.appendChild(canvas);
      parentElement.appendChild(element);
      this.applyGeometry(resource);
      this.resources.set(id, resource);
      return 0;
    }

    /**
     * @param {number} id
     * @param {number} drawable
     * @param {number} width
     * @param {number} height
     * @param {number} depth
     * @returns {number}
     */
    createPixmap(id, drawable, width, height, depth) {
      const canvas = this.createCanvas(
        positiveInt(width, 1),
        positiveInt(height, 1),
      );
      const resource = this.createResourceRecord(
        id,
        "pixmap",
        drawable,
        0,
        0,
        width,
        height,
        depth,
        0,
        null,
        canvas,
      );
      this.resources.set(id, resource);
      return 0;
    }

    /**
     * @param {number} id
     * @returns {number}
     */
    destroyResource(id) {
      const resource = this.resources.get(id);
      if (!resource || resource.kind === "root") {
        return 0;
      }
      this.dirtyResources.delete(resource);
      if (resource.element && resource.element.parentNode) {
        resource.element.parentNode.removeChild(resource.element);
      }
      this.resources.delete(id);
      return 0;
    }

    /**
     * @param {number} id
     * @returns {number}
     */
    mapWindow(id) {
      const resource = this.resources.get(id);
      if (resource && resource.element) {
        resource.pendingMapped = true;
        this.markGeometryDirty(resource);
        this.markDirty(
          resource,
          0,
          0,
          resource.pendingWidth,
          resource.pendingHeight,
        );
      }
      return 0;
    }

    /**
     * @param {number} id
     * @returns {number}
     */
    unmapWindow(id) {
      const resource = this.resources.get(id);
      if (resource && resource.element) {
        resource.pendingMapped = false;
        this.markGeometryDirty(resource);
      }
      return 0;
    }

    /**
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {number} borderWidth
     * @param {number} valueMask
     * @returns {number}
     */
    configureWindow(id, x, y, width, height, borderWidth, valueMask) {
      const resource = this.resources.get(id);
      if (!resource) {
        return 0;
      }
      const nextWidth = positiveInt(width, resource.pendingWidth);
      const nextHeight = positiveInt(height, resource.pendingHeight);
      const sizeChanged =
        nextWidth !== resource.pendingWidth ||
        nextHeight !== resource.pendingHeight;

      resource.pendingX = x;
      resource.pendingY = y;
      resource.pendingWidth = nextWidth;
      resource.pendingHeight = nextHeight;
      resource.pendingBorderWidth = Math.max(0, Math.floor(borderWidth));
      void valueMask;
      this.markGeometryDirty(resource);
      if (sizeChanged) {
        this.markDirty(resource, 0, 0, nextWidth, nextHeight);
      }
      return 0;
    }

    /**
     * @param {number} id
     * @param {number} parent
     * @param {number} x
     * @param {number} y
     * @returns {number}
     */
    reparentWindow(id, parent, x, y) {
      const resource = this.resources.get(id);
      const parentResource = this.resources.get(parent);
      const parentElement =
        parentResource && parentResource.element
          ? parentResource.element
          : this.rootElement;

      if (!resource || !resource.element || !parentElement) {
        return 0;
      }
      resource.parent = parent;
      resource.pendingX = x;
      resource.pendingY = y;
      resource.x = x;
      resource.y = y;
      if (resource.element.parentNode !== parentElement) {
        parentElement.appendChild(resource.element);
      }
      this.markGeometryDirty(resource);
      return 0;
    }

    /**
     * @param {number} id
     * @returns {number}
     */
    clearWindow(id) {
      const context = this.getContext(id);
      const resource = this.resources.get(id);
      if (context && resource) {
        context.clearRect(0, 0, resource.width, resource.height);
        this.markDirty(resource, 0, 0, resource.width, resource.height);
      }
      return 0;
    }

    /**
     * @param {number} source
     * @param {number} target
     * @param {number} srcX
     * @param {number} srcY
     * @param {number} width
     * @param {number} height
     * @param {number} destX
     * @param {number} destY
     * @returns {number}
     */
    copyArea(source, target, srcX, srcY, width, height, destX, destY) {
      const sourceResource = this.resources.get(source);
      const targetContext = this.getContext(target);
      const targetResource = this.resources.get(target);
      if (!sourceResource || !sourceResource.canvas || !targetContext) {
        return 0;
      }
      if (sourceResource.geometryDirty) {
        this.flushResourceGeometry(sourceResource);
      }
      targetContext.drawImage(
        sourceResource.canvas,
        srcX,
        srcY,
        width,
        height,
        destX,
        destY,
        width,
        height,
      );
      if (targetResource) {
        this.markDirty(targetResource, destX, destY, width, height);
      }
      return 0;
    }

    /**
     * @param {number} id
     * @param {number} pixel
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @returns {number}
     */
    drawLine(id, pixel, x1, y1, x2, y2) {
      const context = this.getContext(id);
      const resource = this.resources.get(id);
      if (!context) {
        return 0;
      }
      context.strokeStyle = pixelToCss(pixel);
      context.beginPath();
      context.moveTo(x1 + 0.5, y1 + 0.5);
      context.lineTo(x2 + 0.5, y2 + 0.5);
      context.stroke();
      if (resource) {
        this.markDirty(
          resource,
          Math.min(x1, x2),
          Math.min(y1, y2),
          Math.abs(x2 - x1) + 1,
          Math.abs(y2 - y1) + 1,
        );
      }
      return 0;
    }

    /**
     * @param {number} id
     * @param {number} pixel
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {boolean} fill
     * @returns {number}
     */
    drawRectangle(id, pixel, x, y, width, height, fill) {
      const context = this.getContext(id);
      const resource = this.resources.get(id);
      if (!context) {
        return 0;
      }
      if (fill) {
        context.fillStyle = pixelToCss(pixel);
        context.fillRect(x, y, width, height);
        if (resource) {
          this.markDirty(resource, x, y, width, height);
        }
      } else {
        context.strokeStyle = pixelToCss(pixel);
        context.strokeRect(x + 0.5, y + 0.5, width, height);
        if (resource) {
          this.markDirty(resource, x, y, width + 1, height + 1);
        }
      }
      return 0;
    }

    /**
     * @param {number} id
     * @param {number} pixel
     * @param {number} x
     * @param {number} y
     * @param {string} text
     * @returns {number}
     */
    drawText(id, pixel, x, y, text) {
      const context = this.getContext(id);
      const resource = this.resources.get(id);
      if (!context || text.length === 0) {
        return 0;
      }
      context.fillStyle = pixelToCss(pixel);
      context.font = "14px sans-serif";
      context.textBaseline = "alphabetic";
      context.fillText(text, x, y);
      if (resource) {
        const metrics = context.measureText(text);
        const left = Math.floor(x + Math.min(0, metrics.actualBoundingBoxLeft));
        const top = Math.floor(y - (metrics.actualBoundingBoxAscent || 11));
        const width =
          Math.ceil(
            Math.max(
              metrics.width,
              metrics.actualBoundingBoxRight || 0,
              text.length * 8,
            ),
          ) + 2;
        const height =
          Math.ceil(
            (metrics.actualBoundingBoxAscent || 11) +
              (metrics.actualBoundingBoxDescent || 3),
          ) + 2;
        this.markDirty(resource, left, top, width, height);
      }
      return 0;
    }

    /**
     * @param {number} id
     * @param {Uint8Array | null} bytes
     * @param {number} srcX
     * @param {number} srcY
     * @param {number} destX
     * @param {number} destY
     * @param {number} width
     * @param {number} height
     * @param {number} bytesPerLine
     * @param {number} bitsPerPixel
     * @returns {number}
     */
    putImage(
      id,
      bytes,
      srcX,
      srcY,
      destX,
      destY,
      width,
      height,
      bytesPerLine,
      bitsPerPixel,
    ) {
      const context = this.getContext(id);
      const resource = this.resources.get(id);
      if (!context || !bytes || width <= 0 || height <= 0) {
        return 0;
      }
      const imageData = new ImageData(width, height);
      const bytesPerPixel = Math.max(1, Math.floor(bitsPerPixel / 8));
      let out = 0;
      for (let row = 0; row < height; row++) {
        const rowStart = (srcY + row) * bytesPerLine + srcX * bytesPerPixel;
        for (let col = 0; col < width; col++) {
          const source = rowStart + col * bytesPerPixel;
          if (source < 0 || source >= bytes.length) {
            out += 4;
            continue;
          }
          if (bitsPerPixel >= 24) {
            imageData.data[out++] = bytes[source + 2] || 0;
            imageData.data[out++] = bytes[source + 1] || 0;
            imageData.data[out++] = bytes[source] || 0;
            imageData.data[out++] = 255;
          } else if (bitsPerPixel >= 8) {
            const gray = bytes[source] || 0;
            imageData.data[out++] = gray;
            imageData.data[out++] = gray;
            imageData.data[out++] = gray;
            imageData.data[out++] = 255;
          } else {
            const byte = bytes[source >> 3] || 0;
            const bit = (byte >> (source & 7)) & 1;
            const value = bit ? 255 : 0;
            imageData.data[out++] = value;
            imageData.data[out++] = value;
            imageData.data[out++] = value;
            imageData.data[out++] = 255;
          }
        }
      }
      context.putImageData(imageData, destX, destY);
      if (resource) {
        this.markDirty(resource, destX, destY, width, height);
      }
      return 0;
    }

    /**
     * @returns {number}
     */
    flush() {
      this.flushScheduled = false;
      for (const resource of Array.from(this.dirtyResources)) {
        this.flushResource(resource);
      }
      this.dirtyResources.clear();
      return 0;
    }

    /**
     * @returns {HTMLTextAreaElement | null}
     */
    ensureInputElement() {
      const document = this.document;
      const root = this.rootElement;
      if (!document || !root) {
        return null;
      }
      if (this.inputElement) {
        return this.inputElement;
      }
      const input = document.createElement("textarea");
      input.className = "tk-browser-input";
      input.setAttribute("aria-hidden", "true");
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.rows = 1;
      input.value = "";
      root.appendChild(input);
      this.inputElement = input;
      return input;
    }

    /**
     * @param {HTMLElement} root
     */
    installEventListeners(root) {
      const input = this.ensureInputElement();
      if (!input || this.listenersInstalled) {
        return;
      }
      this.listenersInstalled = true;

      root.addEventListener("pointerdown", (event) => {
        this.queuePointerEvent(BUTTON_PRESS, event);
        this.capturePointer(root, event);
        input.focus();
        event.preventDefault();
      });
      root.addEventListener("pointerup", (event) => {
        this.queuePointerEvent(BUTTON_RELEASE, event);
        this.releasePointer(root, event);
        event.preventDefault();
      });
      root.addEventListener("pointermove", (event) => {
        this.queuePointerEvent(MOTION_NOTIFY, event);
      });
      root.addEventListener("pointerover", (event) => {
        this.queueCrossingEvent(ENTER_NOTIFY, event);
      });
      root.addEventListener("pointerout", (event) => {
        this.queueCrossingEvent(LEAVE_NOTIFY, event);
      });
      root.addEventListener(
        "wheel",
        (event) => {
          this.queueWheelEvent(event);
          event.preventDefault();
        },
        { passive: false },
      );
      root.addEventListener("lostpointercapture", () => {
        this.capturedPointerId = null;
        this.capturedPointerElement = null;
      });
      root.addEventListener("focus", () => {
        input.focus();
      });

      input.addEventListener("focus", (event) => {
        this.queueFocusEvent(FOCUS_IN, eventTime(event.timeStamp));
      });
      input.addEventListener("blur", (event) => {
        this.queueFocusEvent(FOCUS_OUT, eventTime(event.timeStamp));
      });
      input.addEventListener("keydown", (event) => {
        this.handleKeyDown(event);
      });
      input.addEventListener("keyup", (event) => {
        this.handleKeyUp(event);
      });
      input.addEventListener("compositionstart", (event) => {
        this.startComposition(event.data || "");
      });
      input.addEventListener("compositionupdate", (event) => {
        this.updateComposition(event.data || "");
      });
      input.addEventListener("compositionend", (event) => {
        this.endComposition(event.data || "");
      });
      input.addEventListener("beforeinput", (event) => {
        this.handleBeforeInput(event);
      });
      input.addEventListener("input", (event) => {
        if (event instanceof InputEvent && event.isComposing) {
          if (event.inputType === "insertCompositionText") {
            this.updateComposition(event.data || input.value);
          }
          return;
        }
        if (!this.composing) {
          this.flushInputText();
        }
      });
    }

    /**
     * @param {HTMLElement} root
     * @param {PointerEvent} event
     */
    capturePointer(root, event) {
      const captureTarget = root;

      if (typeof captureTarget.setPointerCapture === "function") {
        try {
          captureTarget.setPointerCapture(event.pointerId);
        } catch (error) {
          /* Pointer capture is opportunistic; event queueing still works. */
        }
      }
      this.capturedPointerId = event.pointerId;
      this.capturedPointerElement = captureTarget;
    }

    /**
     * @param {HTMLElement} root
     * @param {PointerEvent} event
     */
    releasePointer(root, event) {
      if (this.capturedPointerId !== event.pointerId) {
        return;
      }
      const captureTarget = this.capturedPointerElement || root;

      if (typeof captureTarget.releasePointerCapture === "function") {
        try {
          captureTarget.releasePointerCapture(event.pointerId);
        } catch (error) {
          /* The browser may have already released capture. */
        }
      }
      this.capturedPointerId = null;
      this.capturedPointerElement = null;
    }

    /**
     * @param {MouseEvent | PointerEvent | WheelEvent} event
     * @returns {{x: number, y: number}}
     */
    eventRootCoordinates(event) {
      const element = this.rootElement;
      if (!element) {
        return { x: 0, y: 0 };
      }
      const rect = element.getBoundingClientRect();
      const coordinates = {
        x: Math.floor(event.clientX - rect.left),
        y: Math.floor(event.clientY - rect.top),
      };
      this.lastPointerRootX = coordinates.x;
      this.lastPointerRootY = coordinates.y;
      return coordinates;
    }

    /**
     * @param {number} type
     * @param {PointerEvent} event
     */
    queueCrossingEvent(type, event) {
      const { x, y } = this.eventRootCoordinates(event);
      const queue = this.module && this.module["_TkBrowserQueueCrossingEvent"];
      if (typeof queue === "function") {
        queue(
          type,
          this.rootWindow,
          pointerButtonState(event),
          x,
          y,
          eventTime(event.timeStamp),
        );
      }
    }

    /**
     * @param {number} type
     * @param {number} time
     */
    queueFocusEvent(type, time) {
      const queue = this.module && this.module["_TkBrowserQueueFocusEvent"];
      if (typeof queue === "function") {
        queue(type, this.rootWindow, time);
      }
    }

    /**
     * @param {WheelEvent} event
     */
    queueWheelEvent(event) {
      const { x, y } = this.eventRootCoordinates(event);
      const queue = this.module && this.module["_TkBrowserQueueWheelEvent"];
      const delta = wheelDeltaForEvent(event);
      if (typeof queue === "function" && delta !== 0) {
        queue(
          this.rootWindow,
          delta,
          modifierState(event),
          x,
          y,
          eventTime(event.timeStamp),
        );
      }
    }

    /**
     * @param {number} type
     * @param {PointerEvent} event
     */
    queuePointerEvent(type, event) {
      const { x, y } = this.eventRootCoordinates(event);
      const queue = this.module && this.module["_TkBrowserQueuePointerEvent"];
      if (typeof queue === "function") {
        queue(
          type,
          this.rootWindow,
          xButtonFromPointerEvent(event),
          pointerEventButtonState(type, event),
          x,
          y,
          eventTime(event.timeStamp),
        );
      }
    }

    /**
     * @param {KeyboardEvent} event
     */
    handleKeyDown(event) {
      if (this.isImeKeyEvent(event)) {
        return;
      }
      if (this.isPlainTextKey(event)) {
        return;
      }
      const keySym = keySymForKeyboardEvent(event);
      if (keySym === 0) {
        return;
      }
      this.queueKeyEvent(
        KEY_PRESS,
        keySym,
        keyCodeForKeyboardEvent(event, keySym),
        modifierState(event),
        eventTime(event.timeStamp),
      );
      event.preventDefault();
    }

    /**
     * @param {KeyboardEvent} event
     */
    handleKeyUp(event) {
      if (this.isImeKeyEvent(event) || this.isPlainTextKey(event)) {
        return;
      }
      const keySym = keySymForKeyboardEvent(event);
      if (keySym === 0) {
        return;
      }
      this.queueKeyEvent(
        KEY_RELEASE,
        keySym,
        keyCodeForKeyboardEvent(event, keySym),
        modifierState(event),
        eventTime(event.timeStamp),
      );
      event.preventDefault();
    }

    /**
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    isImeKeyEvent(event) {
      return (
        event.isComposing ||
        this.composing ||
        event.key === "Process" ||
        event.keyCode === 229
      );
    }

    /**
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    isPlainTextKey(event) {
      return (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      );
    }

    /**
     * @param {InputEvent} event
     */
    handleBeforeInput(event) {
      if (event.isComposing || event.inputType === "insertCompositionText") {
        this.updateComposition(event.data || "");
      }
    }

    /**
     * @param {string} text
     */
    startComposition(text) {
      this.composing = true;
      this.compositionText = text;
      this.queueCompositionEvent(COMPOSITION_START, text);
    }

    /**
     * @param {string} text
     */
    updateComposition(text) {
      if (!this.composing) {
        this.startComposition(text);
        return;
      }
      if (text === this.compositionText) {
        return;
      }
      this.compositionText = text;
      this.queueCompositionEvent(COMPOSITION_UPDATE, text);
    }

    /**
     * @param {string} text
     */
    endComposition(text) {
      const input = this.inputElement;
      const finalText = text || (input ? input.value : "");

      this.composing = false;
      this.compositionText = "";
      this.queueCompositionEvent(COMPOSITION_END, finalText);
      this.flushInputText(finalText || undefined);
    }

    /**
     * @param {string=} textOverride
     */
    flushInputText(textOverride) {
      const input = this.inputElement;
      if (!input) {
        return;
      }
      const text =
        typeof textOverride === "string" ? textOverride : input.value;
      if (text.length === 0) {
        return;
      }
      input.value = "";
      for (const char of text) {
        const codepoint = char.codePointAt(0);
        const queue = this.module && this.module["_TkBrowserQueueTextEvent"];
        if (typeof codepoint === "number" && typeof queue === "function") {
          queue(this.rootWindow, codepoint, 0, 0);
        }
      }
    }

    /**
     * @param {string} text
     * @param {(pointer: number, byteLength: number) => number} callback
     * @returns {number}
     */
    withUtf8String(text, callback) {
      const module = this.module;
      const malloc = module && module["_malloc"];
      const free = module && module["_free"];

      if (typeof malloc !== "function") {
        return 0;
      }
      const bytes = new TextEncoder().encode(text);
      const pointer = malloc(bytes.length + 1);
      if (!pointer) {
        return 0;
      }
      HEAPU8.set(bytes, pointer);
      HEAPU8[pointer + bytes.length] = 0;
      try {
        return callback(pointer, bytes.length);
      } finally {
        if (typeof free === "function") {
          free(pointer);
        }
      }
    }

    /**
     * @param {number} phase
     * @param {string} text
     */
    queueCompositionEvent(phase, text) {
      const queue =
        this.module && this.module["_TkBrowserQueueCompositionEvent"];

      if (typeof queue !== "function") {
        return;
      }
      this.withUtf8String(text, (pointer, byteLength) =>
        queue(phase, this.rootWindow, pointer, byteLength),
      );
    }

    /**
     * @param {number} type
     * @param {number} keySym
     * @param {number} keyCode
     * @param {number} state
     * @param {number} time
     */
    queueKeyEvent(type, keySym, keyCode, state, time) {
      const queueFields =
        this.module && this.module["_TkBrowserQueueKeyEventFields"];
      if (typeof queueFields === "function") {
        queueFields(
          type,
          this.rootWindow,
          keyCode,
          keySym,
          state,
          this.lastPointerRootX,
          this.lastPointerRootY,
          time,
        );
        return;
      }
      const queue = this.module && this.module["_TkBrowserQueueKeyEvent"];
      if (typeof queue === "function") {
        queue(type, this.rootWindow, keySym, state, time);
      }
    }

    /**
     * @param {number} id
     * @param {ResourceKind} kind
     * @param {number} parent
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {number} depth
     * @param {number} eventMask
     * @param {HTMLElement | null} element
     * @param {HTMLCanvasElement | OffscreenCanvas | null} canvas
     * @returns {TkBrowserResource}
     */
    createResourceRecord(
      id,
      kind,
      parent,
      x,
      y,
      width,
      height,
      depth,
      eventMask,
      element,
      canvas,
    ) {
      const resourceWidth = positiveInt(width, 1);
      const resourceHeight = positiveInt(height, 1);
      if (canvas) {
        canvas.width = resourceWidth;
        canvas.height = resourceHeight;
      }
      return {
        id,
        kind,
        parent,
        x,
        y,
        width: resourceWidth,
        height: resourceHeight,
        borderWidth: 0,
        pendingX: x,
        pendingY: y,
        pendingWidth: resourceWidth,
        pendingHeight: resourceHeight,
        pendingBorderWidth: 0,
        depth,
        eventMask,
        mapped: false,
        pendingMapped: false,
        geometryDirty: false,
        dirty: false,
        damage: null,
        damageSerial: 0,
        element,
        canvas,
        context: canvas ? canvas.getContext("2d") : null,
      };
    }

    /**
     * @param {TkBrowserResource} resource
     */
    markGeometryDirty(resource) {
      resource.geometryDirty = true;
      this.dirtyResources.add(resource);
      this.scheduleFlush();
    }

    /**
     * @param {TkBrowserResource} resource
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     */
    markDirty(resource, x, y, width, height) {
      let damageX = Math.floor(x);
      let damageY = Math.floor(y);
      let damageWidth = Math.floor(width);
      let damageHeight = Math.floor(height);

      if (damageWidth <= 0 || damageHeight <= 0) {
        return;
      }
      if (damageX < 0) {
        damageWidth += damageX;
        damageX = 0;
      }
      if (damageY < 0) {
        damageHeight += damageY;
        damageY = 0;
      }
      if (
        damageX >= resource.pendingWidth ||
        damageY >= resource.pendingHeight
      ) {
        return;
      }
      damageWidth = Math.min(damageWidth, resource.pendingWidth - damageX);
      damageHeight = Math.min(damageHeight, resource.pendingHeight - damageY);
      if (damageWidth <= 0 || damageHeight <= 0) {
        return;
      }
      if (resource.damage) {
        const left = Math.min(resource.damage.x, damageX);
        const top = Math.min(resource.damage.y, damageY);
        const right = Math.max(
          resource.damage.x + resource.damage.width,
          damageX + damageWidth,
        );
        const bottom = Math.max(
          resource.damage.y + resource.damage.height,
          damageY + damageHeight,
        );
        resource.damage = {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        };
      } else {
        resource.damage = {
          x: damageX,
          y: damageY,
          width: damageWidth,
          height: damageHeight,
        };
      }
      resource.dirty = true;
      resource.damageSerial = this.damageSerial++;
      this.dirtyResources.add(resource);
      this.scheduleFlush();
    }

    scheduleFlush() {
      if (this.flushScheduled) {
        return;
      }
      this.flushScheduled = true;
      const window = this.document && this.document.defaultView;
      const callback = () => {
        this.flush();
      };

      if (window && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(callback);
      } else if (typeof global.setTimeout === "function") {
        global.setTimeout(callback, 0);
      }
    }

    /**
     * @param {TkBrowserResource} resource
     */
    flushResource(resource) {
      if (resource.geometryDirty) {
        this.flushResourceGeometry(resource);
      }
      resource.dirty = false;
      resource.damage = null;
    }

    /**
     * @param {TkBrowserResource} resource
     */
    flushResourceGeometry(resource) {
      resource.x = resource.pendingX;
      resource.y = resource.pendingY;
      resource.width = resource.pendingWidth;
      resource.height = resource.pendingHeight;
      resource.borderWidth = resource.pendingBorderWidth;
      resource.mapped = resource.pendingMapped;
      resource.geometryDirty = false;
      this.applyGeometry(resource);
    }

    /**
     * @param {number} width
     * @param {number} height
     * @returns {HTMLCanvasElement | OffscreenCanvas}
     */
    createCanvas(width, height) {
      if (typeof global.OffscreenCanvas === "function") {
        return new global.OffscreenCanvas(width, height);
      }
      if (!this.document) {
        throw new Error("TkBrowserDOMBackend requires a document");
      }
      const canvas = this.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }

    /**
     * @param {TkBrowserResource} resource
     */
    applyGeometry(resource) {
      if (!resource.element) {
        return;
      }
      resource.element.style.left = `${resource.x}px`;
      resource.element.style.top = `${resource.y}px`;
      resource.element.style.width = `${resource.width}px`;
      resource.element.style.height = `${resource.height}px`;
      resource.element.style.display = resource.mapped ? "" : "none";
      if (resource.canvas) {
        if (resource.canvas.width !== resource.width) {
          resource.canvas.width = resource.width;
        }
        if (resource.canvas.height !== resource.height) {
          resource.canvas.height = resource.height;
        }
      }
    }

    /**
     * @param {number} id
     * @returns {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null}
     */
    getContext(id) {
      const resource = this.resources.get(id);
      if (!resource) {
        return null;
      }
      if (resource.geometryDirty) {
        this.flushResourceGeometry(resource);
      }
      return resource.context;
    }
  }

  /**
   * @param {TkBrowserBackendOptions=} options
   * @returns {TkBrowserDOMBackend}
   */
  function createBackend(options) {
    return new TkBrowserDOMBackend(options);
  }

  global.TkBrowserDOM = {
    createBackend,
    TkBrowserDOMBackend,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
