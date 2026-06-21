declare const LibraryManager: {
  library: Record<string, unknown>;
};

declare function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void;

declare const Module: {
  tkBrowserBackend?: unknown;
  tkBrowserCreateBackend?: (module: typeof Module) => unknown;
  tkBrowserRoot?: string | HTMLElement;
  _TkBrowserQueueKeyEvent?: (
    type: number,
    window: number,
    keySym: number,
    state: number,
    time: number,
  ) => number;
  _TkBrowserQueueKeyEventFields?: (
    type: number,
    window: number,
    keyCode: number,
    keySym: number,
    state: number,
    x: number,
    y: number,
    time: number,
  ) => number;
  _TkBrowserQueueTextEvent?: (
    window: number,
    codepoint: number,
    state: number,
    time: number,
  ) => number;
  _TkBrowserQueueCompositionEvent?: (
    phase: number,
    window: number,
    utf8: number,
    utf8Length: number,
  ) => number;
  _TkBrowserQueuePointerEvent?: (
    type: number,
    window: number,
    button: number,
    state: number,
    x: number,
    y: number,
    time: number,
  ) => number;
  _TkBrowserQueueCrossingEvent?: (
    type: number,
    window: number,
    state: number,
    x: number,
    y: number,
    time: number,
  ) => number;
  _TkBrowserQueueFocusEvent?: (
    type: number,
    window: number,
    time: number,
  ) => number;
  _TkBrowserQueueWheelEvent?: (
    window: number,
    delta: number,
    state: number,
    x: number,
    y: number,
    time: number,
  ) => number;
  _malloc?: (size: number) => number;
  _free?: (pointer: number) => void;
};

declare function UTF8ToString(pointer: number, maxBytesToRead?: number): string;

declare const HEAPU8: Uint8Array;

declare const TkBrowserBridge: any;

declare var TkBrowserDOM: {
  createBackend(options?: {
    root?: string | HTMLElement;
    document?: Document;
    module?: typeof Module;
  }): unknown;
  TkBrowserDOMBackend: unknown;
};
