// @ts-check
/*
 * tk-browser-library.js --
 *
 *	Emscripten js-library bridge for Browser/WASM Tk. Link final wasm with:
 *
 *	    emcc ... --js-library browser/tk/js/tk-browser-library.js
 *
 *	Load tk-browser-dom.js before the generated Emscripten module, or provide
 *	Module.tkBrowserBackend with the same method names.
 */

// @ts-ignore Emscripten defines LibraryManager while processing js-library files.
const TkBrowserLibraryManager = LibraryManager;
// @ts-ignore Emscripten defines mergeInto while processing js-library files.
const TkBrowserMergeInto = mergeInto;

TkBrowserMergeInto(TkBrowserLibraryManager.library, {
  $TkBrowserBridge: {
    backend: null,

    getModule: function () {
      // @ts-ignore Module is provided by Emscripten generated code.
      return typeof Module !== "undefined" ? Module : null;
    },

    getBackend: function () {
      if (TkBrowserBridge.backend) {
        return TkBrowserBridge.backend;
      }
      var module = TkBrowserBridge.getModule();
      if (module && module["tkBrowserBackend"]) {
        TkBrowserBridge.backend = module["tkBrowserBackend"];
        return TkBrowserBridge.backend;
      }
      if (module && typeof module["tkBrowserCreateBackend"] === "function") {
        TkBrowserBridge.backend = module["tkBrowserCreateBackend"](module);
        module["tkBrowserBackend"] = TkBrowserBridge.backend;
        return TkBrowserBridge.backend;
      }
      if (
        typeof globalThis !== "undefined" &&
        globalThis["TkBrowserDOM"] &&
        typeof globalThis["TkBrowserDOM"]["createBackend"] === "function"
      ) {
        TkBrowserBridge.backend = globalThis["TkBrowserDOM"]["createBackend"]({
          root:
            module && module["tkBrowserRoot"]
              ? module["tkBrowserRoot"]
              : undefined,
          module: module || undefined,
        });
        if (module) {
          module["tkBrowserBackend"] = TkBrowserBridge.backend;
        }
      }
      return TkBrowserBridge.backend;
    },

    call: function (method, args) {
      var backend = TkBrowserBridge.getBackend();
      if (!backend || typeof backend[method] !== "function") {
        return 0;
      }
      var result = backend[method].apply(backend, args);
      return result === undefined ? 0 : result;
    },
  },

  TkBrowserJsInit__deps: ["$TkBrowserBridge"],
  TkBrowserJsInit: function (width, height, rootXid) {
    return TkBrowserBridge.call("init", [width, height, rootXid]) | 0;
  },

  TkBrowserJsCreateWindow__deps: ["$TkBrowserBridge"],
  TkBrowserJsCreateWindow: function (
    id,
    parent,
    x,
    y,
    width,
    height,
    depth,
    eventMask,
  ) {
    return (
      TkBrowserBridge.call("createWindow", [
        id,
        parent,
        x,
        y,
        width,
        height,
        depth,
        eventMask,
      ]) | 0
    );
  },

  TkBrowserJsCreatePixmap__deps: ["$TkBrowserBridge"],
  TkBrowserJsCreatePixmap: function (id, drawable, width, height, depth) {
    return (
      TkBrowserBridge.call("createPixmap", [
        id,
        drawable,
        width,
        height,
        depth,
      ]) | 0
    );
  },

  TkBrowserJsDestroyResource__deps: ["$TkBrowserBridge"],
  TkBrowserJsDestroyResource: function (id) {
    return TkBrowserBridge.call("destroyResource", [id]) | 0;
  },

  TkBrowserJsMapWindow__deps: ["$TkBrowserBridge"],
  TkBrowserJsMapWindow: function (id) {
    return TkBrowserBridge.call("mapWindow", [id]) | 0;
  },

  TkBrowserJsUnmapWindow__deps: ["$TkBrowserBridge"],
  TkBrowserJsUnmapWindow: function (id) {
    return TkBrowserBridge.call("unmapWindow", [id]) | 0;
  },

  TkBrowserJsConfigureWindow__deps: ["$TkBrowserBridge"],
  TkBrowserJsConfigureWindow: function (
    id,
    x,
    y,
    width,
    height,
    borderWidth,
    valueMask,
  ) {
    return (
      TkBrowserBridge.call("configureWindow", [
        id,
        x,
        y,
        width,
        height,
        borderWidth,
        valueMask,
      ]) | 0
    );
  },

  TkBrowserJsReparentWindow__deps: ["$TkBrowserBridge"],
  TkBrowserJsReparentWindow: function (id, parent, x, y) {
    return TkBrowserBridge.call("reparentWindow", [id, parent, x, y]) | 0;
  },

  TkBrowserJsClearWindow__deps: ["$TkBrowserBridge"],
  TkBrowserJsClearWindow: function (id) {
    return TkBrowserBridge.call("clearWindow", [id]) | 0;
  },

  TkBrowserJsCopyArea__deps: ["$TkBrowserBridge"],
  TkBrowserJsCopyArea: function (
    source,
    target,
    srcX,
    srcY,
    width,
    height,
    destX,
    destY,
  ) {
    return (
      TkBrowserBridge.call("copyArea", [
        source,
        target,
        srcX,
        srcY,
        width,
        height,
        destX,
        destY,
      ]) | 0
    );
  },

  TkBrowserJsDrawLine__deps: ["$TkBrowserBridge"],
  TkBrowserJsDrawLine: function (id, pixel, x1, y1, x2, y2) {
    return TkBrowserBridge.call("drawLine", [id, pixel, x1, y1, x2, y2]) | 0;
  },

  TkBrowserJsDrawRectangle__deps: ["$TkBrowserBridge"],
  TkBrowserJsDrawRectangle: function (id, pixel, x, y, width, height, fill) {
    return (
      TkBrowserBridge.call("drawRectangle", [
        id,
        pixel,
        x,
        y,
        width,
        height,
        !!fill,
      ]) | 0
    );
  },

  TkBrowserJsDrawText__deps: ["$TkBrowserBridge"],
  TkBrowserJsDrawText: function (id, pixel, x, y, utf8, utf8Length) {
    var text = "";
    if (utf8 && utf8Length > 0) {
      // @ts-ignore UTF8ToString is provided by Emscripten generated code.
      text = UTF8ToString(utf8, utf8Length);
    }
    return TkBrowserBridge.call("drawText", [id, pixel, x, y, text]) | 0;
  },

  TkBrowserJsPutImage__deps: ["$TkBrowserBridge"],
  TkBrowserJsPutImage: function (
    id,
    data,
    dataLength,
    srcX,
    srcY,
    destX,
    destY,
    width,
    height,
    bytesPerLine,
    bitsPerPixel,
  ) {
    var bytes = null;
    if (data && dataLength > 0) {
      // @ts-ignore HEAPU8 is provided by Emscripten generated code.
      bytes = HEAPU8.subarray(data, data + dataLength);
    }
    return (
      TkBrowserBridge.call("putImage", [
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
      ]) | 0
    );
  },

  TkBrowserJsFlush__deps: ["$TkBrowserBridge"],
  TkBrowserJsFlush: function () {
    return TkBrowserBridge.call("flush", []) | 0;
  },
});
